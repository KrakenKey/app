export const API_ROUTES = {
  AUTH: {
    LOGIN: '/auth/login',
    REGISTER: '/auth/register',
    PROFILE: '/auth/profile',
    CALLBACK: '/auth/callback',
    LOGOUT_URL: '/auth/logout-url',
    CONFIRM_AUTO_RENEWAL: '/auth/confirm-auto-renewal',
    GITHUB_OIDC: '/auth/github-oidc',
    GITHUB_OIDC_TRUSTS: '/auth/github-oidc/trusts',
    GITHUB_OIDC_TRUST_BY_ID: (id: string) => `/auth/github-oidc/trusts/${id}`,
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
    DETAILS: (id: string) => `/certs/tls/${id}/details`,
  },
  API_KEYS: {
    BASE: '/auth/api-keys',
    BY_ID: (id: string) => `/auth/api-keys/${id}`,
  },
  DEVICE_AUTH: {
    CODE: '/auth/device/code',
    TOKEN: '/auth/device/token',
    REQUEST: (userCode: string) =>
      `/auth/device/${encodeURIComponent(userCode)}`,
    APPROVE: '/auth/device/approve',
    DENY: '/auth/device/deny',
  },
  ENDPOINTS: {
    BASE: '/endpoints',
    BY_ID: (id: string) => `/endpoints/${id}`,
    REGIONS: (id: string) => `/endpoints/${id}/regions`,
    REGION: (id: string, region: string) =>
      `/endpoints/${id}/regions/${region}`,
    RESULTS: (id: string) => `/endpoints/${id}/results`,
    PROBES_MINE: '/endpoints/probes/mine',
    PROBES: (id: string) => `/endpoints/${id}/probes`,
    PROBE: (id: string, probeId: string) =>
      `/endpoints/${id}/probes/${probeId}`,
    SCAN: (id: string) => `/endpoints/${id}/scan`,
    EXPORT_RESULTS: (id: string) => `/endpoints/${id}/results/export`,
    LATEST_RESULTS: (id: string) => `/endpoints/${id}/results/latest`,
  },
  BILLING: {
    CHECKOUT: '/billing/checkout',
    SUBSCRIPTION: '/billing/subscription',
    PORTAL: '/billing/portal',
    WEBHOOK: '/billing/webhook',
    UPGRADE_PREVIEW: '/billing/upgrade/preview',
    UPGRADE: '/billing/upgrade',
  },
  ORGANIZATIONS: {
    BASE: '/organizations',
    BY_ID: (id: string) => `/organizations/${id}`,
    MEMBERS: (id: string) => `/organizations/${id}/members`,
    MEMBER: (id: string, userId: string) =>
      `/organizations/${id}/members/${userId}`,
    TRANSFER_OWNERSHIP: (id: string) =>
      `/organizations/${id}/transfer-ownership`,
  },
  NOTIFICATION_CHANNELS: {
    BASE: '/notifications/channels',
    BY_ID: (id: string) => `/notifications/channels/${id}`,
    TEST: (id: string) => `/notifications/channels/${id}/test`,
    ROTATE_SECRET: (id: string) =>
      `/notifications/channels/${id}/rotate-secret`,
  },
  PUBLIC_SCAN: {
    SCAN: '/public-scan',
  },
  REPORTS: {
    BASE: '/reports',
    BY_ID: (id: string) => `/reports/${id}`,
    SHARE: (id: string) => `/reports/${id}/share`,
    EXPORT: (id: string) => `/reports/${id}/export`,
    PUBLIC: (token: string) => `/public/reports/${encodeURIComponent(token)}`,
    PUBLIC_EXPORT: (token: string) =>
      `/public/reports/${encodeURIComponent(token)}/export`,
  },
} as const;
