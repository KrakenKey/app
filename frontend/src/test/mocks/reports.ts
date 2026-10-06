import type {
  PublicReport,
  Report,
  ReportHostResult,
  ReportListItem,
} from '@krakenkey/shared';

function host(over: Partial<ReportHostResult>): ReportHostResult {
  return {
    host: 'example.com',
    port: 443,
    status: 'complete',
    severity: 'ok',
    problems: [],
    reachable: true,
    error: null,
    tlsVersion: 'TLS 1.3',
    notAfter: '2026-12-20T00:00:00Z',
    daysLeft: 75,
    issuer: "CN=R11,O=Let's Encrypt,C=US",
    issuerName: "Let's Encrypt",
    subject: 'CN=example.com',
    sans: ['example.com'],
    hostnameCovered: true,
    trusted: true,
    chainDepth: 2,
    keyType: 'ECDSA',
    keySize: 256,
    letsEncrypt: true,
    scannedAt: '2026-10-05T00:00:00Z',
    ...over,
  };
}

export const mockReportHosts: ReportHostResult[] = [
  host({
    host: 'expired.example.com',
    severity: 'critical',
    daysLeft: -2,
    notAfter: '2026-10-03T00:00:00Z',
    problems: [
      {
        code: 'expired',
        severity: 'critical',
        message: 'Certificate expired on 2026-10-03T00:00:00Z',
      },
    ],
  }),
  host({
    host: 'soon.example.com',
    severity: 'warning',
    daysLeft: 6,
    issuerName: 'DigiCert Inc',
    letsEncrypt: false,
    problems: [
      {
        code: 'expires_soon',
        severity: 'warning',
        message: 'Expires in 6 days',
      },
    ],
  }),
  host({
    host: 'month.example.com',
    severity: 'notice',
    daysLeft: 25,
    problems: [
      {
        code: 'expires_within_30_days',
        severity: 'notice',
        message: 'Expires in 25 days',
      },
    ],
  }),
  host({ host: 'fine.example.com', daysLeft: 80 }),
];

const summary = {
  totalHosts: 4,
  scannedHosts: 4,
  counts: { critical: 1, warning: 1, notice: 1, ok: 1 },
  issuers: [
    { issuer: "Let's Encrypt", count: 3 },
    { issuer: 'DigiCert Inc', count: 1 },
  ],
  letsEncryptHosts: 3,
  earliestExpiry: {
    host: 'expired.example.com',
    port: 443,
    notAfter: '2026-10-03T00:00:00Z',
    daysLeft: -2,
  },
};

export const mockReport: Report = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Client sites',
  status: 'complete',
  hostCount: 4,
  completedCount: 4,
  share: null,
  createdAt: '2026-10-05T10:00:00Z',
  completedAt: '2026-10-05T10:01:00Z',
  expiresAt: '2027-01-03T10:00:00Z',
  summary,
  hosts: mockReportHosts,
};

export const mockReportListItem: ReportListItem = {
  id: mockReport.id,
  name: mockReport.name,
  status: 'complete',
  hostCount: 4,
  completedCount: 4,
  counts: summary.counts,
  share: null,
  createdAt: mockReport.createdAt,
  completedAt: mockReport.completedAt,
  expiresAt: mockReport.expiresAt,
};

export const mockPublicReport: PublicReport = {
  name: mockReport.name,
  status: 'complete',
  hostCount: 4,
  completedCount: 4,
  createdAt: mockReport.createdAt,
  completedAt: mockReport.completedAt,
  shareExpiresAt: '2026-11-04T10:00:00Z',
  summary,
  hosts: mockReportHosts,
};
