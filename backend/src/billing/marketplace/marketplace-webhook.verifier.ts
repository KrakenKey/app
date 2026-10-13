import {
  Inject,
  Injectable,
  Logger,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { JwksClient } from 'jwks-rsa';
import {
  MARKETPLACE_RESOURCE_ID,
  MarketplaceConfig,
} from './marketplace.config';

/** Injection token to replace the Entra JWKS client (tests). */
export const MARKETPLACE_JWKS_CLIENT = 'MARKETPLACE_JWKS_CLIENT';

type SigningKeySource = Pick<JwksClient, 'getSigningKeys'>;

/**
 * An unknown key id triggers at most one key download per this interval,
 * so junk tokens can't keep the endpoint busy or crowd out a real refresh.
 */
const UNKNOWN_KID_REFRESH_MS = 5 * 60 * 1000;
/** Known keys are downloaded again after this long. */
const KEYS_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Verifies the bearer token Microsoft sends with every Marketplace webhook
 * call: an Entra ID access token signed with the keys published for
 * KrakenKey's tenant, issued by that tenant (v1 or v2 issuer, `tid`), for
 * KrakenKey's fulfillment app (`aud`), on behalf of the Marketplace SaaS API
 * (`appid` or `azp`), and not expired.
 */
@Injectable()
export class MarketplaceWebhookVerifier {
  private readonly logger = new Logger(MarketplaceWebhookVerifier.name);
  private source: SigningKeySource | null;
  private keys = new Map<string, string>();
  private fetchedAt = 0;
  private refreshing: Promise<void> | null = null;

  constructor(
    private readonly config: MarketplaceConfig,
    @Optional() @Inject(MARKETPLACE_JWKS_CLIENT) jwks?: SigningKeySource,
  ) {
    this.source = jwks ?? null;
  }

  private keySource(): SigningKeySource {
    this.source ??= new JwksClient({
      jwksUri: `https://login.microsoftonline.com/${encodeURIComponent(this.config.tenantId)}/discovery/v2.0/keys`,
      cache: false,
      rateLimit: false,
      timeout: 3000,
    });
    return this.source;
  }

  /** The PEM key for a key id, downloading the key set when needed. */
  private async publicKey(kid: string): Promise<string> {
    const age = Date.now() - this.fetchedAt;
    if (
      age > KEYS_MAX_AGE_MS ||
      (!this.keys.has(kid) && age > UNKNOWN_KID_REFRESH_MS)
    ) {
      this.refreshing ??= this.refreshKeys().finally(() => {
        this.refreshing = null;
      });
      await this.refreshing;
    }
    const key = this.keys.get(kid);
    if (!key) throw new Error('unknown kid');
    return key;
  }

  private async refreshKeys(): Promise<void> {
    try {
      const keys = await this.keySource().getSigningKeys();
      this.keys = new Map(keys.map((k) => [k.kid, k.getPublicKey()]));
    } catch (err) {
      this.logger.warn(
        `Could not download Entra signing keys: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      // Also after a failure, so a failing endpoint isn't asked on every call.
      this.fetchedAt = Date.now();
    }
  }

  /** Throws UnauthorizedException unless the Authorization header is valid. */
  async verify(authorization: string | undefined): Promise<void> {
    const { tenantId, clientId } = this.config;
    try {
      if (!tenantId || !clientId) throw new Error('tenant or client id unset');
      const match = /^Bearer\s+(\S+)$/i.exec(authorization ?? '');
      if (!match) throw new Error('missing bearer token');
      const token = match[1];

      const decoded = jwt.decode(token, { complete: true });
      if (!decoded || typeof decoded === 'string') throw new Error('not a JWT');
      if (decoded.header.alg !== 'RS256') {
        throw new Error(`unexpected alg ${decoded.header.alg}`);
      }
      if (!decoded.header.kid) throw new Error('missing kid');
      // Cheap checks before any key lookup; the signature check below is
      // what proves them.
      const unverified = decoded.payload as jwt.JwtPayload;
      if (unverified.tid !== tenantId) throw new Error('wrong tid');
      if (unverified.aud !== clientId) throw new Error('wrong aud');

      const key = await this.publicKey(decoded.header.kid);
      const claims = jwt.verify(token, key, {
        algorithms: ['RS256'],
        audience: clientId,
        issuer: [
          `https://sts.windows.net/${tenantId}/`,
          `https://login.microsoftonline.com/${tenantId}/v2.0`,
        ],
        clockTolerance: 60,
      }) as jwt.JwtPayload;

      if (typeof claims.exp !== 'number') throw new Error('missing exp');
      if (claims.tid !== tenantId) throw new Error('wrong tid');
      const caller = (claims.appid ?? claims.azp) as unknown;
      if (caller !== MARKETPLACE_RESOURCE_ID) {
        throw new Error('caller is not the Marketplace SaaS API');
      }
    } catch (err) {
      // The reason only; never the token.
      this.logger.warn(
        `Marketplace webhook token rejected: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new UnauthorizedException('Invalid Marketplace webhook token');
    }
  }
}
