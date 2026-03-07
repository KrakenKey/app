import React, { createContext, useContext, useState, useEffect } from 'react';
import api from '../services/api';
import axios from 'axios';
import type { User, AuthCallbackResponse } from '@krakenkey/shared';

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  login: () => void;
  register: () => void;
  logout: () => void;
  handleCallback: (code: string) => Promise<void>;
  deleteAccount: () => Promise<void>;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

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
export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Auto-login: check if token exists and is still valid
  useEffect(() => {
    const checkAuth = async () => {
      const token = localStorage.getItem('access_token');
      console.log("Auth check: token exists in localStorage:", !!token);
      if (token) {
        try {
          console.log("Validating token with /auth/profile");
          const response = await api.get('/auth/profile');
          console.log("Token valid, user authenticated:", response.data.email);
          setUser(response.data);
        } catch (error) {
          console.error("Token validation failed, logging out", error);
          logout();
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
  const handleCallback = async (code: string) => {
    try {
      setIsLoading(true);
      console.log("OAuth callback: exchanging code for tokens");

      const response = await api.get<AuthCallbackResponse>(`/auth/callback?code=${code}`);
      console.log("Received response from /auth/callback");

      const { access_token, id_token } = response.data;
      console.log("Tokens received:", {
        has_access_token: !!access_token,
        has_id_token: !!id_token
      });

      // Prefer id_token because it's always a JWT with user claims.
      // access_token might be opaque or have a different audience.
      const tokenToUse = id_token || access_token;

      if (tokenToUse) {
        console.log("Using token type:", tokenToUse === id_token ? "id_token" : "access_token");

        localStorage.setItem('access_token', tokenToUse);
        console.log("Token saved to localStorage");

        console.log("Fetching user profile");
        const userRes = await api.get('/auth/profile');
        console.log("Profile received:", userRes.data.email);

        setUser(userRes.data);
        console.log("Authentication complete");
      } else {
        console.error("No token received from callback");
      }
    } catch (error) {
      console.error("Login failed:", error);
      if (axios.isAxiosError(error)) {
        console.error("Response data:", error.response?.data);
        console.error("Response status:", error.response?.status);
      }
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Logs out by clearing token from localStorage and resetting state.
   *
   * Note: This does NOT invalidate the token at Authentik (stateless JWT).
   * The token will remain valid until it expires.
   */
  const logout = () => {
    localStorage.removeItem('access_token');
    setUser(null);
    window.location.href = '/';
  };

  const deleteAccount = async () => {
    if (!user) return;
    await api.delete(`/users/${user.id}`);
    logout();
  };

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, login, register, logout, handleCallback, deleteAccount, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
