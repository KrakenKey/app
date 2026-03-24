import { renderHook, act, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { AuthProvider } from '../AuthContext';
import { useAuth } from '../../hooks/useAuth';
import { mockUser } from '../../test/mocks/data';
import { API_URL } from '../../services/api';

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
});
