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
export const ORG_ELIGIBLE_PLANS = new Set(['team', 'business', 'enterprise']);

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

/** 409 message for a Stripe checkout while Microsoft bills the account. */
export const BILLED_BY_MICROSOFT_MESSAGE =
  'Your subscription is billed through Microsoft. Change or cancel it in the Azure portal instead of starting a checkout here.';
