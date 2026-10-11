import type {
  Connector,
  Domain,
  Endpoint,
  ProbeScanResult,
  TlsCert,
} from '@krakenkey/shared';
import { mockCerts } from '../../test/mocks/data';
import {
  computeAttention,
  countByArea,
  summarizeEndpoint,
} from '../accountHealth';

const NOW = new Date('2026-10-11T14:30:00Z').getTime();
const DAY = 86_400_000;
const inDays = (d: number) => new Date(NOW + d * DAY).toISOString();

const cert = (over: Partial<TlsCert>): TlsCert => ({
  ...mockCerts[0],
  ...over,
});

const endpoint = (over: Partial<Endpoint>): Endpoint => ({
  id: 'ep1',
  userId: 'u',
  host: 'app.example.com',
  port: 443,
  isActive: true,
  createdAt: inDays(-10),
  updatedAt: inDays(-10),
  ...over,
});

const scan = (over: Partial<ProbeScanResult>): ProbeScanResult => ({
  id: 's',
  probeId: 'p',
  host: 'app.example.com',
  port: 443,
  connectionSuccess: true,
  certTrusted: true,
  certDaysUntilExpiry: 60,
  scannedAt: inDays(0),
  createdAt: inDays(0),
  ...over,
});

const empty = {
  certs: [] as TlsCert[],
  endpoints: [] as Endpoint[],
  latestResults: {} as Record<string, ProbeScanResult[]>,
  probes: [],
  connectors: [] as Connector[],
  domains: [] as Domain[],
  now: NOW,
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe('summarizeEndpoint', () => {
  it('ranks unreachable over untrusted over expiring', () => {
    const ep = endpoint({});
    expect(
      summarizeEndpoint(ep, [
        scan({ certTrusted: false }),
        scan({ connectionSuccess: false, connectionError: 'timeout' }),
      ]).state,
    ).toBe('unreachable');
    expect(summarizeEndpoint(ep, [scan({ certTrusted: false })]).state).toBe(
      'untrusted',
    );
    expect(
      summarizeEndpoint(ep, [scan({ certDaysUntilExpiry: 12 })]).state,
    ).toBe('expiring');
    expect(summarizeEndpoint(ep, [scan({})]).state).toBe('healthy');
    expect(summarizeEndpoint(ep, []).state).toBe('unscanned');
    expect(
      summarizeEndpoint(endpoint({ isActive: false }), [scan({})]).state,
    ).toBe('disabled');
  });
});

describe('computeAttention', () => {
  it('flags failed and soon-expiring certificates by severity', () => {
    const items = computeAttention({
      ...empty,
      certs: [
        cert({ id: 1, status: 'failed' as TlsCert['status'] }),
        cert({ id: 2, expiresAt: inDays(5.5), autoRenew: false }),
        cert({ id: 3, expiresAt: inDays(20.5) }),
        cert({ id: 4, expiresAt: inDays(80) }),
      ],
    });
    expect(items.map((i) => [i.id, i.severity])).toEqual([
      ['cert-1', 'critical'],
      ['cert-2', 'critical'],
      ['cert-3', 'warning'],
    ]);
    expect(items[1].detail).toBe('Expires in 5 days. Auto-renew is off.');
  });

  it('lists an expiring endpoint once when a certificate covers it', () => {
    const items = computeAttention({
      ...empty,
      certs: [cert({ expiresAt: inDays(12.5) })],
      endpoints: [endpoint({ host: 'example.com' })],
      latestResults: { ep1: [scan({ certDaysUntilExpiry: 12 })] },
    });
    expect(items.map((i) => i.area)).toEqual(['certificates']);
  });

  it('flags untrusted endpoints, stale connectors and pending domains', () => {
    const items = computeAttention({
      ...empty,
      endpoints: [endpoint({})],
      latestResults: {
        ep1: [scan({ certTrusted: false, certIssuer: 'CN=internal-ca' })],
      },
      connectors: [
        {
          id: 'c1',
          name: 'dc1',
          enrolledAt: inDays(-30),
          lastSeenAt: inDays(-3),
          revokedAt: null,
          enrollmentTokenExpiresAt: null,
          deploymentSummary: { certificates: 1, targets: 2, failing: 1 },
        } as unknown as Connector,
      ],
      domains: [
        { id: 'd1', hostname: 'new.example', isVerified: false } as Domain,
      ],
    });
    expect(items.map((i) => `${i.id}:${i.severity}`)).toEqual([
      'ep-ep1:critical',
      'con-c1-failing:critical',
      'con-c1-stale:warning',
      'dom-d1:warning',
    ]);
    expect(items[0].detail).toContain('internal-ca');
    expect(countByArea(items)).toMatchObject({
      endpoints: { count: 1, severity: 'critical' },
      connectors: { count: 2, severity: 'critical' },
      domains: { count: 1, severity: 'warning' },
      certificates: { count: 0, severity: null },
    });
  });
});
