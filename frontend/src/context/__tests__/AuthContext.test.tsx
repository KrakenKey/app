import { renderHook, act, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { AuthProvider } from '../AuthContext';
import { useAuth } from '../../hooks/useAuth';
import { mockUser } from '../../test/mocks/data';
import { API_URL } from '../../services/api';

/** Unsigned JWT shaped like an Authentik ID token. */
const b64url = (obj: object) =>
  btoa(JSON.stringify(obj))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const ID_TOKEN = `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url({
  iss: 'https://auth.example.com/application/o/krakenkey/',
  aud: 'krakenkey-backend',
  sub: 'user-1',
})}.signature`;

const END_SESSION_URL =
  'https://auth.example.com/application/o/krakenkey/end-session/';

function wrapper({ children }: { children: ReactNode }) {
  return (
    <BrowserRouter>
      <AuthProvider>{children}</AuthProvider>
    </BrowserRouter>
  );
}

describe('AuthContext', () => {
  it('auto-login: sets user when valid token exists', async () => {
    localStorage.setItem('access_token', 'valid-token');

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.user).toEqual(mockUser);
    expect(result.current.isAuthenticated).toBe(true);
  });

  it('auto-login: clears token when profile fetch fails', async () => {
    localStorage.setItem('access_token', 'invalid-token');

    server.use(
      http.get(`${API_URL}/auth/profile`, () => {
        return new HttpResponse(null, { status: 401 });
      }),
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.user).toBeNull();
    expect(localStorage.getItem('access_token')).toBeNull();
  });

  it('auto-login: a failed token check clears the session without logging out of Authentik', async () => {
    localStorage.setItem('access_token', ID_TOKEN);
    let logoutUrlRequested = false;

    server.use(
      http.get(`${API_URL}/auth/profile`, () => {
        return new HttpResponse(null, { status: 500 });
      }),
      http.get(`${API_URL}/auth/logout-url`, () => {
        logoutUrlRequested = true;
        return HttpResponse.json({
          url: END_SESSION_URL,
          postLogoutRedirectUri: 'https://app.example.com',
        });
      }),
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.user).toBeNull();
    expect(localStorage.getItem('access_token')).toBeNull();
    expect(logoutUrlRequested).toBe(false);
  });

  it('finishes loading with no user when no token exists', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.user).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('handleCallback: exchanges code for tokens and fetches profile', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.handleCallback('test-auth-code', 'test-state');
    });

    expect(result.current.user).toEqual(mockUser);
    expect(result.current.isAuthenticated).toBe(true);
    expect(localStorage.getItem('access_token')).toBe('fake-id-token-67890');
  });

  it('handleCallback: prefers id_token over access_token', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.handleCallback('test-auth-code', 'test-state');
    });

    expect(localStorage.getItem('access_token')).toBe('fake-id-token-67890');
  });

  it('handleCallback: falls back to access_token when no id_token', async () => {
    server.use(
      http.get(`${API_URL}/auth/callback`, () => {
        return HttpResponse.json({
          access_token: 'fallback-access-token',
          id_token: null,
        });
      }),
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.handleCallback('test-auth-code', 'test-state');
    });

    expect(localStorage.getItem('access_token')).toBe('fallback-access-token');
  });

  it('handleCallback: throws on API failure', async () => {
    server.use(
      http.get(`${API_URL}/auth/callback`, () => {
        return new HttpResponse(null, { status: 500 });
      }),
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await expect(
      act(async () => {
        await result.current.handleCallback('bad-code', 'test-state');
      }),
    ).rejects.toThrow();
  });

  describe('logout', () => {
    const originalLocation = window.location;
    let assign: ReturnType<typeof vi.fn>;
    let location: { assign: typeof assign; href: string };

    beforeEach(() => {
      assign = vi.fn();
      location = { assign, href: 'http://localhost/dashboard' };
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: location,
      });
    });

    afterEach(() => {
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: originalLocation,
      });
      localStorage.clear();
    });

    async function renderSignedIn(token: string) {
      localStorage.setItem('access_token', token);
      const hook = renderHook(() => useAuth(), { wrapper });
      await waitFor(() => {
        expect(hook.result.current.isAuthenticated).toBe(true);
      });
      return hook;
    }

    it('clears the local session and sends the browser to the Authentik end-session URL', async () => {
      let authHeader: string | null = 'unset';
      server.use(
        http.get(`${API_URL}/auth/logout-url`, ({ request }) => {
          authHeader = request.headers.get('Authorization');
          return HttpResponse.json({
            url: END_SESSION_URL,
            postLogoutRedirectUri: 'https://app.example.com',
          });
        }),
      );
      const { result } = await renderSignedIn(ID_TOKEN);

      await act(async () => {
        await result.current.logout();
      });

      expect(result.current.user).toBeNull();
      expect(localStorage.getItem('access_token')).toBeNull();
      // The ID token must not reach our API.
      expect(authHeader).toBeNull();

      expect(assign).toHaveBeenCalledTimes(1);
      const target = new URL(assign.mock.calls[0][0] as string);
      expect(`${target.origin}${target.pathname}`).toBe(END_SESSION_URL);
      expect(target.searchParams.get('id_token_hint')).toBe(ID_TOKEN);
      expect(target.searchParams.get('post_logout_redirect_uri')).toBe(
        'https://app.example.com',
      );
    });

    it('omits id_token_hint and post_logout_redirect_uri when the stored token is not a JWT', async () => {
      server.use(
        http.get(`${API_URL}/auth/logout-url`, () =>
          HttpResponse.json({
            url: END_SESSION_URL,
            postLogoutRedirectUri: 'https://app.example.com',
          }),
        ),
      );
      const { result } = await renderSignedIn('opaque-access-token');

      await act(async () => {
        await result.current.logout();
      });

      expect(localStorage.getItem('access_token')).toBeNull();
      expect(assign).toHaveBeenCalledWith(END_SESSION_URL);
    });

    it('falls back to a local logout when the logout URL cannot be fetched', async () => {
      server.use(
        http.get(`${API_URL}/auth/logout-url`, () => {
          return new HttpResponse(null, { status: 500 });
        }),
      );
      const { result } = await renderSignedIn(ID_TOKEN);

      await act(async () => {
        await result.current.logout();
      });

      expect(result.current.user).toBeNull();
      expect(localStorage.getItem('access_token')).toBeNull();
      expect(assign).not.toHaveBeenCalled();
      expect(location.href).toBe('/');
    });

    it('deleteAccount deletes the user then ends the Authentik session', async () => {
      let deleted = false;
      server.use(
        http.delete(`${API_URL}/users/:id`, () => {
          deleted = true;
          return new HttpResponse(null, { status: 204 });
        }),
        http.get(`${API_URL}/auth/logout-url`, () =>
          HttpResponse.json({
            url: END_SESSION_URL,
            postLogoutRedirectUri: 'https://app.example.com',
          }),
        ),
      );
      const { result } = await renderSignedIn(ID_TOKEN);

      await act(async () => {
        await result.current.deleteAccount();
      });

      expect(deleted).toBe(true);
      expect(localStorage.getItem('access_token')).toBeNull();
      const target = new URL(assign.mock.calls[0][0] as string);
      expect(target.searchParams.get('id_token_hint')).toBe(ID_TOKEN);
    });
  });
});
