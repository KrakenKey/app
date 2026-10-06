import { promises as dns } from 'dns';
import { isIP } from 'net';

/**
 * Helpers that keep server-side requests away from private and internal
 * networks. Used by the public TLS scan and by webhook notification
 * delivery.
 */

export function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p))) return true;
  const [a, b] = parts;

  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // 127.0.0.0/8
  if (a === 169 && b === 254) return true; // 169.254.0.0/16
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 (CGNAT)
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15
  if (a >= 240) return true; // 240.0.0.0/4 (reserved) + broadcast

  return false;
}

export function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase().replace(/^\[|\]$/g, '');

  if (lower === '::1' || lower === '::') return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // ULA
  if (lower.startsWith('fe80')) return true; // link-local
  if (lower.startsWith('ff')) return true; // multicast
  if (lower.startsWith('2001:db8')) return true; // documentation

  // IPv4-mapped IPv6 (::ffff:x.x.x.x) — extract and check the v4 part
  const v4Mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Mapped) return isPrivateIPv4(v4Mapped[1]);

  // Same, in the hex form URL parsers normalise to (::ffff:7f00:1)
  const v4MappedHex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (v4MappedHex) {
    const hi = parseInt(v4MappedHex[1], 16);
    const lo = parseInt(v4MappedHex[2], 16);
    return isPrivateIPv4(`${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`);
  }

  return false;
}

/** True for any IP literal (v4 or v6) in a private or reserved range. */
export function isPrivateIP(ip: string): boolean {
  const bare = ip.replace(/^\[|\]$/g, '');
  const family = isIP(bare);
  if (family === 4) return isPrivateIPv4(bare);
  if (family === 6) return isPrivateIPv6(bare);
  return true;
}

export type SsrfErrorReason = 'unresolvable' | 'private';

export class SsrfError extends Error {
  constructor(
    readonly reason: SsrfErrorReason,
    message: string,
  ) {
    super(message);
    this.name = 'SsrfError';
  }
}

/**
 * Resolves a hostname over DNS (A and AAAA) and returns its addresses.
 * Throws SsrfError('unresolvable') when nothing resolves and
 * SsrfError('private') when any address is private or internal.
 */
export async function resolveToPublicIPs(hostname: string): Promise<string[]> {
  const v4 = await dns.resolve4(hostname).catch(() => [] as string[]);
  const v6 = await dns.resolve6(hostname).catch(() => [] as string[]);
  const addresses = [...v4, ...v6];

  if (addresses.length === 0) {
    throw new SsrfError('unresolvable', 'Could not resolve hostname');
  }

  for (const addr of addresses) {
    if (isPrivateIP(addr)) {
      throw new SsrfError(
        'private',
        'Hostname resolves to a private or internal address',
      );
    }
  }

  return addresses;
}
