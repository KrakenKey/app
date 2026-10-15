import {
  ORG_ELIGIBLE_PLANS as ORG_PLANS,
  PLAN_LABELS,
} from '@krakenkey/shared';
import type { Subscription } from './entities/subscription.entity';

/**
 * Stripe statuses where the subscription still bills (or will bill) the
 * customer. A second checkout on top of one of these creates a duplicate.
 */
export const LIVE_STRIPE_STATUSES = new Set([
  'active',
  'past_due',
  'trialing',
  'unpaid',
]);

/**
 * Our statuses for a Marketplace subscription that Microsoft still bills:
 * Subscribed (active) and Suspended (past_due, Microsoft is collecting).
 */
const LIVE_MARKETPLACE_STATUSES = new Set(['active', 'past_due']);

/** Plans that can back an organization. */
export const ORG_ELIGIBLE_PLANS: ReadonlySet<string> = new Set(ORG_PLANS);

/** The smallest plan that can back an organization, for messages. */
export const ORG_MIN_PLAN_LABEL = PLAN_LABELS[ORG_PLANS[0]];

type SourceFields = Pick<Subscription, 'stripeSubscriptionId' | 'status'> &
  Partial<Pick<Subscription, 'source' | 'marketplaceSubscriptionId'>>;

/** True when the row points at a Stripe subscription that is still live. */
export function hasLiveStripeSubscription(
  sub: SourceFields | null | undefined,
): boolean {
  return (
    !!sub?.stripeSubscriptionId &&
    sub.source !== 'marketplace' &&
    LIVE_STRIPE_STATUSES.has(sub.status ?? '')
  );
}

/** True when the row is a Microsoft Marketplace subscription that is still live. */
export function hasLiveMarketplaceSubscription(
  sub: SourceFields | null | undefined,
): boolean {
  return (
    sub?.source === 'marketplace' &&
    !!sub.marketplaceSubscriptionId &&
    LIVE_MARKETPLACE_STATUSES.has(sub.status ?? '')
  );
}

/**
 * How long a Marketplace purchase claimed on the landing page counts as
 * being activated. Activation takes seconds; an older claim was abandoned
 * (for example Microsoft refused it) and doesn't block anything.
 */
export const MARKETPLACE_ACTIVATION_WINDOW_MS = 15 * 60 * 1000;

/** True while a Marketplace purchase is being activated for this row. */
export function isActivatingMarketplacePurchase(
  sub:
    | (Pick<Subscription, 'source' | 'marketplaceStatus'> &
        Partial<Pick<Subscription, 'updatedAt'>>)
    | null
    | undefined,
  now: Date = new Date(),
): boolean {
  return (
    sub?.source === 'marketplace' &&
    sub.marketplaceStatus === 'PendingFulfillmentStart' &&
    !!sub.updatedAt &&
    now.getTime() - sub.updatedAt.getTime() < MARKETPLACE_ACTIVATION_WINDOW_MS
  );
}

/** 409 message for a Stripe checkout while Microsoft bills the account. */
export const BILLED_BY_MICROSOFT_MESSAGE =
  'Your subscription is billed through Microsoft. Change or cancel it in the Azure portal instead of starting a checkout here.';
