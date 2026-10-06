import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { Report } from './entities/report.entity';
import { ReportHost } from './entities/report-host.entity';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { PublicReportsController } from './public-reports.controller';
import { ReportScanProcessor } from './processors/report-scan.processor';
import { ReportCleanupService } from './services/report-cleanup.service';
import { REPORT_QUEUE } from './reports.constants';
import { BillingModule } from '../billing/billing.module';
import { PublicScanModule } from '../public-scan/public-scan.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Report, ReportHost]),
    BullModule.registerQueue({ name: REPORT_QUEUE }),
    AuthModule,
    BillingModule,
    PublicScanModule,
  ],
  controllers: [ReportsController, PublicReportsController],
  providers: [ReportsService, ReportScanProcessor, ReportCleanupService],
})
export class ReportsModule {}
