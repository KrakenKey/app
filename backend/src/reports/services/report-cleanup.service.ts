import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ReportsService } from '../reports.service';

@Injectable()
export class ReportCleanupService {
  private readonly logger = new Logger(ReportCleanupService.name);

  constructor(private readonly reportsService: ReportsService) {}

  /**
   * Runs daily at 03:30. Deletes reports older than REPORT_RETENTION_DAYS
   * (their hosts cascade) and clears expired share links.
   */
  @Cron('30 3 * * *')
  async purge(): Promise<void> {
    const { reports, shares } = await this.reportsService.purgeExpired();
    this.logger.log(
      `Report cleanup: deleted ${reports} report(s), cleared ${shares} expired share link(s)`,
    );
  }
}
