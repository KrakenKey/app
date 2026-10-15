import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { AwsMarketplaceLandingResponse } from '@krakenkey/shared';
import { render } from '../../test/test-utils';
import { server } from '../../test/mocks/server';
import { API_URL } from '../../services/api';
import AwsMarketplace from '../AwsMarketplace';
import {
  readAwsRegisterError,
  readAwsRegistration,
} from '../../services/awsMarketplaceService';

const mockLogin = vi.fn();
const mockRegister = vi.fn();
const mockLoginWithMicrosoft = vi.fn();
let mockAuthenticated = true;

vi.mock('../../hooks/useAuth', async () => {
  const actual = await vi.importActual('../../hooks/useAuth');
  return {
    ...actual,
    useAuth: () => ({
      login: mockLogin,
      loginWithMicrosoft: mockLoginWithMicrosoft,
      register: mockRegister,
      logout: vi.fn(),
      handleCallback: vi.fn(),
      user: mockAuthenticated ? { username: 'testuser', groups: [] } : null,
      isAuthenticated: mockAuthenticated,
      isLoading: false,
    }),
  };
});

const REGISTRATION = 'AbCdEf_-0123456789';

const purchase = (
  overrides: Partial<AwsMarketplaceLandingResponse> = {},
): AwsMarketplaceLandingResponse => ({
  state: 'ready',
  awsAccountId: '444455556666',
  dimension: 'business',
  plan: 'business',
  expiresAt: '2027-01-15T12:00:00.000Z',
  target: { kind: 'user', name: 'me@acme.example' },
  ...overrides,
});

function awsApi(opts: {
  enabled?: boolean;
  resolve?: AwsMarketplaceLandingResponse | { status: number; message: string };
  link?: AwsMarketplaceLandingResponse;
}) {
  const seen: { resolve: unknown[]; link: unknown[] } = {
    resolve: [],
    link: [],
  };
  server.use(
    http.get(`${API_URL}/billing/aws-marketplace/status`, () =>
      HttpResponse.json({ enabled: opts.enabled ?? true }),
    ),
    http.post(
      `${API_URL}/billing/aws-marketplace/resolve`,
      async ({ request }) => {
        seen.resolve.push(await request.json());
        const r = opts.resolve ?? purchase();
        if ('status' in r && typeof r.status === 'number') {
          return HttpResponse.json(
            { statusCode: r.status, message: r.message },
            { status: r.status },
          );
        }
        return HttpResponse.json(r);
      },
    ),
    http.post(
      `${API_URL}/billing/aws-marketplace/link`,
      async ({ request }) => {
        seen.link.push(await request.json());
        return HttpResponse.json(opts.link ?? purchase({ state: 'active' }));
      },
    ),
  );
  return seen;
}

describe('AWS Marketplace query parameters', () => {
  it('reads a registration id and nothing else', () => {
    expect(readAwsRegistration('?registration=AbC_-1')).toBe('AbC_-1');
    expect(readAwsRegistration('?registration=a%20b')).toBeNull();
    expect(readAwsRegistration('?registration=')).toBeNull();
    expect(readAwsRegistration('?other=1')).toBeNull();
  });

  it('reads only known errors', () => {
    expect(readAwsRegisterError('?error=invalid_token')).toBe('invalid_token');
    expect(readAwsRegisterError('?error=<script>')).toBeNull();
    expect(readAwsRegisterError('')).toBeNull();
  });
});

