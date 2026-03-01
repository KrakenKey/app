export const API_ROUTES = {
  AUTH: {
    LOGIN: '/auth/login',
    REGISTER: '/auth/register',
    PROFILE: '/auth/profile',
    CALLBACK: '/auth/callback',
  },
  USERS: {
    BASE: '/users',
    BY_ID: (id: string) => `/users/${id}`,
  },
  DOMAINS: {
    BASE: '/domains',
    BY_ID: (id: string) => `/domains/${id}`,
    VERIFY: (id: string) => `/domains/${id}/verify`,
    DELETE: (id: string) => `/domains/${id}`,
  },
  TLS_CERTS: {
    BASE: '/certs/tls',
    BY_ID: (id: string) => `/certs/tls/${id}`,
    RENEW: (id: string) => `/certs/tls/${id}/renew`,
    RETRY: (id: string) => `/certs/tls/${id}/retry`,
    REVOKE: (id: string) => `/certs/tls/${id}/revoke`,
    DELETE: (id: string) => `/certs/tls/${id}`,
  },
  API_KEYS: {
    BASE: '/auth/api-keys',
    BY_ID: (id: string) => `/auth/api-keys/${id}`,
  },
} as const;
