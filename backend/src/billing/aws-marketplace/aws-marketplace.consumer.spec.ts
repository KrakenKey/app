import { Logger } from '@nestjs/common';
import {
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
} from '@aws-sdk/client-sqs';
import { AwsMarketplaceConfig } from './aws-marketplace.config';
import {
  AwsMarketplaceEventConsumer,
  MAX_MESSAGES,
  RECEIVE_WAIT_SECONDS,
  VISIBILITY_TIMEOUT_SECONDS,
} from './aws-marketplace.consumer';

const QUEUE = 'https://sqs.us-east-1.amazonaws.com/111122223333/kk-aws-mp';

function makeConfig(env: Record<string, string> = {}) {
  return new AwsMarketplaceConfig({
    get: (key: string) =>
      ({
        KK_AWS_MARKETPLACE_ENABLED: 'true',
        KK_AWS_MARKETPLACE_DIMENSION_MAP: 'pro=pro',
        KK_AWS_MARKETPLACE_QUEUE_URL: QUEUE,
        ...env,
      })[key],
  } as any);
}

function setup(env: Record<string, string> = {}) {
  const sqs = { send: jest.fn() };
  const service = {
    handleEventMessage: jest.fn().mockResolvedValue('processed'),
  };
  const consumer = new AwsMarketplaceEventConsumer(
    makeConfig(env),
    service as any,
    sqs as any,
  );
  return { sqs, service, consumer };
}

