import { CertStatus } from '@krakenkey/shared';
import type {
  Connector,
  Domain,
  Endpoint,
  ProbeScanResult,
  TlsCert,
} from '@krakenkey/shared';
import type { ProbeOption } from '../services/endpointService';
import { getCertDomains } from './certDomains';
import { connectorStatus, formatRelative } from './connectors';

/**
 * Account health: one list of things that need a person, computed from the
 * data the dashboard already loads (certificates, endpoints and their latest
 * scans, connected probes, connectors, domains). The Overview renders the
 * list; the sidebar shows per-area counts from the same list.
 */

const DAY = 86_400_000;

export type HealthSeverity = 'critical' | 'warning' | 'notice';
export type HealthArea =
  | 'certificates'
  | 'endpoints'
  | 'connectors'
  | 'domains';

/** What a row is about, shown as a small tag next to its name. */
export type AttentionKind =
  | 'Certificate'
  | 'Endpoint'
  | 'Probe'
  | 'Connector'
  | 'Domain';

/** Something the Overview can do in place, without leaving the page. */
export type AttentionAction =
  | { kind: 'renew'; certId: number }
  | { kind: 'retry'; certId: number }
  | { kind: 'scan'; endpointId: string };

export interface AttentionItem {
  id: string;
  severity: HealthSeverity;
  area: HealthArea;
  kind: AttentionKind;
  /** Usually a hostname, connector or probe name. */
  title: string;
  /** What is wrong, in a few words: "Expires in 5 days, auto-renew is off". */
  summary: string;
  /** Optional context: a failure reason, an error, a client label. */
  detail?: string;
  /** Days until it becomes a problem, for ordering within a severity. */
  dueDays?: number;
  /** Where to look at it. */
  to: string;
  /** Label for the link when there is no in-place action. */
  linkLabel: string;
  action?: AttentionAction;
}

export const SEVERITY_ORDER: HealthSeverity[] = [
  'critical',
  'warning',
  'notice',
];

/** Whole days from `now` until `iso` (negative when past). */
export function daysUntil(iso: string, now: number = Date.now()): number {
  return Math.floor((new Date(iso).getTime() - now) / DAY);
}

/**
 * How many days before expiry KrakenKey renews a certificate on this plan:
 * 5 on Free, 30 on paid plans. Unknown plans get the paid window.
 */
export function renewalWindowDays(plan?: string | null): number {
  return plan === 'free' ? 5 : 30;
}

/* ── Endpoints ──────────────────────────────────────────────────────────── */

export type EndpointState =
  | 'unreachable'
  | 'untrusted'
  | 'expiring'
  | 'healthy'
  | 'unscanned'
  | 'disabled';

export interface EndpointSummary {
  state: EndpointState;
  worstExpiry: number | null;
  allTrusted: boolean;
  anyFailed: boolean;
  latestScan: string | null;
  error: string | null;
  untrustedIssuer: string | null;
  hasHosted: boolean;
  hasConnected: boolean;
}

/** Folds the latest result from each probe into one state for the endpoint. */
export function summarizeEndpoint(
  ep: Pick<Endpoint, 'isActive'>,
  results: ProbeScanResult[],
): EndpointSummary {
  const worstExpiry = results.reduce<number | null>(
    (min, r) =>
      r.certDaysUntilExpiry != null &&
      (min == null || r.certDaysUntilExpiry < min)
        ? r.certDaysUntilExpiry
        : min,
    null,
  );
  const failed = results.find((r) => !r.connectionSuccess);
  const untrusted = results.find(
    (r) => r.connectionSuccess && r.certTrusted === false,
  );
  const latestScan = results.reduce<string | null>(
    (latest, r) =>
      !latest || new Date(r.scannedAt) > new Date(latest)
        ? r.scannedAt
        : latest,
    null,
  );

  let state: EndpointState;
  if (!ep.isActive) state = 'disabled';
  else if (results.length === 0) state = 'unscanned';
  else if (failed) state = 'unreachable';
  else if (untrusted) state = 'untrusted';
  else if (worstExpiry != null && worstExpiry <= 30) state = 'expiring';
  else state = 'healthy';

  return {
    state,
    worstExpiry,
    allTrusted:
      results.length > 0 && results.every((r) => r.certTrusted === true),
    anyFailed: !!failed,
    latestScan,
    error: failed?.connectionError ?? null,
    untrustedIssuer: untrusted?.certIssuer ?? null,
    hasHosted: results.some((r) => r.probeMode === 'hosted'),
    hasConnected: results.some((r) => r.probeMode === 'connected'),
  };
}

