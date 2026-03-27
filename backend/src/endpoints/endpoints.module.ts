import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EndpointsController } from './endpoints.controller';
import { EndpointsService } from './endpoints.service';
import { Endpoint } from './entities/endpoint.entity';
import { EndpointHostedRegion } from './entities/endpoint-hosted-region.entity';
import { EndpointProbeAssignment } from './entities/endpoint-probe-assignment.entity';
import { ProbeScanResult } from '../probes/entities/probe-scan-result.entity';
import { Probe } from '../probes/entities/probe.entity';
import { User } from '../users/entities/user.entity';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Endpoint,
      EndpointHostedRegion,
      EndpointProbeAssignment,
      ProbeScanResult,
      Probe,
      User,
    ]),
    AuthModule,
    BillingModule,
  ],
  controllers: [EndpointsController],
  providers: [EndpointsService],
  exports: [EndpointsService],
})
export class EndpointsModule {}
