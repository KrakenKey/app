/**
 * Plan ids. `free` is shown as "Starter" (see PLAN_LABELS); `enterprise` is
 * for custom deals and is not sold self-serve.
 */
export type SubscriptionPlan = 'free' | 'pro' | 'business' | 'enterprise';

export type SubscriptionStatus =
  | 'active'
  | 'past_due'
  | 'unpaid'
  | 'canceled'
  | 'incomplete'
  | 'trialing';

/** How often a paid plan is billed. A year costs ten months. */
export type BillingInterval = 'month' | 'year';

export const BILLING_INTERVALS: readonly BillingInterval[] = ['month', 'year'];

/**
 * Where a subscription is billed: directly by KrakenKey (Stripe), by
 * Microsoft Marketplace (`marketplace`) or by AWS Marketplace
 * (`aws_marketplace`).
 */
export type BillingSource = 'stripe' | 'marketplace' | 'aws_marketplace';

/** A Microsoft Marketplace SaaS subscription's status as Microsoft reports it. */
export type MarketplaceSaasStatus =
  | 'PendingFulfillmentStart'
  | 'Subscribed'
  | 'Suspended'
  | 'Unsubscribed';

/**
 * An AWS Marketplace license as KrakenKey tracks it:
 * - `pending`: linked to an account, waiting for AWS to grant the entitlement
 * - `active`: AWS reports a current entitlement for a plan sold here
 * - `ended`: the contract expired, was canceled or the license was deprovisioned
 */
export type AwsMarketplaceLicenseStatus = 'pending' | 'active' | 'ended';

/**
 * A plan or billing interval change Stripe will apply at a later date,
 * usually the end of the current period (a downgrade or a switch from
 * yearly to monthly made in the billing portal).
 */
export interface ScheduledPlanChange {
  plan: SubscriptionPlan;
  interval: BillingInterval;
  /** When the change takes effect (ISO 8601). */
  effectiveAt: string;
}

export interface Subscription {
  id: string;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  organizationId?: string | null;
  /** When the first payment of the current past_due run failed. */
  pastDueSince?: string | null;
  /**
   * While past_due: when the paid plan's limits stop applying unless the
   * payment goes through. Null otherwise.
   */
  graceEndsAt?: string | null;
  /** Who bills the subscription. Missing on responses from older API versions (Stripe). */
  source?: BillingSource;
  /**
   * The marketplace's status: Microsoft's for `marketplace`, KrakenKey's
   * license status for `aws_marketplace`, null for Stripe.
   */
  marketplaceStatus?:
    | MarketplaceSaasStatus
    | AwsMarketplaceLicenseStatus
    | null;
  /**
   * How often a Stripe subscription is billed; null on the free plan, for
   * Marketplace subscriptions and for rows from before annual billing.
   */
  interval?: BillingInterval | null;
  /**
   * A change Stripe has scheduled for a later date, or null when there is
   * none, for Marketplace and free subscriptions, and when Stripe couldn't
   * be reached. Cancellation is reported by `cancelAtPeriodEnd` instead.
   */
  scheduledChange?: ScheduledPlanChange | null;
  createdAt: string;
}

export interface CreateCheckoutRequest {
  plan: SubscriptionPlan;
  /** Defaults to `month`. */
  interval?: BillingInterval;
}

export interface UpgradeRequest {
  plan: SubscriptionPlan;
  /** Defaults to the subscription's current interval. */
  interval?: BillingInterval;
  /** prorationDate from the preview. */
  prorationDate?: number;
}

/** `switch_interval` opens the portal on a monthly/yearly switch to confirm. */
export interface PortalRequest {
  flow?: 'switch_interval';
}

/** A plan that can be bought here, and the intervals it has a price for. */
export interface PurchasablePlan {
  plan: SubscriptionPlan;
  intervals: BillingInterval[];
}

export interface PlansResponse {
  plans: PurchasablePlan[];
}

export interface CheckoutResponse {
  sessionUrl: string;
}

export interface PortalResponse {
  portalUrl: string;
}

export interface UpgradePreviewResponse {
  immediateAmountCents: number;
  currency: string;
  targetPlan: SubscriptionPlan;
  /** The interval after the upgrade. Missing from older API versions. */
  targetInterval?: BillingInterval;
  /** When the next regular invoice is due after the upgrade. */
  currentPeriodEnd: string;
  /**
   * Unix time the amount was prorated from. Send it with the upgrade so
   * Stripe charges the same amount. Missing from older API versions.
   */
  prorationDate?: number;
  /**
   * True when a change scheduled for the end of the period (a downgrade or
   * a yearly-to-monthly switch made in the billing portal) will be canceled
   * by the upgrade.
   */
  cancelsScheduledChange?: boolean;
}

