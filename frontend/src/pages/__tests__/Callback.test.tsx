import { screen, waitFor } from '@testing-library/react';
import { render } from '../../test/test-utils';
import Callback from '../Callback';

const mockHandleCallback = vi.fn();
const mockNavigate = vi.fn();
let mockSearchParams = new URLSearchParams('code=test-code-123');

vi.mock('../../context/AuthContext', async () => {
  const actual = await vi.importActual('../../context/AuthContext');
  return {
    ...actual,
    useAuth: () => ({
      handleCallback: mockHandleCallback,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      user: null,
      isAuthenticated: false,
      isLoading: false,
    }),
  };
});

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useSearchParams: () => [mockSearchParams],
  };
});

describe('Callback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams = new URLSearchParams('code=test-code-123');
  });

  it('renders authenticating message', () => {
    mockHandleCallback.mockReturnValue(new Promise(() => {})); // never resolves
    render(<Callback />);
    expect(screen.getByText('Authenticating...')).toBeInTheDocument();
  });

  it('calls handleCallback with code from URL', async () => {
    mockHandleCallback.mockResolvedValue(undefined);
    render(<Callback />);

    await waitFor(() => {
      expect(mockHandleCallback).toHaveBeenCalledWith('test-code-123');
    });
  });

  it('navigates to dashboard on successful callback', async () => {
    mockHandleCallback.mockResolvedValue(undefined);
    render(<Callback />);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/dashboard');
    });
  });

  it('navigates to home on callback error', async () => {
    mockHandleCallback.mockRejectedValue(new Error('Auth failed'));
    render(<Callback />);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/');
    });
  });

  it('navigates to home when no code in URL', async () => {
    mockSearchParams = new URLSearchParams('');
    render(<Callback />);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/');
    });
  });
});