/** "CN=northgate-internal-ca" -> "northgate-internal-ca". */
export function issuerName(dn: string | null | undefined): string | null {
  if (!dn) return null;
  const cn = /CN=([^,]+)/.exec(dn);
  return (cn ? cn[1] : dn).trim();
}

function expiresIn(n: number): string {
  if (n < 0) return `Expired ${-n} day${n === -1 ? '' : 's'} ago`;
  if (n === 0) return 'Expires today';
  return `Expires in ${n} day${n === 1 ? '' : 's'}`;
}

/** Display name for a certificate: its first domain. */
export function certName(cert: TlsCert): string {
  return getCertDomains(cert)[0] ?? `Certificate #${cert.id}`;
}

/* ── The list ──────────────────────────────────────────────────────────── */

export interface HealthInput {
  certs: TlsCert[];
  endpoints: Endpoint[];
  latestResults: Record<string, ProbeScanResult[]>;
  probes: ProbeOption[];
  connectors: Connector[];
  domains: Domain[];
  /** The account's plan, for the renewal window. */
  plan?: string | null;
  now?: number;
}

export function computeAttention(input: HealthInput): AttentionItem[] {
  const now = input.now ?? Date.now();
  const window = renewalWindowDays(input.plan);
  const items: AttentionItem[] = [];
  const certLink = '/dashboard/certificates';
  const endpointLink = '/dashboard/endpoints';
  const connectorsLink = '/dashboard/connectors';

  // Hosts covered by a live certificate: an expiring endpoint on one of
  // these is the certificate's problem and is listed once, there.
  const covered = new Set<string>();

  for (const cert of input.certs) {
    const name = certName(cert);
    const days = cert.expiresAt ? daysUntil(cert.expiresAt, now) : null;
    const managed = cert.managedBy === 'connector';
    const base = {
      id: `cert-${cert.id}`,
      area: 'certificates' as const,
      kind: 'Certificate' as const,
      title: name,
      to: certLink,
      linkLabel: 'View',
    };

    if (
      cert.status === CertStatus.ISSUED ||
      cert.status === CertStatus.RENEWING
    ) {
      getCertDomains(cert).forEach((d) => covered.add(d));
    }

    switch (cert.status) {
      case CertStatus.FAILED:
        items.push({
          ...base,
          severity: 'critical',
          summary: 'Issuance failed',
          detail: cert.failureReason ?? undefined,
          action: { kind: 'retry', certId: cert.id },
        });
        break;
      case CertStatus.RENEWING:
        items.push({
          ...base,
          severity: 'notice',
          summary: 'Renewal in progress',
          detail:
            [
              cert.lastRenewalAttemptAt &&
                `Started ${formatRelative(cert.lastRenewalAttemptAt, now)}`,
              days != null && expiresIn(days).toLowerCase(),
            ]
              .filter(Boolean)
              .join(', ') || undefined,
          dueDays: days ?? undefined,
        });
        break;
      case CertStatus.PENDING:
      case CertStatus.ISSUING:
        items.push({
          ...base,
          severity: 'notice',
          summary: 'Issuance in progress',
        });
        break;
      case CertStatus.AWAITING_CSR:
        items.push({
          ...base,
          severity: 'notice',
          summary: "Waiting for its connector's CSR",
          detail: 'Add its id to the connector config to issue it',
          to: connectorsLink,
          linkLabel: 'Connectors',
        });
        break;
      case CertStatus.ISSUED: {
        if (cert.ariReplacementRequestedAt) {
          items.push({
            ...base,
            severity: 'warning',
            summary: 'The CA asked for early replacement',
            dueDays: days ?? undefined,
            ...(managed
              ? { to: connectorsLink, linkLabel: 'Connectors' }
              : { action: { kind: 'renew', certId: cert.id } }),
          });
          break;
        }
        if (days == null || days > 30) break;
        // Renewal is due once renewAfter passes; without it, once the
        // certificate is inside the plan's renewal window.
        const due = cert.renewAfter
          ? new Date(cert.renewAfter).getTime() <= now
          : days <= window;
        const automatic = managed || cert.autoRenew;
        // Scheduled and not yet due: KrakenKey or the connector has it.
        if (automatic && !due && days >= 0) break;
        const why = !automatic
          ? 'auto-renew is off'
          : managed
            ? 'the connector has not renewed it'
            : 'renewal has not started';
        items.push({
          ...base,
          severity: days <= 7 ? 'critical' : 'warning',
          summary: `${expiresIn(days)}, ${why}`,
          dueDays: days,
          ...(managed
            ? { to: connectorsLink, linkLabel: 'Connectors' }
            : { action: { kind: 'renew', certId: cert.id } }),
        });
        break;
      }
      default:
        break;
    }
  }

  for (const ep of input.endpoints) {
    if (!ep.isActive) continue;
    const s = summarizeEndpoint(ep, input.latestResults[ep.id] ?? []);
    const base = {
      id: `ep-${ep.id}`,
      area: 'endpoints' as const,
      kind: 'Endpoint' as const,
      title: ep.port === 443 ? ep.host : `${ep.host}:${ep.port}`,
      to: endpointLink,
      linkLabel: 'View',
    };
    if (s.state === 'unreachable') {
      items.push({
        ...base,
        severity: 'critical',
        summary: 'Unreachable',
        detail: s.error ?? undefined,
        action: { kind: 'scan', endpointId: ep.id },
      });
    } else if (s.state === 'untrusted') {
      const issuer = issuerName(s.untrustedIssuer);
      items.push({
        ...base,
        severity: 'critical',
        summary: 'Certificate chain is not trusted',
        detail: issuer ? `Issued by ${issuer}` : undefined,
        linkLabel: 'Inspect',
      });
    } else if (
      s.state === 'expiring' &&
      s.worstExpiry != null &&
      !covered.has(ep.host)
    ) {
      items.push({
        ...base,
        severity: s.worstExpiry <= 7 ? 'critical' : 'warning',
        summary: `Serves a certificate that ${expiresIn(s.worstExpiry).toLowerCase()}`,
        detail: 'Not issued by KrakenKey',
        dueDays: s.worstExpiry,
      });
    }
  }

  for (const probe of input.probes) {
    if (probe.status !== 'stale') continue;
    items.push({
      id: `probe-${probe.id}`,
      severity: 'warning',
      area: 'endpoints',
      kind: 'Probe',
      title: probe.name,
      summary: probe.lastSeenAt
        ? `Offline, last reported ${formatRelative(probe.lastSeenAt, now)}`
        : 'Offline',
      detail: 'Endpoints it scans are not checked from its network',
      to: endpointLink,
      linkLabel: 'Endpoints',
    });
  }

  for (const c of input.connectors) {
    const status = connectorStatus(c, now);
    if (status === 'revoked') continue;
    const base = {
      area: 'connectors' as const,
      kind: 'Connector' as const,
      title: c.name,
      detail: c.clientLabel ?? undefined,
      to: `/dashboard/connectors/${c.id}`,
      linkLabel: 'Open',
    };
    const failing = c.deploymentSummary?.failing ?? 0;
    if (failing > 0) {
      items.push({
        ...base,
        id: `con-${c.id}-failing`,
        severity: 'critical',
        summary: `${failing} deployment target${failing === 1 ? '' : 's'} failing`,
      });
    }
    if (status === 'stale') {
      const seen = c.lastSeenAt ?? c.enrolledAt;
      items.push({
        ...base,
        id: `con-${c.id}-stale`,
        severity: 'warning',
        summary: seen
          ? `Last check-in ${formatRelative(seen, now)}`
          : 'Not seen recently',
      });
    } else if (status === 'expired') {
      items.push({
        ...base,
        id: `con-${c.id}-expired`,
        severity: 'warning',
        summary: 'Enrollment token expired before it enrolled',
      });
    } else if (status === 'waiting') {
      items.push({
        ...base,
        id: `con-${c.id}-waiting`,
        severity: 'notice',
        summary: 'Waiting to enroll',
      });
    }
  }

  for (const d of input.domains) {
    if (d.isVerified) continue;
    items.push({
      id: `dom-${d.id}`,
      severity: 'warning',
      area: 'domains',
      kind: 'Domain',
      title: d.hostname,
      summary: 'DNS verification pending',
      detail: 'Add the TXT and CNAME records, then verify',
      to: '/dashboard/domains',
      linkLabel: 'Verify',
    });
  }

  // Most severe first; within a severity, soonest due first. Array.sort is
  // stable, so items without a due date keep their order.
  const rank = (s: HealthSeverity) => SEVERITY_ORDER.indexOf(s);
  return items.sort(
    (a, b) =>
      rank(a.severity) - rank(b.severity) ||
      (a.dueDays ?? Infinity) - (b.dueDays ?? Infinity),
  );
}

