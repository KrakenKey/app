import { Injectable } from '@nestjs/common';
import { DnsProvider } from '../interfaces/dns-provider.interface';
import { ConfigService } from '@nestjs/config/dist/config.service';
import {
  Route53Client,
  ChangeResourceRecordSetsCommand,
  ListResourceRecordSetsCommand,
} from '@aws-sdk/client-route-53';

/**
 * AWS Route53 implementation of the DnsProvider interface.
 * Manages TXT records for ACME DNS-01 challenges.
 */
@Injectable()
export class Route53DnsStrategy implements DnsProvider {
  private readonly client: Route53Client;
  private readonly authZoneDomain: string;

  constructor(private readonly configService: ConfigService) {
    // Credentials are resolved via the default AWS credential chain:
    // env vars (AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY), IAM roles, instance profiles, etc.
    this.client = new Route53Client({
      region: this.configService.get<string>('AWS_REGION') || 'us-east-1',
    });
    this.authZoneDomain = this.configService.get<string>(
      'KK_ACME_AUTH_ZONE_DOMAIN',
    ) as string;
  }
  /**
   * Creates (or updates) a TXT record for an ACME challenge.
   * Uses UPSERT so re-issuing for the same domain won't fail on duplicates.
   */
  async createRecord(
    clientDomain: string,
    challengeToken: string,
  ): Promise<void> {
    const hostedZoneId = this.configService.get<string>(
      'KK_AWS_ROUTE53_HOSTED_ZONE_ID',
    );
    // Strip the _acme-challenge. prefix, then flatten dots to dashes
    // so "_acme-challenge.sub.example.com" becomes "sub-example-com.{authZoneDomain}"
    const hostname = clientDomain.replace(/^_acme-challenge\./, '');
    const recordName = `${hostname.replace(/\./g, '-')}.${this.authZoneDomain}`;

    await this.client.send(
      new ChangeResourceRecordSetsCommand({
        HostedZoneId: hostedZoneId,
        ChangeBatch: {
          Changes: [
            {
              Action: 'UPSERT',
              ResourceRecordSet: {
                Name: recordName,
                Type: 'TXT',
                TTL: 60, // Low TTL for fast ACME verification
                // Route53 requires TXT values wrapped in double quotes
                ResourceRecords: [{ Value: `"${challengeToken}"` }],
              },
            },
          ],
        },
      }),
    );
  }

  /**
   * Removes the TXT challenge record after ACME validation is complete.
   * Route53 DELETE requires the exact record payload, so we look it up first.
   */
  async removeRecord(clientDomain: string): Promise<void> {
    const hostedZoneId = this.configService.get<string>(
      'KK_AWS_ROUTE53_HOSTED_ZONE_ID',
    );
    const hostname = clientDomain.replace(/^_acme-challenge\./, '');
    const recordName = `${hostname.replace(/\./g, '-')}.${this.authZoneDomain}`;

    // Look up the existing record so we can pass the full payload to DELETE
    const listResponse = await this.client.send(
      new ListResourceRecordSetsCommand({
        HostedZoneId: hostedZoneId,
        StartRecordName: recordName,
        StartRecordType: 'TXT',
        MaxItems: 1,
      }),
    );

    // Route53 returns names with a trailing dot ("example.com."), so match both forms
    const matchingRecords = (listResponse.ResourceRecordSets || []).filter(
      (r) => r.Name === `${recordName}.` || r.Name === recordName,
    );

    for (const record of matchingRecords) {
      await this.client.send(
        new ChangeResourceRecordSetsCommand({
          HostedZoneId: hostedZoneId,
          ChangeBatch: {
            Changes: [
              {
                Action: 'DELETE',
                ResourceRecordSet: record,
              },
            ],
          },
        }),
      );
    }
  }
}
