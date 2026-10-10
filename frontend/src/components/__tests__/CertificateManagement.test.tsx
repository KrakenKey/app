import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../test/test-utils';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { mockAwaitingCsrCert, mockCerts } from '../../test/mocks/data';
import { mockDeployments } from '../../test/mocks/connectors';
import { API_URL } from '../../services/api';
import CertificateManagement from '../CertificateManagement';

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

  it('shows CSR submission form', async () => {
    render(<CertificateManagement />);

    await waitFor(() => {
      expect(screen.getByText('Request a Certificate')).toBeInTheDocument();
    });

    expect(screen.getByText('Submit CSR')).toBeInTheDocument();
  });

  it('submits a CSR and refreshes the list', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<CertificateManagement />);

    await waitFor(() => {
      expect(screen.getByText('example.com')).toBeInTheDocument();
    });

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

  it('shows copy PEM button for certificates with PEM', async () => {
    render(<CertificateManagement />);

    await waitFor(() => {
      expect(screen.getByText('Copy PEM')).toBeInTheDocument();
    });
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

    render(<CertificateManagement />);

    await waitFor(() => {
      expect(screen.getByText(reason)).toBeInTheDocument();
    });
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
    expect(
      screen.getAllByRole('button', { name: /Delete/ }).length,
    ).toBeGreaterThanOrEqual(1);
    // Nothing to renew, revoke, retry or download yet
    expect(screen.queryByRole('button', { name: /Renew/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Revoke/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Retry/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Download/ })).toBeNull();
  });

  it('displays domains from parsed CSR', async () => {
    render(<CertificateManagement />);

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
      await screen.findByText('Request a Certificate');

      await user.click(
        screen.getByRole('radio', { name: /Issued by a connector/ }),
      );
      expect(screen.queryByText('Generate New CSR')).toBeNull();
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
      await waitFor(() => expect(names).toHaveValue(''));
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
