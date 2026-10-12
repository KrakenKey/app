import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { render } from '../../test/test-utils';
import { server } from '../../test/mocks/server';
import { API_URL } from '../../services/api';
import { mockCerts, mockUser } from '../../test/mocks/data';
import { HEALTH_TIMEOUT_MS, HealthProvider } from '../../context/HealthContext';
import Overview from '../Overview';

// Stable reference to avoid infinite useEffect([user]) loop
const stableUser = {
  ...mockUser,
  resourceCounts: { domains: 2, certificates: 1, apiKeys: 1 },
};
let currentUser: Record<string, unknown> = stableUser;

vi.mock('../../hooks/useAuth', async () => {
  const actual = await vi.importActual('../../hooks/useAuth');
  return {
    ...actual,
    useAuth: () => ({
      user: currentUser,
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
    currentUser = stableUser;
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
    expect(screen.getByText('Nothing to renew yet')).toBeInTheDocument();
  });

  it('greets by the part before the @ when the username is an address', () => {
    currentUser = {
      ...stableUser,
      username: 'cert-action@krakenkey.io',
      email: 'cert-action@krakenkey.io',
      displayName: null,
    };
    renderOverview();
    expect(screen.getByText('Welcome back, cert-action')).toBeInTheDocument();
  });

  describe('a sparse account', () => {
    const day = 86_400_000;
    const at = (d: number) => new Date(Date.now() + d * day).toISOString();
    const issued = (id: number, over: object) => ({
      ...mockCerts[0],
      id,
      expiresAt: at(88.5),
      renewAfter: at(57.5),
      ...over,
    });

    beforeEach(() => {
      server.use(
        http.get(`${API_URL}/certs/tls`, () =>
          HttpResponse.json([
            ...[1, 2, 3].map((id) => ({
              ...mockCerts[0],
              id,
              status: 'revoked',
              revokedAt: at(-30),
              expiresAt: at(-10),
            })),
            issued(21, { autoRenew: false, expiresAt: at(84.5) }),
            issued(27, { autoRenew: false, managedBy: 'connector' }),
            issued(28, { autoRenew: false, managedBy: 'connector' }),
          ]),
        ),
        http.get(`${API_URL}/connectors`, () =>
          HttpResponse.json([
            {
              id: 'c1',
              name: 'e2e-connector',
              clientLabel: 'e2e-client',
              allowedCertIds: [27, 28],
              enrolledAt: at(-2),
              lastSeenAt: at(-0.8),
              revokedAt: null,
              enrollmentTokenExpiresAt: null,
              version: '0.3.0-dev',
              deploymentSummary: { certificates: 2, targets: 2, failing: 1 },
            },
          ]),
        ),
      );
    });

    it('counts live certificates and mentions revoked ones', async () => {
      renderOverview();
      const kpi = await screen.findByRole('link', {
        name: /^Certificates\s*3\s*3\sissued,\s3\srevoked/,
      });
      expect(kpi).toHaveAttribute('href', '/dashboard/certificates');
    });

    it('shows a renewal schedule that tells certificates apart', async () => {
      renderOverview();
      const schedule = (
        await screen.findByRole('heading', { name: /Renewal schedule/ })
      ).closest('div')!.parentElement!;
      const rows = within(schedule).getAllByRole('listitem');
      expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual([
        expect.stringMatching(/^example\.com #21, Auto-renew is off, expires/),
        expect.stringMatching(
          /^example\.com #27, Renewed by e2e-connector, renews .+, expires/,
        ),
        expect.stringMatching(/^example\.com #28, /),
      ]);
    });

    it('flags the certificate with auto-renew off, and never revoked ones', async () => {
      renderOverview();
      const warning = await screen.findByRole('region', { name: 'Warning' });
      expect(within(warning).getByText('#21')).toBeInTheDocument();
      expect(
        within(warning).getByText(/^Auto-renew is off; it will expire on/),
      ).toBeInTheDocument();
      expect(screen.queryByText('#1')).not.toBeInTheDocument();
    });

    it('colors the connector by health, not check-in time', async () => {
      renderOverview();
      expect(
        await screen.findByRole('img', { name: 'Targets failing' }),
      ).toHaveClass('bg-red-400');
    });

    it('offers to add a first endpoint instead of showing zeros', async () => {
      renderOverview();
      expect(
        await screen.findByText('Monitor your first endpoint'),
      ).toBeInTheDocument();
      expect(
        screen.getAllByRole('button', { name: /add endpoint/i }).length,
      ).toBeGreaterThan(1);
    });
  });

  describe('when health requests fail', () => {
    const fail = () => HttpResponse.json({}, { status: 500 });
    const cleanAccount = [
      http.get(`${API_URL}/certs/tls`, () => HttpResponse.json([])),
      http.get(`${API_URL}/domains`, () =>
        HttpResponse.json([
          { id: 'd1', hostname: 'example.com', isVerified: true },
        ]),
      ),
    ];

    it('never says all clear when one source failed, and retries it', async () => {
      let connectorsUp = false;
      server.use(
        ...cleanAccount,
        http.get(`${API_URL}/connectors`, () =>
          connectorsUp ? HttpResponse.json([]) : fail(),
        ),
      );
      renderOverview();
      expect(
        await screen.findByText("Couldn't check everything"),
      ).toBeInTheDocument();
      expect(screen.queryByText('All clear')).not.toBeInTheDocument();
      expect(
        screen.getByText(
          /^Couldn't load connectors\. Nothing in what did load/,
        ),
      ).toBeInTheDocument();
      // The connectors panel and tile say so instead of showing zero.
      expect(screen.getByText("Couldn't load connectors")).toBeInTheDocument();
      expect(
        screen.getByRole('link', { name: /^Connectors\s*\?\s*Couldn't load/ }),
      ).toBeInTheDocument();
      // What did load is still shown.
      expect(screen.getByText('Nothing to renew yet')).toBeInTheDocument();

      connectorsUp = true;
      await userEvent.click(
        screen.getAllByRole('button', { name: 'Retry' })[0],
      );
      expect(await screen.findByText('All clear')).toBeInTheDocument();
      expect(
        screen.queryByText("Couldn't check everything"),
      ).not.toBeInTheDocument();
    });

    it('names every area when every source failed', async () => {
      server.use(
        http.get(`${API_URL}/certs/tls`, fail),
        http.get(`${API_URL}/endpoints`, fail),
        http.get(`${API_URL}/endpoints/probes/mine`, fail),
        http.get(`${API_URL}/connectors`, fail),
        http.get(`${API_URL}/domains`, fail),
      );
      renderOverview();
      expect(
        await screen.findByText(
          "Couldn't load certificates, endpoints, connectors and domains. Nothing in what did load needs you right now.",
        ),
      ).toBeInTheDocument();
      expect(screen.queryByText('All clear')).not.toBeInTheDocument();
      expect(screen.getAllByText("Couldn't load")).toHaveLength(6);
      for (const what of ['certificates', 'endpoints', 'connectors']) {
        expect(screen.getByText(`Couldn't load ${what}`)).toBeInTheDocument();
      }
    });

    it('warns that the list may be incomplete next to what it found', async () => {
      server.use(
        http.get(`${API_URL}/certs/tls`, () =>
          HttpResponse.json([{ ...mockCerts[0], status: 'failed' }]),
        ),
        http.get(`${API_URL}/domains`, fail),
      );
      renderOverview();
      expect(
        await screen.findByText(
          "Couldn't load domains, so this list may be incomplete.",
        ),
      ).toBeInTheDocument();
      expect(screen.getByText('Issuance failed')).toBeInTheDocument();
    });

    it('treats endpoints with missing latest results as unknown', async () => {
      server.use(
        ...cleanAccount,
        http.get(`${API_URL}/endpoints`, () =>
          HttpResponse.json([
            { id: 'e1', host: 'a.example.com', port: 443, isActive: true },
            { id: 'e2', host: 'b.example.com', port: 443, isActive: true },
          ]),
        ),
        http.get(`${API_URL}/endpoints/:id/results/latest`, ({ params }) =>
          params.id === 'e2' ? fail() : HttpResponse.json([]),
        ),
      );
      renderOverview();
      expect(
        await screen.findByText(
          /^Couldn't load the latest scan for 1 endpoint\./,
        ),
      ).toBeInTheDocument();
      expect(screen.queryByText('All clear')).not.toBeInTheDocument();
      expect(
        screen.getByRole('img', {
          name: "0 healthy, 0 expiring, 0 failing, 1 inactive, 1 couldn't load",
        }),
      ).toBeInTheDocument();
    });

    it('stops waiting for a request that hangs', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        server.use(
          ...cleanAccount,
          http.get(`${API_URL}/connectors`, async () => {
            await delay('infinite');
            return HttpResponse.json([]);
          }),
        );
        renderOverview();
        // The rest of the page renders while connectors are still loading.
        expect(
          await screen.findByText('Nothing to renew yet'),
        ).toBeInTheDocument();
        expect(screen.getByText('Checking your account')).toBeInTheDocument();
        expect(screen.queryByText('All clear')).not.toBeInTheDocument();

        await act(() => vi.advanceTimersByTimeAsync(HEALTH_TIMEOUT_MS));
        expect(
          await screen.findByText("Couldn't load connectors"),
        ).toBeInTheDocument();
        expect(screen.queryByText('All clear')).not.toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it('explains connectors when there are none', async () => {
    renderOverview();
    expect(
      await screen.findByText(
        'Run a connector to renew and deploy with your own keys',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /set up a connector/i }),
    ).toBeInTheDocument();
  });
});
