import {
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { CreateTlsCrtDto } from './dto/create-tls-crt.dto';
import {
  UpdateTlsCrtDto,
  InternalUpdateTlsCrtDto,
} from './dto/update-tls-crt.dto';
import { CsrUtilService } from './util/csr-util.service';
import { CertUtilService } from './util/cert-util.service';
import { TlsCrt } from './entities/tls-crt.entity';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DomainsService } from '../../domains/domains.service';
import { CertStatus } from '@krakenkey/shared';
import type {
  CreateTlsCertResponse,
  RenewTlsCertResponse,
  RetryTlsCertResponse,
  RevokeTlsCertResponse,
  TlsCertJobPayload,
  TlsCertDetails,
} from '@krakenkey/shared';
import { AcmeIssuerStrategy } from './strategies/acme-issuer.strategy';
import { EmailService } from '../../notifications/email.service';

/**
 * Manages TLS certificate lifecycle through a job queue.
 *
 * Certificate states:
 * - pending: CSR validated, awaiting ACME issuance
 * - issuing: Background job processing ACME challenge
 * - issued: Certificate successfully issued
 * - failed: ACME challenge or issuance failed
 * - renewing: Certificate renewal in progress
 */
@Injectable()
export class TlsService {
  constructor(
    @InjectRepository(TlsCrt)
    private readonly TlsCrtRepository: Repository<TlsCrt>,
    @InjectQueue('tlsCertIssuance')
    private readonly tlsCertQueue: Queue,
    private readonly csrUtilService: CsrUtilService,
    private readonly certUtilService: CertUtilService,
    private readonly domainsService: DomainsService,
    private readonly acmeIssuerStrategy: AcmeIssuerStrategy,
    private readonly emailService: EmailService,
  ) {}

  /**
   * Retrieves all certificates for a user.
   */
  async findAll(userId: string): Promise<TlsCrt[]> {
    return this.TlsCrtRepository.find({ where: { userId } });
  }

  /**
   * Creates a new certificate request and queues it for issuance.
   *
   * Flow:
   * 1. Validate CSR (signature, key strength, PEM format)
   * 2. Save CSR with 'pending' status
   * 3. Queue background job for ACME challenge and issuance
   * 4. Return certificate ID and status
   *
   * The background job (tlsCertIssuance) handles the actual ACME interaction.
   * Job retries 3 times with exponential backoff on failure.
   */
  async create(userId: string, createTlsCrtDto: CreateTlsCrtDto) {
    const csr = await this.csrUtilService.validateAndParse(
      createTlsCrtDto.csrPem,
    );
    if (!csr) {
      throw new Error('Invalid CSR PEM format');
    }

    // Domain authorization check: Ensure user owns all domains in CSR
    const userDomains = await this.domainsService.findAllVerified(userId);
    if (userDomains.length === 0) {
      throw new BadRequestException(
        'No verified domains found. Verify at least one domain before requesting certificates.',
      );
    }

    const allowedDomainNames = userDomains.map((d) => d.hostname);
    this.csrUtilService.isAuthorized(csr.domains, allowedDomainNames);
    // This throws BadRequestException if any domain is unauthorized

    const savedCsr = await this.TlsCrtRepository.save({
      rawCsr: csr.raw,
      parsedCsr: csr.parsed,
      status: CertStatus.PENDING,
      userId,
    });
    // Queue background job for ACME issuance
    const jobPayload: TlsCertJobPayload = { certId: savedCsr.id };
    await this.tlsCertQueue.add('tlsCertIssuance', jobPayload, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });

