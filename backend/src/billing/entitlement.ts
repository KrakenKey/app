import type { Subscription } from './entities/subscription.entity';

/**
 * How long a past_due subscription keeps its paid plan, counted from the
 * first failed payment. Matches Stripe's retry schedule (about two weeks),
 * so a customer whose card is declined once doesn't drop to Free while
 * Stripe is still retrying.
 */
export const PAST_DUE_GRACE_DAYS = 14;
export const PAST_DUE_GRACE_MS = PAST_DUE_GRACE_DAYS * 24 * 60 * 60 * 1000;

type EntitlementFields = Pick<Subscription, 'plan' | 'status' | 'pastDueSince'>;

/** When the paid plan stops applying for a past_due subscription, or null. */
export function graceEndsAt(
  sub: Pick<Subscription, 'status' | 'pastDueSince'>,
): Date | null {
  if (sub.status !== 'past_due' || !sub.pastDueSince) return null;
  return new Date(sub.pastDueSince.getTime() + PAST_DUE_GRACE_MS);
}

/**
 * Whether the subscription's plan applies right now: it is active, or it is
 * past_due and still inside the grace period. A past_due row without
 * pastDueSince (written before the grace period existed) gets no grace
 * until the next Stripe event for it records the start.
 */
export function hasPlanEntitlement(
  sub: Pick<Subscription, 'status' | 'pastDueSince'>,
  now: Date = new Date(),
): boolean {
  if (sub.status === 'active') return true;
  const ends = graceEndsAt(sub);
  return ends !== null && now < ends;
}

/** The plan whose limits apply to this subscription right now. */
export function effectivePlan(
  sub: EntitlementFields | null | undefined,
  now: Date = new Date(),
): string {
  if (!sub || !hasPlanEntitlement(sub, now)) return 'free';
  return sub.plan;
}

/**
 * SQL version of hasPlanEntitlement for queries that join the subscription
 * table. Bind `graceCutoff` to pastDueGraceCutoff().
 */
export function entitledSubscriptionSql(alias: string): string {
  return `(${alias}.status = 'active' OR (${alias}.status = 'past_due' AND ${alias}."pastDueSince" > :graceCutoff))`;
}

/** past_due subscriptions that failed after this time are still in grace. */
export function pastDueGraceCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - PAST_DUE_GRACE_MS);
}
