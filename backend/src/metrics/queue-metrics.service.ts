import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Gauge } from 'prom-client';
import { MetricsService } from './metrics.service';

export const QUEUE_JOB_STATES = [
  'waiting',
  'active',
  'delayed',
  'failed',
  'completed',
  'paused',
] as const;

// Bound the Redis round-trip so a slow or unreachable Redis cannot stall
// the whole /metrics scrape.
const COLLECT_TIMEOUT_MS = 2000;

/**
 * Exposes BullMQ job counts per queue and state. Counts are read from Redis
 * only when Prometheus scrapes /metrics; nothing polls in the background.
 */
@Injectable()
export class QueueMetricsService {
  private readonly logger = new Logger(QueueMetricsService.name);
  readonly queueJobs: Gauge<'queue' | 'state'>;

  constructor(
    metricsService: MetricsService,
    @InjectQueue('tlsCertIssuance') tlsCertQueue: Queue,
    @InjectQueue('orgDissolution') orgDissolutionQueue: Queue,
  ) {
    const queues = [tlsCertQueue, orgDissolutionQueue];
    const logger = this.logger;

    this.queueJobs = new Gauge({
      name: 'bullmq_queue_jobs',
      help: 'Number of BullMQ jobs by queue and state',
      labelNames: ['queue', 'state'] as const,
      registers: [metricsService.registry],
      async collect() {
        this.reset();
        await Promise.all(
          queues.map(async (queue) => {
            try {
              const counts = await withTimeout(
                queue.getJobCounts(...QUEUE_JOB_STATES),
                COLLECT_TIMEOUT_MS,
              );
              for (const state of QUEUE_JOB_STATES) {
                this.set({ queue: queue.name, state }, counts[state] ?? 0);
              }
            } catch (err) {
              // Omit the queue's series rather than failing the whole scrape.
              logger.warn(
                `Failed to collect job counts for queue ${queue.name}: ${(err as Error).message}`,
              );
            }
          }),
        );
      },
    });
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
