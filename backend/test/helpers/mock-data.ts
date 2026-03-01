/** Centralised mock data for e2e tests. */

// ── User ────────────────────────────────────────────────────────────────────
export const MOCK_USER = {
  userId: 'test-user-123',
  username: 'testuser',
  email: 'test@example.com',
};

// ── Domains ─────────────────────────────────────────────────────────────────
export const MOCK_DOMAIN = {
  id: 'domain-uuid-1',
  hostname: 'example.com',
  verificationCode: 'krakenkey-site-verification=abc123',
  isVerified: false,
  userId: MOCK_USER.userId,
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
};

export const MOCK_VERIFIED_DOMAIN = {
  ...MOCK_DOMAIN,
  isVerified: true,
  updatedAt: '2025-01-02T00:00:00.000Z',
};

// ── TLS Certificates ────────────────────────────────────────────────────────
export const MOCK_CSR_PEM =
  '-----BEGIN CERTIFICATE REQUEST-----\nMIIBkTCB+wIBADBSMQswCQYDVQQGEwJVUzELMAkGA1UECAwCQ0ExFDASBgNVBAcM\nC0xvcyBBbmdlbGVzMSAwHgYDVQQKDBdFeGFtcGxlIE9yZ2FuaXphdGlvbjBZMBMG\nByqGSM49AgEGCCqGSM49AwEHA0IABJZlUHI0up/l3eZf9vCBb+lInoEMEgc7Ro8r\nYB4MME3FtSMTRyKhz9OPGq0GYme5MBVxOJkq7sJJbEPGZILYcUagPzA9BgkqhkiG\n9w0BCQ4xMDAuMCwGA1UdEQQlMCOCEGV4YW1wbGUuY29tgQ90ZXN0QGV4YW1wbGUu\nY29tMAoGCCqGSM49BAMCA0gAMEUCIFnT\n-----END CERTIFICATE REQUEST-----';

export const MOCK_TLS_CERT = {
  id: 1,
  rawCsr: MOCK_CSR_PEM,
  parsedCsr: { commonName: 'example.com' },
  crtPem: null,
  status: 'pending',
  expiresAt: null,
  lastRenewedAt: null,
  createdAt: '2025-01-01T00:00:00.000Z',
  userId: MOCK_USER.userId,
};

export const MOCK_ISSUED_CERT = {
  ...MOCK_TLS_CERT,
  status: 'issued',
  crtPem:
    '-----BEGIN CERTIFICATE-----\nMIIBkTCB+wIBADBSMQswCQYDVQQGEwJVUzELMAkGA1UECAwCQ0E=\n-----END CERTIFICATE-----',
  expiresAt: '2026-01-01T00:00:00.000Z',
};

export const MOCK_FAILED_CERT = {
  ...MOCK_TLS_CERT,
  status: 'failed',
};

export const MOCK_REVOKED_CERT = {
  ...MOCK_ISSUED_CERT,
  status: 'revoked',
  revokedAt: '2025-06-01T00:00:00.000Z',
  revocationReason: 0,
};

// ── Auth helpers ────────────────────────────────────────────────────────────
/**
 * Build a fake JWT whose payload the throttler can decode for user tracking.
 * The signature is invalid — this is only useful when the auth guard is mocked.
 */
export function createFakeJwt(sub: string): string {
  const payload = Buffer.from(JSON.stringify({ sub })).toString('base64url');
  return `eyJhbGciOiJSUzI1NiJ9.${payload}.fake`;
}
