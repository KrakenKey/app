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
 * Environment variable for each price. There are no fallbacks to the old
 * Starter and Team prices: Team cost less than Business, and Starter's
 * price can't be confirmed to match Pro, so a plan and interval without
 * its own variable simply isn't sold.
 */
export const PRICE_ENV: Record<StripePlan, Record<BillingInterval, string>> = {
  pro: {
    month: 'KK_STRIPE_PRICE_PRO_MONTHLY',
    year: 'KK_STRIPE_PRICE_PRO_YEARLY',
  },
  business: {
    month: 'KK_STRIPE_PRICE_BUSINESS_MONTHLY',
    year: 'KK_STRIPE_PRICE_BUSINESS_YEARLY',
  },
};

/**
 * Stripe prices by plan and interval, read once from the environment, and
 * the reverse lookup the webhooks use. Only the configured prices are
 * known; any other price (the old Starter and Team ones included) maps to
 * no plan.
 */
export class StripePriceMap {
  private readonly prices = new Map<string, string>();
  private readonly byPriceId = new Map<string, PlanPrice>();

  constructor(get: (name: string) => string | undefined) {
    for (const plan of STRIPE_PLANS) {
      for (const interval of ['month', 'year'] as const) {
        const priceId = get(PRICE_ENV[plan][interval])?.trim();
        if (!priceId) continue;
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

  /** Price variables that are unset, for a startup note. Never values. */
  missing(): string[] {
    return STRIPE_PLANS.flatMap((plan) =>
      (['month', 'year'] as const)
        .filter((i) => !this.prices.has(`${plan}:${i}`))
        .map((i) => PRICE_ENV[plan][i]),
    );
  }
}
