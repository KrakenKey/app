import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { Repository } from 'typeorm';
import { MetricsService } from '../../metrics/metrics.service';
import { NotificationChannel } from './entities/notification-channel.entity';
import { NOTIFICATIONS_QUEUE, type AlertJobData } from './alerts.service';
import {
  ChannelDeliveryService,
  type DeliveryResult,
} from './channel-delivery.service';

export class AlertDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AlertDeliveryError';
  }
}

/**
 * Sends queued alerts. Network errors, 408, 429 and 5xx throw so BullMQ
 * retries with backoff; other 4xx are recorded as failed and not retried.
 * Every attempt records lastDeliveryAt/Status/Error on the channel.
 */
@Processor(NOTIFICATIONS_QUEUE)
export class AlertDeliveryProcessor extends WorkerHost {
  private readonly logger = new Logger(AlertDeliveryProcessor.name);

  constructor(
    @InjectRepository(NotificationChannel)
    private readonly channelRepo: Repository<NotificationChannel>,
    private readonly delivery: ChannelDeliveryService,
    private readonly metrics: MetricsService,
  ) {
    super();
  }

  async process(job: Job<AlertJobData>): Promise<{ ok: boolean }> {
    const { channelId, message } = job.data;
    const channel = await this.channelRepo.findOne({
      where: { id: channelId },
    });
    if (!channel || !channel.enabled) {
      // Deleted or disabled after the alert was queued.
      return { ok: false };
    }

    const result = await this.delivery.deliver(channel, message);
    await recordDelivery(this.channelRepo, channel.id, result);

    const attemptNumber = (job.attemptsMade ?? 0) + 1;
    const attemptsAllowed = job.opts?.attempts ?? 1;
    const willRetry =
      !result.ok && result.retryable && attemptNumber < attemptsAllowed;

    this.metrics.alertDeliveriesTotal.inc({
      type: channel.type,
      result: result.ok ? 'ok' : willRetry ? 'retry' : 'failed',
    });

    if (result.ok) return { ok: true };

    this.logger.warn(
      `Alert ${message.event} to ${channel.type} channel ${channel.id} failed ` +
        `(attempt ${attemptNumber}/${attemptsAllowed}${willRetry ? ', will retry' : ''}): ${result.error}`,
    );

    if (result.retryable) {
      throw new AlertDeliveryError(result.error ?? 'Delivery failed');
    }
    return { ok: false };
  }
}

export async function recordDelivery(
  repo: Repository<NotificationChannel>,
  channelId: string,
  result: DeliveryResult,
): Promise<void> {
  await repo.update(channelId, {
    lastDeliveryAt: new Date(),
    lastDeliveryStatus: result.ok ? 'ok' : 'failed',
    lastError: result.ok ? null : result.error,
  });
}