    const response: CreateTlsCertResponse = {
      id: savedCsr.id,
      status: savedCsr.status,
    };
    return response;
  }

  async findOne(id: number, userId: string) {
    const tlsCrt = await this.TlsCrtRepository.findOneBy({ id, userId });
    if (!tlsCrt) {
      throw new NotFoundException(
        `Certificate #${id} not found or access denied`,
      );
    }
    return tlsCrt;
  }

  async getDetails(id: number, userId: string): Promise<TlsCertDetails> {
    const cert = await this.findOne(id, userId);

    if (!cert.crtPem) {
      throw new BadRequestException(
        'Certificate has not been issued yet. Details are only available for issued certificates.',
      );
    }

    return this.certUtilService.getDetails(cert.crtPem);
  }

  async update(
    id: number,
    userId: string,
    updateTlsCrtDto: UpdateTlsCrtDto,
    status?: CertStatus,
  ) {
    const cert = await this.findOne(id, userId); // Verifies ownership
    await this.TlsCrtRepository.update(cert.id, { ...updateTlsCrtDto, status });
    return this.findOne(id, userId);
  }

  async revoke(id: number, userId: string, reason?: number) {
    const cert = await this.TlsCrtRepository.findOne({
      where: { id, userId },
      relations: ['user'],
    });
    if (!cert) {
      throw new NotFoundException(
        `Certificate #${id} not found or access denied`,
      );
    }

    if (cert.status !== CertStatus.ISSUED) {
      throw new BadRequestException(
        `Certificate must be in 'issued' state to revoke. Current status: ${cert.status}`,
      );
    }

    if (!cert.crtPem) {
      throw new BadRequestException(
        'Certificate has no PEM data, cannot revoke',
      );
    }

    await this.TlsCrtRepository.update(cert.id, {
      status: CertStatus.REVOKING,
    });

    try {
      await this.acmeIssuerStrategy.revoke(cert.crtPem, reason);

      await this.TlsCrtRepository.update(cert.id, {
        status: CertStatus.REVOKED,
        revocationReason: reason ?? 0,
        revokedAt: new Date(),
      });

      if (cert.user) {
        const commonName =
          cert.parsedCsr?.subject?.find((a) => a.shortName === 'CN')
            ?.value as string ??
          cert.parsedCsr?.extensions?.[0]?.altNames?.[0]?.value ??
          `cert #${cert.id}`;
        this.emailService.sendCertRevoked({
          username: cert.user.username,
          email: cert.user.email,
          certId: cert.id,
          commonName,
        });
      }
    } catch (err) {
      const logger = new Logger(TlsService.name);
      logger.error(
        `ACME revocation failed for cert #${cert.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
      await this.TlsCrtRepository.update(cert.id, {
        status: CertStatus.ISSUED,
      });
      throw new InternalServerErrorException('Certificate revocation failed');
    }

    const response: RevokeTlsCertResponse = {
      id: cert.id,
      status: CertStatus.REVOKED,
    };
    return response;
  }

  /**
   * Deletes a certificate record.
   * Only failed or revoked certificates can be deleted.
   */
  async remove(id: number, userId: string) {
    const cert = await this.findOne(id, userId);

    if (
      cert.status !== CertStatus.FAILED &&
      cert.status !== CertStatus.REVOKED
    ) {
      throw new BadRequestException(
        `Only failed or revoked certificates can be deleted. Current status: ${cert.status}`,
      );
    }

    await this.TlsCrtRepository.delete(cert.id);
    return { id: cert.id };
  }

  /**
   * Renews an existing certificate using the original CSR.
   *
   * Requirements:
   * - Certificate must be in 'issued' state
   * - Original CSR must be available
   *
   * Queues a separate 'tlsCertRenewal' job to handle ACME renewal.
   */
  async renew(id: number, userId: string) {
    const cert = await this.findOne(id, userId);

    if (cert.status !== CertStatus.ISSUED) {
      throw new BadRequestException(
        `Certificate must be in 'issued' state to renew. Current status: ${cert.status}`,
      );
    }

    if (!cert.rawCsr) {
      throw new BadRequestException(
        'Certificate missing CSR data, cannot renew',
      );
    }

    await this.TlsCrtRepository.update(cert.id, {
      status: CertStatus.RENEWING,
    });

    // Queue renewal job (separate from initial issuance)
    const jobPayload: TlsCertJobPayload = { certId: cert.id };
    await this.tlsCertQueue.add('tlsCertRenewal', jobPayload, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });

    const response: RenewTlsCertResponse = {
      id: cert.id,
      status: CertStatus.RENEWING,
    };
    return response;
  }

  /**
   * Retries a failed certificate issuance using the original CSR.
   *
   * Requirements:
   * - Certificate must be in 'failed' state
   * - Original CSR must be available
   *
   * Re-queues the original 'tlsCertIssuance' job.
   */
  async retry(id: number, userId: string) {
    const cert = await this.findOne(id, userId);

    if (cert.status !== CertStatus.FAILED) {
      throw new BadRequestException(
        `Certificate must be in 'failed' state to retry. Current status: ${cert.status}`,
      );
    }

    if (!cert.rawCsr) {
      throw new BadRequestException(
        'Certificate missing CSR data, cannot retry',
      );
    }

    await this.TlsCrtRepository.update(cert.id, {
      status: CertStatus.PENDING,
    });

    const jobPayload: TlsCertJobPayload = { certId: cert.id };
    await this.tlsCertQueue.add('tlsCertIssuance', jobPayload, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });

    const response: RetryTlsCertResponse = {
      id: cert.id,
      status: CertStatus.PENDING,
    };
    return response;
  }

  // --- Internal System Methods (No User Check) ---

  /**
   * @internal
   * SYSTEM USE ONLY. Do not use this in Controllers.
   * Bypasses all ownership checks. Intended for background jobs (Queue Processors) only.
   */
  async findOneInternal(
    id: number,
    options?: { relations?: string[] },
  ) {
    const tlsCrt = await this.TlsCrtRepository.findOne({
      where: { id },
      relations: options?.relations,
    });
    return tlsCrt;
  }

  /**
   * @internal
   * SYSTEM USE ONLY. Do not use this in Controllers.
   * Bypasses all ownership checks. Intended for background jobs (Queue Processors) only.
   */
  async updateInternal(
    id: number,
    updateTlsCrtDto: InternalUpdateTlsCrtDto,
    status?: CertStatus,
  ) {
    await this.TlsCrtRepository.update(id, { ...updateTlsCrtDto, status });
    return this.findOneInternal(id);
  }

  /**
   * @internal
   * SYSTEM USE ONLY. Do not use this in Controllers.
   * Queues a renewal job for a certificate without an ownership check.
   * Intended for automated monitoring (CertMonitorService) only.
   * Silently skips certificates that are not in 'issued' state or missing CSR data.
   */
  async renewInternal(id: number): Promise<void> {
    const cert = await this.findOneInternal(id);
    if (!cert || cert.status !== CertStatus.ISSUED || !cert.rawCsr) {
      return;
    }

    await this.TlsCrtRepository.update(cert.id, {
      status: CertStatus.RENEWING,
      renewalCount: cert.renewalCount + 1,
      lastRenewalAttemptAt: new Date(),
    });

    const jobPayload: TlsCertJobPayload = { certId: cert.id };
    await this.tlsCertQueue.add('tlsCertRenewal', jobPayload, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });
  }
}
