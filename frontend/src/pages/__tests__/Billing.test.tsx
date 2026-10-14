import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError, AxiosHeaders } from 'axios';
import Billing from '../Billing';

const {
  mockFetchSubscription,
  mockFetchPlans,
  mockCreateCheckout,
  mockCreatePortalSession,
  mockPreviewUpgrade,
  mockUpgradeSubscription,
  authState,
  healthState,
} = vi.hoisted(() => ({
  mockFetchSubscription: vi.fn(),
  mockFetchPlans: vi.fn(),
  mockCreateCheckout: vi.fn(),
  mockPreviewUpgrade: vi.fn(),
  mockUpgradeSubscription: vi.fn(),
  mockCreatePortalSession: vi.fn(),
  authState: {
    user: null as {
      organizationId: string | null;
      role: 'owner' | 'admin' | 'member' | 'viewer' | null;
      resourceCounts?: {
        domains: number;
        certificates: number;
        apiKeys: number;
        connectors?: number;
        alertChannels?: number;
        githubOidcTrusts?: number;
        orgMembers?: number;
      };
    } | null,
  },
  healthState: { data: null as unknown },
}));

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: authState.user }),
}));

vi.mock('../../hooks/useHealth', () => ({
  useHealth: () => ({
    data: healthState.data,
    status: {
      certs: 'loaded',
      endpoints: 'loaded',
      latestResults: 'loaded',
      probes: 'loaded',
      connectors: 'loaded',
      domains: 'loaded',
    },
  }),
}));

vi.mock('../../services/billingService', () => ({
  fetchSubscription: mockFetchSubscription,
  fetchPlans: mockFetchPlans,
  createCheckout: mockCreateCheckout,
  createPortalSession: mockCreatePortalSession,
  previewUpgrade: mockPreviewUpgrade,
  upgradeSubscription: mockUpgradeSubscription,
}));

const sub = (plan: string) => ({
  id: `sub_${plan}`,
  plan,
  status: 'active',
  cancelAtPeriodEnd: false,
  currentPeriodEnd: '2026-04-20T00:00:00.000Z',
  createdAt: '2025-01-01T00:00:00.000Z',
});

