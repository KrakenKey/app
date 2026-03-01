import type { Domain, TlsCert } from '@krakenkey/shared';

export const mockUser = {
  username: 'testuser',
  email: 'testuser@example.com',
  groups: ['users', 'admins'],
};

export const mockTokens = {
  access_token: 'fake-access-token-12345',
  id_token: 'fake-id-token-67890',
};

export const mockDomains: Domain[] = [
  {
    id: 'domain-1',
    hostname: 'example.com',
    verificationCode: 'krakenkey-verify=abc123def456',
    isVerified: true,
    userId: 'user-1',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-02T00:00:00.000Z',
  },
  {
    id: 'domain-2',
    hostname: 'unverified.com',
    verificationCode: 'krakenkey-verify=xyz789',
    isVerified: false,
    userId: 'user-1',
    createdAt: '2025-01-03T00:00:00.000Z',
    updatedAt: '2025-01-03T00:00:00.000Z',
  },
];

export const mockCerts: TlsCert[] = [
  {
    id: 1,
    rawCsr: '-----BEGIN CERTIFICATE REQUEST-----\nfake-csr\n-----END CERTIFICATE REQUEST-----',
    parsedCsr: {
      subject: [{ name: 'commonName', shortName: 'CN', value: 'example.com' }],
      attributes: [],
      publicKey: { keyType: 'ECDSA', bitLength: 384, curve: 'P-384' },
      extensions: [
        {
          name: 'subjectAltName',
          altNames: [
            { type: 2, value: 'example.com' },
            { type: 2, value: 'www.example.com' },
          ],
        },
      ],
    },
    crtPem: '-----BEGIN CERTIFICATE-----\nfake-cert-pem\n-----END CERTIFICATE-----',
    status: 'issued',
    expiresAt: '2026-01-01T00:00:00.000Z',
    lastRenewedAt: null,
    autoRenew: true,
    renewalCount: 0,
    lastRenewalAttemptAt: null,
    revocationReason: null,
    revokedAt: null,
    createdAt: '2025-01-01T00:00:00.000Z',
    userId: 'user-1',
  },
  {
    id: 2,
    rawCsr: '-----BEGIN CERTIFICATE REQUEST-----\nfake-csr-2\n-----END CERTIFICATE REQUEST-----',
    parsedCsr: {
      subject: [{ name: 'commonName', shortName: 'CN', value: 'pending.com' }],
      attributes: [],
      publicKey: { keyType: 'ECDSA', bitLength: 384, curve: 'P-384' },
      extensions: [],
    },
    crtPem: null,
    status: 'pending',
    expiresAt: null,
    lastRenewedAt: null,
    autoRenew: true,
    renewalCount: 0,
    lastRenewalAttemptAt: null,
    revocationReason: null,
    revokedAt: null,
    createdAt: '2025-01-05T00:00:00.000Z',
    userId: 'user-1',
  },
];

export const mockApiKey = 'kk_fake_api_key_abcdef123456';
