import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { render } from '../../test/test-utils';
import { server } from '../../test/mocks/server';
import { API_URL } from '../../services/api';
import { mockCerts, mockUser } from '../../test/mocks/data';
import { HealthProvider } from '../../context/HealthContext';
import Overview from '../Overview';

// Stable reference to avoid infinite useEffect([user]) loop
const stableUser = {
  ...mockUser,
  resourceCounts: { domains: 2, certificates: 1, apiKeys: 1 },
};

vi.mock('../../hooks/useAuth', async () => {
  const actual = await vi.importActual('../../hooks/useAuth');
  return {
    ...actual,
    useAuth: () => ({
      user: stableUser,
      logout: vi.fn(),
      isAuthenticated: true,
      isLoading: false,
      login: vi.fn(),
      register: vi.fn(),
      handleCallback: vi.fn(),
      deleteAccount: vi.fn(),
    }),
  };
});

function renderOverview() {
  return render(
    <HealthProvider>
      <Overview />
    </HealthProvider>,
  );
}

describe('Overview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    server.use(
      http.get(`${API_URL}/endpoints`, () => HttpResponse.json([])),
      http.get(`${API_URL}/endpoints/probes/mine`, () => HttpResponse.json([])),
      http.get(`${API_URL}/connectors`, () => HttpResponse.json([])),
    );
  });

  it('renders user greeting', () => {
    renderOverview();
    expect(
      screen.getByText(`Welcome back, ${mockUser.username}`),
    ).toBeInTheDocument();
  });

  it('shows the KPI strip linking to each area', async () => {
    renderOverview();
    for (const [label, href] of [
      ['Certificates', '/dashboard/certificates'],
      ['Expiring in 30 days', '/dashboard/certificates'],
      ['Failed', '/dashboard/certificates'],
      ['Endpoints', '/dashboard/endpoints'],
      ['Connectors', '/dashboard/connectors'],
      ['Domains', '/dashboard/domains'],
    ]) {
      expect(
        await screen.findByRole('link', {
          name: new RegExp(`^${label}\\s*\\d`),
        }),
      ).toHaveAttribute('href', href);
    }
  });

  it('lists what needs attention and retries a failed issuance in place', async () => {
    let retried = false;
    server.use(
      http.get(`${API_URL}/certs/tls`, () =>
        HttpResponse.json([
          {
            ...mockCerts[0],
            status: 'failed',
            crtPem: null,
            failureReason: 'No CNAME at _acme-challenge.example.com.',
          },
        ]),
      ),
      http.post(`${API_URL}/certs/tls/:id/retry`, () => {
        retried = true;
        return HttpResponse.json({ id: mockCerts[0].id, status: 'pending' });
      }),
    );
    renderOverview();
    const critical = await screen.findByRole('region', { name: 'Critical' });
    expect(
      within(critical).getByRole('link', { name: 'example.com' }),
    ).toHaveAttribute('href', '/dashboard/certificates');
    expect(within(critical).getByText('Issuance failed')).toBeInTheDocument();

    await userEvent.click(
      within(critical).getByRole('button', { name: 'Retry example.com' }),
    );
    await waitFor(() => expect(retried).toBe(true));
  });

  it('says all clear when nothing needs attention', async () => {
    server.use(
      http.get(`${API_URL}/certs/tls`, () => HttpResponse.json([])),
      http.get(`${API_URL}/domains`, () =>
        HttpResponse.json([
          { id: 'd1', hostname: 'example.com', isVerified: true },
        ]),
      ),
    );
    renderOverview();
    expect(await screen.findByText('All clear')).toBeInTheDocument();
    expect(
      screen.getByText('Nothing expires in the next 90 days.'),
    ).toBeInTheDocument();
  });

  it('draws issued certificates on the expiry timeline', async () => {
    const soon = new Date(Date.now() + 12.5 * 86_400_000).toISOString();
    server.use(
      http.get(`${API_URL}/certs/tls`, () =>
        HttpResponse.json([{ ...mockCerts[0], expiresAt: soon }]),
      ),
    );
    renderOverview();
    expect(
      await screen.findByRole('img', {
        name: /^example\.com expires in 12 days/,
      }),
    ).toBeInTheDocument();
  });
});
