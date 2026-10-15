import { normalizePlan, type SubscriptionPlan } from '@krakenkey/shared';
import type { Subscription } from './entities/subscription.entity';

/**
 * How long a past_due subscription keeps its paid plan, counted from the
 * first failed payment. Matches Stripe's retry schedule (about two weeks),
 * so a customer whose card is declined once doesn't drop to Free while
 * Stripe is still retrying.
 */
export const PAST_DUE_GRACE_DAYS = 14;
export const PAST_DUE_GRACE_MS = PAST_DUE_GRACE_DAYS * 24 * 60 * 60 * 1000;

/**
 * How long a Microsoft Marketplace subscription keeps its paid plan once
 * Microsoft suspends it for nonpayment (stored as past_due). Microsoft gives
 * the customer 30 days to pay before it cancels the subscription and sends
 * Unsubscribe, which drops the account to Free right away.
 */
export const MARKETPLACE_SUSPENDED_GRACE_DAYS = 30;
export const MARKETPLACE_SUSPENDED_GRACE_MS =
  MARKETPLACE_SUSPENDED_GRACE_DAYS * 24 * 60 * 60 * 1000;

/**
 * How long an AWS Marketplace subscription keeps its plan after the
 * current term's end (`currentPeriodEnd`, AWS's ExpirationDate). For an
 * auto-renewing contract that date is the renewal date, and the renewed
 * date reaches KrakenKey a little later through an event or the hourly
 * reconcile. Past it the plan stops applying even if KrakenKey can't reach
 * AWS, so an outage or a broken role never keeps paid limits open.
 */
export const AWS_EXPIRATION_GRACE_MS = 24 * 60 * 60 * 1000;

type GraceFields = Pick<Subscription, 'status' | 'pastDueSince'> &
  Partial<Pick<Subscription, 'source' | 'currentPeriodEnd'>>;

type EntitlementFields = GraceFields & Pick<Subscription, 'plan'>;

/** Length of the grace period for this subscription's billing source. */
function graceMs(sub: GraceFields): number {
  return sub.source === 'marketplace'
    ? MARKETPLACE_SUSPENDED_GRACE_MS
    : PAST_DUE_GRACE_MS;
}

/** When the paid plan stops applying for a past_due subscription, or null. */
export function graceEndsAt(sub: GraceFields): Date | null {
  if (sub.status !== 'past_due' || !sub.pastDueSince) return null;
  return new Date(sub.pastDueSince.getTime() + graceMs(sub));
}

/**
 * Whether an AWS Marketplace subscription's paid term (plus the renewal
 * grace) still covers `now`. A row without a term end never does.
 */
export function withinAwsTerm(
  sub: Partial<Pick<Subscription, 'currentPeriodEnd'>>,
  now: Date = new Date(),
): boolean {
  const end = sub.currentPeriodEnd;
  return !!end && end.getTime() + AWS_EXPIRATION_GRACE_MS > now.getTime();
}

/**
 * Whether the subscription's plan applies right now: it is active, or it is
 * past_due and still inside the grace period. A past_due row without
 * pastDueSince (written before the grace period existed) gets no grace
 * until the next Stripe event for it records the start. An AWS Marketplace
 * subscription also has to be inside its paid term (see
 * AWS_EXPIRATION_GRACE_MS).
 */
export function hasPlanEntitlement(
  sub: GraceFields,
  now: Date = new Date(),
): boolean {
  if (sub.source === 'aws_marketplace' && !withinAwsTerm(sub, now)) {
    return false;
  }
  if (sub.status === 'active') return true;
  const ends = graceEndsAt(sub);
  return ends !== null && now < ends;
}

/**
 * The plan whose limits apply to this subscription right now. A legacy plan
 * id (starter, team) written by an older release reads as its replacement.
 */
export function effectivePlan(
  sub: EntitlementFields | null | undefined,
  now: Date = new Date(),
): SubscriptionPlan {
  if (!sub || !hasPlanEntitlement(sub, now)) return 'free';
  return normalizePlan(sub.plan);
}

/**
 * SQL version of hasPlanEntitlement for queries that join the subscription
 * table. Bind the parameters from entitlementSqlParams().
 */
export function entitledSubscriptionSql(alias: string): string {
  return (
    `((${alias}.source <> 'aws_marketplace' OR ${alias}."currentPeriodEnd" > :awsTermCutoff) AND ` +
    `(${alias}.status = 'active' OR (${alias}.status = 'past_due' AND (` +
    `(${alias}.source = 'marketplace' AND ${alias}."pastDueSince" > :marketplaceGraceCutoff) OR ` +
    `(${alias}.source <> 'marketplace' AND ${alias}."pastDueSince" > :graceCutoff)))))`
  );
}

/** past_due Stripe subscriptions that failed after this time are still in grace. */
export function pastDueGraceCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - PAST_DUE_GRACE_MS);
}

/** Parameters for entitledSubscriptionSql. */
export function entitlementSqlParams(now: Date = new Date()): {
  graceCutoff: Date;
  marketplaceGraceCutoff: Date;
  awsTermCutoff: Date;
} {
  return {
    awsTermCutoff: new Date(now.getTime() - AWS_EXPIRATION_GRACE_MS),
    graceCutoff: pastDueGraceCutoff(now),
    marketplaceGraceCutoff: new Date(
      now.getTime() - MARKETPLACE_SUSPENDED_GRACE_MS,
    ),
  };
}
