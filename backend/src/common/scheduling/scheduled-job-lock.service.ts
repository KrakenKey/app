import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { hostname } from 'node:os';

/**
 * How long a claimed run is remembered. Only has to outlast the gap between
 * two processes firing the same schedule (clock skew plus a busy event
 * loop), so it is kept well under the one-hour slot: even if a slot were
 * ever computed wrong, the next run would not be blocked.
 */
export const SCHEDULED_JOB_LOCK_TTL_SECONDS = 30 * 60;

const HOUR_MS = 3600_000;

/** Injection token to replace the Redis connection, for tests. */
export const SCHEDULED_JOB_LOCK_STORE = Symbol('SCHEDULED_JOB_LOCK_STORE');

/** Minimal Redis surface the lock needs; satisfied by ioredis. */
export interface ScheduledJobLockStore {
  set(
    key: string,
    value: string,
    ex: 'EX',
    ttl: number,
    nx: 'NX',
  ): Promise<'OK' | null>;
}

/**
 * Runs a scheduled job once per scheduled time when several API processes
 * fire the same @Cron, for example the two containers of a blue/green
 * deploy, or more than one replica.
 *
 * The first process to claim `<job>:<slot>` in Redis (SET NX EX) runs the
 * job; the others skip it. The slot is the start of the UTC hour, so this
 * is only for jobs that run at most once an hour.
 *
 * A run that throws or is killed keeps its claim until the TTL expires and
 * is not repeated in the same slot: the next scheduled run picks up
 * whatever was left, as it would after a crash with a single process.
 *
 * If Redis can't be reached the job runs anyway (fail open), which is how
 * it behaved before this lock: a duplicate run is better than a missed one.
 */
@Injectable()
export class ScheduledJobLock implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ScheduledJobLock.name);
  private readonly store: ScheduledJobLockStore;
  private readonly redis: Redis | null;
  private readonly owner = `${hostname()}:${process.pid}`;

  constructor(
    config: ConfigService,
    @Optional()
    @Inject(SCHEDULED_JOB_LOCK_STORE)
    store?: ScheduledJobLockStore,
  ) {
    if (store) {
      this.store = store;
      this.redis = null;
      return;
    }
    const redis = new Redis({
      host: config.get<string>('KK_BULLMQ_HOST', 'localhost'),
      port: parseInt(config.get('KK_BULLMQ_PORT', '6379')),
      password: config.get<string>('KK_BULLMQ_PASSWORD', '') || undefined,
      keyPrefix: 'cron-lock:',
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    // Without a listener ioredis turns connection errors into uncaught
    // exceptions; runOnce logs the failure when it matters.
    redis.on('error', () => undefined);
    this.redis = redis;
    this.store = redis;
  }

  async onModuleInit() {
    if (!this.redis) return;
    try {
      await this.redis.connect();
      this.logger.log('Scheduled job lock ready');
    } catch (err) {
      this.logger.warn(
        `Redis connect failed for scheduled job locks; jobs will run without them: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  onModuleDestroy() {
    this.redis?.disconnect();
  }

  /**
   * Runs `run` unless another process already claimed `job` for the
   * current slot. Returns false when the run was skipped.
   */
  async runOnce(
    job: string,
    run: () => Promise<unknown>,
    opts: { now?: Date; ttlSeconds?: number } = {},
  ): Promise<boolean> {
    const slot = slotOf(opts.now ?? new Date());
    const key = `${job}:${slot}`;
    let claimed: boolean;
    try {
      claimed =
        (await this.store.set(
          key,
          this.owner,
          'EX',
          opts.ttlSeconds ?? SCHEDULED_JOB_LOCK_TTL_SECONDS,
          'NX',
        )) === 'OK';
    } catch (err) {
      this.logger.warn(
        `Scheduled job lock unavailable, running ${job} without it: ${err instanceof Error ? err.message : String(err)}`,
      );
      claimed = true;
    }
    if (!claimed) {
      this.logger.log(
        `Skipping ${job} for ${slot}: another API process already ran it`,
      );
      return false;
    }
    await run();
    return true;
  }
}

/** Start of the UTC hour, as an ISO string. */
export function slotOf(now: Date): string {
  return new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS).toISOString();
}
