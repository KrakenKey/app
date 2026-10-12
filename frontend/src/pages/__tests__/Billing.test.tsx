import { render, screen } from '@testing-library/react';
import Billing from '../Billing';

const { mockFetchSubscription, authState, healthState } = vi.hoisted(() => ({
  mockFetchSubscription: vi.fn(),
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
  useHealth: () => ({ data: healthState.data }),
}));

vi.mock('../../services/billingService', () => ({
  fetchSubscription: mockFetchSubscription,
  createCheckout: vi.fn(),
  createPortalSession: vi.fn(),
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
});
