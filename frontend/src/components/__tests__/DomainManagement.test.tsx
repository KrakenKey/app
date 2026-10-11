import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../test/test-utils';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { mockCerts, mockDomains } from '../../test/mocks/data';
import {
  HealthContext,
  type HealthContextValue,
} from '../../context/HealthContext';
import { countByArea } from '../../utils/accountHealth';
import { API_URL } from '../../services/api';
import DomainManagement from '../DomainManagement';

const { mockCopy } = vi.hoisted(() => ({ mockCopy: vi.fn() }));
vi.mock('../../utils/clipboard', () => ({ copyToClipboard: mockCopy }));

// Mock AuthContext so the component can render outside a real auth flow
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

describe('DomainManagement', () => {
  it('renders loading state initially', () => {
    render(<DomainManagement />);
    expect(screen.getByText('Loading domains...')).toBeInTheDocument();
  });

  it('renders domain list after fetching', async () => {
    render(<DomainManagement />);

    await waitFor(() => {
      expect(screen.getByText('example.com')).toBeInTheDocument();
    });

    expect(screen.getByText('unverified.com')).toBeInTheDocument();
  });

  it('shows empty state when no domains', async () => {
    server.use(
      http.get(`${API_URL}/domains`, () => {
        return HttpResponse.json([]);
      }),
    );

    render(<DomainManagement />);

    await waitFor(() => {
      expect(screen.getByText(/No domains yet/)).toBeInTheDocument();
    });
  });

  it('displays domain count', async () => {
    render(<DomainManagement />);

    await waitFor(() => {
      expect(
        screen.getByText(`Your Domains (${mockDomains.length})`),
      ).toBeInTheDocument();
    });
  });

  it('adds a domain from the modal and opens its DNS records', async () => {
    const user = userEvent.setup();
    render(<DomainManagement />);
    await screen.findByText('example.com');

    await user.click(screen.getByRole('button', { name: 'Add domain' }));
    const dialog = screen.getByRole('dialog', { name: 'Add a domain' });
    expect(within(dialog).getByLabelText('Domain')).toHaveFocus();
    await user.type(within(dialog).getByLabelText('Domain'), 'newdomain.com');
    await user.click(
      within(dialog).getByRole('button', { name: 'Add domain' }),
    );

    expect(await screen.findByText('newdomain.com')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(
      screen.getByText('_acme-challenge.newdomain.com'),
    ).toBeInTheDocument();
  });

  it('shows verify only for pending domains', async () => {
    render(<DomainManagement />);
    await screen.findByText('unverified.com');

    expect(screen.getAllByRole('button', { name: 'Verify' })).toHaveLength(1);
    const pendingRow = screen.getByText('unverified.com').closest('tr')!;
    expect(within(pendingRow).getAllByText('Pending').length).toBeGreaterThan(
      0,
    );
    const verifiedRow = screen.getByText('example.com').closest('tr')!;
    expect(within(verifiedRow).getAllByText('Verified').length).toBeGreaterThan(
      0,
    );
  });

  it('does not show verify button for verified domains', async () => {
    server.use(
      http.get(`${API_URL}/domains`, () => {
        return HttpResponse.json([mockDomains[0]]); // only the verified domain
      }),
    );

    render(<DomainManagement />);
    await screen.findByText('example.com');

    expect(
      screen.queryByRole('button', { name: 'Verify' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Show DNS records/ }),
    ).not.toBeInTheDocument();
  });

  it('shows the DNS records of a pending domain with copy buttons', async () => {
    const user = userEvent.setup();
    render(<DomainManagement />);
    await screen.findByText('unverified.com');
    expect(screen.queryByText('krakenkey-verify=xyz789')).toBeNull();

    await user.click(
      screen.getByRole('button', {
        name: 'Show DNS records for unverified.com',
      }),
    );

    expect(screen.getByText('krakenkey-verify=xyz789')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Copy TXT value' }));
    expect(mockCopy).toHaveBeenCalledWith('krakenkey-verify=xyz789');
    await user.click(screen.getByRole('button', { name: 'Copy CNAME target' }));
    expect(mockCopy).toHaveBeenLastCalledWith(
      expect.stringMatching(/^unverified-com\./),
    );
  });

  it('counts certificates per domain when account data is loaded', async () => {
    const health: HealthContextValue = {
      data: {
        certs: mockCerts,
        endpoints: [],
        latestResults: {},
        probes: [],
        connectors: [],
        domains: [],
      },
      items: [],
      byArea: countByArea([]),
      loading: false,
      checkedAt: null,
      refresh: async () => {},
    };
    render(
      <HealthContext.Provider value={health}>
        <DomainManagement />
      </HealthContext.Provider>,
    );
    await screen.findByText('example.com');

    expect(
      screen.getByRole('columnheader', { name: 'Certificates' }),
    ).toBeInTheDocument();
    // mockCerts has one certificate for example.com, none for unverified.com.
    const row = screen.getByText('example.com').closest('tr')!;
    expect(within(row).getByText('1')).toBeInTheDocument();
    const pending = screen.getByText('unverified.com').closest('tr')!;
    expect(within(pending).getByText('0')).toBeInTheDocument();
  });

  it('leaves out the certificate column without account data', async () => {
    render(<DomainManagement />);
    await screen.findByText('example.com');

    expect(
      screen.queryByRole('columnheader', { name: 'Certificates' }),
    ).not.toBeInTheDocument();
  });

  it('deletes a domain from the row menu after confirming', async () => {
    const user = userEvent.setup();
    render(<DomainManagement />);
    await screen.findByText('example.com');

    await user.click(
      screen.getByRole('button', { name: 'More actions for example.com' }),
    );
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await user.click(
      await screen.findByRole('button', { name: 'Delete domain' }),
    );

    await waitFor(() => {
      expect(screen.queryByText('example.com')).not.toBeInTheDocument();
    });
  });

  it('does not delete a domain when cancelled', async () => {
    const user = userEvent.setup();
    render(<DomainManagement />);
    await screen.findByText('example.com');

    await user.click(
      screen.getByRole('button', { name: 'More actions for example.com' }),
    );
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(screen.getByText('example.com')).toBeInTheDocument();
  });
});
