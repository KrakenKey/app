import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { TlsService } from '../tls.service';
import { TlsCrt } from '../entities/tls-crt.entity';
import { InternalUpdateTlsCrtDto } from '../dto/update-tls-crt.dto';
import { CsrUtilService } from '../util/csr-util.service';
import { CertUtilService } from '../util/cert-util.service';
import { AcmeIssuerStrategy } from '../strategies/acme-issuer.strategy';
import type { DnsProvider } from '../interfaces/dns-provider.interface';
import { Inject, Logger } from '@nestjs/common';
import { CertStatus } from '@krakenkey/shared';
import type { TlsCertJobPayload } from '@krakenkey/shared';
import { MetricsService } from '../../../metrics/metrics.service';
import { EmailService } from '../../../notifications/email.service';
import type { CertEmailContext } from '../../../notifications/email.service';

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
  private readonly logger = new Logger(CertIssuerConsumer.name);

  constructor(
    private readonly tlsService: TlsService,
    private readonly acmeStrategy: AcmeIssuerStrategy,
    @Inject('DNS_PROVIDER') private readonly dnsStrategy: DnsProvider,
    private readonly csrUtilService: CsrUtilService,
    private readonly certUtilService: CertUtilService,
    private readonly metricsService: MetricsService,
    private readonly emailService: EmailService,
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
    const csrRecord = (await this.tlsService.findOneInternal(certId, {
      relations: ['user'],
    })) as TlsCrt;
    if (!csrRecord) {
      throw new Error(`CSR with ID ${certId} not found`);
    }

    const commonName =
      (csrRecord.parsedCsr?.subject?.find((a) => a.shortName === 'CN')
        ?.value as string) ??
      csrRecord.parsedCsr?.extensions?.[0]?.altNames?.[0]?.value ??
      `cert #${certId}`;

    // Validate CSR format before attempting ACME
    const raw = csrRecord.rawCsr ?? '';
    this.logger.debug(`Validating CSR format for cert #${certId}`);
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
      this.logger.log(
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

      this.logger.log(
        `Certificate ${isRenewal ? 'renewed' : 'issued'} for ID: ${certId}, expires: ${expiresAt.toISOString()}`,
      );

      this.metricsService.certIssuanceTotal.inc({ status: 'issued' });

      if (csrRecord.user) {
        const ctx: CertEmailContext = {
          userId: csrRecord.user.id,
          username: csrRecord.user.username,
          email: csrRecord.user.email,
          certId,
          commonName,
          expiresAt,
        };
        if (isRenewal) {
          await this.emailService.sendCertRenewed(ctx);
        } else {
          await this.emailService.sendCertIssued(ctx);
        }
      }

      return { success: true };
    } catch (err: unknown) {
      this.metricsService.certIssuanceTotal.inc({ status: 'failed' });
      // Mark as failed and let BullMQ retry the job
      await this.tlsService.updateInternal(
        csrRecord.id,
        { crtPem: null },
        CertStatus.FAILED,
      );
      if (csrRecord.user) {
        await this.emailService.sendCertFailed({
          userId: csrRecord.user.id,
          username: csrRecord.user.username,
          email: csrRecord.user.email,
          certId,
          commonName,
          errorMessage: err instanceof Error ? err.message : String(err),
        });
      }

      if (err instanceof Error) {
        this.logger.error(
          `Error ${isRenewal ? 'renewing' : 'issuing'} certificate #${certId}: ${err.message}`,
        );
        throw err;
      }
      this.logger.error(`Unknown error processing certificate #${certId}`, err);
      throw new Error('Unknown error processing certificate');
    }
  }
}
