import { ExecutionContext, Inject, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ThrottlerGuard,
  InjectThrottlerOptions,
  InjectThrottlerStorage,
} from '@nestjs/throttler';
import type {
  ThrottlerModuleOptions,
  ThrottlerStorage,
} from '@nestjs/throttler';
import type { ThrottlerRequest } from '@nestjs/throttler/dist/throttler.guard.interface';
import { TIER_RESOLVER } from '../interfaces/tier-resolver.interface';
import type { TierResolver } from '../interfaces/tier-resolver.interface';
import { API_KEY_USER_RESOLVER } from '../interfaces/api-key-user-resolver.interface';
import type { ApiKeyUserResolver } from '../interfaces/api-key-user-resolver.interface';
import { RateLimitCategory } from '../interfaces/rate-limit-category.enum';
import {
  RATE_LIMIT_TIERS,
  DEFAULT_TIER,
} from '../config/rate-limit-tiers.config';
import { RATE_LIMIT_CATEGORY_KEY } from '../decorators/rate-limit-category.decorator';

@Injectable()
export class TierAwareThrottlerGuard extends ThrottlerGuard {
  private readonly logger = new Logger(TierAwareThrottlerGuard.name);

  /** Per-request user ID, so getTracker and handleRequest share one lookup. */
  private readonly userIds = new WeakMap<object, Promise<string | null>>();

  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    @Inject(TIER_RESOLVER) private readonly tierResolver: TierResolver,
    @Inject(API_KEY_USER_RESOLVER)
    private readonly apiKeyUserResolver: ApiKeyUserResolver,
  ) {
    super(options, storageService, reflector);
  }

  /**
   * Determines the tracking key.
   * Authenticated requests are tracked by user ID; public requests by IP.
   */
  protected async getTracker(
    req: Record<string, any>,
    context?: ExecutionContext,
  ): Promise<string> {
    // Try to extract user ID from an already-populated req.user (unlikely
    // since this guard runs as APP_GUARD before auth guards), by resolving
    // a user API key, or by peeking at the JWT in the Authorization header.
    // Public routes never look at the token: it is unverified and nothing
    // rejects it later, so a caller could mint a new bucket per request.
    const userId =
      context && this.resolveCategory(context) === RateLimitCategory.PUBLIC
        ? null
        : await this.tryExtractUserId(req);
    if (userId) {
      return `user:${userId}`;
    }

    // Fall back to client IP. req.ip already resolves the real client
    // through the trusted proxy chain (see src/config/trusted-proxies.ts);
    // req.ips[0] would trust the leftmost X-Forwarded-For entry, which a
    // client can forge, so it must not be used for rate-limit keying.
    return req.ip;
  }

  /**
   * Overrides the default handleRequest to dynamically resolve limits
   * based on the route's @RateLimitCategory and the user's subscription tier.
   */
  protected async handleRequest(
    requestProps: ThrottlerRequest,
  ): Promise<boolean> {
    const { context } = requestProps;
    const { req } = this.getRequestResponse(context);

    // 1. Determine rate limit category from decorator metadata
    const category = this.resolveCategory(context);

    // 2. Determine user's subscription tier (public routes always use the
    //    default tier; see getTracker)
    const userId =
      category === RateLimitCategory.PUBLIC
        ? null
        : await this.tryExtractUserId(req);
    let tier = DEFAULT_TIER;
    if (userId) {
      try {
        tier = await this.tierResolver.resolve(userId);
      } catch {
        this.logger.warn(
          `Failed to resolve tier for user ${userId}, defaulting to '${DEFAULT_TIER}'`,
        );
      }
    }

    // 3. Look up tier-specific limits for this category
    const tierConfig = RATE_LIMIT_TIERS[tier] ?? RATE_LIMIT_TIERS[DEFAULT_TIER];
    const categoryLimits = tierConfig[category];

    // 4. Delegate to parent with overridden limit/ttl
    return super.handleRequest({
      ...requestProps,
      limit: categoryLimits.limit,
      ttl: categoryLimits.ttl,
      blockDuration: categoryLimits.ttl,
    });
  }

  /**
   * Reads the @RateLimitCategory() decorator from handler or controller.
   * Falls back to inferring category from HTTP method.
   */
  private resolveCategory(context: ExecutionContext): RateLimitCategory {
    const category = this.reflector.getAllAndOverride<RateLimitCategory>(
      RATE_LIMIT_CATEGORY_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (category) {
      return category;
    }

    // Fallback: infer from HTTP method
    const req = context.switchToHttp().getRequest();
    const method = req.method?.toUpperCase();

    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return RateLimitCategory.AUTHENTICATED_READ;
    }
    return RateLimitCategory.AUTHENTICATED_WRITE;
  }

  /**
   * Attempts to extract a user ID before authentication has run.
   *
   * Checks req.user first (in case auth already ran), then the bearer token:
   * - User API keys (kk_...) are resolved to their owner through
   *   ApiKeyUserResolver (cached hashed-key lookup). Unknown, revoked or
   *   expired keys resolve to null and fall back to IP + default tier.
   * - Service keys (kk_svc_...) belong to hosted probe infrastructure, not a
   *   user, so they stay on IP tracking.
   * - Anything else is treated as a JWT whose payload is decoded without
   *   verification, so only call this for routes behind an auth guard, which
   *   rejects a forged token after this guard runs. Never use it on PUBLIC
   *   routes.
   *
   * The result is memoised per request object.
   */
  private tryExtractUserId(req: Record<string, any>): Promise<string | null> {
    let pending = this.userIds.get(req);
    if (!pending) {
      pending = this.extractUserId(req);
      this.userIds.set(req, pending);
    }
    return pending;
  }

  private async extractUserId(
    req: Record<string, any>,
  ): Promise<string | null> {
    // Already populated by auth guard
    if (req.user?.userId) {
      return req.user.userId;
    }

    const authHeader = req.headers?.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }

    const token = authHeader.slice(7);

    if (token.startsWith('kk_svc_')) {
      return null;
    }

    if (token.startsWith('kk_')) {
      try {
        return await this.apiKeyUserResolver.resolve(token, req.ip ?? '');
      } catch {
        return null;
      }
    }

    // Decode JWT payload (no verification — just for tracking key)
    try {
      const payloadB64 = token.split('.')[1];
      if (!payloadB64) return null;
      const payload = JSON.parse(Buffer.from(payloadB64, 'base64').toString());
      return payload.sub ?? null;
    } catch {
      return null;
    }
  }
}
