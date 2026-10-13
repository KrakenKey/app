import {
  SCHEDULED_JOB_LOCK_TTL_SECONDS,
  SHUTDOWN_WAIT_MS,
  slotOf,
} from './scheduled-job-lock.service';
import {
  InMemoryLockStore,
  inMemoryJobLock,
} from './scheduled-job-lock.testing';

describe('ScheduledJobLock', () => {
  const at = (iso: string) => new Date(iso);
  let store: InMemoryLockStore;
  let lock: ReturnType<typeof inMemoryJobLock>['lock'];

  beforeEach(() => {
    ({ lock, store } = inMemoryJobLock());
    store.now = at('2026-10-13T06:00:00.050Z').getTime();
  });

  it('keys runs by the start of the UTC hour', () => {
    expect(slotOf(at('2026-10-13T06:00:00.050Z'))).toBe(
      '2026-10-13T06:00:00.000Z',
    );
    expect(slotOf(at('2026-10-13T06:59:59.999Z'))).toBe(
      '2026-10-13T06:00:00.000Z',
    );
    expect(slotOf(at('2026-10-13T07:00:00.000Z'))).toBe(
      '2026-10-13T07:00:00.000Z',
    );
  });

  it('runs the job once when two processes fire it in the same slot', async () => {
    const run = jest.fn().mockResolvedValue(undefined);

    const results = await Promise.all([
      lock.runOnce('cert-monitor', run, {
        now: at('2026-10-13T06:00:00.010Z'),
      }),
      lock.runOnce('cert-monitor', run, {
        now: at('2026-10-13T06:00:00.900Z'),
      }),
    ]);

    expect(run).toHaveBeenCalledTimes(1);
    expect(results.sort()).toEqual([false, true]);
    expect([...store.keys.keys()]).toEqual([
      'cert-monitor:2026-10-13T06:00:00.000Z',
    ]);
  });

  it('still skips a duplicate that fires late in the same hour', async () => {
    const run = jest.fn().mockResolvedValue(undefined);
    await lock.runOnce('cert-monitor', run, {
      now: at('2026-10-13T06:00:00Z'),
    });
    store.advance(120);
    await lock.runOnce('cert-monitor', run, {
      now: at('2026-10-13T06:02:00Z'),
    });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('runs again once the claim expires', async () => {
    const run = jest.fn().mockResolvedValue(undefined);
    const now = at('2026-10-13T06:00:00Z');
    await lock.runOnce('cert-monitor', run, { now });
    store.advance(SCHEDULED_JOB_LOCK_TTL_SECONDS + 1);
    await lock.runOnce('cert-monitor', run, { now });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('runs the next scheduled time and other jobs independently', async () => {
    const run = jest.fn().mockResolvedValue(undefined);
    await lock.runOnce('ari-monitor', run, { now: at('2026-10-13T06:00:00Z') });
    await lock.runOnce('ari-monitor', run, { now: at('2026-10-13T07:00:00Z') });
    await lock.runOnce('cert-monitor', run, {
      now: at('2026-10-13T06:00:00Z'),
    });
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('keeps the claim when a run throws, so the slot is not repeated', async () => {
    const now = at('2026-10-13T02:00:00Z');
    await expect(
      lock.runOnce(
        'domain-monitor',
        () => Promise.reject(new Error('db went away')),
        { now },
      ),
    ).rejects.toThrow('db went away');

    const retry = jest.fn().mockResolvedValue(undefined);
    await lock.runOnce('domain-monitor', retry, { now });
    expect(retry).not.toHaveBeenCalled();

    // The claim expires on its own, and the next day's slot is unaffected
    expect(
      store.keys.get('domain-monitor:2026-10-13T02:00:00.000Z')!.expiresAt,
    ).toBe(store.now + SCHEDULED_JOB_LOCK_TTL_SECONDS * 1000);
    await lock.runOnce('domain-monitor', retry, {
      now: at('2026-10-14T02:00:00Z'),
    });
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('runs the job anyway when Redis is unavailable', async () => {
    store.down = true;
    const run = jest.fn().mockResolvedValue(undefined);
    await expect(lock.runOnce('activation-reminder', run)).resolves.toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
  });

  describe('shutdown', () => {
    it('waits for a run this process claimed before the app closes', async () => {
      let finish!: () => void;
      const run = jest.fn(
        () => new Promise<void>((resolve) => (finish = resolve)),
      );
      const running = lock.runOnce('cert-monitor', run);
      await new Promise((r) => setImmediate(r));

      let closed = false;
      const shutdown = lock.beforeApplicationShutdown().then(() => {
        closed = true;
      });
      await new Promise((r) => setTimeout(r, 20));
      expect(closed).toBe(false);

      finish();
      await shutdown;
      await running;
      expect(closed).toBe(true);
    });

    it('gives up after the wait limit', async () => {
      lock.shutdownWaitMs = 30;
      void lock.runOnce('cert-monitor', () => new Promise(() => undefined));
      await new Promise((r) => setImmediate(r));

      const started = Date.now();
      await lock.beforeApplicationShutdown();
      expect(Date.now() - started).toBeLessThan(1000);
    });

    it('returns at once with nothing running, and forgets finished runs', async () => {
      await lock.runOnce('ari-monitor', () => Promise.resolve());
      lock.shutdownWaitMs = 60_000;
      const started = Date.now();
      await lock.beforeApplicationShutdown();
      expect(Date.now() - started).toBeLessThan(100);
    });

    it('keeps the wait under the 60 s stop grace period', () => {
      expect(SHUTDOWN_WAIT_MS).toBeLessThan(60_000);
    });
  });
});
