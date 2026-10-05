import React, { createContext, useState, useEffect } from 'react';
import api from '../services/api';
import axios from 'axios';
import { API_ROUTES } from '@krakenkey/shared';
import type {
  User,
  AuthCallbackResponse,
  LogoutUrlResponse,
} from '@krakenkey/shared';

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  login: () => void;
  register: () => void;
  logout: () => Promise<void>;
  handleCallback: (code: string, state: string | null) => Promise<void>;
  deleteAccount: () => Promise<void>;
  refreshUser: () => Promise<void>;
  isLoading: boolean;
}

export const AuthContext = createContext<AuthContextType | undefined>(
  undefined,
);

/**
 * True when the token looks like a JWT (three segments, JSON header with alg,
 * JSON payload with iss and aud). Authentik shows an error page instead of
 * logging out if id_token_hint can't be decoded, so anything else is left out.
 */
function looksLikeIdToken(token: string): boolean {
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  try {
    const decode = (segment: string) => {
      const b64 = segment.replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(
        atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '=')),
      ) as unknown;
    };
    const header = decode(parts[0]) as { alg?: unknown } | null;
    const payload = decode(parts[1]) as { iss?: unknown; aud?: unknown } | null;
    return (
      typeof header?.alg === 'string' &&
      typeof payload?.iss === 'string' &&
      payload.aud !== undefined
    );
  } catch {
    return false;
  }
}

/**
 * AuthProvider manages authentication state for the entire app.
 *
 * On mount, checks localStorage for existing token and validates it by calling
 * /auth/profile. If valid, the user is auto-logged in.
 *
 * Token storage:
 * We store id_token (not access_token) in localStorage because it's always a JWT
 * with user claims that the backend can validate.
 */
export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Auto-login: check if token exists and is still valid
  useEffect(() => {
    const checkAuth = async () => {
      const token = localStorage.getItem('access_token');
      console.log('Auth check: token exists in localStorage:', !!token);
      if (token) {
        try {
          console.log('Validating token with /auth/profile');
          const response = await api.get('/auth/profile');
          console.log('Token valid, user authenticated:', response.data.email);
          setUser(response.data);
        } catch (error) {
          console.error('Token validation failed, clearing session', error);
          // Local only: a stale token on page load should not send the
          // browser through Authentik's logout on every visit.
          clearSession();
        }
      }
      setIsLoading(false);
    };
    checkAuth();
  }, []);

  /**
   * Redirects user to the backend login endpoint to start the SSO flow.
   */
  const login = () => {
    window.location.href = `${api.defaults.baseURL}/auth/login`;
  };

  /**
   * Redirects user to the backend registration endpoint to start the SSO flow.
   */
  const register = () => {
    window.location.href = `${api.defaults.baseURL}/auth/register`;
  };

  /**
   * Exchanges OAuth authorization code for tokens.
   *
   * Flow:
   * 1. User returns from Authentik to /callback with code in URL
   * 2. Frontend calls backend /auth/callback with the code
   * 3. Backend exchanges code for access_token and id_token
   * 4. Frontend stores id_token in localStorage (always a JWT with user claims)
   * 5. Frontend calls /auth/profile to get user data
   */
  const handleCallback = async (code: string, state: string | null) => {
    try {
      setIsLoading(true);
      console.log('OAuth callback: exchanging code for tokens');

      const params = new URLSearchParams({ code });
      if (state) params.set('state', state);

      const response = await api.get<AuthCallbackResponse>(
        `/auth/callback?${params.toString()}`,
      );
      console.log('Received response from /auth/callback');

      const { access_token, id_token } = response.data;
      console.log('Tokens received:', {
        has_access_token: !!access_token,
        has_id_token: !!id_token,
      });

      // Prefer id_token because it's always a JWT with user claims.
      // access_token might be opaque or have a different audience.
      const tokenToUse = id_token || access_token;

      if (tokenToUse) {
        console.log(
          'Using token type:',
          tokenToUse === id_token ? 'id_token' : 'access_token',
        );

        localStorage.setItem('access_token', tokenToUse);
        console.log('Token saved to localStorage');

        console.log('Fetching user profile');
        const userRes = await api.get('/auth/profile');
        console.log('Profile received:', userRes.data.email);

        setUser(userRes.data);
        console.log('Authentication complete');
      } else {
        console.error('No token received from callback');
      }
    } catch (error) {
      console.error('Login failed:', error);
      if (axios.isAxiosError(error)) {
        console.error('Response data:', error.response?.data);
        console.error('Response status:', error.response?.status);
      }
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Forgets the token and user locally. Does not touch the Authentik session.
   */
  const clearSession = () => {
    localStorage.removeItem('access_token');
    setUser(null);
  };

  /**
   * Logs out locally and ends the Authentik SSO session (OIDC RP-initiated
   * logout), so the next "Log in" asks for credentials again.
   *
   * The local session is cleared first, so the user is logged out of the app
   * even if the rest fails. The ID token goes to Authentik as id_token_hint in
   * the browser redirect; it is not sent to our API (the token is already out
   * of localStorage when /auth/logout-url is fetched). If the logout URL
   * can't be fetched, falls back to a local-only logout.
   */
  const logout = async () => {
    const idToken = localStorage.getItem('access_token');
    clearSession();

    try {
      const { data } = await api.get<LogoutUrlResponse>(
        API_ROUTES.AUTH.LOGOUT_URL,
      );
      const url = new URL(data.url);
      // Authentik requires id_token_hint when post_logout_redirect_uri is
      // set, and errors on a hint it can't decode. Without a usable token,
      // send neither: the session still ends and Authentik shows its own
      // logged-out page.
      if (idToken && looksLikeIdToken(idToken)) {
        url.searchParams.set('id_token_hint', idToken);
        url.searchParams.set(
          'post_logout_redirect_uri',
          data.postLogoutRedirectUri,
        );
      }
      window.location.assign(url.toString());
    } catch (error) {
      console.error(
        'Could not end the SSO session, logging out locally',
        error,
      );
      window.location.href = '/';
    }
  };

  const deleteAccount = async () => {
    if (!user) return;
    await api.delete(`/users/${user.id}`);
    await logout();
  };

  const refreshUser = async () => {
    const response = await api.get('/auth/profile');
    setUser(response.data);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        login,
        register,
        logout,
        handleCallback,
        deleteAccount,
        refreshUser,
        isLoading,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
