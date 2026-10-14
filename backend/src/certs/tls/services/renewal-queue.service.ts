import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TlsService } from '../tls.service';

/**
 * Every minute: recovers certificates stuck in flight with no live job
 * (TlsService.recoverStuck), then starts queued renewals (past an
 * account's concurrent pending limit) once there is room. Most start right
 * away when an earlier job finishes; this sweep catches the rest, for
 * example a slot freed by a deleted certificate, or a start that failed
 * because Redis was briefly down.
 *
 * Safe to run in several API processes at once: startQueuedRenewals takes
 * a per-account advisory lock and gives each start its own job id.
 */
@Injectable()
export class RenewalQueueService {
  private readonly logger = new Logger(RenewalQueueService.name);
  private running = false;

  constructor(private readonly tlsService: TlsService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async startQueuedRenewals(): Promise<void> {
    // A slow sweep must not overlap the next one in the same process
    if (this.running) return;
    this.running = true;
    try {
      await this.tlsService.recoverStuck();
    } catch (err) {
      this.logger.warn(
        `Stuck certificate recovery failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    try {
      const userIds = await this.tlsService.findUsersWithQueuedRenewals();
      for (const userId of userIds) {
        await this.tlsService.startQueuedRenewalsSafely(userId);
      }
    } catch (err) {
      this.logger.warn(
        `Queued renewal sweep failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.running = false;
    }
  }
}
