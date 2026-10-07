import { Injectable, Logger } from '@nestjs/common';
import { createHmac, randomBytes } from 'crypto';
import { AuthService } from '../auth.service';
import { ApiKeySecurityService } from './api-key-security.service';
import { ipAllowed } from '../api-key-restrictions';
import type { ApiKeyUserResolver } from '../../throttler/interfaces/api-key-user-resolver.interface';

/**
 * How long a key-to-user lookup is reused. A key revoked inside this window
 * can still be counted against its owner's (higher) rate limit bucket until
 * the entry expires. That only affects which bucket the request lands in:
 * the auth guard checks the database on every request and rejects the key
 * immediately. Kept short so plan changes and revocations show up quickly.
 */
export const API_KEY_USER_CACHE_TTL_MS = 60_000;

/** Upper bound on cached keys, so random tokens can't grow memory forever. */
export const API_KEY_USER_CACHE_MAX_ENTRIES = 10_000;

interface CacheEntry {
  /** null = the key did not resolve to an active key (negative entry). */
  owner: { userId: string; allowedIps: string[] | null } | null;
  cachedUntil: number;
}

/**
 * Resolves user API keys to their owner for the rate limiter, with a small
 * in-process LRU cache so throttling doesn't add a scrypt hash and a database
 * query to every API key request.
 *
 * The cache is keyed by an HMAC-SHA256 of the key under a random secret
 * generated at startup, never the key itself, and lives only in this
 * process's memory. Cache keys are useless outside the process.
 */
@Injectable()
export class ApiKeyUserResolverService implements ApiKeyUserResolver {
  private readonly logger = new Logger(ApiKeyUserResolverService.name);
  private readonly cache = new Map<string, CacheEntry>();
  private readonly cacheSecret = randomBytes(32);

  constructor(
    private readonly authService: AuthService,
    private readonly apiKeySecurity: ApiKeySecurityService,
  ) {}

  async resolve(rawKey: string, ip: string): Promise<string | null> {
    const cacheKey = createHmac('sha256', this.cacheSecret)
      .update(rawKey)
      .digest('hex');
    const now = Date.now();

    let entry = this.get(cacheKey, now);
    if (!entry) {
      // Same order as ApiKeyStrategy: a locked-out client gets no hashing
      // work, and the result isn't cached so the lockout keeps applying.
      if (await this.apiKeySecurity.isLockedOut(ip)) return null;
      entry = await this.lookup(rawKey, now);
      if (!entry) return null;
      this.set(cacheKey, entry);
    }

    const { owner } = entry;
    if (!owner) return null;
    if (owner.allowedIps && !ipAllowed(ip, owner.allowedIps)) return null;
    return owner.userId;
  }

  /** Returns undefined (and caches nothing) if the lookup itself fails. */
  private async lookup(
    rawKey: string,
    now: number,
  ): Promise<CacheEntry | undefined> {
    try {
      const found = await this.authService.findApiKeyOwner(rawKey);
      let cachedUntil = now + API_KEY_USER_CACHE_TTL_MS;
      // Never reuse an entry past the key's own expiry (short-lived keys
      // from the GitHub OIDC exchange can expire within the TTL).
      if (found?.expiresAt) {
        cachedUntil = Math.min(cachedUntil, found.expiresAt.getTime());
      }
      return {
        owner: found
          ? { userId: found.userId, allowedIps: found.allowedIps }
          : null,
        cachedUntil,
      };
    } catch (err) {
      this.logger.warn(
        `API key owner lookup failed, rate limiting by IP: ${err instanceof Error ? err.message : String(err)}`,
      );
      return undefined;
    }
  }

  private get(cacheKey: string, now: number): CacheEntry | undefined {
    const entry = this.cache.get(cacheKey);
    if (!entry) return undefined;
    this.cache.delete(cacheKey);
    if (entry.cachedUntil <= now) return undefined;
    // Re-insert to mark as most recently used.
    this.cache.set(cacheKey, entry);
    return entry;
  }

  private set(cacheKey: string, entry: CacheEntry): void {
    this.cache.delete(cacheKey);
    this.cache.set(cacheKey, entry);
    while (this.cache.size > API_KEY_USER_CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }
}
