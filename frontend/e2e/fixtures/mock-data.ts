/* ── Billing ────────────────────────────────────────────────────────────── */

export const freeSub = {
  id: 'sub_free',
  plan: 'free',
  status: 'active',
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  organizationId: null,
  createdAt: '2025-01-01T00:00:00.000Z',
};

export const starterSub = {
  ...freeSub,
  id: 'sub_starter',
  plan: 'starter',
  currentPeriodEnd: '2026-04-20T00:00:00.000Z',
};

export const teamSub = {
  ...freeSub,
  id: 'sub_team',
  plan: 'team',
  currentPeriodEnd: '2026-04-20T00:00:00.000Z',
};

export const cancelingSub = {
  ...starterSub,
  cancelAtPeriodEnd: true,
};

export const upgradePreview = {
  immediateAmountCents: 4200,
  currency: 'usd',
  targetPlan: 'team' as const,
  currentPeriodEnd: '2026-04-20T00:00:00.000Z',
};

/* ── Organizations ─────────────────────────────────────────────────────── */

export const mockOrg = {
  id: 'org_001',
  name: 'Acme Corp',
  ownerId: 'usr_test_001',
  plan: 'team',
  createdAt: '2025-06-01T00:00:00.000Z',
  members: [
    {
      id: 'usr_test_001',
      username: 'testuser',
      email: 'test@example.com',
      displayName: 'Test User',
      role: 'owner' as const,
    },
    {
      id: 'usr_member_002',
      username: 'janedoe',
      email: 'jane@example.com',
      displayName: 'Jane Doe',
      role: 'admin' as const,
    },
    {
      id: 'usr_member_003',
      username: 'bobsmith',
      email: 'bob@example.com',
      displayName: 'Bob Smith',
      role: 'member' as const,
    },
  ],
};

/* ── Domains ───────────────────────────────────────────────────────────── */

export const mockDomains = [
  {
    id: 'dom_001',
    hostname: 'example.com',
    isVerified: true,
    verificationCode: 'kk-verify-abc123',
    userId: 'usr_test_001',
    createdAt: '2025-02-01T00:00:00.000Z',
    verifiedAt: '2025-02-02T00:00:00.000Z',
  },
  {
    id: 'dom_002',
    hostname: 'staging.example.com',
    isVerified: false,
    verificationCode: 'kk-verify-def456',
    userId: 'usr_test_001',
    createdAt: '2025-03-01T00:00:00.000Z',
    verifiedAt: null,
  },
];

/* ── Certificates ──────────────────────────────────────────────────────── */

export const mockCertificates = [
  {
    id: 'cert_001',
    commonName: 'example.com',
    status: 'issued',
    domains: ['example.com'],
    expiresAt: '2026-06-01T00:00:00.000Z',
    autoRenew: true,
    renewalCount: 0,
    pem: '-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----',
    createdAt: '2025-03-01T00:00:00.000Z',
    lastRenewedAt: null,
    revokedAt: null,
  },
  {
    id: 'cert_002',
    commonName: 'staging.example.com',
    status: 'failed',
    domains: ['staging.example.com'],
    expiresAt: null,
    autoRenew: false,
    renewalCount: 0,
    pem: null,
    createdAt: '2025-03-15T00:00:00.000Z',
    lastRenewedAt: null,
    revokedAt: null,
  },
];

/* ── Org-Aware User Overrides ──────────────────────────────────────────── */

export const orgOwnerUser = {
  plan: 'team',
  organizationId: 'org_001',
  role: 'owner' as const,
  resourceCounts: { domains: 12, certificates: 8, apiKeys: 6 },
};

export const orgMemberUser = {
  id: 'usr_member_002',
  username: 'janedoe',
  email: 'jane@example.com',
  displayName: 'Jane Doe',
  plan: 'team',
  organizationId: 'org_001',
  role: 'member' as const,
  resourceCounts: { domains: 12, certificates: 8, apiKeys: 6 },
};

export const dissolvingOrg = {
  ...mockOrg,
  status: 'dissolving' as const,
};

export const paidUserSub = {
  ...starterSub,
  cancelAtPeriodEnd: false,
};

export const canceledPaidSub = {
  ...starterSub,
  cancelAtPeriodEnd: true,
};

/* ── Cross-Member Domains (for org visibility tests) ──────────────────── */

export const orgMixedDomains = [
  ...mockDomains,
  {
    id: 'dom_003',
    hostname: 'other-member.io',
    isVerified: true,
    verificationCode: 'kk-verify-xyz789',
    userId: 'usr_member_003',
    createdAt: '2025-04-01T00:00:00.000Z',
    verifiedAt: '2025-04-02T00:00:00.000Z',
  },
];

/* ── API Keys ──────────────────────────────────────────────────────────── */

export const mockApiKeys = [
  {
    id: 'key_001',
    name: 'ci-deploy',
    createdAt: '2025-01-15T00:00:00.000Z',
    expiresAt: '2026-01-15T00:00:00.000Z',
  },
  {
    id: 'key_002',
    name: 'local-dev',
    createdAt: '2025-02-01T00:00:00.000Z',
    expiresAt: null,
  },
];
