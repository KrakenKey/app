import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../test/test-utils';
import Home from '../Home';

// Mock useAuth to control auth state in tests
const mockLogin = vi.fn();
const mockRegister = vi.fn();
const mockLoginWithMicrosoft = vi.fn();

vi.mock('../../hooks/useAuth', async () => {
  const actual = await vi.importActual('../../hooks/useAuth');
  return {
    ...actual,
    useAuth: () => ({
      login: mockLogin,
      register: mockRegister,
      loginWithMicrosoft: mockLoginWithMicrosoft,
      isAuthenticated: false,
      user: null,
      isLoading: false,
      logout: vi.fn(),
      handleCallback: vi.fn(),
    }),
  };
});

describe('Home', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete window.__env__;
  });

  it('renders KrakenKey heading', () => {
    render(<Home />);
    expect(screen.getByText('KrakenKey')).toBeInTheDocument();
  });

  it('renders login and sign up buttons', () => {
    render(<Home />);
    expect(screen.getByText('Login')).toBeInTheDocument();
    expect(screen.getByText('Sign Up')).toBeInTheDocument();
  });

  it('calls login when Login button is clicked', async () => {
    const user = userEvent.setup();
    render(<Home />);

    await user.click(screen.getByText('Login'));
    expect(mockLogin).toHaveBeenCalledOnce();
  });

  it('calls register when Sign Up button is clicked', async () => {
    const user = userEvent.setup();
    render(<Home />);

    await user.click(screen.getByText('Sign Up'));
    expect(mockRegister).toHaveBeenCalledOnce();
  });

  describe('Continue with Microsoft', () => {
    it('is hidden until Microsoft sign-in is turned on', () => {
      render(<Home />);
      expect(
        screen.queryByRole('button', { name: /continue with microsoft/i }),
      ).not.toBeInTheDocument();
    });

    it('is hidden for any value other than "true"', () => {
      window.__env__ = { KK_MICROSOFT_LOGIN_ENABLED: 'false' };
      render(<Home />);
      expect(
        screen.queryByRole('button', { name: /continue with microsoft/i }),
      ).not.toBeInTheDocument();
    });

    it('starts a Microsoft sign-in when turned on', async () => {
      window.__env__ = { KK_MICROSOFT_LOGIN_ENABLED: 'true' };
      const user = userEvent.setup();
      render(<Home />);

      await user.click(
        screen.getByRole('button', { name: /continue with microsoft/i }),
      );
      expect(mockLoginWithMicrosoft).toHaveBeenCalledOnce();
      expect(mockLogin).not.toHaveBeenCalled();
      expect(mockRegister).not.toHaveBeenCalled();
    });
  });

  it('renders tagline text', () => {
    render(<Home />);
    expect(screen.getByText('Certificate Automagick')).toBeInTheDocument();
  });
});
