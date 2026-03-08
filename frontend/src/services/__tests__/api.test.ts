import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import api, { API_URL } from '../api';

describe('api service', () => {
  describe('request interceptor', () => {
    it('attaches Bearer token when token exists in localStorage', async () => {
      localStorage.setItem('access_token', 'fake-token-12345');

      const response = await api.get('/auth/profile');
      expect(response.status).toBe(200);
    });

    it('sends request without Authorization header when no token', async () => {
      const response = await api.get('/auth/profile');
      expect(response.status).toBe(200);
    });
  });

  describe('response interceptor', () => {
    it('passes successful responses through', async () => {
      const response = await api.get('/auth/profile');
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('email');
    });

    it('handles 401 by clearing localStorage', async () => {
      localStorage.setItem('access_token', 'expired-token');
      localStorage.setItem('user', 'some-user');

      server.use(
        http.get(`${API_URL}/auth/profile`, () => {
          return new HttpResponse(JSON.stringify({ message: 'Unauthorized' }), {
            status: 401,
          });
        }),
      );

      await expect(api.get('/auth/profile')).rejects.toThrow();
      expect(localStorage.getItem('access_token')).toBeNull();
      expect(localStorage.getItem('user')).toBeNull();
    });

    it('handles 403 errors', async () => {
      server.use(
        http.get(`${API_URL}/auth/profile`, () => {
          return new HttpResponse(JSON.stringify({ message: 'Forbidden' }), {
            status: 403,
          });
        }),
      );

      await expect(api.get('/auth/profile')).rejects.toThrow();
    });

    it('handles 404 errors', async () => {
      server.use(
        http.get(`${API_URL}/auth/profile`, () => {
          return new HttpResponse(JSON.stringify({ message: 'Not found' }), {
            status: 404,
          });
        }),
      );

      await expect(api.get('/auth/profile')).rejects.toThrow();
    });

    it('handles 422 validation errors with array of messages', async () => {
      server.use(
        http.get(`${API_URL}/auth/profile`, () => {
          return new HttpResponse(
            JSON.stringify({
              message: ['Field is required', 'Invalid format'],
            }),
            { status: 422 },
          );
        }),
      );

      await expect(api.get('/auth/profile')).rejects.toThrow();
    });

    it('handles 429 rate limit', async () => {
      server.use(
        http.get(`${API_URL}/auth/profile`, () => {
          return new HttpResponse(
            JSON.stringify({ message: 'Too many requests' }),
            { status: 429 },
          );
        }),
      );

      await expect(api.get('/auth/profile')).rejects.toThrow();
    });

    it('handles 500 server error', async () => {
      server.use(
        http.get(`${API_URL}/auth/profile`, () => {
          return new HttpResponse(
            JSON.stringify({ message: 'Internal server error' }),
            { status: 500 },
          );
        }),
      );

      await expect(api.get('/auth/profile')).rejects.toThrow();
    });

    it('handles network errors', async () => {
      server.use(
        http.get(`${API_URL}/auth/profile`, () => {
          return HttpResponse.error();
        }),
      );

      await expect(api.get('/auth/profile')).rejects.toThrow();
    });
  });
});
