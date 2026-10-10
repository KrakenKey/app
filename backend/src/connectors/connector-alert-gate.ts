import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { createHash } from 'node:crypto';

/** A target alerts deploy.failed at most once in this window. */
export const DEPLOY_ALERT_COOLDOWN_SECONDS = 6 * 3600;
/** At most one deploy.failed email per connector in this window. */
export const DEPLOY_EMAIL_INTERVAL_SECONDS = 3600;

/**
 * Rate limits connector alerts, in Redis so the limits hold across API
 * replicas and survive the deployment row being deleted (a connector that
 * drops a target from one report and lists it again in the next would
 * otherwise re-arm it every time).
 *
 * Fails closed: if Redis is unavailable no deploy.failed alert or email is
 * sent (BullMQ, which delivers alerts, needs the same Redis anyway).
 */
@Injectable()
export class ConnectorAlertGate implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ConnectorAlertGate.name);
  private readonly redis: Redis;
  private redisWarned = false;

  constructor(config: ConfigService) {
    this.redis = new Redis({
      host: config.get<string>('KK_BULLMQ_HOST', 'localhost'),
      port: parseInt(config.get('KK_BULLMQ_PORT', '6379')),
      password: config.get<string>('KK_BULLMQ_PASSWORD', '') || undefined,
      keyPrefix: 'connector-alert:',
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    this.redis.on('error', (err) => {
      if (!this.redisWarned) {
        this.redisWarned = true;
        this.logger.warn(
          `Redis unavailable for connector alerts: ${err.message}`,
        );
      }
    });
  }

  async onModuleInit() {
    try {
      await this.redis.connect();
    } catch (err) {
      this.logger.warn(
        `Redis connect failed for connector alerts: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  onModuleDestroy() {
    this.redis.disconnect();
  }

  /**
   * True when this target may alert now: it hasn't alerted within
   * DEPLOY_ALERT_COOLDOWN_SECONDS. Claims the slot when it returns true.
   */
  async claimTargetAlert(
    connectorId: string,
    certificateId: number,
    label: string,
  ): Promise<boolean> {
    const key = `target:${digest(`${connectorId}\n${certificateId}\n${label}`)}`;
    try {
      const set = await this.redis.set(
        key,
        '1',
        'EX',
        DEPLOY_ALERT_COOLDOWN_SECONDS,
        'NX',
      );
      return set === 'OK';
    } catch {
      return false;
    }
  }

  /**
   * Decides whether a deploy.failed email may go out for this connector
   * now. Returns the number of failures held back since the last email
   * (to mention in this one), or null when the email must wait; in that
   * case `failures` is added to the held-back count.
   */
  async claimEmail(
    connectorId: string,
    failures: number,
  ): Promise<number | null> {
    const id = digest(connectorId);
    try {
      const set = await this.redis.set(
        `email:${id}`,
        '1',
        'EX',
        DEPLOY_EMAIL_INTERVAL_SECONDS,
        'NX',
      );
      if (set !== 'OK') {
        const held = `held:${id}`;
        await this.redis.incrby(held, failures);
        // Kept a little longer than the interval so the next email finds it
        await this.redis.expire(held, DEPLOY_EMAIL_INTERVAL_SECONDS * 2);
        return null;
      }
      const held = await this.redis.getdel(`held:${id}`);
      return held ? parseInt(held, 10) || 0 : 0;
    } catch {
      return null;
    }
  }
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
