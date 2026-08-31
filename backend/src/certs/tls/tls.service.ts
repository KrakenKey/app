import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  HttpException,
  Logger,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { CreateTlsCrtDto } from './dto/create-tls-crt.dto';
import {
  UpdateTlsCrtDto,
  InternalUpdateTlsCrtDto,
} from './dto/update-tls-crt.dto';
import { CsrUtilService } from './util/csr-util.service';
import { CertUtilService } from './util/cert-util.service';
import { TlsCrt } from './entities/tls-crt.entity';
import { In, MoreThanOrEqual, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { User } from '../../users/entities/user.entity';
import { DomainsService } from '../../domains/domains.service';
import { CertStatus } from '@krakenkey/shared';
import type {
  CreateTlsCertResponse,
  RenewTlsCertResponse,
  RetryTlsCertResponse,
  RevokeTlsCertResponse,
  TlsCertJobPayload,
  TlsCertDetails,
  TlsCertChainInfo,
} from '@krakenkey/shared';
import { AcmeIssuerStrategy } from './strategies/acme-issuer.strategy';
import { EmailService } from '../../notifications/email.service';
import { BillingService } from '../../billing/billing.service';
import { PLAN_LIMITS } from '../../billing/constants/plan-limits';
import type { SubscriptionPlan } from '@krakenkey/shared';

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
/** How long a create request stays idempotent (seconds). */
const IDEMPOTENCY_TTL_SECONDS = 15 * 60;
/** Placeholder stored while the original request is still being processed. */
const IDEMPOTENCY_PENDING = '__pending__';

/** Minimal Redis surface used for idempotency (satisfied by BullMQ's client). */
interface IdempotencyStore {
  set(
    key: string,
    value: string,
    ex: 'EX',
    ttl: number,
    nx?: 'NX',
  ): Promise<'OK' | null>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<number>;
}

@Injectable()
export class TlsService {
  private readonly logger = new Logger(TlsService.name);

  constructor(
    @InjectRepository(TlsCrt)
    private readonly TlsCrtRepository: Repository<TlsCrt>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectQueue('tlsCertIssuance')
    private readonly tlsCertQueue: Queue,
    private readonly csrUtilService: CsrUtilService,
    private readonly certUtilService: CertUtilService,
    private readonly domainsService: DomainsService,
    private readonly acmeIssuerStrategy: AcmeIssuerStrategy,
    private readonly emailService: EmailService,
    private readonly billingService: BillingService,
  ) {}

  /**
   * Retrieves all certificates visible to a user.
   * If the user belongs to an organization, returns certs owned by any org member.
   */
  async findAll(userId: string): Promise<TlsCrt[]> {
    const memberIds = await this.getOrgMemberIds(userId);
    if (memberIds) {
      return this.TlsCrtRepository.find({ where: { userId: In(memberIds) } });
    }
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

    // Idempotency: a retried/duplicated request with the same CSR within the
    // idempotency window returns the original cert instead of creating another.
    const idemKey = this.idempotencyKey(userId, csr.raw);
    const store = await this.getIdempotencyStore();
    if (store) {
      const replay = await this.claimOrReplay(store, idemKey, userId);
      if (replay) return replay;
    }

    try {
      // Plan-based limit checks
      await this.enforceCertLimits(userId);

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

      if (store) {
        // Replace the pending marker with the cert id for replay lookups.
        await store
          .set(idemKey, String(savedCsr.id), 'EX', IDEMPOTENCY_TTL_SECONDS)
          .catch((err: unknown) =>
            this.logger.warn(
              `Failed to store idempotency result for ${idemKey}: ${err instanceof Error ? err.message : String(err)}`,
            ),
          );
      }

      const response: CreateTlsCertResponse = {
        id: savedCsr.id,
        status: savedCsr.status,
      };
      return response;
    } catch (err) {
      // Release the idempotency claim so a corrected retry isn't blocked.
      if (store) {
        await store
          .del(idemKey)
          .catch(() => undefined /* key expires via TTL anyway */);
      }
      throw err;
    }
  }

  /**
   * Attempts to claim the idempotency key for this request.
   *
   * Returns null when the claim succeeded (caller proceeds with creation).
   * Returns the original create response when this is a replay of a recent
   * identical request. Throws 409 when the original request is still in flight.
   */
  private async claimOrReplay(
    store: IdempotencyStore,
    idemKey: string,
    userId: string,
  ): Promise<CreateTlsCertResponse | null> {
    try {
      const claimed = await store.set(
        idemKey,
        IDEMPOTENCY_PENDING,
        'EX',
        IDEMPOTENCY_TTL_SECONDS,
        'NX',
      );
      if (claimed === 'OK') return null;

      const existing = await store.get(idemKey);
      if (existing === IDEMPOTENCY_PENDING) {
        throw new ConflictException(
          'An identical certificate request is already being processed. Retry shortly to get its result.',
        );
      }

      if (existing) {
        const cert = await this.TlsCrtRepository.findOneBy({
          id: Number(existing),
          userId,
        });
        // Replay only certs that are still progressing or issued; a failed,
        // revoked, or deleted cert should not block a fresh attempt.
        if (
          cert &&
          cert.status !== CertStatus.FAILED &&
          cert.status !== CertStatus.REVOKED
        ) {
          this.logger.log(
            `Idempotent replay of cert #${cert.id} for duplicate create request (user ${userId})`,
          );
          return { id: cert.id, status: cert.status };
        }
        await store.del(idemKey);
        const reclaimed = await store.set(
          idemKey,
          IDEMPOTENCY_PENDING,
          'EX',
          IDEMPOTENCY_TTL_SECONDS,
          'NX',
        );
        if (reclaimed !== 'OK') {
          throw new ConflictException(
            'An identical certificate request is already being processed. Retry shortly to get its result.',
          );
        }
      }
      return null;
    } catch (err) {
      if (err instanceof HttpException) throw err;
      // Redis trouble must not block issuance — fail open without idempotency.
      this.logger.warn(
        `Idempotency check unavailable, proceeding without it: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  private idempotencyKey(userId: string, rawCsr: string): string {
    const csrHash = createHash('sha256')
      .update(rawCsr.replace(/\s+/g, ''))
      .digest('hex');
    return `tls:idem:${userId}:${csrHash}`;
  }

  /**
   * Reuses the BullMQ queue's Redis connection for idempotency bookkeeping.
   * Returns null (disabling idempotency) when the connection is unavailable.
   */
  private async getIdempotencyStore(): Promise<IdempotencyStore | null> {
    try {
      return (await this.tlsCertQueue.client) as unknown as IdempotencyStore;
    } catch (err) {
      this.logger.warn(
        `Redis unavailable for idempotency: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  async findOne(id: number, userId: string) {
    // Try direct ownership first (fast path)
    let tlsCrt = await this.TlsCrtRepository.findOneBy({ id, userId });

    // If not found, check if the cert belongs to an org member
    if (!tlsCrt) {
      const memberIds = await this.getOrgMemberIds(userId);
      if (memberIds) {
        tlsCrt = await this.TlsCrtRepository.findOne({
          where: { id, userId: In(memberIds) },
        });
      }
    }

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

  async getChain(id: number, userId: string): Promise<TlsCertChainInfo> {
    const cert = await this.findOne(id, userId);

    if (!cert.crtPem) {
      throw new BadRequestException(
        'Certificate has not been issued yet. Chain is only available for issued certificates.',
      );
    }

    return this.certUtilService.getChainInfo(cert.crtPem, cert.chainPem);
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
          (cert.parsedCsr?.subject?.find((a) => a.shortName === 'CN')
            ?.value as string) ??
          cert.parsedCsr?.extensions?.[0]?.altNames?.[0]?.value ??
          `cert #${cert.id}`;
        await this.emailService.sendCertRevoked({
          userId: cert.user.id,
          username: cert.user.username,
          email: cert.user.email,
          certId: cert.id,
          commonName,
        });
      }
    } catch (err) {
      this.logger.error(
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

    // Plan-based limit checks (renewals count against monthly cert limit)
    await this.enforceCertLimits(userId);

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

    // Plan-based limit checks (retries consume the same quota as new certs)
    await this.enforceCertLimits(userId);

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
  async findOneInternal(id: number, options?: { relations?: string[] }) {
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
    const cert = await this.findOneInternal(id, { relations: ['user'] });
    if (!cert || cert.status !== CertStatus.ISSUED || !cert.rawCsr) {
      return;
    }

    // Silently skip if monthly cert limit reached (don't throw for auto-renewal)
    const plan = (await this.billingService.resolveUserTier(
      cert.userId,
    )) as SubscriptionPlan;
    const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;
    if (limits.certsPerMonth !== Infinity) {
      const memberIds = await this.billingService.getResourceCountUserIds(
        cert.userId,
      );
      const monthlyCount = await this.countCertsThisMonth(memberIds);
      if (monthlyCount >= limits.certsPerMonth) {
        this.logger.warn(
          `Auto-renewal skipped for cert #${id}: monthly limit reached (${monthlyCount}/${limits.certsPerMonth}, plan=${plan})`,
        );
        // Notify user that auto-renewal was skipped due to plan limit
        if (cert.user) {
          await this.emailService.sendPlanLimitReached({
            userId: cert.user.id,
            username: cert.user.username,
            email: cert.user.email,
            plan,
            resourceType: 'Monthly certificates (renewal skipped)',
            current: monthlyCount,
            limit: limits.certsPerMonth,
          });
        }
        return;
      }
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

  // --- Plan Limit Helpers ---

  /**
   * Enforces all cert-related plan limits for a user.
   * Counts are pooled across org members when applicable.
   * Throws HttpException(402) if any limit is exceeded.
   */
  private async enforceCertLimits(userId: string): Promise<void> {
    const plan = (await this.billingService.resolveUserTier(
      userId,
    )) as SubscriptionPlan;
    const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;
    const memberIds = await this.billingService.getResourceCountUserIds(userId);

    // Concurrent pending check
    if (limits.concurrentPending !== Infinity) {
      const pendingCount = await this.TlsCrtRepository.count({
        where: {
          userId: In(memberIds),
          status: In([
            CertStatus.PENDING,
            CertStatus.ISSUING,
            CertStatus.RENEWING,
          ]),
        },
      });
      if (pendingCount >= limits.concurrentPending) {
        throw new HttpException(
          {
            message: 'Concurrent pending request limit reached',
            limit: limits.concurrentPending,
            current: pendingCount,
            plan,
          },
          402,
        );
      }
    }

    // Total active certs check
    if (limits.totalActiveCerts !== Infinity) {
      const activeCount = await this.TlsCrtRepository.count({
        where: { userId: In(memberIds), status: CertStatus.ISSUED },
      });
      if (activeCount >= limits.totalActiveCerts) {
        throw new HttpException(
          {
            message: 'Total active certificate limit reached',
            limit: limits.totalActiveCerts,
            current: activeCount,
            plan,
          },
          402,
        );
      }
    }

    // Monthly cert count check
    if (limits.certsPerMonth !== Infinity) {
      const monthlyCount = await this.countCertsThisMonth(memberIds);
      if (monthlyCount >= limits.certsPerMonth) {
        throw new HttpException(
          {
            message: 'Monthly certificate limit reached',
            limit: limits.certsPerMonth,
            current: monthlyCount,
            plan,
          },
          402,
        );
      }
    }
  }

  private async getOrgMemberIds(userId: string): Promise<string[] | null> {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: { id: true, organizationId: true },
    });
    if (!user?.organizationId) return null;
    const members = await this.userRepo.find({
      where: { organizationId: user.organizationId },
      select: { id: true },
    });
    return members.map((m) => m.id);
  }

  private async countCertsThisMonth(userIds: string[]): Promise<number> {
    const startOfMonth = new Date();
    startOfMonth.setUTCDate(1);
    startOfMonth.setUTCHours(0, 0, 0, 0);

    return this.TlsCrtRepository.count({
      where: {
        userId: In(userIds),
        createdAt: MoreThanOrEqual(startOfMonth),
      },
    });
  }
}
