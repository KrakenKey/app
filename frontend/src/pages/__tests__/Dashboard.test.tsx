import { screen, within } from '@testing-library/react';
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

  it('shows a health headline and the resource tiles', async () => {
    renderOverview();
    expect(
      await screen.findByRole('heading', {
        name: /need(s)? attention|Everything looks healthy/,
      }),
    ).toBeInTheDocument();
    for (const label of [
      'Certificates',
      'Endpoints',
      'Domains',
      'Connectors',
    ]) {
      expect(
        screen.getByRole('link', { name: new RegExp(`^${label}`) }),
      ).toBeInTheDocument();
    }
  });

  it('lists what needs attention with links', async () => {
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
    );
    renderOverview();
    const critical = await screen.findByRole('region', { name: 'Critical' });
    const link = within(critical).getByRole('link', { name: /example\.com/ });
    expect(link).toHaveAttribute('href', '/dashboard/certificates');
    expect(link).toHaveTextContent(/Issuance failed/);
    expect(
      screen.getByRole('heading', { name: /items? needs? attention/ }),
    ).toBeInTheDocument();
  });

  it('renders quick actions', async () => {
    renderOverview();
    expect(
      await screen.findByRole('link', { name: 'Request certificate' }),
    ).toHaveAttribute('href', '/dashboard/certificates?request=1');
    expect(
      screen.getByRole('link', { name: 'Add domain' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Create API key' }),
    ).toBeInTheDocument();
  });
});
