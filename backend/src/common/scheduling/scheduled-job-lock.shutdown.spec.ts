/**
 * Shutdown order with a real Nest application context, imported the way
 * AppModule imports them (ScheduleModule, then ScheduledJobLockModule):
 * Nest runs every onModuleDestroy, then every beforeApplicationShutdown
 * (in an order we don't control relative to @nestjs/schedule), then
 * onApplicationShutdown.
 */
import { Injectable, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { SchedulerOrchestrator } from '@nestjs/schedule/dist/scheduler.orchestrator';
import { Test } from '@nestjs/testing';
import { ScheduledJobLockModule } from './scheduled-job-lock.module';
import { ScheduledJobLock } from './scheduled-job-lock.service';
import { InMemoryLockStore } from './scheduled-job-lock.testing';

@Injectable()
class JobProbe {
  constructor(readonly lock: ScheduledJobLock) {}
}

@Module({ providers: [JobProbe] })
class ProbeModule {}

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('ScheduledJobLock shutdown (Nest lifecycle)', () => {
  let store: InMemoryLockStore;

  async function start() {
    store = new InMemoryLockStore();
    const app = await Test.createTestingModule({
      imports: [ScheduleModule.forRoot(), ScheduledJobLockModule, ProbeModule],
    })
      .overrideProvider(ScheduledJobLock)
      .useFactory({
        factory: () => new ScheduledJobLock(new ConfigService(), store),
      })
      .compile();
    await app.init();
    return { app, lock: app.get(JobProbe).lock };
  }

  afterEach(() => jest.restoreAllMocks());

  it('runs no new job once close() starts, awaits the claimed run, and disconnects Redis last', async () => {
    const stopTimers = jest.spyOn(
      SchedulerOrchestrator.prototype,
      'beforeApplicationShutdown',
    );
    stopTimers.mockImplementation(function (this: SchedulerOrchestrator) {
      store.events.push('cron timers stopped');
    });
    const { app, lock } = await start();

    let finish!: () => void;
    const claimed = lock.runOnce(
      'cert-monitor',
      () =>
        new Promise<void>((resolve) => {
          finish = () => {
            store.events.push('claimed run finished');
            resolve();
          };
        }),
    );
    while (!finish) await tick();

    const closed = app.close();
    for (let i = 0; i < 5; i++) await tick();

    // A cron firing now (timers may not be stopped yet) runs nothing
    const fired = jest.fn().mockResolvedValue(undefined);
    await expect(lock.runOnce('domain-monitor', fired)).resolves.toBe(false);
    expect(fired).not.toHaveBeenCalled();
    expect([...store.keys.keys()]).toEqual([
      expect.stringMatching(/^cert-monitor:/),
    ]);
    // Still waiting for the claimed run, with Redis connected
    expect(store.events).not.toContain('disconnect');

    finish();
    await closed;
    await expect(claimed).resolves.toBe(true);

    expect(store.events).toContain('cron timers stopped');
    expect(store.events.indexOf('claimed run finished')).toBeLessThan(
      store.events.indexOf('disconnect'),
    );
    expect(store.events.at(-1)).toBe('disconnect');
  });

  it('closes at once when nothing is running', async () => {
    const { app } = await start();
    const started = Date.now();
    await app.close();
    expect(Date.now() - started).toBeLessThan(1000);
    expect(store.events).toEqual(['disconnect']);
  });
});
