import { ConfigService } from '@nestjs/config';
import {
  ScheduledJobLock,
  type ScheduledJobLockStore,
} from './scheduled-job-lock.service';

/**
 * For tests: an in-memory stand-in for Redis SET NX EX, with a clock the
 * test moves forward to expire keys.
 */
export class InMemoryLockStore implements ScheduledJobLockStore {
  readonly keys = new Map<string, { value: string; expiresAt: number }>();
  now = Date.now();
  /** When set, every call fails like an unreachable Redis. */
  down = false;

  set(
    key: string,
    value: string,
    _ex: 'EX',
    ttl: number,
    _nx: 'NX',
  ): Promise<'OK' | null> {
    if (this.down) return Promise.reject(new Error('Connection is closed.'));
    const held = this.keys.get(key);
    if (held && held.expiresAt > this.now) return Promise.resolve(null);
    this.keys.set(key, { value, expiresAt: this.now + ttl * 1000 });
    return Promise.resolve('OK');
  }

  /** When disconnect() was called, in call order with `events`. */
  readonly events: string[] = [];

  disconnect() {
    this.events.push('disconnect');
  }

  /** Moves the clock forward. */
  advance(seconds: number) {
    this.now += seconds * 1000;
  }
}

/** For tests: a ScheduledJobLock backed by an InMemoryLockStore. */
export function inMemoryJobLock(store = new InMemoryLockStore()) {
  return {
    lock: new ScheduledJobLock(new ConfigService(), store),
    store,
  };
}
