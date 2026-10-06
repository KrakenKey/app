import {
  AlertDeliveryError,
  AlertDeliveryProcessor,
} from './alert-delivery.processor';
import type { DeliveryResult } from './channel-delivery.service';

describe('AlertDeliveryProcessor', () => {
  let repo: { findOne: jest.Mock; update: jest.Mock };
  let delivery: { deliver: jest.Mock };
  let inc: jest.Mock;
  let processor: AlertDeliveryProcessor;

  const channel = { id: 'c1', type: 'webhook', enabled: true };
  const message = {
    id: 'd1',
    event: 'cert.failed',
    createdAt: '2026-10-05T00:00:00.000Z',
    payload: { subject: 'example.com' },
  };

  function job(attemptsMade = 0) {
    return {
      data: { channelId: 'c1', message },
      attemptsMade,
      opts: { attempts: 5 },
    } as never;
  }

  function result(r: Partial<DeliveryResult>): DeliveryResult {
    return { ok: false, status: null, error: null, retryable: false, ...r };
  }

  beforeEach(() => {
    repo = {
      findOne: jest.fn().mockResolvedValue({ ...channel }),
      update: jest.fn().mockResolvedValue({}),
    };
    delivery = { deliver: jest.fn() };
    inc = jest.fn();
    processor = new AlertDeliveryProcessor(
      repo as never,
      delivery as never,
      { alertDeliveriesTotal: { inc } } as never,
    );
  });

  it('records a successful delivery', async () => {
    delivery.deliver.mockResolvedValue(result({ ok: true, status: 200 }));

    await expect(processor.process(job())).resolves.toEqual({ ok: true });

    expect(repo.update).toHaveBeenCalledWith('c1', {
      lastDeliveryAt: expect.any(Date),
      lastDeliveryStatus: 'ok',
      lastError: null,
    });
    expect(inc).toHaveBeenCalledWith({ type: 'webhook', result: 'ok' });
  });

  it.each([408, 429, 500, 503])(
    'throws so BullMQ retries on HTTP %d',
    async (status) => {
      delivery.deliver.mockResolvedValue(
        result({ status, error: `HTTP ${status}`, retryable: true }),
      );

      await expect(processor.process(job(1))).rejects.toBeInstanceOf(
        AlertDeliveryError,
      );
      expect(repo.update).toHaveBeenCalledWith('c1', {
        lastDeliveryAt: expect.any(Date),
        lastDeliveryStatus: 'failed',
        lastError: `HTTP ${status}`,
      });
      expect(inc).toHaveBeenCalledWith({ type: 'webhook', result: 'retry' });
    },
  );

  it('throws on network errors and counts the last attempt as failed', async () => {
    delivery.deliver.mockResolvedValue(
      result({ error: 'Network error (ECONNRESET)', retryable: true }),
    );

    await expect(processor.process(job(4))).rejects.toThrow(
      'Network error (ECONNRESET)',
    );
    expect(inc).toHaveBeenCalledWith({ type: 'webhook', result: 'failed' });
  });

  it.each([400, 403, 404, 410])('does not retry on HTTP %d', async (status) => {
    delivery.deliver.mockResolvedValue(
      result({ status, error: `HTTP ${status}` }),
    );

    await expect(processor.process(job())).resolves.toEqual({ ok: false });
    expect(repo.update).toHaveBeenCalledWith(
      'c1',
      expect.objectContaining({
        lastDeliveryStatus: 'failed',
        lastError: `HTTP ${status}`,
      }),
    );
    expect(inc).toHaveBeenCalledWith({ type: 'webhook', result: 'failed' });
  });

  it('skips channels deleted or disabled since the alert was queued', async () => {
    repo.findOne.mockResolvedValueOnce(null);
    await expect(processor.process(job())).resolves.toEqual({ ok: false });
    repo.findOne.mockResolvedValueOnce({ ...channel, enabled: false });
    await expect(processor.process(job())).resolves.toEqual({ ok: false });
    expect(delivery.deliver).not.toHaveBeenCalled();
    expect(repo.update).not.toHaveBeenCalled();
  });
});
