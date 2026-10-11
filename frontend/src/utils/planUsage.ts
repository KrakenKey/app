import { PLAN_LIMITS } from '@krakenkey/shared';
import type {
  Endpoint,
  PlanLimits,
  SubscriptionPlan,
  TlsCert,
} from '@krakenkey/shared';

export type UsageLevel = 'normal' | 'high' | 'full';

export interface UsageRow {
  key: string;
  label: string;
  hint?: string;
  /** null while the count is still loading. */
  used: number | null;
  /** Infinity on unlimited plans. */
  limit: number;
}

/** The plan's limits, falling back to Free for an unknown plan name. */
export function planLimits(plan?: string | null): PlanLimits {
  return PLAN_LIMITS[(plan ?? 'free') as SubscriptionPlan] ?? PLAN_LIMITS.free;
}

/** Neutral below 80% of the limit, amber from 80%, red at or over the limit. */
export function usageLevel(used: number, limit: number): UsageLevel {
  if (!Number.isFinite(limit)) return 'normal';
  if (limit <= 0 || used >= limit) return 'full';
  return used / limit >= 0.8 ? 'high' : 'normal';
}

/** Bar fill in percent, 0 to 100. */
export function usagePercent(used: number, limit: number): number {
  if (!Number.isFinite(limit)) return 0;
  if (limit <= 0) return 100;
  return Math.min(100, Math.round((used / limit) * 100));
}

/** Certificates the API counts against the monthly limit (UTC month). */
export function certsThisMonth(certs: TlsCert[], now = new Date()): number {
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  return certs.filter((c) => new Date(c.createdAt).getTime() >= start).length;
}

/** Issued certificates plus connector certificates waiting for a CSR. */
export function activeCerts(certs: TlsCert[]): number {
  return certs.filter(
    (c) => c.status === 'issued' || c.status === 'awaiting_csr',
  ).length;
}

export function hostedEndpoints(endpoints: Endpoint[]): number {
  return endpoints.filter((e) => (e.hostedRegions?.length ?? 0) > 0).length;
}

/** Distinct hosted probe regions in use across all endpoints. */
export function hostedRegions(endpoints: Endpoint[]): number {
  const regions = new Set<string>();
  for (const e of endpoints) {
    for (const r of e.hostedRegions ?? []) regions.add(r.region);
  }
  return regions.size;
}

export interface UsageInput {
  plan?: string | null;
  domains: number | null;
  apiKeys: number | null;
  certs: TlsCert[] | null;
  endpoints: Endpoint[] | null;
  now?: Date;
}

/**
 * One row per plan limit the account can use up. Hosted rows only appear on
 * plans that include hosted monitoring.
 */
export function usageRows(input: UsageInput): UsageRow[] {
  const limits = planLimits(input.plan);
  const { certs, endpoints } = input;
  const rows: UsageRow[] = [
    {
      key: 'domains',
      label: 'Domains',
      used: input.domains,
      limit: limits.domains,
    },
    {
      key: 'certsPerMonth',
      label: 'Certificates this month',
      hint: 'Resets on the 1st (UTC); renewals do not count',
      used: certs ? certsThisMonth(certs, input.now) : null,
      limit: limits.certsPerMonth,
    },
    {
      key: 'totalActiveCerts',
      label: 'Active certificates',
      hint: 'Issued, or waiting for a connector CSR',
      used: certs ? activeCerts(certs) : null,
      limit: limits.totalActiveCerts,
    },
    {
      key: 'apiKeys',
      label: 'API keys',
      hint: 'Short-lived keys do not count',
      used: input.apiKeys,
      limit: limits.apiKeys,
    },
    {
      key: 'monitoredEndpoints',
      label: 'Monitored endpoints',
      used: endpoints ? endpoints.length : null,
      limit: limits.monitoredEndpoints,
    },
  ];
  if (limits.hostedMonitoredEndpoints > 0) {
    rows.push({
      key: 'hostedMonitoredEndpoints',
      label: 'Hosted endpoints',
      hint: 'Scanned from a hosted region',
      used: endpoints ? hostedEndpoints(endpoints) : null,
      limit: limits.hostedMonitoredEndpoints,
    });
  }
  if (limits.hostedProbeRegions > 0) {
    rows.push({
      key: 'hostedProbeRegions',
      label: 'Hosted regions',
      hint: 'Distinct regions in use',
      used: endpoints ? hostedRegions(endpoints) : null,
      limit: limits.hostedProbeRegions,
    });
  }
  return rows;
}

/** "10 domains" style summary of a limit, for the upgrade cards. */
export function formatLimit(n: number): string {
  return Number.isFinite(n) ? n.toLocaleString('en-US') : 'Unlimited';
}
