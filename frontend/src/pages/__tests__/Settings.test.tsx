import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../test/test-utils';
import { mockUser } from '../../test/mocks/data';
import Settings from '../Settings';

const { mockDeleteAccount, mockConnectMicrosoft, mockApi, mockToast } =
  vi.hoisted(() => ({
    mockDeleteAccount: vi.fn(),
    mockConnectMicrosoft: vi.fn(),
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
      connectMicrosoft: mockConnectMicrosoft,
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
    mockApi.get.mockImplementation((url: string) =>
      Promise.resolve({
        data: url === '/auth/profile' ? mockProfile : [],
      }),
    );
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
      screen.getByText(
        new Date(mockProfile.createdAt).toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        }),
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Test Display Name')).toBeInTheDocument();
  });

  it('shows the page description in the header', async () => {
    render(<Settings />);
    expect(
      await screen.findByText(
        'Your profile, email notifications and alert channels.',
      ),
    ).toBeInTheDocument();
  });

  it('does not repeat the resource counts from the overview', async () => {
    render(<Settings />);
    await screen.findByText(mockProfile.username);
    expect(screen.queryByText('Resources')).not.toBeInTheDocument();
  });

  it('edits the display name inline and can cancel', async () => {
    const user = userEvent.setup();
    render(<Settings />);
    await user.click(
      await screen.findByRole('button', { name: 'Edit display name' }),
    );

    const input = screen.getByPlaceholderText('Enter display name');
    expect(input).toHaveValue('Test Display Name');
    await user.clear(input);
    await user.type(input, 'Something else');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(
      screen.queryByPlaceholderText('Enter display name'),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Test Display Name')).toBeInTheDocument();
    expect(mockApi.patch).not.toHaveBeenCalled();
  });

  it('updates display name on form submit', async () => {
    const user = userEvent.setup();
    mockApi.patch.mockResolvedValue({
      data: { ...mockProfile, displayName: 'New Name' },
    });

    render(<Settings />);
    await user.click(
      await screen.findByRole('button', { name: 'Edit display name' }),
    );

    const input = screen.getByPlaceholderText('Enter display name');
    await user.clear(input);
    await user.type(input, 'New Name');
    await user.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(mockApi.patch).toHaveBeenCalledWith('/auth/profile', {
        displayName: 'New Name',
      });
    });
    expect(await screen.findByText('New Name')).toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText('Enter display name'),
    ).not.toBeInTheDocument();
  });

  describe('Microsoft sign-in', () => {
    afterEach(() => {
      delete window.__env__;
    });

    it('hides the sign-in methods card until Microsoft sign-in is turned on', async () => {
      render(<Settings />);
      await waitFor(() => {
        expect(screen.getByText(mockProfile.username)).toBeInTheDocument();
      });
      expect(screen.queryByText('Sign-in methods')).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /connect microsoft/i }),
      ).not.toBeInTheDocument();
    });

    it('connects a Microsoft account when turned on', async () => {
      window.__env__ = { KK_MICROSOFT_LOGIN_ENABLED: 'true' };
      const user = userEvent.setup();
      render(<Settings />);

      await user.click(
        await screen.findByRole('button', { name: /connect microsoft/i }),
      );
      expect(screen.getByText('Sign-in methods')).toBeInTheDocument();
      expect(mockConnectMicrosoft).toHaveBeenCalledOnce();
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

  it('lists the connector email alerts and turns one off', async () => {
    const user = userEvent.setup();
    mockApi.patch.mockResolvedValue({
      data: {
        ...mockProfile,
        notificationPreferences: { deploy_failed: false },
      },
    });
    render(<Settings />);
    const connectors = await screen.findByRole('region', {
      name: 'Connectors',
    });
    expect(
      within(connectors).getByText('Connector offline'),
    ).toBeInTheDocument();

    const toggle = within(connectors).getByRole('switch', {
      name: /Deployment failed/,
    });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await user.click(toggle);

    await waitFor(() =>
      expect(mockApi.patch).toHaveBeenCalledWith('/auth/profile', {
        notificationPreferences: { deploy_failed: false },
      }),
    );
  });

  it('groups email notifications by topic', async () => {
    render(<Settings />);
    const certs = await screen.findByRole('region', { name: 'Certificates' });
    expect(within(certs).getAllByRole('switch')).toHaveLength(5);
    expect(
      within(screen.getByRole('region', { name: 'Domains' })).getAllByRole(
        'switch',
      ),
    ).toHaveLength(1);
  });
});
