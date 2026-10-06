import {
  Injectable,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { isIP } from 'net';
import type { PublicScanResponse } from '@krakenkey/shared';
import type { PublicScanRequestDto } from './dto/public-scan.dto';
import { resolveToPublicIPs } from '../common/net/ssrf';

export interface ScanHostOptions {
  /** Overrides the HTTP client's default timeout for the scanner call. */
  timeoutMs?: number;
}

@Injectable()
export class PublicScanService {
  constructor(private readonly httpService: HttpService) {}

  scan(dto: PublicScanRequestDto): Promise<PublicScanResponse> {
    const { hostname, port = 443 } = dto;
    return this.scanHost(hostname, port);
  }

  /**
   * Scans one host through the internal probe scanner. Refuses IP literals
   * and names that resolve to private addresses (BadRequestException), and
   * reports scanner failures and timeouts as ServiceUnavailableException.
   * A host that is resolvable but not reachable is not an error: the result
   * has `connection.success: false`.
   */
  async scanHost(
    hostname: string,
    port: number,
    options: ScanHostOptions = {},
  ): Promise<PublicScanResponse> {
    if (isIP(hostname)) {
      throw new BadRequestException(
        'Raw IP addresses are not allowed — use a hostname',
      );
    }

    const resolved = await resolveToPublicIPs(hostname);

    try {
      const { data } = await firstValueFrom(
        this.httpService.post(
          '/scan',
          {
            host: resolved[0],
            port,
            sni: hostname,
          },
          options.timeoutMs ? { timeout: options.timeoutMs } : undefined,
        ),
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
}
