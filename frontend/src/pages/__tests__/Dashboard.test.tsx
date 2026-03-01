import { screen, waitFor } from '@testing-library/react';
import { render } from '../../test/test-utils';
import { mockUser } from '../../test/mocks/data';
import Dashboard from '../Dashboard';

const mockLogout = vi.fn();

vi.mock('../../context/AuthContext', async () => {
  const actual = await vi.importActual('../../context/AuthContext');
  return {
    ...actual,
    useAuth: () => ({
      user: mockUser,
      logout: mockLogout,
      isAuthenticated: true,
      isLoading: false,
      login: vi.fn(),
      register: vi.fn(),
      handleCallback: vi.fn(),
    }),
  };
});

describe('Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders user greeting', async () => {
    render(<Dashboard />);
    expect(screen.getByText(`Welcome, ${mockUser.username}`)).toBeInTheDocument();
  });

  it('renders user email', () => {
    render(<Dashboard />);
    expect(screen.getByText(mockUser.email)).toBeInTheDocument();
  });

  it('renders user groups', () => {
    render(<Dashboard />);
    expect(screen.getByText(mockUser.groups.join(', '))).toBeInTheDocument();
  });

  it('renders API Key Management section', async () => {
    render(<Dashboard />);
    await waitFor(() => {
      expect(screen.getByText('API Key Management')).toBeInTheDocument();
    });
  });

  it('renders DomainManagement section', async () => {
    render(<Dashboard />);
    await waitFor(() => {
      expect(screen.getByText('Domain Management')).toBeInTheDocument();
    });
  });

  it('renders CertificateManagement section', async () => {
    render(<Dashboard />);
    await waitFor(() => {
      expect(screen.getByText('Certificate Management')).toBeInTheDocument();
    });
  });

  it('renders Logout button', () => {
    render(<Dashboard />);
    expect(screen.getByText('Logout')).toBeInTheDocument();
  });
});
