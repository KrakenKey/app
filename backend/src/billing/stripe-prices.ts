import type { BillingInterval } from '@krakenkey/shared';
import type { PaidPlan } from './dto/paid-plan';

/** Plans with Stripe prices. Enterprise is sold by quote. */
export const STRIPE_PLANS = ['pro', 'business'] as const;
export type StripePlan = (typeof STRIPE_PLANS)[number];

/** A Stripe price's plan and billing interval. */
export interface PlanPrice {
  plan: StripePlan;
  interval: BillingInterval;
}

/**
 * Environment variables for each price. The monthly prices fall back to the
 * variables from before annual billing, so a deploy works before the new
 * ones are set.
 */
export const PRICE_ENV: Record<
  StripePlan,
  Record<BillingInterval, { name: string; fallback?: string }>
> = {
  pro: {
    month: {
      name: 'KK_STRIPE_PRICE_PRO_MONTHLY',
      fallback: 'KK_STRIPE_PRICE_STARTER',
    },
    year: { name: 'KK_STRIPE_PRICE_PRO_YEARLY' },
  },
  business: {
    month: {
      name: 'KK_STRIPE_PRICE_BUSINESS_MONTHLY',
      fallback: 'KK_STRIPE_PRICE_TEAM',
    },
    year: { name: 'KK_STRIPE_PRICE_BUSINESS_YEARLY' },
  },
};

/**
 * Stripe prices by plan and interval, read once from the environment, and
 * the reverse lookup the webhooks use. The legacy variables stay in the
 * reverse lookup even once the new ones are set, so subscriptions still on
 * the old monthly prices keep mapping to Pro and Business.
 */
export class StripePriceMap {
  private readonly prices = new Map<string, string>();
  private readonly byPriceId = new Map<string, PlanPrice>();
  /** Fallbacks in use, for a startup warning. Never includes values. */
  readonly usingFallback: string[] = [];

  constructor(get: (name: string) => string | undefined) {
    for (const plan of STRIPE_PLANS) {
      for (const interval of ['month', 'year'] as const) {
        const { name, fallback } = PRICE_ENV[plan][interval];
        const own = get(name)?.trim();
        const old = fallback ? get(fallback)?.trim() : undefined;
        const priceId = own || old;
        if (old) this.byPriceId.set(old, { plan, interval });
        if (!priceId) continue;
        if (!own && old) this.usingFallback.push(`${name} (using ${fallback})`);
        this.prices.set(`${plan}:${interval}`, priceId);
        this.byPriceId.set(priceId, { plan, interval });
      }
    }
  }

  /** The price for a plan and interval, or undefined when not sold. */
  priceFor(
    plan: PaidPlan | string,
    interval: BillingInterval,
  ): string | undefined {
    return this.prices.get(`${plan}:${interval}`);
  }

  /** The plan and interval a Stripe price stands for, or undefined. */
  lookup(priceId: string | null | undefined): PlanPrice | undefined {
    return priceId ? this.byPriceId.get(priceId) : undefined;
  }

  /** The plans that can be bought here and their intervals. */
  purchasable(): { plan: StripePlan; intervals: BillingInterval[] }[] {
    return STRIPE_PLANS.map((plan) => ({
      plan,
      intervals: (['month', 'year'] as const).filter((i) =>
        this.prices.has(`${plan}:${i}`),
      ),
    })).filter((p) => p.intervals.length > 0);
  }
}
