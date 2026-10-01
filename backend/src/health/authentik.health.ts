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
    const issuerUrl = this.config.get<string>('KK_AUTHENTIK_ISSUER_URL');

    if (!issuerUrl) {
      return indicator.down({
        message: 'KK_AUTHENTIK_ISSUER_URL not configured',
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
      const resp = await fetch(
        `${issuerUrl.replace(/\/+$/, '')}/.well-known/openid-configuration`,
        { signal: controller.signal },
      );
      return resp.ok
        ? indicator.up()
        : indicator.down({ message: `HTTP ${resp.status}` });
    } catch (err) {
      return indicator.down({ message: (err as Error).message });
    } finally {
      clearTimeout(timeout);
    }
  }
}
