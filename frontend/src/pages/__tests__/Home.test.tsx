import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../test/test-utils';
import Home from '../Home';

// Mock useAuth to control auth state in tests
const mockLogin = vi.fn();
const mockRegister = vi.fn();

vi.mock('../../context/AuthContext', async () => {
  const actual = await vi.importActual('../../context/AuthContext');
  return {
    ...actual,
    useAuth: () => ({
      login: mockLogin,
      register: mockRegister,
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

  it('renders tagline text', () => {
    render(<Home />);
    expect(screen.getByText('Certificate Automagick')).toBeInTheDocument();
  });
});