describe('AwsMarketplaceEventConsumer', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  it('long-polls the queue and deletes each message after it is handled', async () => {
    const { sqs, service, consumer } = setup();
    sqs.send.mockImplementation(async (command: unknown) => {
      if (command instanceof ReceiveMessageCommand) {
        return {
          Messages: [
            { MessageId: 'm1', ReceiptHandle: 'r1', Body: '{"a":1}' },
            { MessageId: 'm2', ReceiptHandle: 'r2', Body: '{"b":2}' },
          ],
        };
      }
      return {};
    });
    await expect(consumer.pollOnce()).resolves.toBe(2);

    const receive = sqs.send.mock.calls[0][0] as ReceiveMessageCommand;
    expect(receive.input).toEqual({
      QueueUrl: QUEUE,
      MaxNumberOfMessages: MAX_MESSAGES,
      WaitTimeSeconds: RECEIVE_WAIT_SECONDS,
      VisibilityTimeout: VISIBILITY_TIMEOUT_SECONDS,
    });
    expect(sqs.send.mock.calls[0][1].abortSignal).toBeDefined();
    expect(service.handleEventMessage.mock.calls).toEqual([
      ['{"a":1}'],
      ['{"b":2}'],
    ]);
    const deletes = sqs.send.mock.calls
      .map((c: unknown[]) => c[0])
      .filter((c: unknown) => c instanceof DeleteMessageCommand)
      .map((c: DeleteMessageCommand) => c.input);
    expect(deletes).toEqual([
      { QueueUrl: QUEUE, ReceiptHandle: 'r1' },
      { QueueUrl: QUEUE, ReceiptHandle: 'r2' },
    ]);
  });

  it('leaves a message on the queue when handling it fails', async () => {
    const { sqs, service, consumer } = setup();
    sqs.send.mockImplementation(async (command: unknown) =>
      command instanceof ReceiveMessageCommand
        ? {
            Messages: [
              { MessageId: 'm1', ReceiptHandle: 'r1', Body: 'x' },
              { MessageId: 'm2', ReceiptHandle: 'r2', Body: 'y' },
            ],
          }
        : {},
    );
    service.handleEventMessage
      .mockRejectedValueOnce(new Error('aws down'))
      .mockResolvedValueOnce('processed');
    await consumer.pollOnce();
    const deleted = sqs.send.mock.calls
      .map((c: unknown[]) => c[0])
      .filter((c: unknown) => c instanceof DeleteMessageCommand)
      .map((c: DeleteMessageCommand) => c.input.ReceiptHandle);
    expect(deleted).toEqual(['r2']);
  });

  it('keeps going when a delete fails', async () => {
    const { sqs, consumer } = setup();
    sqs.send.mockImplementation(async (command: unknown) => {
      if (command instanceof ReceiveMessageCommand) {
        return {
          Messages: [{ MessageId: 'm1', ReceiptHandle: 'r1', Body: 'x' }],
        };
      }
      throw new Error('delete failed');
    });
    await expect(consumer.pollOnce()).resolves.toBe(1);
  });

  it('does not start while the feature or the queue is off', () => {
    const envs: Record<string, string>[] = [
      { KK_AWS_MARKETPLACE_ENABLED: 'false' },
      { KK_AWS_MARKETPLACE_QUEUE_URL: '' },
    ];
    for (const env of envs) {
      const { sqs, consumer } = setup(env);
      consumer.onApplicationBootstrap();
      expect(consumer.running).toBe(false);
      expect(sqs.send).not.toHaveBeenCalled();
    }
  });

  it('checks the queue, polls until shutdown, and waits for the batch in progress', async () => {
    const { sqs, service, consumer } = setup();
    let release: () => void = () => undefined;
    let polls = 0;
    sqs.send.mockImplementation(
      async (command: unknown, opts?: { abortSignal?: AbortSignal }) => {
        if (command instanceof GetQueueAttributesCommand) {
          return { Attributes: { ApproximateNumberOfMessages: '3' } };
        }
        if (command instanceof ReceiveMessageCommand) {
          polls++;
          if (polls === 1) {
            return {
              Messages: [{ MessageId: 'm1', ReceiptHandle: 'r1', Body: 'x' }],
            };
          }
          // Long poll until aborted.
          return new Promise((_resolve, reject) => {
            opts?.abortSignal?.addEventListener('abort', () =>
              reject(
                Object.assign(new Error('aborted'), { name: 'AbortError' }),
              ),
            );
          });
        }
        return {};
      },
    );
    service.handleEventMessage.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve('processed');
        }),
    );

    consumer.onApplicationBootstrap();
    expect(consumer.running).toBe(true);
    await new Promise((r) => setImmediate(r));
    expect(service.handleEventMessage).toHaveBeenCalledTimes(1);

    // Shutdown starts while the message is being handled.
    consumer.onModuleDestroy();
    let done = false;
    const shutdown = consumer.beforeApplicationShutdown().then(() => {
      done = true;
    });
    await new Promise((r) => setImmediate(r));
    expect(done).toBe(false);
    release();
    await shutdown;
    expect(consumer.running).toBe(false);
    expect(
      sqs.send.mock.calls.some(
        (c: unknown[]) => c[0] instanceof DeleteMessageCommand,
      ),
    ).toBe(true);
    expect(polls).toBe(1);
  });

  it('aborts a long poll on shutdown', async () => {
    const { sqs, consumer } = setup();
    let aborted = false;
    sqs.send.mockImplementation(
      async (command: unknown, opts?: { abortSignal?: AbortSignal }) => {
        if (command instanceof ReceiveMessageCommand) {
          return new Promise((_resolve, reject) => {
            opts?.abortSignal?.addEventListener('abort', () => {
              aborted = true;
              reject(
                Object.assign(new Error('aborted'), { name: 'AbortError' }),
              );
            });
          });
        }
        return {};
      },
    );
    consumer.onApplicationBootstrap();
    await new Promise((r) => setImmediate(r));
    consumer.onModuleDestroy();
    await consumer.beforeApplicationShutdown();
    expect(aborted).toBe(true);
  });

  it('backs off after a failed receive and stops promptly on shutdown', async () => {
    const { sqs, consumer } = setup();
    sqs.send.mockImplementation(async (command: unknown) => {
      if (command instanceof ReceiveMessageCommand) {
        throw Object.assign(new Error('denied'), { name: 'AccessDenied' });
      }
      throw new Error('attributes denied');
    });
    consumer.onApplicationBootstrap();
    await new Promise((r) => setImmediate(r));
    const receives = () =>
      sqs.send.mock.calls.filter(
        (c: unknown[]) => c[0] instanceof ReceiveMessageCommand,
      ).length;
    expect(receives()).toBe(1);
    consumer.onModuleDestroy();
    await consumer.beforeApplicationShutdown();
    expect(receives()).toBe(1);
  });

  it('gives up waiting after the shutdown budget', async () => {
    const { sqs, service, consumer } = setup();
    consumer.shutdownWaitMs = 10;
    sqs.send.mockImplementation(async (command: unknown) =>
      command instanceof ReceiveMessageCommand
        ? { Messages: [{ MessageId: 'm1', ReceiptHandle: 'r1', Body: 'x' }] }
        : {},
    );
    service.handleEventMessage.mockReturnValue(new Promise(() => undefined));
    consumer.onApplicationBootstrap();
    await new Promise((r) => setImmediate(r));
    consumer.onModuleDestroy();
    await expect(consumer.beforeApplicationShutdown()).resolves.toBeUndefined();
  });
});