describe('Billing', () => {
  // Monthly prices only, as before yearly prices exist in Stripe
  const monthlyOnly = {
    plans: [
      { plan: 'pro', intervals: ['month'] },
      { plan: 'business', intervals: ['month'] },
    ],
  };
  const withYearly = {
    plans: [
      { plan: 'pro', intervals: ['month', 'year'] },
      { plan: 'business', intervals: ['month', 'year'] },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    authState.user = { organizationId: null, role: null };
    healthState.data = null;
    mockFetchPlans.mockResolvedValue(monthlyOnly);
  });

  describe('annual billing', () => {
    it('offers only plans that have a Stripe price', async () => {
      mockFetchPlans.mockResolvedValue({
        plans: [{ plan: 'pro', intervals: ['month'] }],
      });
      mockFetchSubscription.mockResolvedValue(sub('free'));
      render(<Billing />);

      await screen.findByRole('button', { name: 'Upgrade to Pro' });
      expect(
        screen.queryByRole('button', { name: 'Upgrade to Business' }),
      ).not.toBeInTheDocument();
    });

    it('hides the interval toggle until yearly prices exist', async () => {
      mockFetchSubscription.mockResolvedValue(sub('free'));
      render(<Billing />);

      await screen.findByRole('button', { name: 'Upgrade to Pro' });
      expect(
        screen.queryByRole('radiogroup', { name: 'Billing interval' }),
      ).not.toBeInTheDocument();
    });

    it('shows yearly prices and checks out yearly', async () => {
      mockFetchPlans.mockResolvedValue(withYearly);
      mockFetchSubscription.mockResolvedValue(sub('free'));
      mockCreateCheckout.mockResolvedValue({ sessionUrl: 'https://x' });
      const location = { href: '' };
      vi.stubGlobal('location', location);
      const user = userEvent.setup();
      render(<Billing />);

      await user.click(
        await screen.findByRole('radio', { name: 'Yearly, 2 months free' }),
      );
      expect(screen.getByText('$290/yr')).toBeInTheDocument();
      expect(screen.getByText('$1,490/yr')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Upgrade to Pro' }));
      expect(mockCreateCheckout).toHaveBeenCalledWith('pro', 'year');
      vi.unstubAllGlobals();
    });

    it('upgrades a yearly Pro account to yearly Business by default', async () => {
      mockFetchPlans.mockResolvedValue(withYearly);
      mockFetchSubscription.mockResolvedValue({
        ...sub('pro'),
        interval: 'year',
      });
      mockPreviewUpgrade.mockResolvedValue({
        immediateAmountCents: 120000,
        currency: 'usd',
        targetPlan: 'business',
        targetInterval: 'year',
        currentPeriodEnd: '2027-04-20T00:00:00.000Z',
      });
      const user = userEvent.setup();
      render(<Billing />);

      expect(await screen.findByText(/Billed yearly\./)).toBeInTheDocument();
      expect(screen.getByText('$290/yr')).toBeInTheDocument();
      await user.click(
        screen.getByRole('button', { name: 'Upgrade to Business' }),
      );
      expect(mockPreviewUpgrade).toHaveBeenCalledWith('business', 'year');
      // On the plan card and in the confirmation
      await waitFor(() =>
        expect(screen.getAllByText('$1,490/yr')).toHaveLength(2),
      );
      await user.click(screen.getByRole('button', { name: 'Confirm Upgrade' }));
      expect(mockUpgradeSubscription).toHaveBeenCalledWith(
        'business',
        'year',
        undefined,
      );
    });

    it('sends the preview proration time and shows a declined payment', async () => {
      mockFetchPlans.mockResolvedValue(withYearly);
      mockFetchSubscription.mockResolvedValue({
        ...sub('pro'),
        interval: 'month',
      });
      mockPreviewUpgrade.mockResolvedValue({
        immediateAmountCents: 6000,
        currency: 'usd',
        targetPlan: 'business',
        targetInterval: 'month',
        currentPeriodEnd: '2026-11-14T00:00:00.000Z',
        prorationDate: 1791000000,
      });
      const message =
        "The payment for the upgrade didn't go through: Your card was declined. Your plan hasn't changed.";
      mockUpgradeSubscription.mockRejectedValue(
        new AxiosError(
          'Payment Required',
          'ERR_BAD_REQUEST',
          undefined,
          undefined,
          {
            status: 402,
            statusText: 'Payment Required',
            data: { statusCode: 402, message },
            headers: {},
            config: { headers: new AxiosHeaders() },
          },
        ),
      );
      const user = userEvent.setup();
      render(<Billing />);

      await user.click(
        await screen.findByRole('button', { name: 'Upgrade to Business' }),
      );
      await user.click(
        await screen.findByRole('button', { name: 'Confirm Upgrade' }),
      );
      expect(mockUpgradeSubscription).toHaveBeenCalledWith(
        'business',
        'month',
        1791000000,
      );
      expect(await screen.findByText(message)).toBeInTheDocument();
    });

    it('says the upgrade cancels a change scheduled in the portal', async () => {
      mockFetchSubscription.mockResolvedValue({
        ...sub('pro'),
        interval: 'month',
      });
      mockPreviewUpgrade.mockResolvedValue({
        immediateAmountCents: 6000,
        currency: 'usd',
        targetPlan: 'business',
        targetInterval: 'month',
        currentPeriodEnd: '2026-11-14T00:00:00.000Z',
        cancelsScheduledChange: true,
      });
      const user = userEvent.setup();
      render(<Billing />);

      await user.click(
        await screen.findByRole('button', { name: 'Upgrade to Business' }),
      );
      expect(
        await screen.findByText(/also cancels the change scheduled/),
      ).toBeInTheDocument();
    });

    it('explains a new billing period when the upgrade changes the interval', async () => {
      mockFetchPlans.mockResolvedValue(withYearly);
      mockFetchSubscription.mockResolvedValue({
        ...sub('pro'),
        interval: 'month',
      });
      mockPreviewUpgrade.mockResolvedValue({
        immediateAmountCents: 147100,
        currency: 'usd',
        targetPlan: 'business',
        targetInterval: 'year',
        currentPeriodEnd: '2027-10-14T00:00:00.000Z',
      });
      const user = userEvent.setup();
      render(<Billing />);

      await user.click(
        await screen.findByRole('radio', { name: 'Yearly, 2 months free' }),
      );
      await user.click(
        screen.getByRole('button', { name: 'Upgrade to Business' }),
      );
      expect(
        await screen.findByText(/a new yearly billing period starts today/),
      ).toBeInTheDocument();
      expect(screen.getByText('$1,471.00')).toBeInTheDocument();
    });

    it('offers a switch to yearly billing through the portal', async () => {
      mockFetchPlans.mockResolvedValue(withYearly);
      mockFetchSubscription.mockResolvedValue({
        ...sub('business'),
        interval: 'month',
      });
      mockCreatePortalSession.mockResolvedValue({ portalUrl: 'https://p' });
      const location = { href: '' };
      vi.stubGlobal('location', location);
      const user = userEvent.setup();
      render(<Billing />);

      await user.click(
        await screen.findByRole('button', {
          name: 'Switch to yearly billing (2 months free)',
        }),
      );
      expect(mockCreatePortalSession).toHaveBeenCalledWith('switch_interval');
      await waitFor(() => expect(location.href).toBe('https://p'));
      vi.unstubAllGlobals();
    });

    it('offers no switch without a yearly price', async () => {
      mockFetchSubscription.mockResolvedValue({
        ...sub('business'),
        interval: 'month',
      });
      render(<Billing />);

      await screen.findByText(/Billed monthly\./);
      expect(
        screen.queryByRole('button', { name: /switch to yearly/i }),
      ).not.toBeInTheDocument();
    });
  });

  it('shows manage subscription for a user without an org', async () => {
    mockFetchSubscription.mockResolvedValue(sub('business'));
    render(<Billing />);

    expect(
      await screen.findByRole('button', { name: /manage subscription/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/managed by its owner/i)).not.toBeInTheDocument();
  });

  it('shows manage subscription for the org owner', async () => {
    authState.user = { organizationId: 'org_001', role: 'owner' };
    mockFetchSubscription.mockResolvedValue(sub('business'));
    render(<Billing />);

    expect(
      await screen.findByRole('button', { name: /manage subscription/i }),
    ).toBeInTheDocument();
  });

  it.each(['admin', 'member', 'viewer'] as const)(
    'hides billing actions from an org %s on a paid plan',
    async (role) => {
      authState.user = { organizationId: 'org_001', role };
      mockFetchSubscription.mockResolvedValue(sub('pro'));
      render(<Billing />);

      expect(
        await screen.findByText(/managed by its owner/i),
      ).toBeInTheDocument();
      expect(screen.getByText('Pro')).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /manage subscription/i }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /upgrade/i }),
      ).not.toBeInTheDocument();
    },
  );

  it('hides upgrade options from an org member on the free plan', async () => {
    authState.user = { organizationId: 'org_001', role: 'member' };
    mockFetchSubscription.mockResolvedValue(sub('free'));
    render(<Billing />);

    expect(
      await screen.findByText(/managed by its owner/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /upgrade/i }),
    ).not.toBeInTheDocument();
  });

  describe('usage', () => {
    const issued = (id: number, createdAt = '2026-01-15T00:00:00Z') => ({
      id,
      status: 'issued',
      createdAt,
    });
    const ep = (id: string, regions: string[]) => ({
      id,
      hostedRegions: regions.map((region) => ({ region })),
    });

    beforeEach(() => {
      vi.useFakeTimers({
        now: new Date('2026-10-11T14:30:00Z'),
        toFake: ['Date'],
      });
      authState.user = {
        organizationId: null,
        role: null,
        resourceCounts: { domains: 7, certificates: 12, apiKeys: 4 },
      };
      healthState.data = {
        domains: Array.from({ length: 7 }, (_, i) => ({ id: `d${i}` })),
        certs: [
          ...Array.from({ length: 8 }, (_, i) => issued(i)),
          issued(100, '2026-10-02T00:00:00Z'),
          { id: 101, status: 'failed', createdAt: '2026-10-11T10:00:00Z' },
        ],
        endpoints: [
          ep('a', ['us-east-1', 'eu-west-1']),
          ep('b', ['us-east-1']),
          ...Array.from({ length: 8 }, (_, i) => ep(`c${i}`, [])),
        ],
      };
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('shows each limit for a Pro account with neutral meters', async () => {
      mockFetchSubscription.mockResolvedValue(sub('pro'));
      render(<Billing />);

      const domains = await screen.findByRole('meter', { name: 'Domains' });
      expect(domains).toHaveAttribute('aria-valuenow', '7');
      expect(domains).toHaveAttribute('aria-valuemax', '15');
      expect(domains).toHaveAttribute('data-level', 'normal');

      const expectUsed = (name: string, used: string) =>
        expect(screen.getByRole('meter', { name })).toHaveAttribute(
          'aria-valuenow',
          used,
        );
      expectUsed('Certificates this month', '2');
      expectUsed('Active certificates', '9');
      expectUsed('API keys', '4');
      expectUsed('Monitored endpoints', '10');
      expectUsed('Hosted endpoints', '2');
      // Every region is included on Pro
      expect(
        screen.getByRole('meter', { name: 'Hosted regions' }),
      ).toHaveAttribute('aria-valuetext', '2 used, unlimited');
    });

    it('turns amber at 80% and red at the limit', async () => {
      mockFetchSubscription.mockResolvedValue(sub('free'));
      authState.user = {
        organizationId: null,
        role: null,
        resourceCounts: { domains: 3, certificates: 0, apiKeys: 1 },
      };
      healthState.data = {
        domains: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
        certs: Array.from({ length: 8 }, (_, i) => issued(i)),
        endpoints: [],
      };
      render(<Billing />);

      expect(
        await screen.findByRole('meter', { name: 'Domains' }),
      ).toHaveAttribute('data-level', 'full');
      // The prompt names the plan that raises the limit
      expect(
        screen.getByText('Limit reached. Pro includes 15.'),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('meter', { name: 'Active certificates' }),
      ).toHaveAttribute('data-level', 'high');
      // The free plan includes one hosted endpoint in one region
      expect(
        screen.getByRole('meter', { name: 'Hosted endpoints' }),
      ).toHaveAttribute('aria-valuemax', '1');
    });

    it('shows connectors, alert channels, trust policies and members, pooled', async () => {
      authState.user = {
        organizationId: 'org_001',
        role: 'owner',
        resourceCounts: {
          domains: 7,
          certificates: 12,
          apiKeys: 4,
          connectors: 5,
          alertChannels: 2,
          githubOidcTrusts: 1,
          orgMembers: 3,
        },
      };
      mockFetchSubscription.mockResolvedValue(sub('pro'));
      render(<Billing />);

      const connectors = await screen.findByRole('meter', {
        name: 'Connectors',
      });
      expect(connectors).toHaveAttribute('aria-valuenow', '5');
      expect(connectors).toHaveAttribute('aria-valuemax', '5');
      expect(connectors).toHaveAttribute('data-level', 'full');
      expect(
        screen.getByRole('meter', { name: 'Alert channels' }),
      ).toHaveAttribute('aria-valuemax', '5');
      expect(
        screen.getByRole('meter', { name: 'GitHub trust policies' }),
      ).toHaveAttribute('aria-valuemax', '10');
      expect(
        screen.getByRole('meter', { name: 'Organization members' }),
      ).toHaveAttribute('aria-valuenow', '3');
      expect(
        screen.getAllByText('Limit reached. Business includes 50.').length,
      ).toBe(1);
      expect(
        screen.getByText('Limit reached. Business has no limit.'),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/Counted across everyone in your organization/),
      ).toBeInTheDocument();
    });

    it('shows counts with Unlimited on Enterprise', async () => {
      mockFetchSubscription.mockResolvedValue(sub('enterprise'));
      render(<Billing />);

      const domains = await screen.findByRole('meter', { name: 'Domains' });
      expect(domains).toHaveAttribute('aria-valuetext', '7 used, unlimited');
      expect(screen.getAllByText(/Unlimited/).length).toBeGreaterThan(0);
      expect(
        screen.queryByRole('link', { name: /compare plans/i }),
      ).not.toBeInTheDocument();
    });

    it('points Business owners at Enterprise with a contact link', async () => {
      mockFetchSubscription.mockResolvedValue(sub('business'));
      render(<Billing />);

      const link = await screen.findByRole('link', { name: /contact us/i });
      expect(link.getAttribute('href')).toMatch(/^mailto:/);
      expect(screen.getByText('Enterprise')).toBeInTheDocument();
      expect(screen.queryByText(/\$199/)).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /upgrade to/i }),
      ).not.toBeInTheDocument();
    });

    it('calls the free plan Starter and offers Pro and Business', async () => {
      mockFetchSubscription.mockResolvedValue(sub('free'));
      render(<Billing />);

      expect(
        await screen.findByRole('button', { name: 'Upgrade to Pro' }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Upgrade to Business' }),
      ).toBeInTheDocument();
      expect(screen.getByText('Starter')).toBeInTheDocument();
      expect(screen.queryByText(/^Free$/)).not.toBeInTheDocument();
      expect(screen.getByText('$29/mo')).toBeInTheDocument();
      expect(screen.getByText('$149/mo')).toBeInTheDocument();
    });

    it('shows the API message when checkout is rejected with 409', async () => {
      mockFetchSubscription.mockResolvedValue(sub('free'));
      const message =
        'You already have a paid subscription. Upgrade your plan from the billing page or manage it in the billing portal instead of starting a new checkout.';
      mockCreateCheckout.mockRejectedValue(
        new AxiosError('Conflict', 'ERR_BAD_REQUEST', undefined, undefined, {
          status: 409,
          statusText: 'Conflict',
          data: { statusCode: 409, message },
          headers: {},
          config: { headers: new AxiosHeaders() },
        }),
      );
      const user = userEvent.setup();
      render(<Billing />);

      await user.click(
        await screen.findByRole('button', { name: 'Upgrade to Pro' }),
      );

      expect(await screen.findByText(message)).toBeInTheDocument();
      expect(mockCreateCheckout).toHaveBeenCalledWith('pro', 'month');
    });

    it('keeps the generic error for other checkout failures', async () => {
      mockFetchSubscription.mockResolvedValue(sub('free'));
      mockCreateCheckout.mockRejectedValue(new Error('network down'));
      const user = userEvent.setup();
      render(<Billing />);

      await user.click(
        await screen.findByRole('button', { name: 'Upgrade to Pro' }),
      );

      expect(
        await screen.findByText(
          'Failed to load upgrade details. Please try again.',
        ),
      ).toBeInTheDocument();
    });

    it('offers Business to Pro owners through the upgrade preview', async () => {
      mockFetchSubscription.mockResolvedValue(sub('pro'));
      render(<Billing />);

      expect(
        await screen.findByRole('button', { name: 'Upgrade to Business' }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /upgrade to pro/i }),
      ).not.toBeInTheDocument();
    });

    it('reads a legacy plan id from an older API as its replacement', async () => {
      mockFetchSubscription.mockResolvedValue(sub('starter'));
      render(<Billing />);

      expect(
        await screen.findByRole('button', { name: 'Upgrade to Business' }),
      ).toBeInTheDocument();
      expect(screen.getByText('Pro')).toBeInTheDocument();
    });
  });

  describe('failed payment', () => {
    const pastDue = (graceEndsAt: string | null, plan = 'business') => ({
      ...sub(plan),
      status: 'past_due',
      pastDueSince: '2026-10-05T12:00:00.000Z',
      graceEndsAt,
    });

    beforeEach(() => {
      vi.useFakeTimers({
        now: new Date('2026-10-12T12:00:00Z'),
        toFake: ['Date'],
      });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('asks the owner to update the payment method before the grace period ends', async () => {
      mockFetchSubscription.mockResolvedValue(
        pastDue('2026-10-19T12:00:00.000Z'),
      );
      render(<Billing />);

      const banner = await screen.findByRole('alert');
      expect(banner).toHaveTextContent(
        /Your last payment failed\. Update your payment method by October 19, 2026 to keep Business limits\./,
      );
      expect(
        screen.getByRole('button', { name: /update payment method/i }),
      ).toBeInTheDocument();
    });

    it('opens the Stripe portal from the banner', async () => {
      mockFetchSubscription.mockResolvedValue(
        pastDue('2026-10-19T12:00:00.000Z'),
      );
      mockCreatePortalSession.mockResolvedValue({
        portalUrl: 'https://billing.stripe.com/p/session',
      });
      const location = { href: '' };
      vi.stubGlobal('location', location);
      render(<Billing />);

      fireEvent.click(
        await screen.findByRole('button', { name: /update payment method/i }),
      );

      await waitFor(() =>
        expect(location.href).toBe('https://billing.stripe.com/p/session'),
      );
      expect(mockCreatePortalSession).toHaveBeenCalledTimes(1);
      vi.unstubAllGlobals();
    });

    it('says the account is on Starter limits once the grace period has passed', async () => {
      mockFetchSubscription.mockResolvedValue(
        pastDue('2026-10-10T12:00:00.000Z'),
      );
      render(<Billing />);

      expect(await screen.findByRole('alert')).toHaveTextContent(
        /your account is on Starter limits/i,
      );
    });

    it('points org members at the owner instead of the portal', async () => {
      authState.user = { organizationId: 'org_001', role: 'member' };
      mockFetchSubscription.mockResolvedValue(
        pastDue('2026-10-19T12:00:00.000Z'),
      );
      render(<Billing />);

      expect(await screen.findByRole('alert')).toHaveTextContent(
        /ask your organization owner/i,
      );
      expect(
        screen.queryByRole('button', { name: /update payment method/i }),
      ).not.toBeInTheDocument();
    });

    it('shows no banner while the subscription is active', async () => {
      mockFetchSubscription.mockResolvedValue(sub('business'));
      render(<Billing />);

      await screen.findByRole('button', { name: /manage subscription/i });
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  describe('billed through Microsoft Marketplace', () => {
    const marketplace = (plan: string, status = 'active') => ({
      ...sub(plan),
      status,
      source: 'marketplace',
      marketplaceStatus: status === 'active' ? 'Subscribed' : 'Suspended',
    });

    it('says Microsoft bills it and links to the Azure portal instead of Stripe', async () => {
      mockFetchSubscription.mockResolvedValue(marketplace('pro'));
      render(<Billing />);

      expect(
        await screen.findByText(/Billed through Microsoft/),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('link', { name: /manage in azure portal/i }),
      ).toHaveAttribute('href', expect.stringContaining('portal.azure.com'));
      expect(
        screen.queryByRole('button', { name: /manage subscription/i }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /upgrade to/i }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('link', { name: /compare plans/i }),
      ).not.toBeInTheDocument();
      // The Stripe price doesn't apply to a Marketplace plan.
      expect(screen.queryByText('$29/mo')).not.toBeInTheDocument();
    });

    it('sends a suspended subscription to the Azure portal to pay', async () => {
      vi.useFakeTimers({
        now: new Date('2026-10-12T12:00:00Z'),
        toFake: ['Date'],
      });
      try {
        mockFetchSubscription.mockResolvedValue({
          ...marketplace('business', 'past_due'),
          pastDueSince: '2026-10-05T12:00:00.000Z',
          graceEndsAt: '2026-11-04T12:00:00.000Z',
        });
        render(<Billing />);

        const banner = await screen.findByRole('alert');
        expect(banner).toHaveTextContent(
          /Microsoft couldn't collect the payment.*by November 4, 2026 to keep Business limits/,
        );
        expect(
          screen.getByRole('link', { name: /open the azure portal/i }),
        ).toHaveAttribute('href', expect.stringContaining('portal.azure.com'));
        expect(
          screen.queryByRole('button', { name: /update payment method/i }),
        ).not.toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });

    it('hides the Azure portal link from org members', async () => {
      authState.user = { organizationId: 'org_001', role: 'member' };
      mockFetchSubscription.mockResolvedValue(marketplace('business'));
      render(<Billing />);

      expect(
        await screen.findByText(/managed by its owner/i),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('link', { name: /manage in azure portal/i }),
      ).not.toBeInTheDocument();
    });

    it('offers Stripe upgrades again after the Marketplace subscription ended', async () => {
      mockFetchSubscription.mockResolvedValue({
        ...marketplace('free', 'canceled'),
        marketplaceStatus: 'Unsubscribed',
      });
      render(<Billing />);

      expect(
        await screen.findByRole('button', { name: 'Upgrade to Pro' }),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(/Billed through Microsoft/),
      ).not.toBeInTheDocument();
    });
  });

  it('is unchanged for a Stripe subscription', async () => {
    mockFetchSubscription.mockResolvedValue({
      ...sub('pro'),
      source: 'stripe',
    });
    render(<Billing />);

    expect(
      await screen.findByRole('button', { name: /manage subscription/i }),
    ).toBeInTheDocument();
    expect(screen.getByText('$29/mo')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Upgrade to Business' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Billed through Microsoft/),
    ).not.toBeInTheDocument();
  });
});
