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
import { shortDate } from './dates';

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
  /**
   * Tells apart items with the same title, like several certificates for
   * one hostname: "#27".
   */
  ref?: string;
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

/* ── Renewal ───────────────────────────────────────────────────────────── */

/**
 * The last renewal of this certificate failed, but the certificate itself
 * is still issued (and in place until it expires). Automatic renewal tries
 * again once it is due, not before `renewAfter`; renewing by hand tries
 * right away. A failure older than the last successful renewal is ignored.
 */
export function renewalFailed(cert: TlsCert): boolean {
  if (cert.status !== CertStatus.ISSUED || !cert.renewalFailedAt) return false;
  return (
    !cert.lastRenewedAt ||
    new Date(cert.renewalFailedAt).getTime() >
      new Date(cert.lastRenewedAt).getTime()
  );
}

/**
 * - scheduled: KrakenKey renews it automatically, renewal not due yet
 * - connector: a connector renews it, renewal not due yet
 * - manual: auto-renew is off and no connector manages it
 * - overdue: renewal is due (or it expired) and has not started
 * - replace: the CA asked for early replacement (ARI)
 * - renewing: renewal is running now
 */
export type RenewalState =
  | 'scheduled'
  | 'connector'
  | 'manual'
  | 'overdue'
  | 'replace'
  | 'renewing';

export interface CertRenewal {
  state: RenewalState;
  /** Whether it needs a person, and how badly. */
  severity: 'critical' | 'warning' | null;
  /** Whole days until expiry. */
  days: number;
  /** When the automatic renewal is due; null for manual certificates. */
  renewAt: string | null;
  managed: boolean;
}

/**
 * How a live certificate gets renewed and whether that needs a person. One
 * rule for the attention list and the renewal schedule, so they agree:
 *
 * - Auto-renew off and no connector: a warning at any distance from expiry,
 *   critical once inside the plan's renewal window (or 7 days).
 * - Automatic (KrakenKey or a connector): nothing until renewal is due
 *   (renewAfter has passed, or without one, inside the renewal window), has
 *   not started, and 30 days or less are left (or it expired); then
 *   critical within 7 days of expiry, else a warning.
 * - The CA asked for early replacement: a warning.
 *
 * Returns null for anything that is not issued or renewing, or has no
 * expiry: revoked, failed and in-flight certificates are not renewed.
 */
export function certRenewal(
  cert: TlsCert,
  windowDays: number,
  now: number = Date.now(),
): CertRenewal | null {
  if (!cert.expiresAt) return null;
  if (cert.status !== CertStatus.ISSUED && cert.status !== CertStatus.RENEWING)
    return null;
  const days = daysUntil(cert.expiresAt, now);
  const managed = cert.managedBy === 'connector';
  const automatic = managed || cert.autoRenew;
  const renewAt = !automatic
    ? null
    : (cert.renewAfter ??
      new Date(
        new Date(cert.expiresAt).getTime() - windowDays * DAY,
      ).toISOString());
  const base = { days, renewAt, managed };

  if (cert.status === CertStatus.RENEWING) {
    return { ...base, state: 'renewing', severity: null };
  }
  if (cert.ariReplacementRequestedAt) {
    return { ...base, state: 'replace', severity: 'warning' };
  }
  if (!automatic) {
    return {
      ...base,
      state: 'manual',
      severity: days <= Math.max(windowDays, 7) ? 'critical' : 'warning',
    };
  }
  const due = new Date(renewAt!).getTime() <= now;
  // A renewal that just came due with more than 30 days left is not a
  // problem yet: KrakenKey or the connector picks it up shortly.
  if ((!due || days > 30) && days >= 0) {
    return {
      ...base,
      state: managed ? 'connector' : 'scheduled',
      severity: null,
    };
  }
  return {
    ...base,
    state: 'overdue',
    severity: days <= 7 ? 'critical' : 'warning',
  };
}

/* ── The list ──────────────────────────────────────────────────────────── */

