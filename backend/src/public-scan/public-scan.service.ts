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