/* ── Expiry timeline ───────────────────────────────────────────────────── */

export interface TimelineRow {
  id: number;
  name: string;
  /** Days until expiry. */
  days: number;
  /** Days until the scheduled automatic renewal, when one is ahead. */
  renewInDays: number | null;
  renewing: boolean;
}

/**
 * Live certificates expiring within `horizon` days, soonest first, with the
 * day their automatic renewal is scheduled (KrakenKey's or the connector's).
 */
export function expiryTimeline(
  certs: TlsCert[],
  horizon = 90,
  now: number = Date.now(),
): TimelineRow[] {
  return certs
    .filter(
      (c) =>
        c.expiresAt &&
        (c.status === CertStatus.ISSUED || c.status === CertStatus.RENEWING),
    )
    .map((c) => {
      const days = daysUntil(c.expiresAt!, now);
      const automatic = c.autoRenew || c.managedBy === 'connector';
      const renewIn =
        automatic && c.renewAfter && c.status === CertStatus.ISSUED
          ? daysUntil(c.renewAfter, now)
          : null;
      return {
        id: c.id,
        name: certName(c),
        days,
        renewInDays:
          renewIn != null && renewIn >= 0 && renewIn < days ? renewIn : null,
        renewing: c.status === CertStatus.RENEWING,
      };
    })
    .filter((r) => r.days <= horizon)
    .sort((a, b) => a.days - b.days);
}

