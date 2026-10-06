import type {
  PublicScanResponse,
  ReportHostResult,
  ReportProblem,
  ReportSeverity,
  ReportSummary,
} from '@krakenkey/shared';

/** Days left at or under which an expiry is a warning. */
export const WARNING_DAYS = 14;
/** Days left at or under which an expiry is a notice. */
export const NOTICE_DAYS = 30;

const SEVERITY_RANK: Record<ReportSeverity, number> = {
  critical: 0,
  warning: 1,
  notice: 2,
  ok: 3,
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Minimum acceptable key sizes; anything smaller is a warning. */
const MIN_KEY_BITS: Record<string, number> = {
  RSA: 2048,
  DSA: 2048,
  ECDSA: 256,
};

const OLD_TLS = new Set(['SSL 3.0', 'TLS 1.0', 'TLS 1.1']);

/**
 * Does a certificate name cover the hostname? Follows RFC 6125: a wildcard
 * is only valid as the whole left-most label and matches exactly one label,
 * so `*.example.com` covers `www.example.com` but not `example.com` or
 * `a.b.example.com`.
 */
export function nameMatches(pattern: string, hostname: string): boolean {
  const p = pattern.toLowerCase().replace(/\.$/, '');
  const h = hostname.toLowerCase().replace(/\.$/, '');
  if (!p.includes('*')) return p === h;
  if (!p.startsWith('*.') || p.indexOf('*', 1) !== -1) return false;
  const suffix = p.slice(1); // ".example.com"
  if (suffix.split('.').length < 3) return false; // no "*.com"
  if (!h.endsWith(suffix)) return false;
  const left = h.slice(0, h.length - suffix.length);
  return left.length > 0 && !left.includes('.');
}

export function hostnameCovered(sans: string[], hostname: string): boolean {
  return sans.some((san) => nameMatches(san, hostname));
}

/** Reads one attribute (CN, O, ...) from a Go pkix.Name string. */
export function dnAttribute(dn: string, attr: string): string | null {
  // Values may contain escaped commas ("\,"); split on unescaped ones.
  for (const part of dn.split(/(?<!\\),/)) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim().toUpperCase() === attr) {
      return part
        .slice(eq + 1)
        .trim()
        .replace(/\\(.)/g, '$1');
    }
  }
  return null;
}

export function issuerName(issuer: string | null | undefined): string | null {
  if (!issuer) return null;
  return dnAttribute(issuer, 'O') ?? dnAttribute(issuer, 'CN') ?? issuer;
}

export function isLetsEncrypt(issuer: string | null | undefined): boolean {
  return /let'?s encrypt/i.test(issuer ?? '');
}

function emptyResult(host: string, port: number): ReportHostResult {
  return {
    host,
    port,
    status: 'pending',
    severity: null,
    problems: [],
    reachable: null,
    error: null,
    tlsVersion: null,
    notAfter: null,
    daysLeft: null,
    issuer: null,
    issuerName: null,
    subject: null,
    sans: [],
    hostnameCovered: null,
    trusted: null,
    chainDepth: null,
    keyType: null,
    keySize: null,
    letsEncrypt: null,
    scannedAt: null,
  };
}

/** A host that has not been scanned yet. */
export function pendingResult(host: string, port: number): ReportHostResult {
  return emptyResult(host, port);
}

function worst(problems: ReportProblem[]): ReportSeverity {
  return problems.reduce<ReportSeverity>(
    (acc, p) =>
      SEVERITY_RANK[p.severity] < SEVERITY_RANK[acc] ? p.severity : acc,
    'ok',
  );
}

/**
 * The scan could not run at all (DNS failure, private address, timeout,
 * scanner down). Always critical: nobody can tell whether the site is fine.
 */
export function classifyFailure(
  host: string,
  port: number,
  message: string,
  now = new Date(),
  code: 'unreachable' | 'scan_failed' = 'scan_failed',
): ReportHostResult {
  const problems: ReportProblem[] = [{ code, severity: 'critical', message }];
  return {
    ...emptyResult(host, port),
    status: code === 'scan_failed' ? 'error' : 'complete',
    severity: 'critical',
    problems,
    reachable: false,
    error: message,
    scannedAt: now.toISOString(),
  };
}

/**
 * Turns a scanner response into a report row with its problems and overall
 * severity.
 *
 * critical: unreachable, no certificate, expired, hostname not covered,
 *           untrusted or incomplete chain
 * warning:  expires within 14 days, TLS older than 1.2, weak key
 * notice:   expires within 30 days
 */
