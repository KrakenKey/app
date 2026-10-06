import {
  Inject,
  Injectable,
  Logger,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import { JwksClient } from 'jwks-rsa';
import { GITHUB_OIDC_ISSUER } from '@krakenkey/shared';

/** The claims KrakenKey relies on from a GitHub Actions OIDC token. */
export interface GithubOidcClaims {
  sub: string;
  repository: string;
  repository_id: string;
  repository_owner: string;
  repository_owner_id: string;
  ref?: string;
  sha?: string;
  environment?: string;
  workflow_ref?: string;
  run_id?: string;
  actor?: string;
  event_name?: string;
}

const REQUIRED = [
  'sub',
  'repository',
  'repository_id',
  'repository_owner',
  'repository_owner_id',
] as const;

/** Injection token to replace GitHub's JWKS client (tests). */
export const GITHUB_JWKS_CLIENT = 'GITHUB_JWKS_CLIENT';

/** Default `aud` the Action requests; override with KK_GITHUB_OIDC_AUDIENCE. */
export const DEFAULT_GITHUB_OIDC_AUDIENCE = 'https://api.krakenkey.io';

/**
 * Verifies GitHub Actions OIDC tokens: RS256 signature against GitHub's
 * published keys (cached, rotated by kid), issuer, audience and expiry.
 */
@Injectable()
export class GithubOidcVerifier {
  private readonly logger = new Logger(GithubOidcVerifier.name);
  private readonly jwks: Pick<JwksClient, 'getSigningKey'>;

  constructor(
    private readonly config: ConfigService,
    @Optional()
    @Inject(GITHUB_JWKS_CLIENT)
    jwks?: Pick<JwksClient, 'getSigningKey'>,
  ) {
    this.jwks =
      jwks ??
      new JwksClient({
        jwksUri: `${GITHUB_OIDC_ISSUER}/.well-known/jwks`,
        cache: true,
        cacheMaxAge: 3600_000,
        rateLimit: true,
        jwksRequestsPerMinute: 10,
        timeout: 10_000,
      });
  }

  audience(): string {
    return (
      this.config.get<string>('KK_GITHUB_OIDC_AUDIENCE') ||
      DEFAULT_GITHUB_OIDC_AUDIENCE
    );
  }

  async verify(token: string): Promise<GithubOidcClaims> {
    try {
      const decoded = jwt.decode(token, { complete: true });
      if (!decoded || typeof decoded === 'string') throw new Error('not a JWT');
      if (decoded.header.alg !== 'RS256') {
        throw new Error(`unexpected alg ${decoded.header.alg}`);
      }
      if (!decoded.header.kid) throw new Error('missing kid');
      const key = await this.jwks.getSigningKey(decoded.header.kid);
      const claims = jwt.verify(token, key.getPublicKey(), {
        algorithms: ['RS256'],
        issuer: GITHUB_OIDC_ISSUER,
        audience: this.audience(),
        clockTolerance: 60,
      }) as Record<string, unknown>;
      for (const name of REQUIRED) {
        if (typeof claims[name] !== 'string' || !claims[name]) {
          throw new Error(`missing claim ${name}`);
        }
      }
      return claims as unknown as GithubOidcClaims;
    } catch (err) {
      this.logger.warn(
        `GitHub OIDC token rejected: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new UnauthorizedException('Invalid GitHub OIDC token');
    }
  }
}
