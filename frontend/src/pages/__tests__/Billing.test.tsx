import { render, screen } from '@testing-library/react';
import Billing from '../Billing';

const { mockFetchSubscription, authState } = vi.hoisted(() => ({
  mockFetchSubscription: vi.fn(),
  authState: {
    user: null as {
      organizationId: string | null;
      role: 'owner' | 'admin' | 'member' | 'viewer' | null;
    } | null,
  },
}));

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: authState.user }),
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
});
