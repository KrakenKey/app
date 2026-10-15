import {
  BeforeApplicationShutdown,
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import {
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  SQSClient,
  type Message,
} from '@aws-sdk/client-sqs';
import { AwsMarketplaceConfig, queueRegion } from './aws-marketplace.config';
import { AwsMarketplaceService } from './aws-marketplace.service';

/** Minimal SQS surface, replaceable in tests. */
export type AwsMarketplaceSqs = Pick<SQSClient, 'send'>;

/** Injection token to replace the SQS client, for tests. */
export const AWS_MARKETPLACE_SQS = Symbol('AWS_MARKETPLACE_SQS');

/** Long poll: SQS's maximum wait. */
export const RECEIVE_WAIT_SECONDS = 20;

/**
 * How long a received message stays hidden from other consumers. Long
 * enough for a batch to be processed (each message is a GetEntitlements
 * call or two); if it ever runs out, another process may handle the same
 * event, which is safe (see AwsMarketplaceService).
 */
export const VISIBILITY_TIMEOUT_SECONDS = 300;

export const MAX_MESSAGES = 10;

/** Back-off after a failed receive, doubling up to the maximum. */
export const MIN_BACKOFF_MS = 1000;
export const MAX_BACKOFF_MS = 60_000;

/** How long shutdown waits for the batch in progress; under the 60 s stop grace. */
export const SHUTDOWN_WAIT_MS = 45_000;

function errorName(err: unknown): string {
  return err instanceof Error ? err.name : 'unknown';
}

/**
 * Long-polls the SQS queue that the seller account's EventBridge rule
 * forwards AWS Marketplace events to, and hands each message to
 * AwsMarketplaceService. A message is deleted only after it was handled
 * (or found to be malformed or irrelevant); a failure leaves it on the
 * queue, and SQS delivers it again after the visibility timeout. Configure
 * a dead-letter queue on the queue so a message that keeps failing stops
 * being retried.
 *
 * Every API process runs a consumer, including both containers of a
 * blue/green deploy. SQS gives each message to one of them at a time, and
 * processing is safe to run concurrently: a license is changed under an
 * advisory lock, always to what GetEntitlements reports, and an event id is
 * recorded once.
 *
 * Runs only with KK_AWS_MARKETPLACE_ENABLED=true and a queue URL. SQS is
 * called with the default credentials (the instance role of the account
 * the queue is in), not the seller account role.
 *
 * Shutdown: onModuleDestroy stops polling and cancels the long poll;
 * beforeApplicationShutdown waits for the batch in progress while the
 * database is still open.
 */
@Injectable()
export class AwsMarketplaceEventConsumer
  implements OnApplicationBootstrap, OnModuleDestroy, BeforeApplicationShutdown
{
  private readonly logger = new Logger(AwsMarketplaceEventConsumer.name);
  private sqs: AwsMarketplaceSqs | null;
  private loop: Promise<void> | null = null;
  private stopping = false;
  private receiveAbort: AbortController | null = null;
  private wake: (() => void) | null = null;
  /** See SHUTDOWN_WAIT_MS; changeable for tests. */
  shutdownWaitMs = SHUTDOWN_WAIT_MS;

  constructor(
    private readonly config: AwsMarketplaceConfig,
    private readonly service: AwsMarketplaceService,
    @Optional() @Inject(AWS_MARKETPLACE_SQS) sqs?: AwsMarketplaceSqs,
  ) {
    this.sqs = sqs ?? null;
  }

  onApplicationBootstrap(): void {
    if (!this.config.consumerEnabled) return;
    this.loop = this.run();
  }

  onModuleDestroy(): void {
    this.stopping = true;
    this.receiveAbort?.abort();
    this.wake?.();
  }

  async beforeApplicationShutdown(): Promise<void> {
    if (!this.loop) return;
    let timer: NodeJS.Timeout | undefined;
    const finished = await Promise.race([
      this.loop.then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), this.shutdownWaitMs);
      }),
    ]);
    clearTimeout(timer);
    if (!finished) {
      this.logger.warn(
        'Shutting down while AWS Marketplace events are still being processed; SQS delivers them again',
      );
    }
  }

  /** Whether the polling loop is running (for tests and diagnostics). */
  get running(): boolean {
    return this.loop !== null && !this.stopping;
  }

  private client(): AwsMarketplaceSqs {
    this.sqs ??= new SQSClient({
      region: queueRegion(this.config.queueUrl) ?? undefined,
    });
    return this.sqs;
  }

  private async run(): Promise<void> {
    await this.checkQueue();
    let backoff = 0;
    while (!this.stopping) {
      try {
        await this.pollOnce();
        backoff = 0;
      } catch (err) {
        if (this.stopping) break;
        backoff = Math.min(
          Math.max(backoff * 2, MIN_BACKOFF_MS),
          MAX_BACKOFF_MS,
        );
        this.logger.warn(
          `AWS Marketplace queue receive failed (${errorName(err)}); retrying in ${backoff / 1000}s`,
        );
        await this.sleep(backoff);
      }
    }
    this.logger.log('AWS Marketplace event consumer stopped');
  }

  /** Logs that the queue is reachable, or why it isn't. Never throws. */
  private async checkQueue(): Promise<void> {
    try {
      const out = await this.client().send(
        new GetQueueAttributesCommand({
          QueueUrl: this.config.queueUrl,
          AttributeNames: ['ApproximateNumberOfMessages'],
        }),
      );
      this.logger.log(
        `AWS Marketplace event consumer started: ${out.Attributes?.ApproximateNumberOfMessages ?? '?'} message(s) waiting`,
      );
    } catch (err) {
      this.logger.error(
        `AWS Marketplace event queue is not reachable (${errorName(err)}); will keep trying`,
      );
    }
  }

  /** One long poll and the batch it returns. Exposed for tests. */
  async pollOnce(): Promise<number> {
    this.receiveAbort = new AbortController();
    let messages: Message[];
    try {
      const out = await this.client().send(
        new ReceiveMessageCommand({
          QueueUrl: this.config.queueUrl,
          MaxNumberOfMessages: MAX_MESSAGES,
          WaitTimeSeconds: RECEIVE_WAIT_SECONDS,
          VisibilityTimeout: VISIBILITY_TIMEOUT_SECONDS,
        }),
        { abortSignal: this.receiveAbort.signal },
      );
      messages = out.Messages ?? [];
    } finally {
      this.receiveAbort = null;
    }
    // The whole batch is processed even when shutdown starts: the messages
    // are already hidden from the other process for the visibility timeout.
    for (const message of messages) {
      await this.handle(message);
    }
    return messages.length;
  }

  private async handle(message: Message): Promise<void> {
    let result: string;
    try {
      result = await this.service.handleEventMessage(message.Body ?? '');
    } catch (err) {
      this.logger.warn(
        `AWS Marketplace event not processed, left on the queue: message=${message.MessageId ?? '?'} error=${errorName(err)}${err instanceof Error && 'code' in err ? `/${String((err as { code: unknown }).code)}` : ''}`,
      );
      return;
    }
    if (!message.ReceiptHandle) return;
    try {
      await this.client().send(
        new DeleteMessageCommand({
          QueueUrl: this.config.queueUrl,
          ReceiptHandle: message.ReceiptHandle,
        }),
      );
    } catch (err) {
      // Delivered again later and recognized as a duplicate.
      this.logger.warn(
        `Could not delete AWS Marketplace message ${message.MessageId ?? '?'} (${result}): ${errorName(err)}`,
      );
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.wake = null;
        resolve();
      }, ms);
      this.wake = () => {
        clearTimeout(timer);
        this.wake = null;
        resolve();
      };
    });
  }
}
