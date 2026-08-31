import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, UnrecoverableError } from 'bullmq';
import { TlsService } from '../tls.service';
import { TlsCrt } from '../entities/tls-crt.entity';
import { InternalUpdateTlsCrtDto } from '../dto/update-tls-crt.dto';
import { CsrUtilService } from '../util/csr-util.service';
import { CertUtilService } from '../util/cert-util.service';
import { AcmeIssuerStrategy } from '../strategies/acme-issuer.strategy';
import type { DnsProvider } from '../interfaces/dns-provider.interface';
import { Inject, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CertStatus } from '@krakenkey/shared';
import type { TlsCertJobPayload } from '@krakenkey/shared';
import { MetricsService } from '../../../metrics/metrics.service';
import { EmailService } from '../../../notifications/email.service';
import type { CertEmailContext } from '../../../notifications/email.service';
import { User } from '../../../users/entities/user.entity';

/**
 * Error detail patterns that indicate a permanent failure — retrying cannot
 * succeed (or, for CA rate limits, cannot succeed within the seconds-scale
 * retry backoff). Anything not matched is treated as transient and retried.
 *
 * acme-client surfaces the ACME problem document's `detail` string as the
 * Error message, so these match detail phrasing, not problem-type URNs.
 */
const PERMANENT_FAILURE_PATTERNS: RegExp[] = [
  // Our own pre-flight validation
  /CSR appears to be invalid/i,
  /Unexpected ACME keyAuthorization format/i,
  /Unable to produce key authorization/i,
  // ACME policy/authorization rejections (Let's Encrypt detail phrasing)
  /refuses to issue/i,
  /Cannot issue for/i,
  /policy forbids issuing/i,
  /CAA record/i,
  /account.+deactivated/i,
  // CA rate limits last hours-to-days; the 5-20s job backoff cannot outwait
  // them, so fail fast and let the user retry deliberately later.
  /too many certificates/i,
  /rate ?limited/i,
];

/**
 * Background job processor for certificate issuance and renewal.
 *
 * Handles both 'tlsCertIssuance' (new certificates) and 'tlsCertRenewal' jobs.
 * Processes ACME DNS-01 challenges using the configured DNS provider.
 *
 * Job retries are configured in tls.service.ts (3 attempts, exponential
 * backoff). Only transient errors (DNS propagation, network, ACME 5xx) are
 * retried; permanent errors abort retries via UnrecoverableError. The cert
 * is marked failed and the user emailed once — when no retry will follow —
 * instead of on every attempt.
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
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
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

    try {
      // Validate CSR format before attempting ACME
      const raw = csrRecord.rawCsr ?? '';
      this.logger.debug(`Validating CSR format for cert #${certId}`);
      if (!raw.includes('-----BEGIN') || !raw.includes('-----END')) {
        throw new Error(
          'CSR appears to be invalid or empty (missing PEM delimiters)',
        );
      }

      const statusDuringProcess = isRenewal
        ? CertStatus.RENEWING
        : CertStatus.ISSUING;
      this.logger.log(
        `Processing certificate ${certId} with status: ${statusDuringProcess}`,
      );

      await this.tlsService.updateInternal(
        csrRecord.id,
        { crtPem: null, chainPem: null },
        statusDuringProcess,
      );

      // ACME issuance handles DNS-01 challenge creation, validation, and cert retrieval
      const fullChainPem = await this.acmeStrategy.issue(
        this.csrUtilService.formatPem(csrRecord.rawCsr),
        this.dnsStrategy,
      );

      const { leaf: crtPem, intermediates: chainPem } =
        this.certUtilService.splitChain(fullChainPem);

      const expiresAt = this.certUtilService.getExpirationDate(crtPem);

      const updateData: InternalUpdateTlsCrtDto & {
        expiresAt: Date;
        lastRenewedAt?: Date;
      } = { crtPem, chainPem, expiresAt };
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

      if (csrRecord.user && !isRenewal) {
        const user = await this.userRepo.findOneBy({ id: csrRecord.user.id });
        if (user && !user.firstCertIssuedAt) {
          user.firstCertIssuedAt = new Date();
          await this.userRepo.save(user);
        }
      }

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
      const message = err instanceof Error ? err.message : String(err);
      const permanent = this.isPermanentFailure(message);
      const attemptsAllowed = job.opts?.attempts ?? 1;
      // attemptsMade is incremented after the attempt finishes, so during
      // processing it equals the number of *previous* attempts.
      const attemptNumber = (job.attemptsMade ?? 0) + 1;
      const willRetry = !permanent && attemptNumber < attemptsAllowed;

      this.logger.error(
        `Error ${isRenewal ? 'renewing' : 'issuing'} certificate #${certId} ` +
          `(attempt ${attemptNumber}/${attemptsAllowed}, ` +
          `${permanent ? 'permanent' : 'transient'}${willRetry ? ', will retry' : ''}): ${message}`,
      );

      if (willRetry) {
        // Keep the in-progress status; BullMQ retries with backoff. Failure
        // bookkeeping and the owner email happen only on the final attempt.
        throw err instanceof Error ? err : new Error(message);
      }

      // No retry will follow: record the failure and notify the owner once.
      this.metricsService.certIssuanceTotal.inc({ status: 'failed' });
      await this.tlsService.updateInternal(
        csrRecord.id,
        { crtPem: null, chainPem: null },
        CertStatus.FAILED,
      );
      if (csrRecord.user) {
        await this.emailService.sendCertFailed({
          userId: csrRecord.user.id,
          username: csrRecord.user.username,
          email: csrRecord.user.email,
          certId,
          commonName,
          errorMessage: message,
        });
      }

      if (permanent) {
        // UnrecoverableError stops BullMQ from consuming remaining attempts.
        throw new UnrecoverableError(message);
      }
      throw err instanceof Error ? err : new Error(message);
    }
  }

  private isPermanentFailure(message: string): boolean {
    return PERMANENT_FAILURE_PATTERNS.some((p) => p.test(message));
  }
}
