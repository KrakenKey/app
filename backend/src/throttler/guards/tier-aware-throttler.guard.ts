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
import { RateLimitCategory } from '../interfaces/rate-limit-category.enum';
import {
  RATE_LIMIT_TIERS,
  DEFAULT_TIER,
} from '../config/rate-limit-tiers.config';
import { RATE_LIMIT_CATEGORY_KEY } from '../decorators/rate-limit-category.decorator';

@Injectable()
export class TierAwareThrottlerGuard extends ThrottlerGuard {
  private readonly logger = new Logger(TierAwareThrottlerGuard.name);

  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    @Inject(TIER_RESOLVER) private readonly tierResolver: TierResolver,
  ) {
    super(options, storageService, reflector);
  }

  /**
   * Determines the tracking key.
   * Authenticated requests are tracked by user ID; public requests by IP.
   */
  protected async getTracker(req: Record<string, any>): Promise<string> {
    // Try to extract user ID from an already-populated req.user (unlikely
    // since this guard runs as APP_GUARD before auth guards) or by peeking
    // at the JWT in the Authorization header.
    const userId = this.tryExtractUserId(req);
    if (userId) {
      return `user:${userId}`;
    }

    // Fall back to client IP
    return req.ips?.length ? req.ips[0] : req.ip;
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

    // 2. Determine user's subscription tier
    const userId = this.tryExtractUserId(req);
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
   * Attempts to extract a user ID without requiring full authentication.
   *
   * Checks req.user first (in case auth already ran), then peeks at the
   * JWT payload in the Authorization header. This is safe for rate limiting:
   * a forged JWT only isolates the attacker into their own bucket, and real
   * auth validation still happens in JwtOrApiKeyGuard afterward.
   *
   * API key requests (Bearer kk_...) fall back to IP tracking since we
   * can't resolve the user without a DB lookup.
   */
  private tryExtractUserId(req: Record<string, any>): string | null {
    // Already populated by auth guard
    if (req.user?.userId) {
      return req.user.userId;
    }

    const authHeader = req.headers?.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }

    const token = authHeader.slice(7);

    // Skip API key tokens — can't resolve user without DB
    if (token.startsWith('kk_')) {
      return null;
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
