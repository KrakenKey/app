import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import type { AlertEvent } from '@krakenkey/shared';
import { NotificationChannel } from './entities/notification-channel.entity';
import type { AlertMessage, AlertPayload } from './alert-payloads';

export const NOTIFICATIONS_QUEUE = 'notifications';

export interface AlertJobData {
  channelId: string;
  message: AlertMessage;
}

export const ALERT_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: true,
  removeOnFail: 1000,
} as const;

/**
 * Fans an event out to the user's Slack, Teams and webhook channels. Each
 * subscribed channel gets its own queued job so one slow or broken
 * destination does not hold up the others.
 */
@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    @InjectRepository(NotificationChannel)
    private readonly channelRepo: Repository<NotificationChannel>,
    @InjectQueue(NOTIFICATIONS_QUEUE)
    private readonly queue: Queue<AlertJobData>,
  ) {}

  /**
   * Never throws: alerting must not break certificate issuance, monitoring
   * or probe reporting. Returns the number of jobs queued.
   */
  async emit(
    userId: string | undefined | null,
    event: AlertEvent,
    payload: AlertPayload,
  ): Promise<number> {
    if (!userId) return 0;
    try {
      const channels = await this.channelRepo.find({
        where: { userId, enabled: true },
        select: ['id', 'events'],
      });
      const targets = channels.filter((c) => c.events?.includes(event));
      if (targets.length === 0) return 0;

      const createdAt = new Date().toISOString();
      let queued = 0;
      for (const channel of targets) {
        const message: AlertMessage = {
          id: randomUUID(),
          event,
          createdAt,
          payload,
        };
        try {
          await this.queue.add(
            'deliver',
            { channelId: channel.id, message },
            { ...ALERT_JOB_OPTIONS, jobId: message.id },
          );
          queued++;
        } catch (err) {
          this.logger.error(
            `Failed to queue ${event} alert for channel ${channel.id}: ${errorMessage(err)}`,
          );
        }
      }
      return queued;
    } catch (err) {
      this.logger.error(
        `Failed to emit ${event} alert for user ${userId}: ${errorMessage(err)}`,
      );
      return 0;
    }
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
