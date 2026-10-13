export type SubscriptionPlan =
  | 'free'
  | 'starter'
  | 'team'
  | 'business'
  | 'enterprise';

export type SubscriptionStatus =
  | 'active'
  | 'past_due'
  | 'unpaid'
  | 'canceled'
  | 'incomplete'
  | 'trialing';

/** Where a subscription is billed: directly by KrakenKey (Stripe) or by Microsoft Marketplace. */
export type BillingSource = 'stripe' | 'marketplace';

/** A Microsoft Marketplace SaaS subscription's status as Microsoft reports it. */
export type MarketplaceSaasStatus =
  | 'PendingFulfillmentStart'
  | 'Subscribed'
  | 'Suspended'
  | 'Unsubscribed';

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
  /** Microsoft's status for a Marketplace subscription, null for Stripe. */
  marketplaceStatus?: MarketplaceSaasStatus | null;
  createdAt: string;
}

export interface CreateCheckoutRequest {
  plan: SubscriptionPlan;
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
  currentPeriodEnd: string;
}

export interface UpgradeResponse {
  plan: SubscriptionPlan;
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
