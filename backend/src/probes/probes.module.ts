import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProbesController } from './probes.controller';
import { ProbesService } from './probes.service';
import { ProbeMonitorService } from './services/probe-monitor.service';
import { ScanResultCleanupService } from './services/scan-result-cleanup.service';
import { Probe } from './entities/probe.entity';
import { ProbeScanResult } from './entities/probe-scan-result.entity';
import { Endpoint } from '../endpoints/entities/endpoint.entity';
import { EndpointHostedRegion } from '../endpoints/entities/endpoint-hosted-region.entity';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Probe,
      ProbeScanResult,
      Endpoint,
      EndpointHostedRegion,
    ]),
    AuthModule,
  ],
  controllers: [ProbesController],
  providers: [ProbesService, ProbeMonitorService, ScanResultCleanupService],
  exports: [ProbesService],
})
export class ProbesModule {}
