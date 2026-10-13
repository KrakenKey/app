import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError, AxiosHeaders } from 'axios';
import Billing from '../Billing';

const {
  mockFetchSubscription,
  mockCreateCheckout,
  mockCreatePortalSession,
  authState,
  healthState,
} = vi.hoisted(() => ({
  mockFetchSubscription: vi.fn(),
  mockCreateCheckout: vi.fn(),
  mockCreatePortalSession: vi.fn(),
  authState: {
    user: null as {
      organizationId: string | null;
      role: 'owner' | 'admin' | 'member' | 'viewer' | null;
      resourceCounts?: {
        domains: number;
        certificates: number;
        apiKeys: number;
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
  createCheckout: mockCreateCheckout,
  createPortalSession: mockCreatePortalSession,
  previewUpgrade: vi.fn(),
  upgradeSubscription: vi.fn(),
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
  beforeEach(() => {
    vi.clearAllMocks();
    authState.user = { organizationId: null, role: null };
    healthState.data = null;
  });

  it('shows manage subscription for a user without an org', async () => {
    mockFetchSubscription.mockResolvedValue(sub('team'));
    render(<Billing />);

    expect(
      await screen.findByRole('button', { name: /manage subscription/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/managed by its owner/i)).not.toBeInTheDocument();
  });

  it('shows manage subscription for the org owner', async () => {
    authState.user = { organizationId: 'org_001', role: 'owner' };
    mockFetchSubscription.mockResolvedValue(sub('team'));
    render(<Billing />);

    expect(
      await screen.findByRole('button', { name: /manage subscription/i }),
    ).toBeInTheDocument();
  });

  it.each(['admin', 'member', 'viewer'] as const)(
    'hides billing actions from an org %s on a paid plan',
    async (role) => {
      authState.user = { organizationId: 'org_001', role };
      mockFetchSubscription.mockResolvedValue(sub('starter'));
      render(<Billing />);

      expect(
        await screen.findByText(/managed by its owner/i),
      ).toBeInTheDocument();
      expect(screen.getByText('Starter')).toBeInTheDocument();
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

    it('shows each limit for a Team account with neutral meters', async () => {
      mockFetchSubscription.mockResolvedValue(sub('team'));
      render(<Billing />);

      const domains = await screen.findByRole('meter', { name: 'Domains' });
      expect(domains).toHaveAttribute('aria-valuenow', '7');
      expect(domains).toHaveAttribute('aria-valuemax', '25');
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
      expectUsed('Hosted regions', '2');
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
      expect(screen.getByText('Limit reached')).toBeInTheDocument();
      expect(
        screen.getByRole('meter', { name: 'Active certificates' }),
      ).toHaveAttribute('data-level', 'high');
      expect(
        screen.queryByRole('meter', { name: 'Hosted regions' }),
      ).not.toBeInTheDocument();
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

    it('points Team owners at Business through the pricing page', async () => {
      mockFetchSubscription.mockResolvedValue(sub('team'));
      render(<Billing />);

      const link = await screen.findByRole('link', { name: /compare plans/i });
      expect(link).toHaveAttribute('href', 'https://krakenkey.io/pricing');
      expect(screen.getByText('Business')).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /upgrade to/i }),
      ).not.toBeInTheDocument();
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
        await screen.findByRole('button', { name: 'Upgrade to Starter' }),
      );

      expect(await screen.findByText(message)).toBeInTheDocument();
      expect(mockCreateCheckout).toHaveBeenCalledWith('starter');
    });

    it('keeps the generic error for other checkout failures', async () => {
      mockFetchSubscription.mockResolvedValue(sub('free'));
      mockCreateCheckout.mockRejectedValue(new Error('network down'));
      const user = userEvent.setup();
      render(<Billing />);

      await user.click(
        await screen.findByRole('button', { name: 'Upgrade to Starter' }),
      );

      expect(
        await screen.findByText(
          'Failed to load upgrade details. Please try again.',
        ),
      ).toBeInTheDocument();
    });

    it('offers Team to Starter owners through the upgrade preview', async () => {
      mockFetchSubscription.mockResolvedValue(sub('starter'));
      render(<Billing />);

      expect(
        await screen.findByRole('button', { name: 'Upgrade to Team' }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /upgrade to business/i }),
      ).not.toBeInTheDocument();
    });
  });

  describe('failed payment', () => {
    const pastDue = (graceEndsAt: string | null, plan = 'team') => ({
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
        /Your last payment failed\. Update your payment method by October 19, 2026 to keep Team limits\./,
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

    it('says the account is on Free limits once the grace period has passed', async () => {
      mockFetchSubscription.mockResolvedValue(
        pastDue('2026-10-10T12:00:00.000Z'),
      );
      render(<Billing />);

      expect(await screen.findByRole('alert')).toHaveTextContent(
        /your account is on Free limits/i,
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
      mockFetchSubscription.mockResolvedValue(sub('team'));
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
      mockFetchSubscription.mockResolvedValue(marketplace('starter'));
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
          ...marketplace('team', 'past_due'),
          pastDueSince: '2026-10-05T12:00:00.000Z',
          graceEndsAt: '2026-11-04T12:00:00.000Z',
        });
        render(<Billing />);

        const banner = await screen.findByRole('alert');
        expect(banner).toHaveTextContent(
          /Microsoft couldn't collect the payment.*by November 4, 2026 to keep Team limits/,
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
      mockFetchSubscription.mockResolvedValue(marketplace('team'));
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
        await screen.findByRole('button', { name: 'Upgrade to Starter' }),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(/Billed through Microsoft/),
      ).not.toBeInTheDocument();
    });
  });

  it('is unchanged for a Stripe subscription', async () => {
    mockFetchSubscription.mockResolvedValue({
      ...sub('starter'),
      source: 'stripe',
    });
    render(<Billing />);

    expect(
      await screen.findByRole('button', { name: /manage subscription/i }),
    ).toBeInTheDocument();
    expect(screen.getByText('$29/mo')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Upgrade to Team' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Billed through Microsoft/),
    ).not.toBeInTheDocument();
  });
});
