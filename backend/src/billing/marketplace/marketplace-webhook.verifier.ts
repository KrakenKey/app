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

type SigningKeySource = Pick<JwksClient, 'getSigningKey'>;

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
  private jwks: SigningKeySource | null;

  constructor(
    private readonly config: MarketplaceConfig,
    @Optional() @Inject(MARKETPLACE_JWKS_CLIENT) jwks?: SigningKeySource,
  ) {
    this.jwks = jwks ?? null;
  }

  private keys(): SigningKeySource {
    this.jwks ??= new JwksClient({
      jwksUri: `https://login.microsoftonline.com/${encodeURIComponent(this.config.tenantId)}/discovery/v2.0/keys`,
      cache: true,
      cacheMaxAge: 3600_000,
      rateLimit: true,
      jwksRequestsPerMinute: 10,
      timeout: 3000,
    });
    return this.jwks;
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

      const key = await this.keys().getSigningKey(decoded.header.kid);
      const claims = jwt.verify(token, key.getPublicKey(), {
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
