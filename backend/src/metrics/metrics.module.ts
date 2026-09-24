import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { BullModule } from '@nestjs/bullmq';
import { MetricsService } from './metrics.service';
import { MetricsController } from './metrics.controller';
import { MetricsInterceptor } from './metrics.interceptor';
import { QueueMetricsService } from './queue-metrics.service';

@Global()
@Module({
  imports: [
    BullModule.registerQueue(
      { name: 'tlsCertIssuance' },
      { name: 'orgDissolution' },
    ),
  ],
  controllers: [MetricsController],
  providers: [
    MetricsService,
    QueueMetricsService,
    {
      provide: APP_INTERCEPTOR,
      useClass: MetricsInterceptor,
    },
  ],
  exports: [MetricsService],
})
export class MetricsModule {}
