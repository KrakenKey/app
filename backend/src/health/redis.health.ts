import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  HealthIndicatorResult,
  HealthIndicatorService,
} from '@nestjs/terminus';
import Redis from 'ioredis';

@Injectable()
export class RedisHealthIndicator {
  constructor(
    private readonly config: ConfigService,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);
    const redis = new Redis({
      host: this.config.get<string>('KK_BULLMQ_HOST', 'localhost'),
      port: parseInt(this.config.get('KK_BULLMQ_PORT', '6379')),
      password: this.config.get<string>('KK_BULLMQ_PASSWORD', '') || undefined,
      connectTimeout: 3000,
      lazyConnect: true,
    });
    try {
      await redis.connect();
      await redis.ping();
      return indicator.up();
    } catch (err) {
      return indicator.down({ message: (err as Error).message });
    } finally {
      redis.disconnect();
    }
  }
}
