import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../test/test-utils';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { mockDomains } from '../../test/mocks/data';
import { API_URL } from '../../services/api';
import DomainManagement from '../DomainManagement';

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

  it('adds a new domain via the form', async () => {
    const user = userEvent.setup();
    render(<DomainManagement />);

    await waitFor(() => {
      expect(screen.getByText('example.com')).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText('example.com');
    await user.type(input, 'newdomain.com');
    await user.click(screen.getByText('Add Domain'));

    await waitFor(() => {
      expect(screen.getByText('newdomain.com')).toBeInTheDocument();
    });
  });

  it('shows verify button for unverified domains', async () => {
    render(<DomainManagement />);

    await waitFor(() => {
      expect(screen.getByText('unverified.com')).toBeInTheDocument();
    });

    expect(screen.getByText('Verify Now')).toBeInTheDocument();
  });

  it('does not show verify button for verified domains', async () => {
    server.use(
      http.get(`${API_URL}/domains`, () => {
        return HttpResponse.json([mockDomains[0]]); // only the verified domain
      }),
    );

    render(<DomainManagement />);

    await waitFor(() => {
      expect(screen.getByText('example.com')).toBeInTheDocument();
    });

    expect(screen.queryByText('Verify Now')).not.toBeInTheDocument();
  });

  it('shows delete button for each domain', async () => {
    render(<DomainManagement />);

    await waitFor(() => {
      expect(screen.getByText('example.com')).toBeInTheDocument();
    });

    const deleteButtons = screen.getAllByText('Delete');
    expect(deleteButtons.length).toBe(2);
  });

  it('deletes a domain when confirmed', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<DomainManagement />);

    await waitFor(() => {
      expect(screen.getByText('example.com')).toBeInTheDocument();
    });

    const deleteButtons = screen.getAllByText('Delete');
    await user.click(deleteButtons[0]);

    await waitFor(() => {
      expect(screen.queryByText('example.com')).not.toBeInTheDocument();
    });

    vi.restoreAllMocks();
  });

  it('does not delete a domain when cancelled', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(<DomainManagement />);

    await waitFor(() => {
      expect(screen.getByText('example.com')).toBeInTheDocument();
    });

    const deleteButtons = screen.getAllByText('Delete');
    await user.click(deleteButtons[0]);

    expect(screen.getByText('example.com')).toBeInTheDocument();

    vi.restoreAllMocks();
  });
});