export interface UpgradeResponse {
  plan: SubscriptionPlan;
  interval?: BillingInterval | null;
  status: SubscriptionStatus;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

export interface MarketplaceStatusResponse {
  /** Whether this KrakenKey installation sells plans through Microsoft Marketplace. */
  enabled: boolean;
}

export interface MarketplaceTokenRequest {
  /** The `token` query parameter Microsoft adds to the landing page URL. */
  token: string;
}

/**
 * What the Marketplace landing page can do with a purchase:
 * - `ready`: can be activated (or linked, if Microsoft already activated it) for this account
 * - `active`: already linked to this account (a "manage" visit from the Azure portal)
 * - `linked_elsewhere`: linked to a different KrakenKey account
 * - `conflict`: this account already has a paid subscription (Stripe or another Marketplace one)
 * - `not_owner`: the user is in an organization and isn't its owner
 * - `needs_team`: the plan can't back an organization and the user is in one. Every plan sold through the Marketplace (Pro, Business, Enterprise) can, so current versions don't return it
 * - `unknown_plan`: the purchased plan isn't sold through this installation
 * - `suspended`: Microsoft suspended it (payment problem) and it isn't linked here
 * - `ended`: canceled on Microsoft's side
 */
export type MarketplaceLandingState =
  | 'ready'
  | 'active'
  | 'linked_elsewhere'
  | 'conflict'
  | 'not_owner'
  | 'needs_team'
  | 'unknown_plan'
  | 'suspended'
  | 'ended';

export interface MarketplaceLandingResponse {
  state: MarketplaceLandingState;
  /** Why the purchase can't be activated here, for `conflict`. */
  message?: string;
  subscriptionName: string;
  planId: string;
  /** The KrakenKey plan the Marketplace plan maps to, or null when unknown. */
  plan: SubscriptionPlan | null;
  saasStatus: MarketplaceSaasStatus;
  purchaserEmail: string | null;
  beneficiaryEmail: string | null;
  /** Billing term, e.g. P1M (monthly) or P1Y (yearly). */
  termUnit: string | null;
  isFreeTrial: boolean;
  /**
   * Whether the signed-in user's email is the purchaser's or the
   * beneficiary's. When it isn't, the page asks for an explicit confirmation.
   */
  accountMatchesPurchase: boolean;
  /** The KrakenKey account the subscription applies to. */
  target: { kind: 'user' | 'organization'; name: string };
}

export interface AwsMarketplaceStatusResponse {
  /** Whether this KrakenKey installation sells plans through AWS Marketplace. */
  enabled: boolean;
}

export interface AwsMarketplaceRegistrationRequest {
  /**
   * The `registration` query parameter the fulfillment URL redirects to. It
   * stands for a purchase AWS confirmed; it is not the AWS token.
   */
  registration: string;
}

/**
 * What the AWS Marketplace landing page can do with a purchase:
 * - `ready`: AWS reports an entitlement; it can be linked to this account
 * - `awaiting_entitlement`: can be linked, but AWS hasn't granted the entitlement yet. Linking now applies the plan as soon as it does
 * - `active`: linked to this account and entitled
 * - `pending`: linked to this account, waiting for AWS to grant the entitlement
 * - `linked_elsewhere`: linked to a different KrakenKey account
 * - `conflict`: this account already has a paid subscription (Stripe, Microsoft or another AWS one)
 * - `not_owner`: the user is in an organization and isn't its owner
 * - `unknown_plan`: the purchased dimension isn't sold through this installation
 * - `ended`: the contract has ended
 */
export type AwsMarketplaceLandingState =
  | 'ready'
  | 'awaiting_entitlement'
  | 'active'
  | 'pending'
  | 'linked_elsewhere'
  | 'conflict'
  | 'not_owner'
  | 'unknown_plan'
  | 'ended';

export interface AwsMarketplaceLandingResponse {
  state: AwsMarketplaceLandingState;
  /** Why the purchase can't be linked here, for `conflict`. */
  message?: string;
  /** The buyer's AWS account ID. */
  awsAccountId: string;
  /** The purchased contract dimension (for example `pro`), or null before AWS grants it. */
  dimension: string | null;
  /** The KrakenKey plan the dimension maps to, or null when unknown. */
  plan: SubscriptionPlan | null;
  /** When the current contract term ends or renews (ISO 8601), if known. */
  expiresAt: string | null;
  /** The KrakenKey account the purchase applies to. */
  target: { kind: 'user' | 'organization'; name: string };
}
