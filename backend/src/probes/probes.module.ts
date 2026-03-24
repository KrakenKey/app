import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProbesController } from './probes.controller';
import { ProbesService } from './probes.service';
import { Probe } from './entities/probe.entity';
import { ProbeScanResult } from './entities/probe-scan-result.entity';
import { Domain } from '../domains/entities/domain.entity';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Probe, ProbeScanResult, Domain]),
    AuthModule,
  ],
  controllers: [ProbesController],
  providers: [ProbesService],
  exports: [ProbesService],
})
export class ProbesModule {}
