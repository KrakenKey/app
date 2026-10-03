import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { render } from '../../test/test-utils';
import { server } from '../../test/mocks/server';
import { API_URL } from '../../services/api';
import Device from '../Device';

const mockLogin = vi.fn();
let mockAuthenticated = true;
let mockSearchParams = new URLSearchParams('code=BCDF-GHJK');

vi.mock('../../hooks/useAuth', async () => {
  const actual = await vi.importActual('../../hooks/useAuth');
  return {
    ...actual,
    useAuth: () => ({
      login: mockLogin,
      register: vi.fn(),
      logout: vi.fn(),
      handleCallback: vi.fn(),
      user: mockAuthenticated ? { username: 'testuser', groups: [] } : null,
      isAuthenticated: mockAuthenticated,
      isLoading: false,
    }),
  };
});

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useSearchParams: () => [mockSearchParams] };
});

const request = {
  userCode: 'BCDF-GHJK',
  clientName: 'build-01',
  ip: '203.0.113.7',
  createdAt: new Date().toISOString(),
};

describe('Device', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticated = true;
    mockSearchParams = new URLSearchParams('code=bcdf-ghjk');
    sessionStorage.clear();
    server.use(
      http.get(`${API_URL}/auth/device/:code`, () =>
        HttpResponse.json(request),
      ),
    );
  });

  it('asks a signed-out user to sign in and remembers the code', async () => {
    mockAuthenticated = false;
    const user = userEvent.setup();
    render(<Device />);

    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(mockLogin).toHaveBeenCalled();
    expect(sessionStorage.getItem('kk_pending_device_code')).toBe('BCDF-GHJK');
  });

  it('shows the request and approves it', async () => {
    let approvedCode: unknown;
    server.use(
      http.post(`${API_URL}/auth/device/approve`, async ({ request: req }) => {
        approvedCode = ((await req.json()) as { userCode: string }).userCode;
        return HttpResponse.json({ name: 'CLI login: build-01' });
      }),
    );
    const user = userEvent.setup();
    render(<Device />);

    expect(await screen.findByText('build-01')).toBeInTheDocument();
    expect(screen.getByText('BCDF-GHJK')).toBeInTheDocument();
    expect(screen.getByText('203.0.113.7')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText(/Approved\./)).toBeInTheDocument();
    expect(approvedCode).toBe('BCDF-GHJK');
  });

  it('denies a request', async () => {
    const deny = vi.fn();
    server.use(
      http.post(`${API_URL}/auth/device/deny`, () => {
        deny();
        return HttpResponse.json({ message: 'Login request denied' });
      }),
    );
    const user = userEvent.setup();
    render(<Device />);

    await user.click(await screen.findByRole('button', { name: 'Deny' }));
    expect(
      await screen.findByText(/No API key was created/),
    ).toBeInTheDocument();
    expect(deny).toHaveBeenCalled();
  });

  it('explains an expired or unknown code', async () => {
    server.use(
      http.get(`${API_URL}/auth/device/:code`, () =>
        HttpResponse.json(
          { message: 'Login request not found or expired' },
          { status: 404 },
        ),
      ),
    );
    render(<Device />);

    expect(
      await screen.findByText(/not found or has expired/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('shows the API key limit message from the server', async () => {
    server.use(
      http.post(`${API_URL}/auth/device/approve`, () =>
        HttpResponse.json(
          { message: 'API key limit reached' },
          { status: 402 },
        ),
      ),
    );
    const user = userEvent.setup();
    render(<Device />);

    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    // The API client also raises a toast with the same text.
    const matches = await screen.findAllByText('API key limit reached');
    expect(matches.some((el) => el.tagName === 'P')).toBe(true);
  });

  it('handles a link without a code', () => {
    mockSearchParams = new URLSearchParams('');
    render(<Device />);
    expect(screen.getByText('No login code in the link.')).toBeInTheDocument();
  });
});
