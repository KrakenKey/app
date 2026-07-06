import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Brute-force protection for API key authentication.
 *
 * Failed API key validations cannot be attributed to a specific key (an
 * unknown key hashes to nothing in the database), so failures are counted
 * per client IP. When an IP crosses the failure threshold inside the
 * counting window it is locked out of API key auth for the lockout period.
 *
 * The lockout check runs *before* the expensive scrypt hash, so a locked-out
 * client also stops consuming hashing CPU.
 *
 * All Redis errors fail open: brute-force protection degrades to the global
 * IP throttler rather than blocking legitimate authentication.
 */
@Injectable()
export class ApiKeySecurityService implements OnModuleDestroy {
  private readonly logger = new Logger(ApiKeySecurityService.name);
  private readonly redis: Redis;
  private readonly failureThreshold: number;
  private readonly windowSeconds: number;
  private readonly lockoutSeconds: number;
  private redisWarned = false;

  constructor(config: ConfigService) {
    this.failureThreshold = parseInt(
      config.get('KK_APIKEY_LOCKOUT_THRESHOLD', '10'),
    );
    this.windowSeconds = parseInt(
      config.get('KK_APIKEY_LOCKOUT_WINDOW_SEC', '900'),
    );
    this.lockoutSeconds = parseInt(
      config.get('KK_APIKEY_LOCKOUT_DURATION_SEC', '900'),
    );

    this.redis = new Redis({
      host: config.get<string>('KK_BULLMQ_HOST', 'localhost'),
      port: parseInt(config.get('KK_BULLMQ_PORT', '6379')),
      password: config.get<string>('KK_BULLMQ_PASSWORD', '') || undefined,
      keyPrefix: 'apikey-sec:',
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    // Without a listener ioredis turns connection errors into uncaught
    // exceptions. Log the first one; individual commands fail open below.
    this.redis.on('error', (err) => {
      if (!this.redisWarned) {
        this.redisWarned = true;
        this.logger.warn(
          `Redis unavailable for API key lockout (failing open): ${err.message}`,
        );
      }
    });
  }

  onModuleDestroy() {
    this.redis.disconnect();
  }

  /** True when this IP is currently locked out of API key authentication. */
  async isLockedOut(ip: string): Promise<boolean> {
    if (!ip) return false;
    try {
      return (await this.redis.exists(`lock:${ip}`)) === 1;
    } catch {
      return false; // fail open
    }
  }

  /**
   * Records a failed API key validation for this IP and activates a lockout
   * once the threshold is crossed.
   */
  async recordFailure(ip: string): Promise<void> {
    if (!ip) return;
    try {
      const failKey = `fail:${ip}`;
      const count = await this.redis.incr(failKey);
      if (count === 1) {
        await this.redis.expire(failKey, this.windowSeconds);
      }
      if (count >= this.failureThreshold) {
        const activated = await this.redis.set(
          `lock:${ip}`,
          '1',
          'EX',
          this.lockoutSeconds,
          'NX',
        );
        if (activated === 'OK') {
          this.logger.warn(
            `API key lockout activated for ${ip}: ${count} failed validations within ${this.windowSeconds}s (locked for ${this.lockoutSeconds}s)`,
          );
        }
      }
    } catch {
      // fail open — the error listener above already logged connectivity loss
    }
  }

  /**
   * Rate-limits "expired key used" owner notifications to one per key per day.
   * Returns true when the caller should send the notification.
   */
  async shouldNotifyExpiredKeyUse(keyId: string): Promise<boolean> {
    try {
      const claimed = await this.redis.set(
        `expired-notice:${keyId}`,
        '1',
        'EX',
        86_400,
        'NX',
      );
      return claimed === 'OK';
    } catch {
      return false; // fail closed for notifications: no Redis, no dedup, no spam
    }
  }
}
