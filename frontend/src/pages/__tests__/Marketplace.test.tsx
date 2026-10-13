import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { MarketplaceLandingResponse } from '@krakenkey/shared';
import { render } from '../../test/test-utils';
import { server } from '../../test/mocks/server';
import { API_URL } from '../../services/api';
import Marketplace from '../Marketplace';
import { readMarketplaceToken } from '../../services/marketplaceService';

const mockLogin = vi.fn();
const mockLoginWithMicrosoft = vi.fn();
let mockAuthenticated = true;

vi.mock('../../hooks/useAuth', async () => {
  const actual = await vi.importActual('../../hooks/useAuth');
  return {
    ...actual,
    useAuth: () => ({
      login: mockLogin,
      loginWithMicrosoft: mockLoginWithMicrosoft,
      register: vi.fn(),
      logout: vi.fn(),
      handleCallback: vi.fn(),
      user: mockAuthenticated ? { username: 'testuser', groups: [] } : null,
      isAuthenticated: mockAuthenticated,
      isLoading: false,
    }),
  };
});

// %2B and %2F as Microsoft sends them; the API must get "ab+cd/ef".
const TOKEN_QUERY = '?token=ab%2Bcd%2Fef';

const purchase = (
  overrides: Partial<MarketplaceLandingResponse> = {},
): MarketplaceLandingResponse => ({
  state: 'ready',
  subscriptionName: 'Acme KrakenKey',
  planId: 'kk-team',
  plan: 'team',
  saasStatus: 'PendingFulfillmentStart',
  purchaserEmail: 'buyer@acme.example',
  beneficiaryEmail: 'admin@acme.example',
  termUnit: 'P1M',
  isFreeTrial: false,
  target: { kind: 'user', name: 'me@acme.example' },
  ...overrides,
});

function marketplaceApi(opts: {
  enabled?: boolean;
  resolve?: MarketplaceLandingResponse | { status: number; message: string };
  activate?: MarketplaceLandingResponse;
}) {
  const seen: { resolve: unknown[]; activate: unknown[] } = {
    resolve: [],
    activate: [],
  };
  server.use(
    http.get(`${API_URL}/billing/marketplace/status`, () =>
      HttpResponse.json({ enabled: opts.enabled ?? true }),
    ),
    http.post(`${API_URL}/billing/marketplace/resolve`, async ({ request }) => {
      seen.resolve.push(await request.json());
      const r = opts.resolve ?? purchase();
      if ('status' in r && typeof r.status === 'number') {
        return HttpResponse.json(
          { statusCode: r.status, message: r.message },
          { status: r.status },
        );
      }
      return HttpResponse.json(r);
    }),
    http.post(
      `${API_URL}/billing/marketplace/activate`,
      async ({ request }) => {
        seen.activate.push(await request.json());
        return HttpResponse.json(
          opts.activate ??
            purchase({ state: 'active', saasStatus: 'Subscribed' }),
        );
      },
    ),
  );
  return seen;
}

describe('readMarketplaceToken', () => {
  it('percent-decodes without turning "+" into a space', () => {
    expect(readMarketplaceToken('?token=ab%2Bcd%2Fef')).toBe('ab+cd/ef');
    expect(readMarketplaceToken('?x=1&token=a+b')).toBe('a+b');
    expect(readMarketplaceToken('?other=1')).toBeNull();
    expect(readMarketplaceToken('?token=')).toBeNull();
  });
});

