import type { SubscriptionPlan } from '@krakenkey/shared';
import { PLAN_LIMITS } from '../../../billing/constants/plan-limits';

const MS_PER_DAY = 86_400_000;

/** Whole days until `expiresAt`, rounded down (negative once expired). */
export function daysUntilExpiry(expiresAt: Date, now = Date.now()): number {
  return Math.floor((expiresAt.getTime() - now) / MS_PER_DAY);
}

/** Renewal window for a plan in days. Unknown plans fall back to free. */
export function renewalWindowDays(plan: string): number {
  return (PLAN_LIMITS[plan as SubscriptionPlan] ?? PLAN_LIMITS.free)
    .renewalWindowDays;
}
