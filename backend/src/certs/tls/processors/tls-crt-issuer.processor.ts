import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { TlsService } from '../tls.service';
import { TlsCrt } from '../entities/tls-crt.entity';
import { InternalUpdateTlsCrtDto } from '../dto/update-tls-crt.dto';
import { CsrUtilService } from '../util/csr-util.service';
import { CertUtilService } from '../util/cert-util.service';
import { AcmeIssuerStrategy } from '../strategies/acme-issuer.strategy';
import type { DnsProvider } from '../interfaces/dns-provider.interface';
import { Inject } from '@nestjs/common';
import { CertStatus } from '@krakenkey/shared';
import type { TlsCertJobPayload } from '@krakenkey/shared';

/**
 * Background job processor for certificate issuance and renewal.
 *
 * Handles both 'tlsCertIssuance' (new certificates) and 'tlsCertRenewal' jobs.
 * Processes ACME DNS-01 challenges using the configured DNS provider.
 *
 * Job retries are configured in tls.service.ts (3 attempts, exponential backoff).
 */
@Processor('tlsCertIssuance')
export class CertIssuerConsumer extends WorkerHost {
  constructor(
    private readonly tlsService: TlsService,
    private readonly acmeStrategy: AcmeIssuerStrategy,
    @Inject('DNS_PROVIDER') private readonly dnsStrategy: DnsProvider,
    private readonly csrUtilService: CsrUtilService,
    private readonly certUtilService: CertUtilService,
  ) {
    super();
  }

  /**
   * Processes certificate issuance or renewal job.
   *
   * Flow:
   * 1. Fetch CSR from database
   * 2. Validate CSR PEM format
   * 3. Issue certificate via ACME (DNS-01 challenge)
   * 4. Parse expiration date from issued certificate
   * 5. Update database with certificate and status
   *
   * On failure, updates status to 'failed' and job retries automatically.
   */
  async process(job: Job<TlsCertJobPayload>): Promise<{ success: boolean }> {
    const isRenewal = job.name === 'tlsCertRenewal';

    const { certId } = job.data;
    const csrRecord = (await this.tlsService.findOneInternal(certId)) as TlsCrt;
    if (!csrRecord) {
      throw new Error(`CSR with ID ${certId} not found`);
    }

    // Validate CSR format before attempting ACME
    const raw = csrRecord.rawCsr ?? '';
    console.log(`CSR preview: ${raw.slice(0, 60).replace(/\n/g, ' ')}...`);
    if (!raw.includes('-----BEGIN') || !raw.includes('-----END')) {
      await this.tlsService.updateInternal(
        csrRecord.id,
        { crtPem: null },
        CertStatus.FAILED,
      );
      throw new Error(
        'CSR appears to be invalid or empty (missing PEM delimiters)',
      );
    }

    try {
      const statusDuringProcess = isRenewal
        ? CertStatus.RENEWING
        : CertStatus.ISSUING;
      console.log(
        `Processing certificate ${certId} with status: ${statusDuringProcess}`,
      );

      await this.tlsService.updateInternal(
        csrRecord.id,
        { crtPem: null },
        statusDuringProcess,
      );

      // ACME issuance handles DNS-01 challenge creation, validation, and cert retrieval
      const crtPem = await this.acmeStrategy.issue(
        this.csrUtilService.formatPem(csrRecord.rawCsr),
        this.dnsStrategy,
      );

      const expiresAt = this.certUtilService.getExpirationDate(crtPem);

      const updateData: InternalUpdateTlsCrtDto & {
        expiresAt: Date;
        lastRenewedAt?: Date;
      } = { crtPem, expiresAt };
      if (isRenewal) {
        updateData.lastRenewedAt = new Date();
      }

      await this.tlsService.updateInternal(
        csrRecord.id,
        updateData,
        CertStatus.ISSUED,
      );

      console.log(
        `Certificate ${isRenewal ? 'renewed' : 'issued'} for ID: ${certId}, expires: ${expiresAt.toISOString()}`,
      );

      return { success: true };
    } catch (err: unknown) {
      // Mark as failed and let BullMQ retry the job
      await this.tlsService.updateInternal(
        csrRecord.id,
        { crtPem: null },
        CertStatus.FAILED,
      );
      if (err instanceof Error) {
        console.error(
          `Error ${isRenewal ? 'renewing' : 'issuing'} certificate:`,
          err.message,
        );
        throw err;
      }
      console.error('Unknown error:', err);
      throw new Error('Unknown error processing certificate');
    }
  }
}
