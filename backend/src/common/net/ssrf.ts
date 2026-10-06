import { BadRequestException } from '@nestjs/common';
import { promises as dns } from 'dns';
import { isIP } from 'net';

/**
 * Guards for outbound scans of user-supplied hostnames. Shared by the public
 * scanner and portfolio reports so both refuse the same address ranges.
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

  // IPv4-mapped IPv6 (::ffff:x.x.x.x): extract and check the v4 part
  const v4Mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Mapped) return isPrivateIPv4(v4Mapped[1]);

  return false;
}

/** True for any IPv4/IPv6 address in a private, internal or reserved range. */
export function isPrivateAddress(addr: string): boolean {
  const family = isIP(addr);
  if (family === 4) return isPrivateIPv4(addr);
  if (family === 6) return isPrivateIPv6(addr);
  return false;
}

/** True when the string is an IP literal (bracketed IPv6 included). */
export function isIpLiteral(value: string): boolean {
  return isIP(value.replace(/^\[|\]$/g, '')) !== 0;
}

/**
 * Resolves a hostname and refuses it when any address is private or
 * internal. Returns every resolved address; callers connect to the first so
 * the name is not resolved a second time (DNS rebinding).
 */
export async function resolveToPublicIPs(hostname: string): Promise<string[]> {
  const v4 = await dns.resolve4(hostname).catch(() => [] as string[]);
  const v6 = await dns.resolve6(hostname).catch(() => [] as string[]);
  const addresses = [...v4, ...v6];

  if (addresses.length === 0) {
    throw new BadRequestException('Could not resolve hostname');
  }

  for (const addr of addresses) {
    if (isPrivateAddress(addr)) {
      throw new BadRequestException('Cannot scan private/internal addresses');
    }
  }

  return addresses;
}
