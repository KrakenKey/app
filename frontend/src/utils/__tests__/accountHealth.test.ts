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
  expiryTimeline,
  fleetCounts,
  renewalWindowDays,
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
      // Days left order items within a severity; undated ones come last.
      ['cert-2', 'critical'],
      ['cert-1', 'critical'],
      ['cert-3', 'warning'],
    ]);
    expect(items[0].summary).toBe('Expires in 5 days, auto-renew is off');
    expect(items[0].action).toEqual({ kind: 'renew', certId: 2 });
    expect(items[1].action).toEqual({ kind: 'retry', certId: 1 });
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

describe('renewal window', () => {
  it('is 5 days on Free and 30 on paid or unknown plans', () => {
    expect(renewalWindowDays('free')).toBe(5);
    expect(renewalWindowDays('team')).toBe(30);
    expect(renewalWindowDays(undefined)).toBe(30);
  });

  it('skips certificates whose automatic renewal is scheduled', () => {
    const items = computeAttention({
      ...empty,
      plan: 'free',
      certs: [
        // renewAfter still ahead: KrakenKey has it
        cert({ id: 1, expiresAt: inDays(20.5), renewAfter: inDays(15.5) }),
        // no renewAfter, outside the Free window
        cert({ id: 2, expiresAt: inDays(20.5), renewAfter: null }),
        // no renewAfter, inside the Free window
        cert({ id: 3, expiresAt: inDays(4.5), renewAfter: null }),
        // renewAfter passed and still not renewed
        cert({ id: 4, expiresAt: inDays(12.5), renewAfter: inDays(-1) }),
      ],
    });
    expect(items.map((i) => [i.id, i.severity, i.summary])).toEqual([
      ['cert-3', 'critical', 'Expires in 4 days, renewal has not started'],
      ['cert-4', 'warning', 'Expires in 12 days, renewal has not started'],
    ]);
  });

  it('sends connector-managed certificates to the connectors page', () => {
    const [item] = computeAttention({
      ...empty,
      certs: [
        cert({
          id: 7,
          managedBy: 'connector',
          autoRenew: false,
          expiresAt: inDays(10.5),
          renewAfter: inDays(-20),
        }),
      ],
    });
    expect(item.summary).toBe(
      'Expires in 10 days, the connector has not renewed it',
    );
    expect(item.action).toBeUndefined();
    expect(item.to).toBe('/dashboard/connectors');
  });
});

describe('ordering and actions', () => {
  it('orders by severity, then by days left', () => {
    const items = computeAttention({
      ...empty,
      certs: [
        cert({ id: 1, expiresAt: inDays(25.5) }),
        cert({ id: 2, expiresAt: inDays(12.5) }),
        cert({ id: 3, expiresAt: inDays(3.5) }),
      ],
      domains: [
        { id: 'd1', hostname: 'a.example', isVerified: false } as Domain,
      ],
    });
    expect(items.map((i) => i.id)).toEqual([
      'cert-3',
      'cert-2',
      'cert-1',
      'dom-d1',
    ]);
  });

  it('offers a scan for unreachable endpoints and names stale probes', () => {
    const items = computeAttention({
      ...empty,
      endpoints: [endpoint({ port: 8443 })],
      latestResults: {
        ep1: [scan({ connectionSuccess: false, connectionError: 'timeout' })],
      },
      probes: [
        {
          id: 'p1',
          name: 'lan-probe',
          mode: 'connected',
          status: 'stale',
          lastSeenAt: inDays(-1),
        },
      ],
    });
    expect(items[0]).toMatchObject({
      title: 'app.example.com:8443',
      summary: 'Unreachable',
      detail: 'timeout',
      action: { kind: 'scan', endpointId: 'ep1' },
    });
    expect(items[1]).toMatchObject({
      kind: 'Probe',
      area: 'endpoints',
      summary: 'Offline, last reported 1 day ago',
    });
  });
});

describe('expiryTimeline', () => {
  it('lists live certificates inside the horizon, soonest first', () => {
    const rows = expiryTimeline(
      [
        cert({ id: 1, expiresAt: inDays(60.5), renewAfter: inDays(30.5) }),
        cert({ id: 2, expiresAt: inDays(5.5), autoRenew: false }),
        cert({ id: 3, expiresAt: inDays(120) }),
        cert({
          id: 4,
          status: 'renewing' as TlsCert['status'],
          expiresAt: inDays(19.5),
        }),
        cert({
          id: 5,
          status: 'revoked' as TlsCert['status'],
          expiresAt: inDays(10),
        }),
      ],
      90,
      NOW,
    );
    expect(rows.map((r) => [r.id, r.days, r.renewInDays, r.renewing])).toEqual([
      [2, 5, null, false],
      [4, 19, null, true],
      [1, 60, 30, false],
    ]);
  });

  it('marks a scheduled renewal only when it is ahead of expiry', () => {
    const [row] = expiryTimeline(
      [cert({ expiresAt: inDays(40.5), renewAfter: inDays(-2) })],
      90,
      NOW,
    );
    expect(row.renewInDays).toBeNull();
  });
});

describe('fleetCounts', () => {
  it('counts certificates, endpoint states, connectors and domains', () => {
    const f = fleetCounts({
      ...empty,
      certs: [
        cert({ id: 1, expiresAt: inDays(12.5) }),
        cert({ id: 2, expiresAt: inDays(4.5) }),
        cert({ id: 3, expiresAt: inDays(80) }),
        cert({ id: 4, status: 'failed' as TlsCert['status'] }),
        cert({ id: 5, status: 'renewing' as TlsCert['status'] }),
      ],
      endpoints: [
        endpoint({ id: 'a' }),
        endpoint({ id: 'b' }),
        endpoint({ id: 'c', isActive: false }),
      ],
      latestResults: {
        a: [scan({})],
        b: [scan({ connectionSuccess: false })],
      },
      connectors: [
        {
          id: 'c1',
          name: 'dc1',
          enrolledAt: inDays(-30),
          lastSeenAt: inDays(-3),
          revokedAt: null,
          deploymentSummary: { certificates: 1, targets: 2, failing: 1 },
        } as unknown as Connector,
        {
          id: 'c2',
          name: 'old',
          enrolledAt: inDays(-30),
          lastSeenAt: inDays(-3),
          revokedAt: inDays(-1),
        } as unknown as Connector,
      ],
      domains: [
        { id: 'd1', hostname: 'a.example', isVerified: true } as Domain,
        { id: 'd2', hostname: 'b.example', isVerified: false } as Domain,
      ],
    });
    expect(f.certs).toMatchObject({
      total: 5,
      issued: 3,
      renewing: 1,
      failed: 1,
    });
    expect(f.certs.expiring.map((e) => e.days)).toEqual([4, 12]);
    expect(f.endpoints).toEqual({
      total: 3,
      healthy: 1,
      expiring: 0,
      failing: 1,
      inactive: 1,
    });
    expect(f.connectors).toEqual({ total: 1, stale: 1, failingTargets: 1 });
    expect(f.domains).toEqual({ total: 2, pending: 1 });
  });
});
