import {
  Injectable,
  Logger,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { promises as dns } from 'dns';
import { isIP } from 'net';
import type { PublicScanResponse } from '@krakenkey/shared';
import type { PublicScanRequestDto } from './dto/public-scan.dto';

const PRIVATE_RANGES_V4 = [
  { prefix: '10.', mask: null },
  { prefix: '127.', mask: null },
  { prefix: '0.', mask: null },
  { prefix: '169.254.', mask: null },
  { prefix: '192.168.', mask: null },
];

function isPrivateIPv4(ip: string): boolean {
  for (const range of PRIVATE_RANGES_V4) {
    if (ip.startsWith(range.prefix)) return true;
  }
  // 172.16.0.0/12
  const parts = ip.split('.');
  if (parts[0] === '172') {
    const second = parseInt(parts[1], 10);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  return (
    lower === '::1' ||
    lower.startsWith('fc') ||
    lower.startsWith('fd') ||
    lower.startsWith('fe80')
  );
}

@Injectable()
export class PublicScanService {
  private readonly logger = new Logger(PublicScanService.name);

  constructor(private readonly httpService: HttpService) {}

  async scan(dto: PublicScanRequestDto): Promise<PublicScanResponse> {
    const { hostname, port = 443 } = dto;

    if (isIP(hostname)) {
      throw new BadRequestException(
        'Raw IP addresses are not allowed — use a hostname',
      );
    }

    await this.checkSSRF(hostname);

    try {
      const { data } = await firstValueFrom(
        this.httpService.post('/scan', { host: hostname, port }),
      );

      return {
        ...data,
        scannedAt: new Date().toISOString(),
      };
    } catch (err) {
      if (err?.response?.data?.error) {
        throw new BadRequestException(err.response.data.error);
      }
      this.logger.error('Probe scan request failed', err?.message);
      throw new ServiceUnavailableException(
        'Scanner is temporarily unavailable',
      );
    }
  }

  private async checkSSRF(hostname: string): Promise<void> {
    let addresses: string[] = [];

    try {
      const v4 = await dns.resolve4(hostname).catch(() => [] as string[]);
      const v6 = await dns.resolve6(hostname).catch(() => [] as string[]);
      addresses = [...v4, ...v6];
    } catch {
      throw new BadRequestException('Could not resolve hostname');
    }

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
  }
}
