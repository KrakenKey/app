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
import { getExpirationInfo } from './expiration';
import { connectorStatus, formatRelative } from './connectors';

/**
 * Account health: one list of things that need a person, computed from the
 * data the dashboard already loads (certificates, endpoints and their latest
 * scans, connected probes, connectors, domains). The Overview renders the
 * list; the sidebar shows per-area counts from the same list.
 */

export type HealthSeverity = 'critical' | 'warning' | 'notice';
export type HealthArea =
  | 'certificates'
  | 'endpoints'
  | 'connectors'
  | 'domains';

export interface AttentionItem {
  id: string;
  severity: HealthSeverity;
  area: HealthArea;
  /** Usually a hostname or connector name. */
  title: string;
  detail: string;
  to: string;
}

export const SEVERITY_ORDER: HealthSeverity[] = [
  'critical',
  'warning',
  'notice',
];

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

function days(n: number): string {
  if (n < 0) return `Expired ${-n} day${n === -1 ? '' : 's'} ago`;
  if (n === 0) return 'Expires today';
  return `Expires in ${n} day${n === 1 ? '' : 's'}`;
}

/* ── The list ──────────────────────────────────────────────────────────── */

export interface HealthInput {
  certs: TlsCert[];
  endpoints: Endpoint[];
  latestResults: Record<string, ProbeScanResult[]>;
  probes: ProbeOption[];
  connectors: Connector[];
  domains: Domain[];
  now?: number;
}

export function computeAttention(input: HealthInput): AttentionItem[] {
  const now = input.now ?? Date.now();
  const items: AttentionItem[] = [];
  const certLink = '/dashboard/certificates';
  const endpointLink = '/dashboard/endpoints';

  // Hosts covered by a live certificate: an expiring endpoint on one of
  // these is the certificate's problem and is listed once, there.
  const covered = new Set<string>();

  for (const cert of input.certs) {
    const name = getCertDomains(cert)[0] ?? `Certificate #${cert.id}`;
    const exp = getExpirationInfo(cert);
    const push = (severity: HealthSeverity, detail: string) =>
      items.push({
        id: `cert-${cert.id}`,
        severity,
        area: 'certificates',
        title: name,
        detail,
        to: certLink,
      });

    if (
      cert.status === CertStatus.ISSUED ||
      cert.status === CertStatus.RENEWING
    ) {
      getCertDomains(cert).forEach((d) => covered.add(d));
    }

    switch (cert.status) {
      case CertStatus.FAILED:
        push(
          'critical',
          cert.failureReason
            ? `Issuance failed. ${cert.failureReason}`
            : 'Issuance failed.',
        );
        break;
      case CertStatus.RENEWING:
        push(
          'notice',
          exp
            ? `Renewal in progress. ${days(exp.daysUntilExpiry)}.`
            : 'Renewal in progress.',
        );
        break;
      case CertStatus.PENDING:
      case CertStatus.ISSUING:
        push('notice', 'Issuance in progress.');
        break;
      case CertStatus.AWAITING_CSR:
        push('notice', 'Waiting for its connector to send a CSR.');
        break;
      case CertStatus.ISSUED: {
        if (cert.ariReplacementRequestedAt) {
          push('warning', 'The CA asked for early replacement.');
          break;
        }
        if (!exp || exp.daysUntilExpiry > 30) break;
        const renewal = !cert.autoRenew
          ? 'Auto-renew is off.'
          : cert.renewAfter && new Date(cert.renewAfter).getTime() < now
            ? 'Renewal is due.'
            : 'Auto-renew is on.';
        push(
          exp.daysUntilExpiry <= 7 ? 'critical' : 'warning',
          `${days(exp.daysUntilExpiry)}. ${renewal}`,
        );
        break;
      }
      default:
        break;
    }
  }

  for (const ep of input.endpoints) {
    if (!ep.isActive) continue;
    const s = summarizeEndpoint(ep, input.latestResults[ep.id] ?? []);
    const title = ep.port === 443 ? ep.host : `${ep.host}:${ep.port}`;
    const push = (severity: HealthSeverity, detail: string) =>
      items.push({
        id: `ep-${ep.id}`,
        severity,
        area: 'endpoints',
        title,
        detail,
        to: endpointLink,
      });
    if (s.state === 'unreachable') {
      push('critical', `Unreachable. ${s.error ?? 'Connection failed.'}`);
    } else if (s.state === 'untrusted') {
      const issuer = issuerName(s.untrustedIssuer);
      push(
        'critical',
        `Certificate chain is not trusted${issuer ? ` (issued by ${issuer})` : ''}.`,
      );
    } else if (
      s.state === 'expiring' &&
      s.worstExpiry != null &&
      !covered.has(ep.host)
    ) {
      push(
        s.worstExpiry <= 7 ? 'critical' : 'warning',
        `${days(s.worstExpiry)}.`,
      );
    }
  }

  for (const probe of input.probes) {
    if (probe.status !== 'stale') continue;
    items.push({
      id: `probe-${probe.id}`,
      severity: 'warning',
      area: 'endpoints',
      title: probe.name,
      detail: probe.lastSeenAt
        ? `Probe last reported ${formatRelative(probe.lastSeenAt, now)}.`
        : 'Probe has stopped reporting.',
      to: endpointLink,
    });
  }

  for (const c of input.connectors) {
    const status = connectorStatus(c, now);
    if (status === 'revoked') continue;
    const to = `/dashboard/connectors/${c.id}`;
    const failing = c.deploymentSummary?.failing ?? 0;
    if (failing > 0) {
      items.push({
        id: `con-${c.id}-failing`,
        severity: 'critical',
        area: 'connectors',
        title: c.name,
        detail: `${failing} deployment${failing === 1 ? '' : 's'} failing${c.clientLabel ? ` for ${c.clientLabel}` : ''}.`,
        to,
      });
    }
    if (status === 'stale') {
      items.push({
        id: `con-${c.id}-stale`,
        severity: 'warning',
        area: 'connectors',
        title: c.name,
        detail: c.lastSeenAt
          ? `Not seen since ${formatRelative(c.lastSeenAt, now)}.`
          : 'Not seen recently.',
        to,
      });
    } else if (status === 'expired') {
      items.push({
        id: `con-${c.id}-expired`,
        severity: 'warning',
        area: 'connectors',
        title: c.name,
        detail: 'Enrollment token expired before the connector enrolled.',
        to,
      });
    } else if (status === 'waiting') {
      items.push({
        id: `con-${c.id}-waiting`,
        severity: 'notice',
        area: 'connectors',
        title: c.name,
        detail: 'Waiting to enroll.',
        to,
      });
    }
  }

  for (const d of input.domains) {
    if (d.isVerified) continue;
    items.push({
      id: `dom-${d.id}`,
      severity: 'warning',
      area: 'domains',
      title: d.hostname,
      detail: 'DNS verification pending. Add the TXT and CNAME records.',
      to: '/dashboard/domains',
    });
  }

  const rank = (s: HealthSeverity) => SEVERITY_ORDER.indexOf(s);
  return items.sort((a, b) => rank(a.severity) - rank(b.severity));
}

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
