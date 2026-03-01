import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { AuthentikHealthIndicator } from './authentik.health';
import { HealthController } from './health.controller';
import { RedisHealthIndicator } from './redis.health';

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [RedisHealthIndicator, AuthentikHealthIndicator],
})
export class HealthModule {}
