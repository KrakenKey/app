import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { RateLimitCategoryDecorator } from '../throttler/decorators/rate-limit-category.decorator';
import { RateLimitCategory } from '../throttler/interfaces/rate-limit-category.enum';
import { AuthentikHealthIndicator } from './authentik.health';
import { RedisHealthIndicator } from './redis.health';

@Controller('health')
@ApiTags('Health')
@RateLimitCategoryDecorator(RateLimitCategory.PUBLIC)
export class HealthController {
  constructor(
    private readonly healthCheckService: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly redis: RedisHealthIndicator,
    private readonly authentik: AuthentikHealthIndicator,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Liveness check' })
  @ApiResponse({ status: 200, description: 'API is live' })
  health() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: process.env.KK_API_VERSION || '0.0.1',
      environment: process.env.NODE_ENV,
    };
  }

  @Get('readiness')
  @HealthCheck()
  @ApiOperation({
    summary: 'Readiness check — verifies DB, Redis, and Authentik',
  })
  @ApiResponse({ status: 200, description: 'All dependencies healthy' })
  @ApiResponse({
    status: 503,
    description: 'One or more dependencies unhealthy',
  })
  readiness() {
    return this.healthCheckService.check([
      () => this.db.pingCheck('db'),
      () => this.redis.isHealthy('redis'),
      () => this.authentik.isHealthy('auth'),
    ]);
  }
}
