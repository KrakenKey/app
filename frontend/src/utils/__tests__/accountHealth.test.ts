import type {
  Connector,
  Domain,
  Endpoint,
  ProbeScanResult,
  TlsCert,
} from '@krakenkey/shared';
import { mockCerts } from '../../test/mocks/data';
import {
  areaLoadStates,
  balancePanels,
  certRenewal,
  computeAttention,
  countByArea,
  estimatePanelHeight,
  fleetCounts,
  greetingName,
  joinWords,
  loadFailures,
  renewalSchedule,
  renewalWindowDays,
  summarizeEndpoint,
  type HealthSource,
  type LoadState,
} from '../accountHealth';
import { connectorHealth, type ConnectorHealth } from '../connectors';
import { shortDate } from '../dates';

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
      'con-c1:critical',
      'dom-d1:warning',
    ]);
    expect(items[0].detail).toContain('internal-ca');
    // A failing, stale connector is one row with both reasons.
    expect(items[1].summary).toBe(
      '1 deployment target failing; last check-in 3 days ago',
    );
    expect(countByArea(items)).toMatchObject({
      endpoints: { count: 1, severity: 'critical' },
      connectors: { count: 1, severity: 'critical' },
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

describe('endpoints whose latest results did not load', () => {
  const input = {
    ...empty,
    endpoints: [
      endpoint({ id: 'a' }),
      endpoint({ id: 'b' }),
      endpoint({ id: 'c', isActive: false }),
    ],
    latestResults: { a: [scan({ connectionSuccess: false })] },
    resultsUnavailable: ['b', 'c'],
  };

  it('counts them as unknown, not healthy or inactive', () => {
    expect(fleetCounts(input).endpoints).toEqual({
      total: 3,
      healthy: 0,
      expiring: 0,
      failing: 1,
      inactive: 1,
      unknown: 1,
    });
  });

  it('lists no problem for them', () => {
    expect(computeAttention(input).map((i) => i.id)).toEqual(['ep-a']);
  });
});

describe('load state', () => {
  const all = (state: LoadState) =>
    ({
      certs: state,
      endpoints: state,
      latestResults: state,
      probes: state,
      connectors: state,
      domains: state,
    }) as Record<HealthSource, LoadState>;

  it('folds sources into areas', () => {
    expect(areaLoadStates(all('loaded'))).toEqual({
      certificates: 'loaded',
      endpoints: 'loaded',
      connectors: 'loaded',
      domains: 'loaded',
    });
    expect(
      areaLoadStates({ ...all('loaded'), connectors: 'failed' }).connectors,
    ).toBe('failed');
    // Endpoints loaded, but not all their latest results or the probes.
    expect(
      areaLoadStates({ ...all('loaded'), latestResults: 'partial' }).endpoints,
    ).toBe('partial');
    expect(
      areaLoadStates({ ...all('loaded'), latestResults: 'failed' }).endpoints,
    ).toBe('partial');
    expect(
      areaLoadStates({ ...all('loaded'), probes: 'failed' }).endpoints,
    ).toBe('partial');
    expect(
      areaLoadStates({ ...all('loaded'), probes: 'loading' }).endpoints,
    ).toBe('loading');
    expect(
      areaLoadStates({ ...all('failed'), probes: 'loaded' }).endpoints,
    ).toBe('failed');
  });

  it('names what could not be loaded', () => {
    expect(loadFailures(all('loaded'))).toEqual([]);
    expect(loadFailures(all('loading'))).toEqual([]);
    // Probes belong to the endpoints area, which already failed.
    expect(loadFailures(all('failed'))).toEqual([
      'certificates',
      'endpoints',
      'connectors',
      'domains',
    ]);
    expect(loadFailures({ ...all('loaded'), probes: 'failed' })).toEqual([
      'probes',
    ]);
    expect(
      loadFailures({ ...all('loaded'), latestResults: 'partial' }, 2),
    ).toEqual(['the latest scans for 2 endpoints']);
    expect(
      loadFailures({ ...all('loaded'), latestResults: 'partial' }, 1),
    ).toEqual(['the latest scan for 1 endpoint']);
  });

  it('joins words for a sentence', () => {
    expect(joinWords(['a'])).toBe('a');
    expect(joinWords(['a', 'b'])).toBe('a and b');
    expect(joinWords(['a', 'b', 'c'])).toBe('a, b and c');
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
        cert({ id: 6, status: 'revoked' as TlsCert['status'] }),
        cert({ id: 7, status: 'revoked' as TlsCert['status'] }),
        cert({ id: 8, status: 'awaiting_csr' as TlsCert['status'] }),
        cert({ id: 9, status: 'pending' as TlsCert['status'] }),
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
    // Live is issued + renewing + on the way; revoked and failed are not.
    expect(f.certs).toMatchObject({
      total: 9,
      live: 6,
      issued: 3,
      renewing: 1,
      inProgress: 2,
      failed: 1,
      revoked: 2,
    });
    expect(f.certs.expiring.map((e) => e.days)).toEqual([4, 12]);
    expect(f.endpoints).toEqual({
      total: 3,
      healthy: 1,
      expiring: 0,
      failing: 1,
      inactive: 1,
      unknown: 0,
    });
    expect(f.connectors).toEqual({ total: 1, stale: 1, failingTargets: 1 });
    expect(f.domains).toEqual({ total: 2, pending: 1 });
  });
});

/* The real account the Overview was checked against: 17 revoked, #21 with
   auto-renew off, #27-#30 managed by a connector with a failing target. */
const ciCerts = (): TlsCert[] => [
  ...Array.from({ length: 17 }, (_, i) =>
    cert({
      id: 3 + i,
      status: 'revoked' as TlsCert['status'],
      expiresAt: inDays(40 - i * 7),
      renewAfter: inDays(10 - i * 7),
    }),
  ),
  cert({
    id: 21,
    autoRenew: false,
    managedBy: null,
    expiresAt: inDays(84.3),
    renewAfter: inDays(54.3),
  }),
  ...[27, 28, 29, 30].map((id) =>
    cert({
      id,
      autoRenew: false,
      managedBy: 'connector',
      expiresAt: inDays(88.2 + (id - 27) * 0.2),
      renewAfter: inDays(57.6 + (id - 27) * 0.2),
    }),
  ),
];

const ciConnector = {
  id: 'c1',
  name: 'e2e-connector',
  clientLabel: 'e2e-client',
  allowedCertIds: [27, 28, 29, 30],
  enrolledAt: inDays(-2),
  lastSeenAt: inDays(-20 / 24),
  revokedAt: null,
  enrollmentTokenExpiresAt: null,
  deploymentSummary: { certificates: 2, targets: 2, failing: 1 },
} as unknown as Connector;

describe('certRenewal', () => {
  it('warns about auto-renew off at any distance from expiry', () => {
    const r = certRenewal(
      cert({ autoRenew: false, expiresAt: inDays(84.3) }),
      30,
      NOW,
    );
    expect(r).toMatchObject({ state: 'manual', severity: 'warning', days: 84 });
    expect(r?.renewAt).toBeNull();
  });

  it('is critical inside the renewal window, or 7 days on Free', () => {
    const manual = (d: number) =>
      cert({ autoRenew: false, expiresAt: inDays(d + 0.5) });
    expect(certRenewal(manual(30), 30, NOW)?.severity).toBe('critical');
    expect(certRenewal(manual(31), 30, NOW)?.severity).toBe('warning');
    expect(certRenewal(manual(7), 5, NOW)?.severity).toBe('critical');
    expect(certRenewal(manual(8), 5, NOW)?.severity).toBe('warning');
  });

  it('treats connector-managed certificates as automatic', () => {
    expect(
      certRenewal(
        cert({
          autoRenew: false,
          managedBy: 'connector',
          expiresAt: inDays(88),
          renewAfter: inDays(57),
        }),
        30,
        NOW,
      ),
    ).toMatchObject({ state: 'connector', severity: null, managed: true });
  });

  it('flags an overdue automatic renewal, and an expired certificate', () => {
    expect(
      certRenewal(
        cert({ expiresAt: inDays(12.5), renewAfter: inDays(-18) }),
        30,
        NOW,
      ),
    ).toMatchObject({ state: 'overdue', severity: 'warning' });
    expect(
      certRenewal(
        cert({ expiresAt: inDays(-1.5), renewAfter: inDays(-31) }),
        30,
        NOW,
      ),
    ).toMatchObject({ state: 'overdue', severity: 'critical' });
  });

  it('ignores anything that is not issued or renewing', () => {
    for (const status of ['revoked', 'revoking', 'failed', 'pending']) {
      expect(
        certRenewal(
          cert({
            status: status as TlsCert['status'],
            autoRenew: false,
            expiresAt: inDays(3),
          }),
          30,
          NOW,
        ),
      ).toBeNull();
    }
  });
});

describe('attention for a sparse account', () => {
  it('flags auto-renew off far from expiry, with a date and the id', () => {
    const items = computeAttention({
      ...empty,
      plan: 'starter',
      certs: ciCerts(),
      connectors: [ciConnector],
    });
    expect(items.map((i) => `${i.id}:${i.severity}`)).toEqual([
      'con-c1:critical',
      'cert-21:warning',
    ]);
    expect(items[1]).toMatchObject({
      title: 'example.com',
      ref: '#21',
      summary: `Auto-renew is off; it will expire on ${shortDate(inDays(84.3))}`,
      action: { kind: 'renew', certId: 21 },
    });
  });

  it('never lists revoked certificates', () => {
    const items = computeAttention({
      ...empty,
      certs: [
        cert({
          id: 9,
          status: 'revoked' as TlsCert['status'],
          autoRenew: false,
          expiresAt: inDays(2),
        }),
      ],
    });
    expect(items).toEqual([]);
  });
});

describe('renewalSchedule', () => {
  it('tells rows with the same name apart and names the connector', () => {
    const { rows, total } = renewalSchedule(ciCerts(), {
      plan: 'starter',
      connectors: [ciConnector],
      now: NOW,
    });
    // No revoked rows; the one needing attention first, then by renewal.
    expect(total).toBe(5);
    expect(rows.map((r) => [r.id, r.state, r.severity])).toEqual([
      [21, 'manual', 'warning'],
      [27, 'connector', null],
      [28, 'connector', null],
      [29, 'connector', null],
      [30, 'connector', null],
    ]);
    expect(rows[1]).toMatchObject({
      name: 'example.com',
      extraNames: 1,
      connectorName: 'e2e-connector',
      renewInDays: 57,
      days: 88,
    });
    expect(rows[0].renewInDays).toBeNull();
  });

  it('orders critical, warning, renewing, then scheduled by next step', () => {
    const { rows } = renewalSchedule(
      [
        cert({ id: 1, expiresAt: inDays(60.5), renewAfter: inDays(30.5) }),
        cert({ id: 2, expiresAt: inDays(50.5), renewAfter: inDays(20.5) }),
        cert({ id: 3, autoRenew: false, expiresAt: inDays(5.5) }),
        cert({ id: 4, autoRenew: false, expiresAt: inDays(70.5) }),
        cert({
          id: 5,
          status: 'renewing' as TlsCert['status'],
          expiresAt: inDays(19.5),
        }),
        cert({ id: 6, expiresAt: inDays(12.5), renewAfter: inDays(-18) }),
      ],
      { now: NOW },
    );
    expect(rows.map((r) => [r.id, r.severity ?? r.state])).toEqual([
      [3, 'critical'],
      [6, 'warning'],
      [4, 'warning'],
      [5, 'renewing'],
      [2, 'scheduled'],
      [1, 'scheduled'],
    ]);
  });

  it('keeps the most urgent rows and counts the rest', () => {
    const certs = Array.from({ length: 11 }, (_, i) =>
      cert({
        id: i + 1,
        expiresAt: inDays(40.5 + i),
        renewAfter: inDays(10.5 + i),
      }),
    );
    const { rows, total } = renewalSchedule(certs, { now: NOW, limit: 8 });
    expect(total).toBe(11);
    expect(rows.map((r) => r.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('leaves out renewals beyond the horizon unless they need someone', () => {
    const { rows } = renewalSchedule(
      [
        cert({ id: 1, expiresAt: inDays(300), renewAfter: inDays(270) }),
        cert({ id: 2, autoRenew: false, expiresAt: inDays(300) }),
      ],
      { now: NOW, horizon: 90 },
    );
    expect(rows.map((r) => r.id)).toEqual([2]);
  });
});

describe('connector health and the sidebar agree', () => {
  const connector = (over: object) =>
    ({ ...ciConnector, ...over }) as unknown as Connector;
  const cases: [Connector, ConnectorHealth, string | null][] = [
    [connector({}), 'failing', 'critical'],
    [
      connector({
        lastSeenAt: inDays(-2),
        deploymentSummary: { certificates: 1, targets: 1, failing: 0 },
      }),
      'stale',
      'warning',
    ],
    [
      connector({
        deploymentSummary: { certificates: 1, targets: 1, failing: 0 },
      }),
      'healthy',
      null,
    ],
    [
      connector({
        enrolledAt: null,
        lastSeenAt: null,
        enrollmentTokenExpiresAt: inDays(1),
        deploymentSummary: undefined,
      }),
      'waiting',
      null,
    ],
  ];
  it.each(cases)('%#: %s', (c, health, badge) => {
    expect(connectorHealth(c, NOW)).toBe(health);
    const items = computeAttention({ ...empty, connectors: [c] });
    expect(countByArea(items).connectors.severity).toBe(badge);
  });
});

describe('greetingName', () => {
  it('prefers the display name', () => {
    expect(greetingName({ displayName: 'Maya Okafor', username: 'maya' })).toBe(
      'Maya Okafor',
    );
  });
  it('uses the part before the @ of an address', () => {
    expect(
      greetingName({
        displayName: null,
        username: 'cert-action@krakenkey.io',
        email: 'cert-action@krakenkey.io',
      }),
    ).toBe('cert-action');
    expect(greetingName({ username: '', email: 'ops@example.com' })).toBe(
      'ops',
    );
    expect(greetingName({ username: 'maya.okafor' })).toBe('maya.okafor');
    expect(greetingName(null)).toBe('there');
  });
});

describe('balancePanels', () => {
  const heights = (attentionRows: number, endpoints: number) => ({
    attention: estimatePanelHeight('attention', {
      rows: attentionRows,
      groups: Math.min(attentionRows, 3),
    }),
    schedule: estimatePanelHeight('schedule', { rows: 5 }),
    connectors: estimatePanelHeight('connectors', { rows: 1 }),
    endpoints: estimatePanelHeight('endpoints', { rows: endpoints }),
  });

  it('keeps the side panels on the right beside a long attention list', () => {
    expect(balancePanels(heights(12, 10))).toEqual({
      left: ['attention'],
      right: ['schedule', 'connectors', 'endpoints'],
    });
  });

  it('moves a panel under a short attention list', () => {
    const { left, right } = balancePanels(heights(2, 0));
    expect(left[0]).toBe('attention');
    expect(left.length).toBeGreaterThan(1);
    expect(right.length).toBeGreaterThan(0);
  });

  it('picks the split with the shortest page', () => {
    expect(
      balancePanels({
        attention: 265,
        schedule: 364,
        connectors: 111,
        endpoints: 273,
      }),
    ).toEqual({
      left: ['attention', 'endpoints'],
      right: ['schedule', 'connectors'],
    });
  });
});
