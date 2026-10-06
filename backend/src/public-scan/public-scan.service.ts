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
import { resolveToPublicIPs, SsrfError } from '../common/net/ssrf';

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

    const resolved = await this.resolveToPublicIPs(hostname);

    try {
      const body = { host: resolved[0], port, sni: hostname };
      const request = options.timeoutMs
        ? this.httpService.post('/scan', body, { timeout: options.timeoutMs })
        : this.httpService.post('/scan', body);
      const { data } = await firstValueFrom(request);

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
    try {
      return await resolveToPublicIPs(hostname);
    } catch (err) {
      if (err instanceof SsrfError) {
        throw new BadRequestException(
          err.reason === 'unresolvable'
            ? 'Could not resolve hostname'
            : 'Cannot scan private/internal addresses',
        );
      }
      throw err;
    }
  }
}
