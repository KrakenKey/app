import { screen, waitFor } from '@testing-library/react';
import { render } from '../../test/test-utils';
import Callback from '../Callback';

const mockHandleCallback = vi.fn();
const mockNavigate = vi.fn();
let mockSearchParams = new URLSearchParams('code=test-code-123');

vi.mock('../../hooks/useAuth', async () => {
  const actual = await vi.importActual('../../hooks/useAuth');
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
    sessionStorage.clear();
    mockSearchParams = new URLSearchParams(
      'code=test-code-123&state=test-state-456',
    );
  });

  it('renders authenticating message', () => {
    mockHandleCallback.mockReturnValue(new Promise(() => {})); // never resolves
    render(<Callback />);
    expect(screen.getByText('Authenticating...')).toBeInTheDocument();
  });

  it('calls handleCallback with code and state from URL', async () => {
    mockHandleCallback.mockResolvedValue(undefined);
    render(<Callback />);

    await waitFor(() => {
      expect(mockHandleCallback).toHaveBeenCalledWith(
        'test-code-123',
        'test-state-456',
      );
    });
  });

  it('navigates to dashboard on successful callback', async () => {
    mockHandleCallback.mockResolvedValue(undefined);
    render(<Callback />);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/dashboard');
    });
  });

  it('returns to a pending CLI login after sign-in', async () => {
    sessionStorage.setItem('kk_pending_device_code', 'BCDF-GHJK');
    mockHandleCallback.mockResolvedValue(undefined);
    render(<Callback />);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/device?code=BCDF-GHJK');
    });
    expect(sessionStorage.getItem('kk_pending_device_code')).toBeNull();
  });

  it('returns to the Marketplace landing page with the purchase token', async () => {
    sessionStorage.setItem('kk_pending_marketplace_token', 'ab+cd/ef==');
    mockHandleCallback.mockResolvedValue(undefined);
    render(<Callback />);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(
        '/marketplace?token=ab%2Bcd%2Fef%3D%3D',
      );
    });
    expect(sessionStorage.getItem('kk_pending_marketplace_token')).toBeNull();
  });

  it('returns to the AWS Marketplace landing page with the registration', async () => {
    sessionStorage.setItem(
      'kk_pending_aws_marketplace_registration',
      'AbC_-123',
    );
    mockHandleCallback.mockResolvedValue(undefined);
    render(<Callback />);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(
        '/aws-marketplace?registration=AbC_-123',
      );
    });
    expect(
      sessionStorage.getItem('kk_pending_aws_marketplace_registration'),
    ).toBeNull();
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
