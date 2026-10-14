import type { SubscriptionPlan } from '../types/subscription';

/** Every plan id, cheapest first. */
export const SUBSCRIPTION_PLANS: readonly SubscriptionPlan[] = [
  'free',
  'pro',
  'business',
  'enterprise',
] as const;

/**
 * What each plan is called in the dashboard, emails and API messages. The
 * free plan's id stays `free`, but it is sold as "Starter".
 */
export const PLAN_LABELS: Record<SubscriptionPlan, string> = {
  free: 'Starter',
  pro: 'Pro',
  business: 'Business',
  enterprise: 'Enterprise',
};

/**
 * Plan ids used before the free/pro/business/enterprise lineup. Stripe
 * checkouts started, and rows written, by an older release can still carry
 * them for a short while, so they are read as the plan that replaced them.
 */
export const LEGACY_PLAN_ALIASES: Readonly<Record<string, SubscriptionPlan>> = {
  starter: 'pro',
  team: 'business',
};

/** True for a current plan id. */
export function isSubscriptionPlan(plan: unknown): plan is SubscriptionPlan {
  return (
    typeof plan === 'string' &&
    (SUBSCRIPTION_PLANS as readonly string[]).includes(plan)
  );
}

/**
 * The current plan id for a stored or submitted plan name: legacy ids map to
 * their replacement, and anything unknown (or missing) is `free`.
 */
export function normalizePlan(
  plan: string | null | undefined,
): SubscriptionPlan {
  if (isSubscriptionPlan(plan)) return plan;
  return (plan && LEGACY_PLAN_ALIASES[plan]) || 'free';
}

/** Display name for a plan id, e.g. "Starter" for `free`. */
export function planLabel(plan: string | null | undefined): string {
  return PLAN_LABELS[normalizePlan(plan)];
}

/** Plans that can back an organization, smallest first. */
export const ORG_ELIGIBLE_PLANS: readonly SubscriptionPlan[] = [
  'pro',
  'business',
  'enterprise',
];

/** True when the plan can back an organization. */
export function canHaveOrganization(plan: string | null | undefined): boolean {
  return ORG_ELIGIBLE_PLANS.includes(normalizePlan(plan));
}

/**
 * The plan to suggest when a limit is reached: Pro after Starter, Business
 * after Pro, Enterprise (by quote) after Business.
 */
export const NEXT_PLAN: Readonly<
  Record<SubscriptionPlan, SubscriptionPlan | null>
> = {
  free: 'pro',
  pro: 'business',
  business: 'enterprise',
  enterprise: null,
};

/** The next plan up from this one, or null on the largest. */
export function nextPlan(
  plan: string | null | undefined,
): SubscriptionPlan | null {
  return NEXT_PLAN[normalizePlan(plan)];
}

/** Ordering for upgrade checks: a higher number is a bigger plan. */
export const PLAN_ORDER: Record<SubscriptionPlan, number> = {
  free: 0,
  pro: 1,
  business: 2,
  enterprise: 3,
};
