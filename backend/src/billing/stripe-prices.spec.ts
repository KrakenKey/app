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
    expect(prices.missing()).toEqual([]);
  });

  it('never sells or recognizes the old Starter and Team prices', () => {
    const prices = map({
      KK_STRIPE_PRICE_STARTER: 'p_starter',
      KK_STRIPE_PRICE_TEAM: 'p_team',
    });
    expect(prices.priceFor('pro', 'month')).toBeUndefined();
    expect(prices.priceFor('business', 'month')).toBeUndefined();
    expect(prices.lookup('p_starter')).toBeUndefined();
    expect(prices.lookup('p_team')).toBeUndefined();
    expect(prices.purchasable()).toEqual([]);
  });

  it('sells only the plans and intervals that have a price', () => {
    const prices = map({
      KK_STRIPE_PRICE_PRO_MONTHLY: 'p_pro_m',
      KK_STRIPE_PRICE_PRO_YEARLY: 'p_pro_y',
    });
    // Business isn't purchasable until its own price is set
    expect(prices.purchasable()).toEqual([
      { plan: 'pro', intervals: ['month', 'year'] },
    ]);
    expect(prices.missing()).toEqual([
      'KK_STRIPE_PRICE_BUSINESS_MONTHLY',
      'KK_STRIPE_PRICE_BUSINESS_YEARLY',
    ]);
  });

  it('ignores blank values', () => {
    const prices = map({ KK_STRIPE_PRICE_PRO_MONTHLY: '  ' });
    expect(prices.priceFor('pro', 'month')).toBeUndefined();
    expect(prices.purchasable()).toEqual([]);
  });
});
