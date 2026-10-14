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
 *   public-strict — Unauthenticated credential exchanges (/connectors/enroll,
 *               /connectors/rotate); 10/min per IP
 *   connector-token  — POST /connectors/token; 60/min per IP
 *   connector-report — POST /connectors/report; 60/hr per connector
 *   read      — Authenticated GET requests (list domains, view certs, etc.)
 *   write     — Authenticated mutations (create domain, delete cert, etc.)
 *   expensive — Resource-heavy operations (issue, retry or revoke a cert, verify a domain)
 *
 * Renewals (POST /certs/tls/:id/renew) have their own category, `renewal`,
 * with the per-tier numbers in RENEWAL_LIMITS_PER_HOUR.
 *
 * Tiers are plan ids:
 *   free       the free plan, shown as "Starter"
 *   pro        Pro
 *   business   Business
 *   enterprise custom deals
 *
 * Summary:
 *   Tier        | Public   | Reads     | Writes   | Expensive | Renewals
 *   ------------|----------|-----------|----------|-----------|----------
 *   free        | 30/min   | 60/min    | 20/min   | 5/hr      | 10/hr
 *   pro         | 60/min   | 300/min   | 60/min   | 30/hr     | 120/hr
 *   business    | 120/min  | 600/min   | 120/min  | 60/hr     | 300/hr
 *   enterprise  | 120/min  | 1000/min  | 200/min  | 100/hr    | 600/hr
 */

/**
 * Renewal requests per hour, per tier: the only place these numbers live.
 *
 * Renewals used the expensive allowance (5 an hour on Free). A renewal
 * replaces a certificate, so it can't grow an account, and since renewals
 * past the concurrent pending limit now wait their turn, these numbers cap
 * how fast requests arrive, not how many ACME orders run at once. Each is
 * at least twice the expensive allowance, and lets an account at its plan's
 * total active certificate limit renew everything within a few hours of
 * clustered daily timers (Free's 10 certificates in one hour, Business's
 * 1000 in under four). `ifDue=true` requests count even when nothing is due.
 */
export const RENEWAL_LIMITS_PER_HOUR: Record<string, number> = {
  free: 10,
  pro: 120,
  business: 300,
  enterprise: 600,
};

const renewal = (tier: string) => ({
  limit: RENEWAL_LIMITS_PER_HOUR[tier],
  ttl: 3_600_000,
});
export const RATE_LIMIT_TIERS: Record<string, TierRateLimits> = {
  // Free plan (shown as Starter)
  free: {
    [RateLimitCategory.PUBLIC]: { limit: 30, ttl: 60_000 }, // 30 req/min
    [RateLimitCategory.PUBLIC_STRICT]: { limit: 10, ttl: 60_000 }, // 10 req/min
    [RateLimitCategory.CONNECTOR_TOKEN]: { limit: 60, ttl: 60_000 }, // 60 req/min per IP
    [RateLimitCategory.CONNECTOR_REPORT]: { limit: 60, ttl: 3_600_000 }, // 60 req/hr per connector
    [RateLimitCategory.AUTHENTICATED_READ]: { limit: 60, ttl: 60_000 }, // 60 req/min
    [RateLimitCategory.AUTHENTICATED_WRITE]: { limit: 20, ttl: 60_000 }, // 20 req/min
    [RateLimitCategory.EXPENSIVE]: { limit: 5, ttl: 3_600_000 }, // 5 req/hr
    [RateLimitCategory.RENEWAL]: renewal('free'),
  },

  // Pro: individuals and small teams
  pro: {
    [RateLimitCategory.PUBLIC]: { limit: 60, ttl: 60_000 }, // 60 req/min
    [RateLimitCategory.PUBLIC_STRICT]: { limit: 10, ttl: 60_000 }, // 10 req/min
    [RateLimitCategory.CONNECTOR_TOKEN]: { limit: 60, ttl: 60_000 }, // 60 req/min per IP
    [RateLimitCategory.CONNECTOR_REPORT]: { limit: 60, ttl: 3_600_000 }, // 60 req/hr per connector
    [RateLimitCategory.AUTHENTICATED_READ]: { limit: 300, ttl: 60_000 }, // 300 req/min
    [RateLimitCategory.AUTHENTICATED_WRITE]: { limit: 60, ttl: 60_000 }, // 60 req/min
    [RateLimitCategory.EXPENSIVE]: { limit: 30, ttl: 3_600_000 }, // 30 req/hr
    [RateLimitCategory.RENEWAL]: renewal('pro'),
  },

  // Business: SaaS teams and agencies
  business: {
    [RateLimitCategory.PUBLIC]: { limit: 120, ttl: 60_000 }, // 120 req/min
    [RateLimitCategory.PUBLIC_STRICT]: { limit: 10, ttl: 60_000 }, // 10 req/min
    [RateLimitCategory.CONNECTOR_TOKEN]: { limit: 60, ttl: 60_000 }, // 60 req/min per IP
    [RateLimitCategory.CONNECTOR_REPORT]: { limit: 60, ttl: 3_600_000 }, // 60 req/hr per connector
    [RateLimitCategory.AUTHENTICATED_READ]: { limit: 600, ttl: 60_000 }, // 600 req/min
    [RateLimitCategory.AUTHENTICATED_WRITE]: { limit: 120, ttl: 60_000 }, // 120 req/min
    [RateLimitCategory.EXPENSIVE]: { limit: 60, ttl: 3_600_000 }, // 60 req/hr
    [RateLimitCategory.RENEWAL]: renewal('business'),
  },

  // Enterprise: custom deals
  enterprise: {
    [RateLimitCategory.PUBLIC]: { limit: 120, ttl: 60_000 }, // 120 req/min
    [RateLimitCategory.PUBLIC_STRICT]: { limit: 10, ttl: 60_000 }, // 10 req/min
    [RateLimitCategory.CONNECTOR_TOKEN]: { limit: 60, ttl: 60_000 }, // 60 req/min per IP
    [RateLimitCategory.CONNECTOR_REPORT]: { limit: 60, ttl: 3_600_000 }, // 60 req/hr per connector
    [RateLimitCategory.AUTHENTICATED_READ]: { limit: 1000, ttl: 60_000 }, // 1000 req/min
    [RateLimitCategory.AUTHENTICATED_WRITE]: { limit: 200, ttl: 60_000 }, // 200 req/min
    [RateLimitCategory.EXPENSIVE]: { limit: 100, ttl: 3_600_000 }, // 100 req/hr
    [RateLimitCategory.RENEWAL]: renewal('enterprise'),
  },
};

export const DEFAULT_TIER = 'free';