describe('AWS Marketplace landing page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticated = true;
    sessionStorage.clear();
    window.__env__ = { KK_MICROSOFT_LOGIN_ENABLED: 'false' };
    window.history.pushState(
      {},
      '',
      `/aws-marketplace?registration=${REGISTRATION}`,
    );
  });

  afterEach(() => {
    window.history.pushState({}, '', '/');
  });

  it('says the offer is not available while the flag is off', async () => {
    const seen = awsApi({ enabled: false });
    render(<AwsMarketplace />);

    expect(await screen.findByText('Not available yet')).toBeInTheDocument();
    expect(
      screen.getByText(/can't be bought through AWS Marketplace yet/),
    ).toBeInTheDocument();
    expect(seen.resolve).toHaveLength(0);
  });

  it('asks a signed-out buyer to create an account or sign in, and keeps the registration', async () => {
    mockAuthenticated = false;
    const seen = awsApi({});
    const user = userEvent.setup();
    render(<AwsMarketplace />);

    expect(
      await screen.findByText(/Thanks for subscribing to KrakenKey/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Contact support' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Continue with Microsoft' }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Create an account' }));
    expect(mockRegister).toHaveBeenCalled();
    expect(
      sessionStorage.getItem('kk_pending_aws_marketplace_registration'),
    ).toBe(REGISTRATION);

    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(mockLogin).toHaveBeenCalled();
    expect(seen.resolve).toHaveLength(0);
  });

  it('offers Microsoft sign-in where it is enabled', async () => {
    mockAuthenticated = false;
    window.__env__ = { KK_MICROSOFT_LOGIN_ENABLED: 'true' };
    awsApi({});
    const user = userEvent.setup();
    render(<AwsMarketplace />);

    await user.click(
      await screen.findByRole('button', { name: 'Continue with Microsoft' }),
    );
    expect(mockLoginWithMicrosoft).toHaveBeenCalled();
  });

  it('picks the registration up from session storage after a reload', async () => {
    window.history.pushState({}, '', '/aws-marketplace');
    sessionStorage.setItem('kk_aws_marketplace_registration', REGISTRATION);
    const seen = awsApi({});
    render(<AwsMarketplace />);
    expect(await screen.findByText('Link your purchase')).toBeInTheDocument();
    expect(seen.resolve).toEqual([{ registration: REGISTRATION }]);
  });

  it('explains how to start over when there is no registration', async () => {
    window.history.pushState({}, '', '/aws-marketplace');
    awsApi({});
    render(<AwsMarketplace />);

    expect(
      await screen.findByText(/choose Set up your account/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /Open the AWS Marketplace console/ }),
    ).toHaveAttribute(
      'href',
      'https://console.aws.amazon.com/marketplace/home#/subscriptions',
    );
  });

  it.each([
    ['invalid_token', /setup link may have expired/],
    ['missing_token', /didn't send the details/],
    ['unknown_product', /isn't sold through this KrakenKey site/],
    ['unavailable', /couldn't reach AWS/],
  ])('explains the %s error from the fulfillment URL', async (error, text) => {
    window.history.pushState({}, '', `/aws-marketplace?error=${error}`);
    const seen = awsApi({});
    render(<AwsMarketplace />);

    expect(
      await screen.findByText("We couldn't set up your purchase"),
    ).toBeInTheDocument();
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(seen.resolve).toHaveLength(0);
  });

  it('shows the purchase and links it to the account', async () => {
    const seen = awsApi({});
    const user = userEvent.setup();
    render(<AwsMarketplace />);

    expect(await screen.findByText('Link your purchase')).toBeInTheDocument();
    expect(screen.getByText('Business')).toBeInTheDocument();
    expect(screen.getByText('Through AWS Marketplace')).toBeInTheDocument();
    expect(screen.getByText('444455556666')).toBeInTheDocument();
    expect(screen.getByText('Jan 15, 2027')).toBeInTheDocument();
    expect(screen.getByText(/right away/)).toBeInTheDocument();
    expect(seen.resolve).toEqual([{ registration: REGISTRATION }]);
    // Out of the address bar, kept for a reload.
    expect(window.location.search).toBe('');
    expect(sessionStorage.getItem('kk_aws_marketplace_registration')).toBe(
      REGISTRATION,
    );

    await user.click(
      screen.getByRole('button', { name: 'Link to this account' }),
    );
    expect(
      await screen.findByText('Your subscription is active'),
    ).toBeInTheDocument();
    expect(seen.link).toEqual([{ registration: REGISTRATION }]);
    expect(
      sessionStorage.getItem('kk_aws_marketplace_registration'),
    ).toBeNull();
    expect(
      screen.getByRole('link', {
        name: /Manage in the AWS Marketplace console/,
      }),
    ).toHaveAttribute(
      'href',
      'https://console.aws.amazon.com/marketplace/home#/subscriptions',
    );
  });

  it('links a purchase AWS is still processing and says when access starts', async () => {
    const seen = awsApi({
      resolve: purchase({
        state: 'awaiting_entitlement',
        dimension: null,
        plan: null,
        expiresAt: null,
      }),
      link: purchase({
        state: 'pending',
        dimension: null,
        plan: null,
        expiresAt: null,
      }),
    });
    const user = userEvent.setup();
    render(<AwsMarketplace />);

    expect(
      await screen.findByText(/AWS is still processing this purchase/),
    ).toBeInTheDocument();
    expect(screen.getByText('Waiting for AWS')).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Link to this account' }),
    );
    expect(await screen.findByText('Almost there')).toBeInTheDocument();
    expect(
      screen.getByText(/apply automatically as soon as AWS confirms it/),
    ).toBeInTheDocument();
    expect(seen.link).toHaveLength(1);
  });

  it('links to the organization for its owner', async () => {
    awsApi({
      resolve: purchase({ target: { kind: 'organization', name: 'Acme' } }),
    });
    render(<AwsMarketplace />);
    expect(
      await screen.findByRole('button', { name: 'Link to this organization' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Acme')).toBeInTheDocument();
  });

  it('shows a linked purchase on a second visit without linking again', async () => {
    const seen = awsApi({ resolve: purchase({ state: 'active' }) });
    render(<AwsMarketplace />);

    expect(
      await screen.findByText('Your subscription is active'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Link to this/ }),
    ).not.toBeInTheDocument();
    expect(seen.link).toHaveLength(0);
  });

  it('explains a conflict with an existing paid plan', async () => {
    awsApi({
      resolve: purchase({
        state: 'conflict',
        message:
          'This account already has a paid subscription billed by KrakenKey.',
      }),
    });
    render(<AwsMarketplace />);

    expect(
      await screen.findByText('This account already has a plan'),
    ).toBeInTheDocument();
    expect(screen.getByText(/billed by KrakenKey/)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Link to this/ }),
    ).not.toBeInTheDocument();
  });

  it.each([
    ['linked_elsewhere', 'Linked to another account'],
    ['not_owner', 'Ask your organization owner'],
    ['unknown_plan', 'Plan not available'],
    ['ended', 'Subscription ended'],
  ] as const)('shows the %s state', async (state, title) => {
    awsApi({ resolve: purchase({ state }) });
    render(<AwsMarketplace />);
    expect(await screen.findByText(title)).toBeInTheDocument();
  });

  it('shows the API message when the setup link expired', async () => {
    awsApi({
      resolve: {
        status: 400,
        message:
          'This setup link has expired. Open your KrakenKey subscription.',
      },
    });
    render(<AwsMarketplace />);
    expect(
      await screen.findByText(/This setup link has expired/),
    ).toBeInTheDocument();
  });
});
