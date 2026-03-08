import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../test/test-utils';
import { mockUser } from '../../test/mocks/data';
import Settings from '../Settings';

const { mockDeleteAccount, mockApi, mockToast } = vi.hoisted(() => ({
  mockDeleteAccount: vi.fn(),
  mockApi: { get: vi.fn(), patch: vi.fn() },
  mockToast: { success: vi.fn(), error: vi.fn() },
}));

const stableUser = { ...mockUser };

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
      deleteAccount: mockDeleteAccount,
    }),
  };
});

vi.mock('../../services/api', () => ({
  default: mockApi,
}));

vi.mock('../../utils/toast', () => ({
  toast: mockToast,
}));

const mockProfile = {
  id: 'user-1',
  username: mockUser.username,
  email: mockUser.email,
  groups: mockUser.groups,
  displayName: 'Test Display Name',
  createdAt: '2025-01-15T00:00:00.000Z',
  resourceCounts: { domains: 3, certificates: 2, apiKeys: 1 },
};

describe('Settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.get.mockResolvedValue({ data: mockProfile });
  });

  it('shows loading state initially', () => {
    mockApi.get.mockReturnValue(new Promise(() => {}));
    render(<Settings />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('renders profile information', async () => {
    render(<Settings />);
    await waitFor(() => {
      expect(screen.getByText(mockProfile.username)).toBeInTheDocument();
    });
    expect(screen.getByText(mockProfile.email)).toBeInTheDocument();
    expect(screen.getByText(mockProfile.groups.join(', '))).toBeInTheDocument();
    expect(
      screen.getByText(new Date(mockProfile.createdAt).toLocaleDateString()),
    ).toBeInTheDocument();
  });

  it('renders resource counts', async () => {
    render(<Settings />);
    await waitFor(() => {
      expect(screen.getByText('3')).toBeInTheDocument();
    });
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('populates display name from profile', async () => {
    render(<Settings />);
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Enter display name')).toHaveValue(
        'Test Display Name',
      );
    });
  });

  it('updates display name on form submit', async () => {
    const user = userEvent.setup();
    mockApi.patch.mockResolvedValue({
      data: { ...mockProfile, displayName: 'New Name' },
    });

    render(<Settings />);
    await waitFor(() => {
      expect(
        screen.getByPlaceholderText('Enter display name'),
      ).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText('Enter display name');
    await user.clear(input);
    await user.type(input, 'New Name');
    await user.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(mockApi.patch).toHaveBeenCalledWith('/auth/profile', {
        displayName: 'New Name',
      });
    });
  });

  it('shows error when profile fails to load', async () => {
    mockApi.get.mockRejectedValue(new Error('Network error'));

    render(<Settings />);
    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('Failed to load profile');
    });
  });

  it('shows delete confirmation when Delete Account is clicked', async () => {
    const user = userEvent.setup();
    render(<Settings />);
    await waitFor(() => {
      expect(screen.getByText('Delete Account')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Delete Account'));

    expect(
      screen.getByText(/To confirm, type your username/),
    ).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
    expect(screen.getByText('Permanently Delete Account')).toBeInTheDocument();
  });

  it('disables delete button until username is typed', async () => {
    const user = userEvent.setup();
    render(<Settings />);
    await waitFor(() => {
      expect(screen.getByText('Delete Account')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Delete Account'));

    const deleteButton = screen.getByText('Permanently Delete Account');
    expect(deleteButton).toBeDisabled();

    const input = screen.getByPlaceholderText(mockUser.username);
    await user.type(input, mockUser.username);
    expect(deleteButton).toBeEnabled();
  });

  it('calls deleteAccount when confirmed', async () => {
    const user = userEvent.setup();
    mockDeleteAccount.mockResolvedValue(undefined);

    render(<Settings />);
    await waitFor(() => {
      expect(screen.getByText('Delete Account')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Delete Account'));
    await user.type(
      screen.getByPlaceholderText(mockUser.username),
      mockUser.username,
    );
    await user.click(screen.getByText('Permanently Delete Account'));

    await waitFor(() => {
      expect(mockDeleteAccount).toHaveBeenCalled();
    });
  });

  it('cancels delete confirmation', async () => {
    const user = userEvent.setup();
    render(<Settings />);
    await waitFor(() => {
      expect(screen.getByText('Delete Account')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Delete Account'));
    expect(screen.getByText('Cancel')).toBeInTheDocument();

    await user.click(screen.getByText('Cancel'));
    expect(screen.queryByText('Cancel')).not.toBeInTheDocument();
    expect(screen.getByText('Delete Account')).toBeInTheDocument();
  });
});
