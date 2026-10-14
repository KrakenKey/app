import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../test/test-utils';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { mockAwaitingCsrCert, mockCerts } from '../../test/mocks/data';
import { mockDeployments } from '../../test/mocks/connectors';
import { API_URL } from '../../services/api';
import CertificateManagement from '../CertificateManagement';
import { toast } from '../../utils/toast';

// Mock AuthContext
vi.mock('../../hooks/useAuth', async () => {
  const actual = await vi.importActual('../../hooks/useAuth');
  return {
    ...actual,
    useAuth: () => ({
      user: { username: 'testuser', email: 'test@example.com', groups: [] },
      isAuthenticated: true,
      isLoading: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      handleCallback: vi.fn(),
    }),
  };
});

/** The request form lives in a modal opened from the page header. */
async function openRequest(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    await screen.findByRole('button', { name: /Request certificate/ }),
  );
  return within(screen.getByRole('dialog'));
}

describe('CertificateManagement', () => {
  it('renders loading state initially', () => {
    render(<CertificateManagement />);
    expect(screen.getByText('Loading certificates...')).toBeInTheDocument();
  });

  it('renders certificate list after fetching', async () => {
    render(<CertificateManagement />);

    await waitFor(() => {
      expect(screen.getByText('example.com')).toBeInTheDocument();
    });
  });

  it('shows empty state when no certificates', async () => {
    server.use(
      http.get(`${API_URL}/certs/tls`, () => {
        return HttpResponse.json([]);
      }),
    );

    render(<CertificateManagement />);

    await waitFor(() => {
      expect(screen.getByText(/No certificates yet/)).toBeInTheDocument();
    });
  });

  it('displays certificate count', async () => {
    render(<CertificateManagement />);

    await waitFor(() => {
      expect(
        screen.getByText(`Your Certificates (${mockCerts.length})`),
      ).toBeInTheDocument();
    });
  });

  it('lists certificates first and opens the CSR form from the header', async () => {
    const user = userEvent.setup();
    render(<CertificateManagement />);

    await screen.findByText('example.com');
    expect(screen.queryByText('Request a Certificate')).toBeNull();

    const dialog = await openRequest(user);
    expect(dialog.getByText('Request a Certificate')).toBeInTheDocument();
    expect(dialog.getByText('Submit CSR')).toBeInTheDocument();
  });

  it('submits a CSR and refreshes the list', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<CertificateManagement />);

    await waitFor(() => {
      expect(screen.getByText('example.com')).toBeInTheDocument();
    });

    await openRequest(user);
    const textarea = screen.getByPlaceholderText(/BEGIN CERTIFICATE REQUEST/);
    await user.type(
      textarea,
      '-----BEGIN CERTIFICATE REQUEST-----\ntest\n-----END CERTIFICATE REQUEST-----',
    );
    await user.click(screen.getByText('Submit CSR'));

    await waitFor(() => {
      expect(screen.getByText('example.com')).toBeInTheDocument();
    });
    vi.useRealTimers();
  });

  it('shows renew button for issued certificates', async () => {
    render(<CertificateManagement />);

    await waitFor(() => {
      expect(screen.getByText('Renew')).toBeInTheDocument();
    });
  });

  it('shows download button for certificates with PEM', async () => {
    render(<CertificateManagement />);

    await waitFor(() => {
      expect(screen.getByText('Download')).toBeInTheDocument();
    });
  });

  it('keeps Copy PEM and Revoke in the row menu', async () => {
    const user = userEvent.setup();
    render(<CertificateManagement />);

    await user.click(
      await screen.findByRole('button', {
        name: 'More actions for example.com',
      }),
    );
    const menu = within(screen.getByRole('menu'));
    expect(menu.getByRole('menuitem', { name: /Copy PEM/ })).toBeVisible();
    expect(menu.getByRole('menuitem', { name: /Revoke/ })).toBeVisible();
    // Revoke is never a top-level button
    expect(screen.queryByRole('button', { name: /^Revoke/ })).toBeNull();
  });

  it('shows certificate status badges', async () => {
    // Ensure real timers (previous test uses fake timers)
    vi.useRealTimers();
    // Only return issued certs to avoid polling interference
    server.use(
      http.get(`${API_URL}/certs/tls`, () => {
        return HttpResponse.json([mockCerts[0]]);
      }),
    );

    render(<CertificateManagement />);

    // Wait for cert data to fully load
    await waitFor(() => {
      expect(screen.getByText('example.com')).toBeInTheDocument();
    });

    // Status badge should be rendered
    expect(screen.getAllByText('Issued').length).toBeGreaterThanOrEqual(1);
  });

  it('shows the failure reason for failed certificates', async () => {
    const reason =
      'ACME challenge delegation missing: no CNAME found at _acme-challenge.example.com.';
    server.use(
      http.get(`${API_URL}/certs/tls`, () => {
        return HttpResponse.json([
          {
            ...mockCerts[0],
            status: 'failed',
            crtPem: null,
            failureReason: reason,
          },
        ]);
      }),
    );

    const user = userEvent.setup();
    render(<CertificateManagement />);

    await user.click(
      await screen.findByRole('button', { name: 'Show details' }),
    );
    expect(screen.getByText(reason)).toBeInTheDocument();
  });

  it('keeps an issued certificate usable after a failed renewal and says why', async () => {
    vi.useRealTimers();
    const reason = 'CAA record for example.com forbids issuance';
    server.use(
      http.get(`${API_URL}/certs/tls`, () =>
        HttpResponse.json([
          {
            ...mockCerts[0],
            renewalFailedAt: new Date().toISOString(),
            failureReason: reason,
          },
        ]),
      ),
    );

    const user = userEvent.setup();
    render(<CertificateManagement />);

    // Listed as needing attention, still issued, still downloadable
    expect(await screen.findByText('Renewal failed')).toBeInTheDocument();
    expect(screen.getAllByText('Issued').length).toBeGreaterThan(0);
    expect(
      screen.getAllByRole('button', { name: /Download/ }).length,
    ).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Show details' }));
    expect(
      screen.getByText(`Renewal failed: ${reason}`, { exact: false }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/The current certificate stays in place/),
    ).toBeInTheDocument();
  });

  it('reports a renewal that came back failed instead of renewed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const error = vi.spyOn(toast, 'error');
    const success = vi.spyOn(toast, 'success');
    server.use(
      http.get(`${API_URL}/certs/tls/:id`, () =>
        HttpResponse.json({
          ...mockCerts[0],
          renewalFailedAt: new Date().toISOString(),
          failureReason: 'DNS problem',
        }),
      ),
    );
    render(<CertificateManagement />);

    const [renew] = await screen.findAllByRole('button', { name: /^Renew$/ });
    await user.click(renew);
    await vi.advanceTimersByTimeAsync(5000);

    await waitFor(() =>
      expect(error).toHaveBeenCalledWith(
        `Renewal of certificate #${mockCerts[0].id} failed: DNS problem`,
      ),
    );
    expect(success).not.toHaveBeenCalledWith(
      expect.stringContaining('has been renewed'),
    );
    vi.useRealTimers();
  });

  it('shows an awaiting_csr certificate by its requested names, with Delete', async () => {
    vi.useRealTimers();
    server.use(
      http.get(`${API_URL}/certs/tls`, () => {
        return HttpResponse.json([mockAwaitingCsrCert]);
      }),
    );

    render(<CertificateManagement />);

    await waitFor(() => {
      expect(screen.getAllByText('Awaiting CSR').length).toBeGreaterThanOrEqual(
        1,
      );
    });
    expect(
      screen.getAllByText('app.example.com').length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      screen.getAllByText(/Awaiting CSR from connector/).length,
    ).toBeGreaterThanOrEqual(1);
    await userEvent.click(
      screen.getByRole('button', { name: 'More actions for app.example.com' }),
    );
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual([
      'Delete',
    ]);
    // Nothing to renew, revoke, retry or download yet
    expect(screen.queryByRole('button', { name: /Renew/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Revoke/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Retry/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Download/ })).toBeNull();
  });

  it('displays domains from parsed CSR', async () => {
    const user = userEvent.setup();
    render(<CertificateManagement />);

    await user.click(
      (await screen.findAllByRole('button', { name: 'Show details' }))[0],
    );
    await waitFor(() => {
      expect(
        screen.getByText(/example.com, www.example.com/),
      ).toBeInTheDocument();
    });
  });

  describe('connectors', () => {
    beforeEach(() => vi.useRealTimers());

    it('creates a pending certificate from names for a connector', async () => {
      let posted: Record<string, unknown> | null = null;
      server.use(
        http.post(`${API_URL}/certs/tls`, async ({ request }) => {
          posted = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json({ id: 9, status: 'awaiting_csr' });
        }),
      );
      const user = userEvent.setup();
      render(<CertificateManagement />);
      const dialog = await openRequest(user);

      await user.click(
        dialog.getByRole('radio', { name: /Issued by a connector/ }),
      );
      expect(dialog.queryByText('Generate New CSR')).toBeNull();
      expect(
        screen.getByText(
          /creates the\s+private key, which never leaves its server/,
        ),
      ).toBeInTheDocument();

      const names = screen.getByLabelText('Names');
      const submit = screen.getByRole('button', {
        name: 'Create Pending Certificate',
      });
      await user.click(submit);
      expect(screen.getByText('Enter at least one name.')).toBeInTheDocument();

      await user.type(names, 'bad_name');
      await user.click(submit);
      expect(
        screen.getByText('Not a valid DNS name: bad_name'),
      ).toBeInTheDocument();
      expect(posted).toBeNull();

      await user.clear(names);
      await user.type(names, 'App.example.com{enter}*.example.com');
      await user.click(submit);
      await waitFor(() =>
        expect(posted).toEqual({
          names: ['app.example.com', '*.example.com'],
          managedBy: 'connector',
        }),
      );
      // The modal closes once the certificate is created
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });

    it('loads where a connector-managed certificate is deployed only when opened', async () => {
      let calls = 0;
      let query = '';
      server.use(
        http.get(`${API_URL}/certs/tls`, () =>
          HttpResponse.json([{ ...mockCerts[0], managedBy: 'connector' }]),
        ),
        http.get(`${API_URL}/connectors/deployments`, ({ request }) => {
          calls++;
          query = new URL(request.url).search;
          return HttpResponse.json(mockDeployments);
        }),
      );
      const user = userEvent.setup();
      render(<CertificateManagement />);
      await user.click(
        await screen.findByRole('button', { name: 'Show details' }),
      );
      await screen.findByText(/A connector, which renews it/);
      const toggle = screen.getByRole('button', { name: /Deployed to/ });
      expect(calls).toBe(0);

      await user.click(toggle);
      expect(await screen.findByText('nginx-main')).toBeInTheDocument();
      expect(query).toBe('?certificateId=1');
      expect(screen.getByRole('link', { name: 'web-01' })).toHaveAttribute(
        'href',
        `/dashboard/connectors/${mockDeployments[0].connectorId}`,
      );
      expect(screen.getByText('haproxy')).toBeInTheDocument();
      expect(screen.getByText('Verified')).toBeInTheDocument();
      expect(screen.getByText('Failed')).toBeInTheDocument();
      expect(screen.getByText('reload_failed')).toBeInTheDocument();
      expect(screen.getByText('(1 failing)')).toBeInTheDocument();

      // Closing and opening again doesn't refetch.
      await user.click(toggle);
      await user.click(toggle);
      expect(calls).toBe(1);
    });

    it('has no Deployed to section for other certificates', async () => {
      server.use(
        http.get(`${API_URL}/certs/tls`, () =>
          HttpResponse.json([mockCerts[0]]),
        ),
      );
      render(<CertificateManagement />);
      await screen.findByText('example.com');
      expect(screen.queryByRole('button', { name: /Deployed to/ })).toBeNull();
    });
  });
});