export interface HealthInput {
  certs: TlsCert[];
  endpoints: Endpoint[];
  latestResults: Record<string, ProbeScanResult[]>;
  probes: ProbeOption[];
  connectors: Connector[];
  domains: Domain[];
  /**
   * Endpoints whose latest results could not be loaded. Their state is
   * unknown: they are neither listed as problems nor counted as healthy.
   */
  resultsUnavailable?: string[];
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
      ref: `#${cert.id}`,
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
        const target = managed
          ? { to: connectorsLink, linkLabel: 'Connectors' }
          : { action: { kind: 'renew' as const, certId: cert.id } };
        if (renewalFailed(cert)) {
          items.push({
            ...base,
            severity: days != null && days <= 7 ? 'critical' : 'warning',
            summary: 'Renewal failed',
            detail:
              [
                cert.failureReason,
                days != null &&
                  `the current certificate ${expiresIn(days).toLowerCase()}`,
              ]
                .filter(Boolean)
                .join('; ') || undefined,
            dueDays: days ?? undefined,
            ...target,
          });
          break;
        }
        const r = certRenewal(cert, window, now);
        if (!r || !r.severity) break;
        let summary: string;
        if (r.state === 'replace') {
          summary = 'The CA asked for early replacement';
        } else if (r.state === 'manual') {
          summary =
            r.days <= 30
              ? `${expiresIn(r.days)}, auto-renew is off`
              : `Auto-renew is off; it will expire on ${shortDate(cert.expiresAt!)}`;
        } else {
          summary = `${expiresIn(r.days)}, ${
            managed
              ? 'the connector has not renewed it'
              : 'renewal has not started'
          }`;
        }
        items.push({
          ...base,
          severity: r.severity,
          summary,
          dueDays: r.days,
          ...target,
        });
        break;
      }
      default:
        break;
    }
  }

  const unavailable = new Set(input.resultsUnavailable);
  for (const ep of input.endpoints) {
    if (!ep.isActive || unavailable.has(ep.id)) continue;
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

  // One row per connector: a connector with a failing target that has also
  // stopped checking in is one thing to look at, with both reasons.
  for (const c of input.connectors) {
    const status = connectorStatus(c, now);
    if (status === 'revoked') continue;
    const reasons: { severity: HealthSeverity; text: string }[] = [];
    const failing = c.deploymentSummary?.failing ?? 0;
    if (failing > 0) {
      reasons.push({
        severity: 'critical',
        text: `${failing} deployment target${failing === 1 ? '' : 's'} failing`,
      });
    }
    if (status === 'stale') {
      const seen = c.lastSeenAt ?? c.enrolledAt;
      reasons.push({
        severity: 'warning',
        text: seen
          ? `Last check-in ${formatRelative(seen, now)}`
          : 'Not seen recently',
      });
    } else if (status === 'expired') {
      reasons.push({
        severity: 'warning',
        text: 'Enrollment token expired before it enrolled',
      });
    } else if (status === 'waiting') {
      reasons.push({ severity: 'notice', text: 'Waiting to enroll' });
    }
    if (reasons.length === 0) continue;
    const severity = reasons.reduce<HealthSeverity>(
      (worst, r) =>
        SEVERITY_ORDER.indexOf(r.severity) < SEVERITY_ORDER.indexOf(worst)
          ? r.severity
          : worst,
      'notice',
    );
    // "1 deployment target failing; last check-in 2 days ago"
    const summary = reasons
      .map((r, i) =>
        i === 0 ? r.text : r.text.charAt(0).toLowerCase() + r.text.slice(1),
      )
      .join('; ');
    items.push({
      id: `con-${c.id}`,
      severity,
      area: 'connectors',
      kind: 'Connector',
      title: c.name,
      summary,
      detail: c.clientLabel ?? undefined,
      to: `/dashboard/connectors/${c.id}`,
      linkLabel: 'Open',
    });
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

/* ── Renewal schedule ──────────────────────────────────────────────────── */

export interface ScheduleRow {
  id: number;
  /** First domain. Several certificates can share it, so show the id too. */
  name: string;
  /** How many more names the certificate covers. */
  extraNames: number;
  /** The connector limited to this certificate, when one manages it. */
  connectorName: string | null;
  state: RenewalState;
  severity: CertRenewal['severity'];
  expiresAt: string;
  /** Days until expiry. */
  days: number;
  renewAt: string | null;
  /** Days until the automatic renewal; negative when it is overdue. */
  renewInDays: number | null;
}

export interface RenewalSchedule {
  /** The most urgent rows, at most `limit`. */
  rows: ScheduleRow[];
  /** Rows inside the horizon, shown or not. */
  total: number;
}

const SEVERITY_RANK = { critical: 0, warning: 1 } as const;

/** Days until the next thing happens to the certificate, for ordering. */
function nextActionDays(r: ScheduleRow): number {
  if (r.state === 'renewing') return 0;
  if (r.state === 'scheduled' || r.state === 'connector')
    return r.renewInDays ?? r.days;
  return r.days;
}

/**
 * When each live certificate renews and expires. With 90-day certificates
 * everything expires within 90 days, so the useful question is what happens
 * next: rows that need a person come first (critical, then warning), then
 * renewals in progress, then scheduled renewals, soonest first. Rows whose
 * next step is beyond `horizon` days are left out unless they need someone.
 * Revoked, failed and in-flight certificates never appear.
 */
export function renewalSchedule(
  certs: TlsCert[],
  opts: {
    plan?: string | null;
    connectors?: Connector[];
    horizon?: number;
    limit?: number;
    now?: number;
  } = {},
): RenewalSchedule {
  const now = opts.now ?? Date.now();
  const horizon = opts.horizon ?? 90;
  const limit = opts.limit ?? 8;
  const window = renewalWindowDays(opts.plan);
  const live = (opts.connectors ?? []).filter((c) => !c.revokedAt);

  const all: ScheduleRow[] = [];
  for (const cert of certs) {
    const r = certRenewal(cert, window, now);
    if (!r) continue;
    const names = getCertDomains(cert);
    const connector = r.managed
      ? live.find((c) => c.allowedCertIds?.includes(cert.id))
      : undefined;
    all.push({
      id: cert.id,
      name: names[0] ?? `Certificate #${cert.id}`,
      extraNames: Math.max(0, names.length - 1),
      connectorName: connector?.name ?? null,
      state: r.state,
      severity: r.severity,
      expiresAt: cert.expiresAt!,
      days: r.days,
      renewAt: r.renewAt,
      renewInDays: r.renewAt ? daysUntil(r.renewAt, now) : null,
    });
  }

  const rank = (r: ScheduleRow) =>
    r.severity ? SEVERITY_RANK[r.severity] : r.state === 'renewing' ? 2 : 3;
  const inHorizon = all
    .filter((r) => r.severity || nextActionDays(r) <= horizon)
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        nextActionDays(a) - nextActionDays(b) ||
        a.id - b.id,
    );
  return { rows: inHorizon.slice(0, limit), total: inHorizon.length };
}

/* ── Fleet counts (the Overview's KPI strip) ───────────────────────────── */

export interface FleetCounts {
  certs: {
    /** Every record, revoked and failed included. */
    total: number;
    /** Issued, renewing, or on the way to issuance. */
    live: number;
    issued: number;
    renewing: number;
    /** Pending, issuing, or waiting for a connector's CSR. */
    inProgress: number;
    failed: number;
    revoked: number;
    /** Issued and expiring within 30 days, soonest first. */
    expiring: { name: string; days: number }[];
  };
  endpoints: {
    total: number;
    healthy: number;
    expiring: number;
    failing: number;
    inactive: number;
    /** Active, but the latest results could not be loaded. */
    unknown: number;
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
    live: 0,
    issued: 0,
    renewing: 0,
    inProgress: 0,
    failed: 0,
    revoked: 0,
    expiring: [] as { name: string; days: number }[],
  };
  for (const c of input.certs) {
    switch (c.status) {
      case CertStatus.ISSUED:
        certs.issued++;
        if (c.expiresAt) {
          const days = daysUntil(c.expiresAt, now);
          if (days <= 30) certs.expiring.push({ name: certName(c), days });
        }
        break;
      case CertStatus.RENEWING:
        certs.renewing++;
        break;
      case CertStatus.PENDING:
      case CertStatus.ISSUING:
      case CertStatus.AWAITING_CSR:
        certs.inProgress++;
        break;
      case CertStatus.FAILED:
        certs.failed++;
        break;
      case CertStatus.REVOKING:
      case CertStatus.REVOKED:
        certs.revoked++;
        break;
    }
  }
  certs.live = certs.issued + certs.renewing + certs.inProgress;
  certs.expiring.sort((a, b) => a.days - b.days);

  const endpoints = {
    total: input.endpoints.length,
    healthy: 0,
    expiring: 0,
    failing: 0,
    inactive: 0,
    unknown: 0,
  };
  const unavailable = new Set(input.resultsUnavailable);
  for (const ep of input.endpoints) {
    if (ep.isActive && unavailable.has(ep.id)) {
      endpoints.unknown++;
      continue;
    }
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

/**
 * Problems (critical and warning) per area, for the sidebar badges. Each
 * certificate, endpoint, probe, connector or domain has at most one item, so
 * the count is the number of things that need attention.
 */
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

/* ── Load state ────────────────────────────────────────────────────────── */

/** The requests behind the account health data. */
export type HealthSource =
  | 'certs'
  | 'endpoints'
  | 'latestResults'
  | 'probes'
  | 'connectors'
  | 'domains';

export const HEALTH_SOURCES: readonly HealthSource[] = [
  'certs',
  'endpoints',
  'latestResults',
  'probes',
  'connectors',
  'domains',
];

/**
 * Where a source (or an area) stands. `partial` means some of it loaded:
 * the latest results for some endpoints, or endpoints without probes.
 */
export type LoadState = 'loading' | 'loaded' | 'partial' | 'failed';

/** Folds the per-source states into one per sidebar area. */
export function areaLoadStates(
  s: Record<HealthSource, LoadState>,
): Record<HealthArea, LoadState> {
  let endpoints: LoadState;
  if (s.endpoints === 'loading' || s.endpoints === 'failed') {
    endpoints = s.endpoints;
  } else if (s.latestResults === 'loading' || s.probes === 'loading') {
    endpoints = 'loading';
  } else if (s.latestResults !== 'loaded' || s.probes !== 'loaded') {
    endpoints = 'partial';
  } else {
    endpoints = 'loaded';
  }
  return {
    certificates: s.certs,
    endpoints,
    connectors: s.connectors,
    domains: s.domains,
  };
}

/**
 * What could not be loaded, in words for "Couldn't load ...": whole areas
 * first, then the parts of the endpoints area.
 */
export function loadFailures(
  s: Record<HealthSource, LoadState>,
  resultsUnavailable = 0,
): string[] {
  const out: string[] = [];
  if (s.certs === 'failed') out.push('certificates');
  if (s.endpoints === 'failed') {
    out.push('endpoints');
  } else if (s.endpoints === 'loaded') {
    if (s.latestResults === 'failed' || s.latestResults === 'partial') {
      out.push(
        resultsUnavailable === 1
          ? 'the latest scan for 1 endpoint'
          : resultsUnavailable > 1
            ? `the latest scans for ${resultsUnavailable} endpoints`
            : 'the latest scans',
      );
    }
    if (s.probes === 'failed') out.push('probes');
  } else if (s.probes === 'failed') {
    out.push('probes');
  }
  if (s.connectors === 'failed') out.push('connectors');
  if (s.domains === 'failed') out.push('domains');
  return out;
}

/** "a", "a and b", "a, b and c". */
export function joinWords(words: string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/* ── Greeting ──────────────────────────────────────────────────────────── */

/**
 * A short name to greet someone by: the display name, else the username,
 * else the email; an address is cut to the part before the @.
 */
export function greetingName(
  user: {
    displayName?: string | null;
    username?: string | null;
    email?: string | null;
  } | null,
): string {
  const raw =
    user?.displayName?.trim() ||
    user?.username?.trim() ||
    user?.email?.trim() ||
    '';
  if (user?.displayName?.trim()) return raw;
  const local = raw.includes('@') ? raw.slice(0, raw.indexOf('@')) : raw;
  return local || 'there';
}

/* ── Overview layout ───────────────────────────────────────────────────── */

export type OverviewPanel =
  | 'attention'
  | 'schedule'
  | 'connectors'
  | 'endpoints';

/**
 * Rough rendered heights in pixels, from row counts. Only used to balance
 * the two columns, so close is good enough.
 */
export function estimatePanelHeight(
  panel: OverviewPanel,
  n: { rows: number; groups?: number; extra?: number },
): number {
  const header = 50;
  switch (panel) {
    case 'attention':
      return n.rows === 0
        ? header + 200
        : header + (n.groups ?? 1) * 40 + n.rows * 64 + 8;
    case 'schedule':
      return n.rows === 0
        ? header + 222
        : header + 32 + n.rows * 57 + (n.extra ? 40 : 0);
    case 'connectors':
      return n.rows === 0 ? header + 240 : header + n.rows * 61;
    case 'endpoints':
      return (
        (n.rows === 0 ? header + 223 : header + 84) +
        (n.extra ? 36 + n.extra * 42 : 0)
      );
  }
}

const SIDE_PANELS = ['schedule', 'connectors', 'endpoints'] as const;

/**
 * Splits the Overview's panels over its two columns on wide screens, so a
 * short attention list does not leave an empty gap beside a tall right
 * column. The attention list always leads the wide left column; the other
 * panels keep their order within a column. Of every split, the one with
 * the shortest page wins (the taller column is as short as it can be);
 * ties keep more panels on the right, then the renewal schedule first.
 */
export function balancePanels(
  heights: Record<OverviewPanel, number>,
  gap = 24,
): { left: OverviewPanel[]; right: OverviewPanel[] } {
  const column = (panels: OverviewPanel[]) =>
    panels.reduce((sum, p, i) => sum + heights[p] + (i > 0 ? gap : 0), 0);
  let best: { left: OverviewPanel[]; right: OverviewPanel[] } | null = null;
  let bestCost = Infinity;
  let bestDiff = Infinity;
  // Masks in order from "everything on the right" (0) up, so a tie keeps
  // the earlier, more right-heavy split.
  for (let mask = 0; mask < 1 << SIDE_PANELS.length; mask++) {
    const left: OverviewPanel[] = ['attention'];
    const right: OverviewPanel[] = [];
    SIDE_PANELS.forEach((p, i) => (mask & (1 << i) ? left : right).push(p));
    const l = column(left);
    const r = column(right);
    const cost = Math.max(l, r);
    const diff = Math.abs(l - r);
    if (cost < bestCost || (cost === bestCost && diff < bestDiff)) {
      best = { left, right };
      bestCost = cost;
      bestDiff = diff;
    }
  }
  return best!;
}
