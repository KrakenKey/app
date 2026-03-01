import { RateLimitCategory } from '../interfaces/rate-limit-category.enum';

export interface RateLimitRule {
  limit: number;
  ttl: number; // milliseconds
}

export type TierRateLimits = Record<RateLimitCategory, RateLimitRule>;

/**
 * Rate limit configuration per subscription tier.
 *
 * Categories:
 *   public    — Unauthenticated endpoints (/, /health, /auth/*)
 *   read      — Authenticated GET requests (list domains, view certs, etc.)
 *   write     — Authenticated mutations (create domain, delete cert, etc.)
 *   expensive — Resource-heavy operations (issue cert, renew cert, verify domain)
 *
 * Tiers (aligned with planned pricing):
 *   free       — Free ACME automation
 *   starter    — Starter $29/mo CLM / Pro $29/mo API
 *   team       — Team $79/mo CLM
 *   business   — Business $99-199/mo (dedicated rate limits)
 *   enterprise — Enterprise $499+/mo
 *
 * Summary:
 *   Tier        | Public   | Reads     | Writes   | Expensive
 *   ------------|----------|-----------|----------|-----------
 *   free        | 30/min   | 60/min    | 20/min   | 5/hr
 *   starter     | 60/min   | 120/min   | 40/min   | 10/hr
 *   team        | 60/min   | 300/min   | 60/min   | 30/hr
 *   business    | 120/min  | 600/min   | 120/min  | 60/hr
 *   enterprise  | 120/min  | 1000/min  | 200/min  | 100/hr
 */
export const RATE_LIMIT_TIERS: Record<string, TierRateLimits> = {
  // Free tier: basic ACME automation only
  free: {
    [RateLimitCategory.PUBLIC]: { limit: 30, ttl: 60_000 }, // 30 req/min
    [RateLimitCategory.AUTHENTICATED_READ]: { limit: 60, ttl: 60_000 }, // 60 req/min
    [RateLimitCategory.AUTHENTICATED_WRITE]: { limit: 20, ttl: 60_000 }, // 20 req/min
    [RateLimitCategory.EXPENSIVE]: { limit: 5, ttl: 3_600_000 }, // 5 req/hr
  },

  // Starter / Pro ($29/mo): small projects, freelancers
  starter: {
    [RateLimitCategory.PUBLIC]: { limit: 60, ttl: 60_000 }, // 60 req/min
    [RateLimitCategory.AUTHENTICATED_READ]: { limit: 120, ttl: 60_000 }, // 120 req/min
    [RateLimitCategory.AUTHENTICATED_WRITE]: { limit: 40, ttl: 60_000 }, // 40 req/min
    [RateLimitCategory.EXPENSIVE]: { limit: 10, ttl: 3_600_000 }, // 10 req/hr
  },

  // Team ($79/mo): SMEs, DevOps teams
  team: {
    [RateLimitCategory.PUBLIC]: { limit: 60, ttl: 60_000 }, // 60 req/min
    [RateLimitCategory.AUTHENTICATED_READ]: { limit: 300, ttl: 60_000 }, // 300 req/min
    [RateLimitCategory.AUTHENTICATED_WRITE]: { limit: 60, ttl: 60_000 }, // 60 req/min
    [RateLimitCategory.EXPENSIVE]: { limit: 30, ttl: 3_600_000 }, // 30 req/hr
  },

  // Business ($99-199/mo): dedicated rate limits, mid-market
  business: {
    [RateLimitCategory.PUBLIC]: { limit: 120, ttl: 60_000 }, // 120 req/min
    [RateLimitCategory.AUTHENTICATED_READ]: { limit: 600, ttl: 60_000 }, // 600 req/min
    [RateLimitCategory.AUTHENTICATED_WRITE]: { limit: 120, ttl: 60_000 }, // 120 req/min
    [RateLimitCategory.EXPENSIVE]: { limit: 60, ttl: 3_600_000 }, // 60 req/hr
  },

  // Enterprise ($499+/mo): large orgs, MSPs, hosting providers
  enterprise: {
    [RateLimitCategory.PUBLIC]: { limit: 120, ttl: 60_000 }, // 120 req/min
    [RateLimitCategory.AUTHENTICATED_READ]: { limit: 1000, ttl: 60_000 }, // 1000 req/min
    [RateLimitCategory.AUTHENTICATED_WRITE]: { limit: 200, ttl: 60_000 }, // 200 req/min
    [RateLimitCategory.EXPENSIVE]: { limit: 100, ttl: 3_600_000 }, // 100 req/hr
  },
};

export const DEFAULT_TIER = 'free';