export function classifyScan(
  host: string,
  port: number,
  scan: PublicScanResponse,
  now = new Date(),
): ReportHostResult {
  const result: ReportHostResult = {
    ...emptyResult(host, port),
    status: 'complete',
    reachable: scan.connection.success,
    tlsVersion: scan.connection.tlsVersion ?? null,
    scannedAt: scan.scannedAt ?? now.toISOString(),
  };

  if (!scan.connection.success) {
    const message = scan.connection.error
      ? `Could not connect: ${scan.connection.error}`
      : 'Could not connect';
    result.problems.push({
      code: 'unreachable',
      severity: 'critical',
      message,
    });
    result.error = scan.connection.error ?? null;
    result.severity = 'critical';
    return result;
  }

  const cert = scan.certificate;
  if (!cert) {
    result.problems.push({
      code: 'no_certificate',
      severity: 'critical',
      message: 'The server did not present a certificate',
    });
    result.severity = 'critical';
    return result;
  }

  const sans = cert.sans ?? [];
  result.sans = sans;
  result.subject = cert.subject ?? null;
  result.issuer = cert.issuer ?? null;
  result.issuerName = issuerName(cert.issuer);
  result.letsEncrypt = isLetsEncrypt(cert.issuer);
  result.keyType = cert.keyType ?? null;
  result.keySize = cert.keySize ?? null;
  result.chainDepth = cert.chainDepth ?? null;
  result.trusted = cert.trusted ?? null;
  result.notAfter = cert.notAfter ?? null;

  if (cert.notAfter) {
    const ms = new Date(cert.notAfter).getTime() - now.getTime();
    result.daysLeft = Math.floor(ms / DAY_MS);
  } else if (typeof cert.daysUntilExpiry === 'number') {
    result.daysLeft = cert.daysUntilExpiry;
  }

  const expired =
    cert.notAfter !== undefined
      ? new Date(cert.notAfter).getTime() <= now.getTime()
      : result.daysLeft !== null && result.daysLeft < 0;

  if (expired) {
    result.problems.push({
      code: 'expired',
      severity: 'critical',
      message: `Certificate expired on ${cert.notAfter ?? 'an earlier date'}`,
    });
  }

  result.hostnameCovered = hostnameCovered(sans, host);
  if (!result.hostnameCovered) {
    result.problems.push({
      code: 'hostname_mismatch',
      severity: 'critical',
      message: `Certificate does not cover ${host}`,
    });
  }

  // The probe verifies the chain against system roots without a hostname,
  // so `trusted` covers the chain only. An expired leaf also fails it; the
  // expiry already explains that. Its `chainComplete` flag is false for
  // nearly every server (roots are not sent), so a missing intermediate is
  // inferred from an untrusted leaf sent alone by a different issuer.
  if (cert.trusted === false && !expired) {
    const sentAlone = cert.chainDepth === 1;
    const selfSigned =
      cert.subject !== undefined && cert.subject === cert.issuer;
    if (sentAlone && !selfSigned) {
      result.problems.push({
        code: 'incomplete_chain',
        severity: 'critical',
        message:
          'The server sends no intermediate certificates, so many clients cannot build a trusted chain',
      });
    } else {
      result.problems.push({
        code: 'untrusted_chain',
        severity: 'critical',
        message: selfSigned
          ? 'Self-signed certificate is not trusted'
          : 'Certificate chain is not trusted by public roots',
      });
    }
  }

  if (!expired && result.daysLeft !== null) {
    if (result.daysLeft <= WARNING_DAYS) {
      result.problems.push({
        code: 'expires_soon',
        severity: 'warning',
        message: `Expires in ${result.daysLeft} day${result.daysLeft === 1 ? '' : 's'}`,
      });
    } else if (result.daysLeft <= NOTICE_DAYS) {
      result.problems.push({
        code: 'expires_within_30_days',
        severity: 'notice',
        message: `Expires in ${result.daysLeft} days`,
      });
    }
  }

  if (result.tlsVersion && OLD_TLS.has(result.tlsVersion)) {
    result.problems.push({
      code: 'old_tls',
      severity: 'warning',
      message: `Negotiated ${result.tlsVersion}; use TLS 1.2 or newer`,
    });
  }

  const minBits = cert.keyType ? MIN_KEY_BITS[cert.keyType] : undefined;
  if (minBits && cert.keySize && cert.keySize < minBits) {
    result.problems.push({
      code: 'weak_key',
      severity: 'warning',
      message: `${cert.keyType} ${cert.keySize}-bit key is below ${minBits} bits`,
    });
  }

  result.severity = worst(result.problems);
  return result;
}

/**
 * Most urgent first: severity, then fewest days left (unknown last), then
 * hostname and port. Hosts not scanned yet go to the end.
 */
export function compareHosts(a: ReportHostResult, b: ReportHostResult): number {
  const rank = (r: ReportHostResult) =>
    r.severity === null ? 4 : SEVERITY_RANK[r.severity];
  const bySeverity = rank(a) - rank(b);
  if (bySeverity !== 0) return bySeverity;
  const days = (r: ReportHostResult) => r.daysLeft ?? Number.POSITIVE_INFINITY;
  if (days(a) !== days(b)) return days(a) < days(b) ? -1 : 1;
  return a.host.localeCompare(b.host) || a.port - b.port;
}

export function sortHosts(hosts: ReportHostResult[]): ReportHostResult[] {
  return [...hosts].sort(compareHosts);
}

export function emptyCounts(): Record<ReportSeverity, number> {
  return { critical: 0, warning: 0, notice: 0, ok: 0 };
}

export function summarize(hosts: ReportHostResult[]): ReportSummary {
  const counts = emptyCounts();
  const issuers = new Map<string, number>();
  let scannedHosts = 0;
  let letsEncryptHosts = 0;
  let earliest: ReportSummary['earliestExpiry'] = null;

  for (const h of hosts) {
    if (h.severity) {
      counts[h.severity] += 1;
      scannedHosts += 1;
    }
    if (h.issuerName) {
      issuers.set(h.issuerName, (issuers.get(h.issuerName) ?? 0) + 1);
    }
    if (h.letsEncrypt) letsEncryptHosts += 1;
    if (
      h.notAfter &&
      h.daysLeft !== null &&
      (!earliest || Date.parse(h.notAfter) < Date.parse(earliest.notAfter))
    ) {
      earliest = {
        host: h.host,
        port: h.port,
        notAfter: h.notAfter,
        daysLeft: h.daysLeft,
      };
    }
  }

  return {
    totalHosts: hosts.length,
    scannedHosts,
    counts,
    issuers: [...issuers.entries()]
      .map(([issuer, count]) => ({ issuer, count }))
      .sort((a, b) => b.count - a.count || a.issuer.localeCompare(b.issuer)),
    letsEncryptHosts,
    earliestExpiry: earliest,
  };
}
