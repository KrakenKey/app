import { Injectable } from '@nestjs/common';
import { DnsProvider } from '../interfaces/dns-provider.interface';
import { Cloudflare } from 'cloudflare';
import { ConfigService } from '@nestjs/config/dist/config.service';

@Injectable()
export class CloudflareDnsStrategy implements DnsProvider {
  private readonly client: Cloudflare;
  private readonly authZoneDomain: string;

  constructor(private readonly configService: ConfigService) {
    this.client = new Cloudflare({
      apiToken: this.configService.get('KK_CLOUDFLARE_API_TOKEN'),
    });
    this.authZoneDomain = this.configService.get<string>(
      'KK_ACME_AUTH_ZONE_DOMAIN',
    ) as string;
  }

  async createRecord(
    clientDomain: string,
    challengeToken: string,
  ): Promise<void> {
    const zoneId = this.configService.get<string>('KK_CLOUDFLARE_ZONE_ID');
    const hostname = clientDomain.replace(/^_acme-challenge\./, '');
    const recordName = `${hostname.replace(/\./g, '-')}.${this.authZoneDomain}`;

    await this.client.dns.records.create({
      zone_id: zoneId || '',
      type: 'TXT',
      name: recordName,
      content: challengeToken,
      ttl: 60, // ACME challenges should have low TTL for fast verification
    });
  }

  async removeRecord(clientDomain: string): Promise<void> {
    const zoneId = this.configService.get<string>('KK_CLOUDFLARE_ZONE_ID');
    const hostname = clientDomain.replace(/^_acme-challenge\./, '');
    const recordName =
      `${hostname.replace(/\./g, '-')}.${this.authZoneDomain}` as Cloudflare.DNS.Records.RecordListParams.Name;
    // const name =
    //   `_acme-challenge.${domain}` as Cloudflare.DNS.Records.RecordListParams.Name;

    // 1. Find the record ID first
    const records = await this.client.dns.records.list({
      zone_id: zoneId || '',
      name: recordName,
      type: 'TXT',
    });

    // 2. Delete all matching challenge records (usually just one)
    for (const record of records.result) {
      await this.client.dns.records.delete(record.id, {
        zone_id: zoneId || '',
      });
    }
  }

  // private async getZoneId(domain: string): Promise<string> {
  //   // We look for the "Root" zone. If domain is 'sub.example.com',
  //   // the zone is usually 'example.com'.
  //   const zones = await this.client.zones.list({
  //     name: domain.split('.').slice(-2).join('.'),
  //   });

  //   if (!zones.result.length) {
  //     throw new Error(`Cloudflare Zone for ${domain} not found.`);
  //   }

  //   return zones.result[0].id;
  // }
}
