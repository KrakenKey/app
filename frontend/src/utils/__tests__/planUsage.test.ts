import { PLAN_LIMITS } from '@krakenkey/shared';
import type { Endpoint, TlsCert } from '@krakenkey/shared';
import {
  activeCerts,
  certsThisMonth,
  formatLimit,
  hostedEndpoints,
  hostedRegions,
  planLimits,
  usageLevel,
  usagePercent,
  upgradeHint,
  usageRows,
} from '../planUsage';

const NOW = new Date('2026-10-11T14:30:00Z');

const cert = (status: string, createdAt: string) =>
  ({ id: 1, status, createdAt }) as unknown as TlsCert;

const endpoint = (regions: string[]) =>
  ({
    id: regions.join('-') || 'none',
    hostedRegions: regions.map((region) => ({ region })),
  }) as unknown as Endpoint;

describe('planUsage', () => {
  it('reads limits from the shared plan table, falling back to free', () => {
    expect(planLimits('business')).toBe(PLAN_LIMITS.business);
    expect(planLimits('nonsense')).toBe(PLAN_LIMITS.free);
    expect(planLimits(null)).toBe(PLAN_LIMITS.free);
  });

  it('turns amber at 80% and red at the limit', () => {
    expect(usageLevel(7, 10)).toBe('normal');
    expect(usageLevel(8, 10)).toBe('high');
    expect(usageLevel(10, 10)).toBe('full');
    expect(usageLevel(12, 10)).toBe('full');
    expect(usageLevel(500, Infinity)).toBe('normal');
  });

  it('caps the bar at 100% and leaves unlimited bars empty', () => {
    expect(usagePercent(7, 25)).toBe(28);
    expect(usagePercent(30, 25)).toBe(100);
    expect(usagePercent(3, Infinity)).toBe(0);
  });

  it('counts certificates created since the 1st of the UTC month', () => {
    const certs = [
      cert('issued', '2026-10-01T00:00:00Z'),
      cert('failed', '2026-10-11T10:00:00Z'),
      cert('issued', '2026-09-30T23:59:59Z'),
    ];
    expect(certsThisMonth(certs, NOW)).toBe(2);
  });

  it('counts issued and awaiting_csr certificates as active', () => {
    const certs = [
      cert('issued', '2026-01-01T00:00:00Z'),
      cert('awaiting_csr', '2026-01-01T00:00:00Z'),
      cert('renewing', '2026-01-01T00:00:00Z'),
      cert('revoked', '2026-01-01T00:00:00Z'),
      cert('failed', '2026-01-01T00:00:00Z'),
    ];
    expect(activeCerts(certs)).toBe(2);
  });

  it('counts hosted endpoints and distinct hosted regions', () => {
    const eps = [
      endpoint(['us-east-1', 'eu-west-1']),
      endpoint(['us-east-1']),
      endpoint([]),
    ];
    expect(hostedEndpoints(eps)).toBe(2);
    expect(hostedRegions(eps)).toBe(2);
  });

  it('shows hosted rows on every plan, the free plan included', () => {
    const base = { domains: 1, apiKeys: 1, certs: [], endpoints: [] };
    const free = usageRows({ ...base, plan: 'free' });
    expect(free.find((r) => r.key === 'hostedMonitoredEndpoints')?.limit).toBe(
      1,
    );
    expect(free.find((r) => r.key === 'hostedProbeRegions')?.limit).toBe(1);
    const business = usageRows({ ...base, plan: 'business' }).map((r) => r.key);
    expect(business).toEqual([
      'domains',
      'certsPerMonth',
      'totalActiveCerts',
      'apiKeys',
      'monitoredEndpoints',
      'hostedMonitoredEndpoints',
      'hostedProbeRegions',
      'connectors',
      'alertChannels',
      'githubOidcTrusts',
    ]);
  });

  it('reports null usage while lists are still loading', () => {
    const rows = usageRows({
      plan: 'business',
      domains: 7,
      apiKeys: null,
      certs: null,
      endpoints: null,
    });
    expect(rows.find((r) => r.key === 'domains')?.used).toBe(7);
    expect(rows.find((r) => r.key === 'certsPerMonth')?.used).toBeNull();
  });

  it('formats unlimited limits', () => {
    expect(formatLimit(1500)).toBe('1,500');
    expect(formatLimit(Infinity)).toBe('Unlimited');
  });

  it('names the plan that raises a limit', () => {
    expect(upgradeHint('free', 'connectors')).toBe('Pro includes 5.');
    expect(upgradeHint('pro', 'githubOidcTrusts')).toBe(
      'Business includes 50.',
    );
    expect(upgradeHint('pro', 'orgMembers')).toBe('Business has no limit.');
    expect(upgradeHint('business', 'alertChannels')).toBe(
      'Contact us about Enterprise for more.',
    );
    expect(upgradeHint('enterprise', 'domains')).toBeNull();
    // Pro and Business both include every hosted region
    expect(upgradeHint('pro', 'hostedProbeRegions')).toBeNull();
  });

  it('shows the new limits, and organization members only inside one', () => {
    const base = { domains: 1, apiKeys: 1, certs: [], endpoints: [] };
    const rows = usageRows({
      ...base,
      plan: 'pro',
      connectors: 2,
      alertChannels: 5,
      githubOidcTrusts: null,
      orgMembers: 3,
    });
    const row = (key: string) => rows.find((r) => r.key === key);
    expect(row('connectors')).toMatchObject({ used: 2, limit: 5 });
    expect(row('alertChannels')).toMatchObject({ used: 5, limit: 5 });
    expect(row('githubOidcTrusts')).toMatchObject({ used: null, limit: 10 });
    expect(row('orgMembers')).toMatchObject({ used: 3, limit: 3 });
    expect(
      usageRows({ ...base, plan: 'pro' }).some((r) => r.key === 'orgMembers'),
    ).toBe(false);
  });
});

describe('planLimits', () => {
  it('reads legacy plan ids as their replacement', () => {
    expect(planLimits('starter')).toBe(PLAN_LIMITS.pro);
    expect(planLimits('team')).toBe(PLAN_LIMITS.business);
    expect(planLimits('gold')).toBe(PLAN_LIMITS.free);
  });
});
