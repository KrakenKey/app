import { Injectable, Logger } from '@nestjs/common';
import { createPrivateKey } from 'crypto';
import { CertIssuerStrategy } from '../interfaces/tls-crt-issuer.interface';
import { DnsProvider } from '../interfaces/dns-provider.interface';
import { ConfigService } from '@nestjs/config/dist/config.service';
import * as acme from 'acme-client';
import { promises as dns } from 'dns';
import { MetricsService } from '../../../metrics/metrics.service';

@Injectable()
export class AcmeIssuerStrategy implements CertIssuerStrategy {
  private readonly logger = new Logger(AcmeIssuerStrategy.name);
  private readonly authZoneDomain: string;
  private readonly dnsResolvers: string[];
  private readonly contactEmail: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly metricsService: MetricsService,
  ) {
    this.authZoneDomain = this.configService.get<string>(
      'KK_ACME_AUTH_ZONE_DOMAIN',
    ) as string;

    const resolvers = this.configService.get<string>('KK_ACME_DNS_RESOLVERS');
    this.dnsResolvers = resolvers
      ? resolvers.split(',').map((s) => s.trim())
      : ['172.64.35.65', '108.162.195.65'];

    this.contactEmail =
      this.configService.get<string>('KK_ACME_CONTACT_EMAIL') ||
      'admin@cloudwalker.it';
  }
  /**
   * Initializes an ACME client with the configured account key and directory,
   * then creates or retrieves the ACME account.
   */
  private async createClient(): Promise<acme.Client> {
    const rawLetsEncryptAccountKey = this.configService.get(
      'KK_ACME_ACCOUNT_KEY',
    ) as string;

    if (!rawLetsEncryptAccountKey) {
      throw new Error('Missing KK_ACME_ACCOUNT_KEY in configuration');
    }

    const letsEncryptAccountKey = this.normalizePrivateKeyPem(
      rawLetsEncryptAccountKey,
    );

    // Determine ACME directory URL.
    // KK_ACME_STAGING=true opts into Let's Encrypt Staging; production is the default.
    // KK_ACME_DIRECTORY_URL overrides both when set.
    let acmeDirectoryUrl = this.configService.get<string>(
      'KK_ACME_DIRECTORY_URL',
    );
    if (!acmeDirectoryUrl) {
      const useStaging =
        this.configService.get<string>('KK_ACME_STAGING')?.toLowerCase() ===
        'true';
      if (useStaging) {
        this.logger.log(
          "Using Let's Encrypt Staging environment for ACME (KK_ACME_STAGING=true)",
        );
        acmeDirectoryUrl = acme.directory.letsencrypt.staging;
      } else {
        this.logger.log("Using Let's Encrypt Production environment for ACME");
        acmeDirectoryUrl = acme.directory.letsencrypt.production;
      }
    } else {
      this.logger.log(`Using custom ACME directory: ${acmeDirectoryUrl}`);
    }

    const client = new acme.Client({
      directoryUrl: acmeDirectoryUrl,
      accountKey: letsEncryptAccountKey,
    });

    await client.createAccount({
      termsOfServiceAgreed: true,
      contact: [`mailto:${this.contactEmail}`],
    });

    return client;
  }

  async issue(csrPem: string, dnsProvider: DnsProvider): Promise<string> {
    const endTimer = this.metricsService.acmeChallengeDuration.startTimer();
    // 1. Initialize ACME client
    const client = await this.createClient();

    // 2. Extract domains from the CSR
    const csrData = acme.crypto.readCsrDomains(csrPem);
    const domains = [csrData.commonName, ...(csrData.altNames || [])].filter(
      (v, i, a) => v && a.indexOf(v) === i,
    );
    this.logger.log(`Creating order for: ${domains.join(', ')}`);

    // 3. Create the Order
    const order = await client.createOrder({
      identifiers: domains.map((domain) => ({ type: 'dns', value: domain })),
    });

    const authorizations = await client.getAuthorizations(order);
    const challengeRecords: { recordName: string }[] = [];

    try {
      for (const authz of authorizations) {
        const domain = authz.identifier.value;
        const challenge = authz.challenges.find((c) => c.type === 'dns-01');

        if (!challenge) throw new Error(`No DNS-01 challenge for ${domain}`);

        // 1. The keyAuthorization is retrieved via getChallengeKeyAuthorization
        const keyAuthorization =
          await client.getChallengeKeyAuthorization(challenge);
        const recordName = `_acme-challenge.${domain}`;

        // 2. Create DNS Record
        await dnsProvider.createRecord(recordName, keyAuthorization);
        challengeRecords.push({ recordName });

        // 3. Wait for DNS propagation
        await this.waitForDns(recordName, keyAuthorization);

        // 4. Notify ACME server that the challenge is ready
        await client.completeChallenge(challenge);

        // 5. Poll for challenge status using the generic waitForValidStatus
        await client.waitForValidStatus(challenge);

        this.logger.log(`Challenge for ${domain} is valid.`);
      }

      // 6. Finalize the order with the CSR
      this.logger.log('Finalizing order...');
      await client.finalizeOrder(order, csrPem);

      // 7. Wait for the CA to actually generate the certificate
      this.logger.log('Waiting for order to be fully processed by CA...');
      await client.waitForValidStatus(order);

      const finalizedOrder = await client.getOrder(order);
      // Handle the string | undefined type safety
      if (!finalizedOrder.certificate) {
        throw new Error('Order finalized but no certificate was returned');
      }

      this.logger.log('Order finalized and certificate obtained.');
      this.logger.log('Downloading certificate PEM...');

      // 8. finalizedOrder contains the URL, client.getCertificate downloads the content
      const certificatePem = await client.getCertificate(finalizedOrder);
      endTimer();
      return certificatePem;
    } finally {
      // 9. Cleanup
      for (const record of challengeRecords) {
        try {
          await dnsProvider.removeRecord(record.recordName);
        } catch {
          this.logger.warn(`Cleanup failed for ${record.recordName}`);
        }
      }
    }
  }

  async revoke(certPem: string, reason?: number): Promise<void> {
    const client = await this.createClient();
    this.logger.log(`Revoking certificate (reason: ${reason ?? 0})...`);
    await client.revokeCertificate(certPem, { reason: reason ?? 0 });
    this.logger.log('Certificate revoked successfully.');
  }

  private async waitForDns(recordName: string, expectedValue: string) {
    const resolver = new dns.Resolver();
    resolver.setServers(this.dnsResolvers);

    const hostname = recordName.replace(/^_acme-challenge\./, '');
    const targetRecord = `${hostname.replace(/\./g, '-')}.${this.authZoneDomain}`;

    for (let i = 0; i < 15; i++) {
      try {
        const records = await resolver.resolveTxt(targetRecord);
        if (records.flat().includes(expectedValue)) {
          this.logger.log(`DNS match found. Cooldown 30s...`);
          await new Promise((res) => setTimeout(res, 30000));
          this.logger.log(`Cooldown complete. Continuing...`);
          return;
        }
      } catch (err) {
        this.logger.warn(
          `DNS lookup attempt failed for ${targetRecord}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      this.logger.log(
        `DNS propagation not yet detected for ${targetRecord}. Retrying in 10s...`,
      );
      await new Promise((res) => setTimeout(res, 10000));
    }
    throw new Error(`DNS propagation failed for ${targetRecord}`);
  }

  /**
   * Normalizes a PEM-encoded private key from an environment variable.
   *
   * Handles common env var issues: literal \n escapes, surrounding quotes,
   * corrupted whitespace, and wrong line wrapping. Validates the key can be
   * parsed by Node.js crypto (OpenSSL 3.x) before returning.
   */
  private normalizePrivateKeyPem(input: string): string {
    let pem = input.trim();

    // Strip surrounding quotes (single or double) from env vars
    if (
      (pem.startsWith("'") && pem.endsWith("'")) ||
      (pem.startsWith('"') && pem.endsWith('"'))
    ) {
      pem = pem.slice(1, -1);
    }

    // Replace literal \n escape sequences with actual newlines
    pem = pem.replace(/\\n/g, '\n');

    // Extract PEM type and base64 body, re-wrap to standard 64-char lines
    const match = pem.match(
      /-----BEGIN\s+([\w\s]+?)-----\s*([\s\S]+?)\s*-----END\s+\1-----/,
    );
    if (!match) {
      throw new Error(
        'KK_ACME_ACCOUNT_KEY is not valid PEM (missing header/footer). ' +
          `Starts with: "${input.slice(0, 30)}..."`,
      );
    }

    const type = match[1].trim();
    const base64 = match[2].replace(/\s/g, '');
    const chunks = base64.match(/.{1,64}/g) || [];
    const normalized = `-----BEGIN ${type}-----\n${chunks.join('\n')}\n-----END ${type}-----`;

    // Validate the key is parseable by OpenSSL before passing to acme-client
    try {
      createPrivateKey(normalized);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `KK_ACME_ACCOUNT_KEY failed OpenSSL parsing after normalization: ${msg}. ` +
          `PEM type: "${type}", base64 length: ${base64.length}`,
      );
    }

    return normalized;
  }
}
