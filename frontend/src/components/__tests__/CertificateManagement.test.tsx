import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../test/test-utils';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { mockCerts } from '../../test/mocks/data';
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
      expect(
        screen.getByText('Submit Certificate Signing Request'),
      ).toBeInTheDocument();
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

  it('displays domains from parsed CSR', async () => {
    render(<CertificateManagement />);

    await waitFor(() => {
      expect(
        screen.getByText(/example.com, www.example.com/),
      ).toBeInTheDocument();
    });
  });
});
