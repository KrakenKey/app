import {
  ORG_ELIGIBLE_PLANS as ORG_PLANS,
  PLAN_LABELS,
} from '@krakenkey/shared';
import type { Subscription } from './entities/subscription.entity';

/**
 * Stripe statuses where the subscription still bills (or will bill) the
 * customer. A second checkout on top of one of these creates a duplicate.
 * `incomplete` is a new subscription whose first payment hasn't cleared yet
 * (a bank debit, or a card waiting for authentication); it grants no plan
 * (see entitlement.ts) but still blocks a second checkout.
 */
export const LIVE_STRIPE_STATUSES = new Set([
  'active',
  'incomplete',
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
  Partial<
    Pick<
      Subscription,
      'source' | 'marketplaceSubscriptionId' | 'marketplaceStatus'
    >
  >;

/** True for a subscription billed by Microsoft or AWS Marketplace. */
export function isMarketplaceSource(
  source: Subscription['source'] | null | undefined,
): boolean {
  return source === 'marketplace' || source === 'aws_marketplace';
}

/** True when the row points at a Stripe subscription that is still live. */
export function hasLiveStripeSubscription(
  sub: SourceFields | null | undefined,
): boolean {
  return (
    !!sub?.stripeSubscriptionId &&
    !isMarketplaceSource(sub.source) &&
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

/** True when the row is an AWS Marketplace license with a current entitlement. */
export function hasLiveAwsMarketplaceSubscription(
  sub: SourceFields | null | undefined,
): boolean {
  return (
    sub?.source === 'aws_marketplace' &&
    !!sub.marketplaceSubscriptionId &&
    sub.marketplaceStatus === 'active' &&
    sub.status === 'active'
  );
}

/**
 * True while an AWS Marketplace purchase linked here waits for its
 * entitlement. It keeps a Stripe checkout from starting for as long as it
 * is pending, so the account is never billed twice; the owner can remove
 * the pending link from the billing page (DELETE
 * /billing/aws-marketplace/pending) to bill another way.
 */
export function isAwaitingAwsEntitlement(
  sub: Pick<Subscription, 'source' | 'marketplaceStatus'> | null | undefined,
): boolean {
  return (
    sub?.source === 'aws_marketplace' && sub.marketplaceStatus === 'pending'
  );
}

/**
 * The marketplace that bills this row right now, or null when none does
 * (Stripe, the free plan, or a marketplace subscription that ended).
 */
export function liveMarketplaceBiller(
  sub: SourceFields | null | undefined,
): 'microsoft' | 'aws' | null {
  if (hasLiveMarketplaceSubscription(sub)) return 'microsoft';
  if (hasLiveAwsMarketplaceSubscription(sub)) return 'aws';
  return null;
}

/** AWS Marketplace console page where buyers manage their subscriptions. */
export const AWS_MARKETPLACE_CONSOLE_URL =
  'https://console.aws.amazon.com/marketplace/home#/subscriptions';

/** 409 message for a Stripe checkout while AWS Marketplace bills the account. */
export const BILLED_BY_AWS_MESSAGE =
  'Your subscription is billed through AWS Marketplace. Change or cancel it in the AWS Marketplace console instead of starting a checkout here.';

/** 409 message for a Stripe checkout while an AWS purchase waits for its entitlement. */
export const AWAITING_AWS_MESSAGE =
  'An AWS Marketplace purchase is linked to this account and waiting for AWS to confirm it. Wait a few minutes, or remove the pending purchase on the billing page to subscribe here instead.';
