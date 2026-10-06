import { isIpLiteral, isPrivateIP } from '../common/net/ssrf';

export interface ReportTarget {
  host: string;
  port: number;
}

export interface ParsedHostList {
  targets: ReportTarget[];
  /** One entry per rejected line, e.g. `"10.0.0.1": IP addresses are not allowed` */
  errors: string[];
}

const DEFAULT_PORT = 443;
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Names that never resolve to something public. */
const INTERNAL_SUFFIXES = [
  'localhost',
  'local',
  'internal',
  'intranet',
  'lan',
  'home.arpa',
  'localdomain',
];

/**
 * Checks a lowercase hostname without a trailing dot. Returns a reason when
 * it is not a public fully qualified domain name.
 */
export function hostnameProblem(host: string): string | null {
  if (host.length === 0) return 'empty hostname';
  if (host.length > 253) return 'hostname is longer than 253 characters';
  if (isIpLiteral(host)) {
    return isPrivateIP(host)
      ? 'private IP addresses are not allowed'
      : 'IP addresses are not allowed, use a hostname';
  }
  if (host.includes('*')) return 'wildcards are not allowed';
  const labels = host.split('.');
  if (labels.length < 2) return 'not a fully qualified domain name';
  if (!labels.every((l) => LABEL.test(l))) return 'not a valid hostname';
  if (/^[0-9]+$/.test(labels[labels.length - 1])) {
    return 'not a valid hostname';
  }
  if (INTERNAL_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`))) {
    return 'internal names are not allowed';
  }
  return null;
}

/**
 * Parses one line of the host list: `host`, `host:port`, or a URL such as
 * `https://host:port/path`. Returns the target or a reason it was refused.
 */
export function parseHostEntry(raw: string): ReportTarget | string {
  let value = raw.trim().toLowerCase();
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, ''); // scheme
  // Path, query, fragment. A single-character search stays linear on long
  // input, unlike /[/?#].*$/.
  const end = value.search(/[/?#]/);
  if (end !== -1) value = value.slice(0, end);
  if (value.includes('@')) return 'credentials are not allowed';

  let host = value;
  let port = DEFAULT_PORT;

  if (value.startsWith('[')) {
    // Bracketed IPv6, with or without a port: always an IP literal.
    return hostnameProblem(value.replace(/\]:\d+$/, ']')) ?? 'invalid host';
  }
  if ((value.match(/:/g) ?? []).length > 1) {
    // Bare IPv6 literal
    return hostnameProblem(value) ?? 'invalid host';
  }

  const colon = value.lastIndexOf(':');
  if (colon !== -1) {
    host = value.slice(0, colon);
    const portText = value.slice(colon + 1);
    if (!/^\d{1,5}$/.test(portText)) return 'invalid port';
    port = Number(portText);
    if (port < 1 || port > 65535) return 'port must be between 1 and 65535';
  }

  host = host.replace(/\.$/, '');
  const problem = hostnameProblem(host);
  if (problem) return problem;
  return { host, port };
}

/**
 * Parses the submitted host list: skips blank lines and duplicates
 * (same host and port), and collects every invalid line.
 */
export function parseHostList(lines: string[]): ParsedHostList {
  const seen = new Set<string>();
  const targets: ReportTarget[] = [];
  const errors: string[] = [];

  for (const line of lines) {
    if (line.trim() === '') continue;
    const parsed = parseHostEntry(line);
    if (typeof parsed === 'string') {
      errors.push(`"${line.trim().slice(0, 100)}": ${parsed}`);
      continue;
    }
    const key = `${parsed.host}:${parsed.port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push(parsed);
  }

  return { targets, errors };
}
