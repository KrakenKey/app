import { BlockList, isIP } from 'node:net';
import type { ApiKeyScope, ParsedCsr } from '@krakenkey/shared';

/**
 * What a request authenticated with a user API key may do, attached to
 * req.user.apiKey by ApiKeyStrategy. Each null field means "unrestricted",
 * and every restriction only narrows what the key's owner could do anyway.
 */
export interface ApiKeyContext {
  id: string;
  scopes: ApiKeyScope[] | null;
  allowedDomainIds: string[] | null;
  allowedCertIds: number[] | null;
  /** Set when the key was issued to a connector. */
  connectorId?: string | null;
}

/** True when the key is limited to specific domains or certificates. */
export function hasResourceRestrictions(key?: ApiKeyContext | null): boolean {
  return Boolean(key && (key.allowedDomainIds || key.allowedCertIds));
}

/**
 * Parses an allowlist entry: a single address or a CIDR range, IPv4 or
 * IPv6. Returns null when the entry is not valid.
 */
export function parseIpEntry(
  entry: string,
): { address: string; prefix: number; family: 'ipv4' | 'ipv6' } | null {
  const [address, prefixText, ...rest] = entry.trim().split('/');
  if (rest.length > 0) return null;
  const version = isIP(address);
  if (version === 0) return null;
  const family = version === 4 ? 'ipv4' : 'ipv6';
  const max = version === 4 ? 32 : 128;
  if (prefixText === undefined) return { address, prefix: max, family };
  if (!/^\d{1,3}$/.test(prefixText)) return null;
  const prefix = Number(prefixText);
  if (prefix > max) return null;
  return { address, prefix, family };
}

/** Unwraps IPv4-mapped IPv6 (::ffff:203.0.113.5), which Express can report. */
function normalizeIp(ip: string): string {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  return mapped ? mapped[1] : ip;
}

/**
 * Whether ip is inside any of the allowlist entries. An unknown or
 * unparseable ip is never allowed.
 */
export function ipAllowed(ip: string, allowlist: string[]): boolean {
  const addr = normalizeIp(ip);
  const version = isIP(addr);
  if (version === 0) return false;
  const list = new BlockList();
  for (const entry of allowlist) {
    const parsed = parseIpEntry(entry);
    if (!parsed) continue;
    list.addSubnet(parsed.address, parsed.prefix, parsed.family);
  }
  return list.check(addr, version === 4 ? 'ipv4' : 'ipv6');
}

/**
 * Whether a DNS name falls under one of the hostnames: an exact match or a
 * subdomain, with a leading "*." ignored. Same rule as cert issuance uses
 * for verified domains (CsrUtilService.isDomainAllowed).
 */
export function nameCovered(name: string, hostnames: string[]): boolean {
  const lower = name.toLowerCase();
  const base = lower.startsWith('*.') ? lower.slice(2) : lower;
  return hostnames.some((h) => {
    const host = h.toLowerCase();
    return base === host || base.endsWith(`.${host}`);
  });
}

/** The DNS names a certificate covers: the subject CN plus DNS SANs. */
export function certDnsNames(parsed: ParsedCsr | null | undefined): string[] {
  if (!parsed) return [];
  const names = new Set<string>();
  for (const field of parsed.subject ?? []) {
    if (
      (field.name === 'commonName' || field.shortName === 'CN') &&
      typeof field.value === 'string' &&
      field.value
    ) {
      names.add(field.value);
    }
  }
  for (const ext of parsed.extensions ?? []) {
    for (const alt of ext.altNames ?? []) {
      if (alt.type === 2 && alt.value) names.add(alt.value);
    }
  }
  return [...names];
}
