export type SubscriptionPlan =
  | 'free'
  | 'starter'
  | 'team'
  | 'business'
  | 'enterprise';

export type SubscriptionStatus =
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'incomplete'
  | 'trialing';

export interface Subscription {
  id: string;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  organizationId?: string | null;
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
