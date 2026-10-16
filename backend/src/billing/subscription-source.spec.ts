import {
  hasLiveAwsMarketplaceSubscription,
  hasLiveMarketplaceSubscription,
  hasLiveStripeSubscription,
  isAwaitingAwsEntitlement,
  isMarketplaceSource,
  liveMarketplaceBiller,
} from './subscription-source';

const aws = {
  source: 'aws_marketplace' as const,
  stripeSubscriptionId: null,
  marketplaceSubscriptionId: 'arn:aws:license-manager::1:license:l-1',
  marketplaceStatus: 'active',
  status: 'active',
};

describe('subscription sources', () => {
  it('knows which sources are marketplaces', () => {
    expect(isMarketplaceSource('marketplace')).toBe(true);
    expect(isMarketplaceSource('aws_marketplace')).toBe(true);
    expect(isMarketplaceSource('stripe')).toBe(false);
    expect(isMarketplaceSource(undefined)).toBe(false);
  });

  it('treats an AWS license as live only while it is entitled', () => {
    expect(hasLiveAwsMarketplaceSubscription(aws)).toBe(true);
    expect(
      hasLiveAwsMarketplaceSubscription({
        ...aws,
        marketplaceStatus: 'pending',
        status: 'incomplete',
      }),
    ).toBe(false);
    expect(
      hasLiveAwsMarketplaceSubscription({
        ...aws,
        marketplaceStatus: 'ended',
        status: 'canceled',
      }),
    ).toBe(false);
    expect(
      hasLiveAwsMarketplaceSubscription({
        ...aws,
        marketplaceSubscriptionId: null,
      }),
    ).toBe(false);
  });

  it('counts a Stripe subscription whose first payment is clearing as live', () => {
    expect(
      hasLiveStripeSubscription({
        source: 'stripe',
        stripeSubscriptionId: 'sub_1',
        status: 'incomplete',
      }),
    ).toBe(true);
    expect(
      hasLiveStripeSubscription({
        source: 'stripe',
        stripeSubscriptionId: 'sub_1',
        status: 'incomplete_expired',
      }),
    ).toBe(false);
  });

  it('never reads an AWS row as Stripe or Microsoft, even with a stray Stripe id', () => {
    const row = { ...aws, stripeSubscriptionId: 'sub_1' };
    expect(hasLiveStripeSubscription(row)).toBe(false);
    expect(hasLiveMarketplaceSubscription(row)).toBe(false);
  });

  it('names the marketplace that bills the row', () => {
    expect(liveMarketplaceBiller(aws)).toBe('aws');
    expect(
      liveMarketplaceBiller({
        ...aws,
        source: 'marketplace',
        marketplaceStatus: 'Subscribed',
      }),
    ).toBe('microsoft');
    expect(
      liveMarketplaceBiller({
        ...aws,
        source: 'stripe',
        stripeSubscriptionId: 'sub_1',
      }),
    ).toBeNull();
    expect(liveMarketplaceBiller(null)).toBeNull();
  });

  it('counts a pending AWS link as in progress for as long as it is pending', () => {
    const pending = {
      source: 'aws_marketplace' as const,
      marketplaceStatus: 'pending',
      updatedAt: new Date('2020-01-01T00:00:00Z'),
    };
    expect(isAwaitingAwsEntitlement(pending)).toBe(true);
    expect(
      isAwaitingAwsEntitlement({ ...pending, marketplaceStatus: 'active' }),
    ).toBe(false);
    expect(
      isAwaitingAwsEntitlement({ ...pending, source: 'marketplace' as const }),
    ).toBe(false);
    expect(isAwaitingAwsEntitlement(null)).toBe(false);
  });
});
