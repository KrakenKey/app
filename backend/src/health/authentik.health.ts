import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  HealthIndicatorResult,
  HealthIndicatorService,
} from '@nestjs/terminus';

@Injectable()
export class AuthentikHealthIndicator {
  constructor(
    private readonly config: ConfigService,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);
    const url = this.checkUrl();

    if (!url) {
      return indicator.down({
        message: 'KK_AUTHENTIK_ISSUER_URL not configured',
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
      const resp = await fetch(url, { signal: controller.signal });
      return resp.ok
        ? indicator.up()
        : indicator.down({ message: `HTTP ${resp.status}` });
    } catch (err) {
      return indicator.down({ message: (err as Error).message });
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * KK_AUTHENTIK_HEALTH_URL, when set, is fetched as is. It lets the check
   * reach Authentik directly (for example its /-/health/ready/ endpoint on a
   * private network) instead of going out through the public hostname on every
   * readiness call. Otherwise the check fetches the issuer's OIDC discovery
   * document. Login and token validation always use KK_AUTHENTIK_ISSUER_URL.
   */
  private checkUrl(): string | undefined {
    const healthUrl = this.config
      .get<string>('KK_AUTHENTIK_HEALTH_URL')
      ?.trim();
    if (healthUrl) {
      return healthUrl;
    }

    const issuerUrl = this.config.get<string>('KK_AUTHENTIK_ISSUER_URL');
    if (!issuerUrl) {
      return undefined;
    }
    return `${issuerUrl.replace(/\/+$/, '')}/.well-known/openid-configuration`;
  }
}
