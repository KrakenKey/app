import {
  Injectable,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { promises as dns } from 'dns';
import { isIP } from 'net';
import type { PublicScanResponse } from '@krakenkey/shared';
import type { PublicScanRequestDto } from './dto/public-scan.dto';

function isPrivateIPv4(ip: string): boolean {
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

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase().replace(/^\[|\]$/g, '');

  if (lower === '::1' || lower === '::') return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // ULA
  if (lower.startsWith('fe80')) return true; // link-local
  if (lower.startsWith('ff')) return true; // multicast
  if (lower.startsWith('2001:db8')) return true; // documentation

  // IPv4-mapped IPv6 (::ffff:x.x.x.x) — extract and check the v4 part
  const v4Mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Mapped) return isPrivateIPv4(v4Mapped[1]);

  return false;
}

@Injectable()
export class PublicScanService {
  constructor(private readonly httpService: HttpService) {}

  async scan(dto: PublicScanRequestDto): Promise<PublicScanResponse> {
    const { hostname, port = 443 } = dto;

    if (isIP(hostname)) {
      throw new BadRequestException(
        'Raw IP addresses are not allowed — use a hostname',
      );
    }

    const resolved = await this.resolveToPublicIPs(hostname);

    try {
      const { data } = await firstValueFrom(
        this.httpService.post('/scan', {
          host: resolved[0],
          port,
          sni: hostname,
        }),
      );

      data.endpoint = { host: hostname, port, sni: hostname };

      return {
        ...data,
        scannedAt: new Date().toISOString(),
      };
    } catch {
      throw new ServiceUnavailableException(
        'Scanner is temporarily unavailable',
      );
    }
  }

  private async resolveToPublicIPs(hostname: string): Promise<string[]> {
    const v4 = await dns.resolve4(hostname).catch(() => [] as string[]);
    const v6 = await dns.resolve6(hostname).catch(() => [] as string[]);
    const addresses = [...v4, ...v6];

    if (addresses.length === 0) {
      throw new BadRequestException('Could not resolve hostname');
    }

    for (const addr of addresses) {
      if (isIP(addr) === 4 && isPrivateIPv4(addr)) {
        throw new BadRequestException('Cannot scan private/internal addresses');
      }
      if (isIP(addr) === 6 && isPrivateIPv6(addr)) {
        throw new BadRequestException('Cannot scan private/internal addresses');
      }
    }

    return addresses;
  }
}
