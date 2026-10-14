import { StripePriceMap } from './stripe-prices';

const map = (env: Record<string, string>) =>
  new StripePriceMap((name) => env[name]);

describe('StripePriceMap', () => {
  const full = {
    KK_STRIPE_PRICE_PRO_MONTHLY: 'p_pro_m',
    KK_STRIPE_PRICE_PRO_YEARLY: 'p_pro_y',
    KK_STRIPE_PRICE_BUSINESS_MONTHLY: 'p_biz_m',
    KK_STRIPE_PRICE_BUSINESS_YEARLY: 'p_biz_y',
  };

  it('keys prices by plan and interval', () => {
    const prices = map(full);
    expect(prices.priceFor('pro', 'month')).toBe('p_pro_m');
    expect(prices.priceFor('pro', 'year')).toBe('p_pro_y');
    expect(prices.priceFor('business', 'month')).toBe('p_biz_m');
    expect(prices.priceFor('business', 'year')).toBe('p_biz_y');
    expect(prices.priceFor('enterprise', 'month')).toBeUndefined();
    expect(prices.lookup('p_biz_y')).toEqual({
      plan: 'business',
      interval: 'year',
    });
    expect(prices.lookup('unknown')).toBeUndefined();
    expect(prices.lookup(null)).toBeUndefined();
    expect(prices.usingFallback).toEqual([]);
  });

  it('falls back to the old variables for the monthly prices', () => {
    const prices = map({
      KK_STRIPE_PRICE_STARTER: 'p_starter',
      KK_STRIPE_PRICE_TEAM: 'p_team',
    });
    expect(prices.priceFor('pro', 'month')).toBe('p_starter');
    expect(prices.priceFor('business', 'month')).toBe('p_team');
    expect(prices.priceFor('pro', 'year')).toBeUndefined();
    expect(prices.lookup('p_team')).toEqual({
      plan: 'business',
      interval: 'month',
    });
    expect(prices.usingFallback).toEqual([
      'KK_STRIPE_PRICE_PRO_MONTHLY (using KK_STRIPE_PRICE_STARTER)',
      'KK_STRIPE_PRICE_BUSINESS_MONTHLY (using KK_STRIPE_PRICE_TEAM)',
    ]);
    expect(prices.purchasable()).toEqual([
      { plan: 'pro', intervals: ['month'] },
      { plan: 'business', intervals: ['month'] },
    ]);
  });

  it('prefers the new variables and still recognizes the old prices', () => {
    const prices = map({
      ...full,
      KK_STRIPE_PRICE_STARTER: 'p_starter',
      KK_STRIPE_PRICE_TEAM: 'p_team',
    });
    expect(prices.priceFor('pro', 'month')).toBe('p_pro_m');
    // Subscriptions still on the old Starter price are Pro, monthly
    expect(prices.lookup('p_starter')).toEqual({
      plan: 'pro',
      interval: 'month',
    });
    expect(prices.lookup('p_team')).toEqual({
      plan: 'business',
      interval: 'month',
    });
    expect(prices.usingFallback).toEqual([]);
  });

  it('ignores blank values and sells nothing without prices', () => {
    const prices = map({ KK_STRIPE_PRICE_PRO_MONTHLY: '  ' });
    expect(prices.priceFor('pro', 'month')).toBeUndefined();
    expect(prices.purchasable()).toEqual([]);
  });
});
