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
    const domain = this.config.get<string>('KK_AUTHENTIK_DOMAIN');

    if (!domain) {
      return indicator.down({ message: 'KK_AUTHENTIK_DOMAIN not configured' });
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const resp = await fetch(
        `https://${domain}/application/o/.well-known/openid-configuration`,
        { signal: controller.signal },
      );
      clearTimeout(timeout);
      return resp.ok
        ? indicator.up()
        : indicator.down({ message: `HTTP ${resp.status}` });
    } catch (err) {
      return indicator.down({ message: (err as Error).message });
    }
  }
}
