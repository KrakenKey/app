import { screen, waitFor } from '@testing-library/react';
import { render } from '../../test/test-utils';
import { mockUser } from '../../test/mocks/data';
import Overview from '../Overview';

// Stable reference to avoid infinite useEffect([user]) loop
const stableUser = { ...mockUser, resourceCounts: { domains: 2, certificates: 1, apiKeys: 1 } };

vi.mock('../../context/AuthContext', async () => {
  const actual = await vi.importActual('../../context/AuthContext');
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

describe('Overview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders user greeting', () => {
    render(<Overview />);
    expect(screen.getByText(`Welcome back, ${mockUser.username}`)).toBeInTheDocument();
  });

  it('renders resource count cards', async () => {
    render(<Overview />);
    await waitFor(() => {
      expect(screen.getByText('Domains')).toBeInTheDocument();
      expect(screen.getByText('Certificates')).toBeInTheDocument();
      expect(screen.getByText('API Keys')).toBeInTheDocument();
    });
  });

  it('renders quick action buttons', () => {
    render(<Overview />);
    expect(screen.getByText('Add Domain')).toBeInTheDocument();
    expect(screen.getByText('Submit CSR')).toBeInTheDocument();
    expect(screen.getByText('Create API Key')).toBeInTheDocument();
  });
});