/* ── Fleet counts (the Overview's KPI strip) ───────────────────────────── */

export interface FleetCounts {
  certs: {
    total: number;
    issued: number;
    renewing: number;
    failed: number;
    /** Issued and expiring within 30 days, soonest first. */
    expiring: { name: string; days: number }[];
  };
  endpoints: {
    total: number;
    healthy: number;
    expiring: number;
    failing: number;
    inactive: number;
  };
  connectors: { total: number; stale: number; failingTargets: number };
  domains: { total: number; pending: number };
}

export function fleetCounts(
  input: Omit<HealthInput, 'plan' | 'probes'>,
): FleetCounts {
  const now = input.now ?? Date.now();
  const certs = {
    total: input.certs.length,
    issued: 0,
    renewing: 0,
    failed: 0,
    expiring: [] as { name: string; days: number }[],
  };
  for (const c of input.certs) {
    if (c.status === CertStatus.ISSUED) {
      certs.issued++;
      if (c.expiresAt) {
        const days = daysUntil(c.expiresAt, now);
        if (days <= 30) certs.expiring.push({ name: certName(c), days });
      }
    } else if (c.status === CertStatus.RENEWING) certs.renewing++;
    else if (c.status === CertStatus.FAILED) certs.failed++;
  }
  certs.expiring.sort((a, b) => a.days - b.days);

  const endpoints = {
    total: input.endpoints.length,
    healthy: 0,
    expiring: 0,
    failing: 0,
    inactive: 0,
  };
  for (const ep of input.endpoints) {
    const s = summarizeEndpoint(ep, input.latestResults[ep.id] ?? []).state;
    if (s === 'healthy') endpoints.healthy++;
    else if (s === 'expiring') endpoints.expiring++;
    else if (s === 'unreachable' || s === 'untrusted') endpoints.failing++;
    else endpoints.inactive++;
  }

  const live = input.connectors.filter(
    (c) => connectorStatus(c, now) !== 'revoked',
  );
  const connectors = {
    total: live.length,
    stale: live.filter((c) => connectorStatus(c, now) === 'stale').length,
    failingTargets: live.reduce(
      (n, c) => n + (c.deploymentSummary?.failing ?? 0),
      0,
    ),
  };

  const domains = {
    total: input.domains.length,
    pending: input.domains.filter((d) => !d.isVerified).length,
  };

  return { certs, endpoints, connectors, domains };
}

/* ── Sidebar badges ────────────────────────────────────────────────────── */

export interface AreaCount {
  count: number;
  severity: HealthSeverity | null;
}

/** Problems (critical and warning) per area, for the sidebar badges. */
export function countByArea(
  items: AttentionItem[],
): Record<HealthArea, AreaCount> {
  const out: Record<HealthArea, AreaCount> = {
    certificates: { count: 0, severity: null },
    endpoints: { count: 0, severity: null },
    connectors: { count: 0, severity: null },
    domains: { count: 0, severity: null },
  };
  for (const item of items) {
    if (item.severity === 'notice') continue;
    const area = out[item.area];
    area.count += 1;
    if (area.severity !== 'critical') area.severity = item.severity;
  }
  return out;
}