describe('Marketplace landing page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticated = true;
    sessionStorage.clear();
    window.__env__ = { KK_MICROSOFT_LOGIN_ENABLED: 'true' };
    window.history.pushState({}, '', `/marketplace${TOKEN_QUERY}`);
  });

  afterEach(() => {
    window.history.pushState({}, '', '/');
  });

  it('says the offer is not available while the flag is off', async () => {
    const seen = marketplaceApi({ enabled: false });
    render(<Marketplace />);

    expect(await screen.findByText('Not available yet')).toBeInTheDocument();
    expect(
      screen.getByText(/can't be bought through Microsoft Marketplace yet/),
    ).toBeInTheDocument();
    expect(seen.resolve).toHaveLength(0);
  });

  it('sends a signed-out buyer through Microsoft sign-in and keeps the token', async () => {
    mockAuthenticated = false;
    const seen = marketplaceApi({});
    const user = userEvent.setup();
    render(<Marketplace />);

    await user.click(
      await screen.findByRole('button', { name: 'Continue with Microsoft' }),
    );
    expect(mockLoginWithMicrosoft).toHaveBeenCalled();
    expect(sessionStorage.getItem('kk_pending_marketplace_token')).toBe(
      'ab+cd/ef',
    );
    expect(seen.resolve).toHaveLength(0);
  });

  it('offers email sign-in too, for existing password accounts', async () => {
    mockAuthenticated = false;
    marketplaceApi({});
    const user = userEvent.setup();
    render(<Marketplace />);

    await user.click(
      await screen.findByRole('button', { name: 'Sign in with email' }),
    );
    expect(mockLogin).toHaveBeenCalled();
    expect(sessionStorage.getItem('kk_pending_marketplace_token')).toBe(
      'ab+cd/ef',
    );
  });

  it('asks to open the page from Microsoft when there is no token', async () => {
    window.history.pushState({}, '', '/marketplace');
    marketplaceApi({});
    render(<Marketplace />);

    expect(
      await screen.findByText(/Select Configure account or Manage account/i),
    ).toBeInTheDocument();
  });

  it('shows a new purchase and activates it', async () => {
    const seen = marketplaceApi({});
    const user = userEvent.setup();
    render(<Marketplace />);

    expect(
      await screen.findByText('Activate your subscription'),
    ).toBeInTheDocument();
    expect(screen.getByText('Acme KrakenKey')).toBeInTheDocument();
    expect(screen.getByText('buyer@acme.example')).toBeInTheDocument();
    expect(screen.getByText('Monthly, through Microsoft')).toBeInTheDocument();
    expect(seen.resolve).toEqual([{ token: 'ab+cd/ef' }]);

    await user.click(
      screen.getByRole('button', { name: 'Activate subscription' }),
    );
    expect(
      await screen.findByText('Your subscription is active'),
    ).toBeInTheDocument();
    expect(seen.activate).toEqual([{ token: 'ab+cd/ef' }]);
    expect(
      screen.getByRole('link', { name: /Manage in the Azure portal/ }),
    ).toHaveAttribute('href', expect.stringContaining('portal.azure.com'));
  });

  it('shows an existing subscription on a "manage" visit without activating again', async () => {
    const seen = marketplaceApi({
      resolve: purchase({ state: 'active', saasStatus: 'Subscribed' }),
    });
    render(<Marketplace />);

    expect(
      await screen.findByText('Your subscription is active'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Activate subscription' }),
    ).not.toBeInTheDocument();
    expect(seen.activate).toHaveLength(0);
  });

  it('explains a conflict with an existing paid plan', async () => {
    marketplaceApi({
      resolve: purchase({
        state: 'conflict',
        message:
          'This account already has a paid subscription billed by KrakenKey.',
      }),
    });
    render(<Marketplace />);

    expect(
      await screen.findByText('This account already has a plan'),
    ).toBeInTheDocument();
    expect(screen.getByText(/billed by KrakenKey/)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Activate subscription' }),
    ).not.toBeInTheDocument();
  });

  it.each([
    ['linked_elsewhere', 'Linked to another account'],
    ['not_owner', 'Ask your organization owner'],
    ['unknown_plan', 'Plan not available'],
    ['suspended', 'Subscription suspended'],
    ['ended', 'Subscription canceled'],
  ] as const)('shows the %s state', async (state, title) => {
    marketplaceApi({ resolve: purchase({ state }) });
    render(<Marketplace />);
    expect(await screen.findByText(title)).toBeInTheDocument();
  });

  it("shows Microsoft's guidance when the token expired", async () => {
    marketplaceApi({
      resolve: {
        status: 400,
        message: "We couldn't identify this purchase. Reopen the subscription.",
      },
    });
    render(<Marketplace />);
    expect(
      await screen.findByText(/couldn't identify this purchase/),
    ).toBeInTheDocument();
  });
});
