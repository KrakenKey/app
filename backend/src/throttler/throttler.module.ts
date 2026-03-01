import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import Redis from 'ioredis';
import { TierAwareThrottlerGuard } from './guards/tier-aware-throttler.guard';
import { DefaultTierResolver } from './services/default-tier-resolver.service';
import { TIER_RESOLVER } from './interfaces/tier-resolver.interface';

@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        throttlers: [
          {
            name: 'default',
            ttl: 60_000,
            limit: 30,
          },
        ],
        storage: new ThrottlerStorageRedisService(
          new Redis({
            host: configService.get<string>('KK_BULLMQ_HOST', 'localhost'),
            port: parseInt(configService.get('KK_BULLMQ_PORT', '6379')),
            password:
              configService.get<string>('KK_BULLMQ_PASSWORD', '') || undefined,
            keyPrefix: 'throttle:',
          }),
        ),
      }),
    }),
  ],
  providers: [
    {
      provide: TIER_RESOLVER,
      useClass: DefaultTierResolver,
    },
    {
      provide: APP_GUARD,
      useClass: TierAwareThrottlerGuard,
    },
  ],
  exports: [TIER_RESOLVER],
})
export class KKThrottlerModule {}
