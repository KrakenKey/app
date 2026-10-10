import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
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
import { In, MoreThanOrEqual, Not, Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
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
  ParsedCsr,
} from '@krakenkey/shared';
import { AcmeIssuerStrategy } from './strategies/acme-issuer.strategy';
import { EmailService } from '../../notifications/email.service';
import { AlertsService } from '../../notifications/channels/alerts.service';
import { BillingService } from '../../billing/billing.service';
import { PLAN_LIMITS } from '../../billing/constants/plan-limits';
import type { SubscriptionPlan } from '@krakenkey/shared';
import {
  certRenewalWindowDays,
  daysUntilExpiry,
  renewAfter,
} from './util/renewal-window';
import { certDnsNames, nameCovered } from '../../auth/api-key-restrictions';
import {
  certDisplayName,
  normalizeRequestedNames,
  normalizedNames,
  sameNames,
} from './util/cert-names';

/** A certificate as the API returns it: the stored row plus computed fields. */
export type TlsCrtResponse = TlsCrt & {
  /** When the certificate should be renewed (ISO 8601); see renewAfter(). */
  renewAfter: string | null;
};

/**
 * Manages TLS certificate lifecycle through a job queue.
 *
 * Certificate states:
 * - awaiting_csr: created from names; waiting for a connector's CSR
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
    private readonly alerts: AlertsService,
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
  async create(
    userId: string,
    createTlsCrtDto: CreateTlsCrtDto,
    opts: { restrictToHostnames?: string[] } = {},
  ): Promise<CreateTlsCertResponse> {
    const { csrPem, names, managedBy } = createTlsCrtDto;
    if ((csrPem === undefined) === (names === undefined)) {
      throw new BadRequestException('Send exactly one of csrPem or names');
    }
    if (names !== undefined) {
      if (managedBy !== 'connector') {
        throw new BadRequestException(
          "names needs managedBy: 'connector'. Certificates requested by name are issued by a connector with its own key.",
        );
      }
      return this.createAwaitingCsr(userId, names, opts);
    }
    if (managedBy !== undefined) {
      throw new BadRequestException(
        'managedBy is only accepted with names. Use PATCH /certs/tls/:id to change it on a certificate.',
      );
    }

    const csr = await this.csrUtilService.validateAndParse(csrPem!);
    if (!csr) {
      throw new Error('Invalid CSR PEM format');
    }

    await this.authorizeNames(userId, csr.domains, opts.restrictToHostnames);

    // Idempotency: a retried/duplicated request with the same CSR within the
    // idempotency window returns the original cert instead of creating another.
    return this.createOnce(
      this.idempotencyKey(userId, csr.raw),
      userId,
      async () => {
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
        return savedCsr;
      },
    );
  }

  /**
   * Creates a certificate from names alone, for a connector that will send
   * a CSR made with its own key later (POST /certs/tls/:id/renew). Nothing
   * is sent to the CA yet. The names get the same checks a CSR's names get,
   * and the certificate counts toward the total active certificate and
   * monthly limits, but not concurrent pending, since nothing is in flight.
   */
  private async createAwaitingCsr(
    userId: string,
    names: string[],
    opts: { restrictToHostnames?: string[] },
  ): Promise<CreateTlsCertResponse> {
    const requestedNames = normalizeRequestedNames(names);
    await this.authorizeNames(userId, requestedNames, opts.restrictToHostnames);

    // Same retry safety as a CSR request, keyed on the set of names
    const namesHash = createHash('sha256')
      .update(normalizedNames(requestedNames).join('\n'))
      .digest('hex');
    return this.createOnce(
      `tls:idem:${userId}:names:${namesHash}`,
      userId,
      async () => {
        await this.enforceCertLimits(userId, { concurrentPending: false });
        return this.TlsCrtRepository.save({
          rawCsr: null,
          parsedCsr: null,
          requestedNames,
          status: CertStatus.AWAITING_CSR,
          managedBy: 'connector',
          autoRenew: false,
          userId,
        });
      },
    );
  }

  /**
   * Checks that the user may get a certificate for these names: each must
   * be one of the user's (or their organization's) verified domains or a
   * subdomain, and, for an API key limited to domains, under those domains.
   */
  private async authorizeNames(
    userId: string,
    names: string[],
    restrictToHostnames?: string[],
  ): Promise<void> {
    const userDomains = await this.domainsService.findAllVerified(userId);
    if (userDomains.length === 0) {
      throw new BadRequestException(
        'No verified domains found. Verify at least one domain before requesting certificates.',
      );
    }

    // Throws BadRequestException if any name is outside the verified domains
    this.csrUtilService.isAuthorized(
      names,
      userDomains.map((d) => d.hostname),
    );

    // An API key limited to specific domains may only request names under them.
    if (restrictToHostnames) {
      const outside = names.filter(
        (name) => !nameCovered(name, restrictToHostnames),
      );
      if (outside.length > 0) {
        throw new ForbiddenException(
          `This API key cannot request certificates for: ${outside.join(', ')}`,
        );
      }
    }
  }

  /**
   * Runs `create` at most once per idempotency key within the idempotency
   * window: a repeat returns the original certificate instead.
   */
  private async createOnce(
    idemKey: string,
    userId: string,
    create: () => Promise<{ id: number; status: CertStatus }>,
  ): Promise<CreateTlsCertResponse> {
    const store = await this.getIdempotencyStore();
    if (store) {
      const replay = await this.claimOrReplay(store, idemKey, userId);
      if (replay) return replay;
    }

    try {
      const saved = await create();

      if (store) {
        // Replace the pending marker with the cert id for replay lookups.
        await store
          .set(idemKey, String(saved.id), 'EX', IDEMPOTENCY_TTL_SECONDS)
          .catch((err: unknown) =>
            this.logger.warn(
              `Failed to store idempotency result for ${idemKey}: ${err instanceof Error ? err.message : String(err)}`,
            ),
          );
      }

      return { id: saved.id, status: saved.status };
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

  /**
   * Adds the computed renewAfter to certificates for an API response. Plans
   * are looked up once per certificate owner.
   */
  async toResponses(certs: TlsCrt[]): Promise<TlsCrtResponse[]> {
    const plans = new Map<string, Promise<string>>();
    const planOf = (ownerId: string) => {
      let plan = plans.get(ownerId);
      if (!plan) {
        plan = this.billingService.resolveUserTier(ownerId);
        plans.set(ownerId, plan);
      }
      return plan;
    };
    return Promise.all(
      certs.map(async (cert) => {
        // Without an expiry there is no window to apply, so skip the plan
        // lookup: null, or the creation time for an awaiting_csr certificate
        if (!cert.expiresAt) {
          return {
            ...cert,
            renewAfter: renewAfter(cert, 0)?.toISOString() ?? null,
          };
        }
        const windowDays = certRenewalWindowDays(
          await planOf(cert.userId),
          cert.managedBy,
        );
        return {
          ...cert,
          renewAfter: renewAfter(cert, windowDays)?.toISOString() ?? null,
        };
      }),
    );
  }

  async toResponse(cert: TlsCrt): Promise<TlsCrtResponse> {
    const [response] = await this.toResponses([cert]);
    return response;
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

  /**
   * Applies a user's PATCH. Only the fields UpdateTlsCrtDto declares are
   * copied, so anything else on the object (for example a csrPem from a
   * caller that skipped validation) never reaches the repository.
   */
  async update(id: number, userId: string, updateTlsCrtDto: UpdateTlsCrtDto) {
    const cert = await this.findOne(id, userId); // Verifies ownership
    const changes: Partial<Pick<TlsCrt, 'autoRenew' | 'managedBy'>> = {};
    if (updateTlsCrtDto.autoRenew !== undefined) {
      changes.autoRenew = updateTlsCrtDto.autoRenew;
    }
    if (updateTlsCrtDto.managedBy !== undefined) {
      changes.managedBy = updateTlsCrtDto.managedBy;
    }
    // Nothing to change: skip the write (TypeORM rejects an empty update)
    if (Object.keys(changes).length === 0) return cert;
    await this.TlsCrtRepository.update(cert.id, changes);
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
        const commonName = certDisplayName(cert);
        await this.emailService.sendCertRevoked({
          userId: cert.user.id,
          username: cert.user.username,
          email: cert.user.email,
          certId: cert.id,
          commonName,
        });
        await this.alerts.emit(cert.user.id, 'cert.revoked', {
          subject: commonName,
          resource: { type: 'certificate', id: cert.id },
          details: { certificateId: cert.id, reason: reason ?? 0 },
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
   * Only failed, revoked or awaiting_csr certificates can be deleted; none of
   * them has a valid certificate the CA would need to revoke.
   */
  async remove(id: number, userId: string) {
    const cert = await this.findOne(id, userId);

    if (
      cert.status !== CertStatus.FAILED &&
      cert.status !== CertStatus.REVOKED &&
      cert.status !== CertStatus.AWAITING_CSR
    ) {
      throw new BadRequestException(
        `Only failed, revoked or awaiting_csr certificates can be deleted. Current status: ${cert.status}`,
      );
    }

    await this.TlsCrtRepository.delete(cert.id);
    return { id: cert.id };
  }

  /**
   * Renews an existing certificate, by default with the CSR stored at first
   * issuance.
   *
   * Requirements:
   * - Certificate must be in 'issued' state
   * - Original CSR must be available, unless a new one is given
   *
   * With `csrPem` the certificate is renewed with that CSR instead, so a
   * client that keeps its keys locally can rotate the key on each renewal.
   * The CSR gets the same checks as a new request, its names must equal the
   * certificate's, and it replaces the stored CSR once the renewal is queued.
   *
   * Queues a separate 'tlsCertRenewal' job to handle ACME renewal.
   *
   * By default the renewal is forced (e.g. after a key compromise). With
   * `ifDue`, a cert that is not yet inside its plan's renewal window is left
   * alone: nothing is queued and no quota is used. This lets clients call
   * renew from a daily timer without re-issuing every day.
   *
   * An awaiting_csr certificate is issued for the first time instead; see
   * completeAwaitingCsr.
   */
  async renew(
    id: number,
    userId: string,
    options: { ifDue?: boolean; csrPem?: string } = {},
  ): Promise<RenewTlsCertResponse> {
    const cert = await this.findOne(id, userId);

    if (cert.status === CertStatus.AWAITING_CSR) {
      // Never issued, so it is always due: ifDue does not apply
      return this.completeAwaitingCsr(cert, userId, options.csrPem);
    }

    if (cert.status !== CertStatus.ISSUED) {
      throw new BadRequestException(
        `Certificate must be in 'issued' state to renew. Current status: ${cert.status}`,
      );
    }

    if (!cert.rawCsr && !options.csrPem) {
      throw new BadRequestException(
        'Certificate missing CSR data, cannot renew',
      );
    }

    // Check a new CSR before anything else, so a bad one fails even when the
    // renewal would be skipped as not due
    const newCsr = options.csrPem
      ? await this.validateRenewalCsr(cert, options.csrPem)
      : null;

    // A CA request for early replacement (ARI) makes the cert due regardless.
    // Connector-managed certs follow renewAfter alone, which already takes
    // the CA's window into account.
    if (
      options.ifDue &&
      cert.expiresAt &&
      (cert.managedBy === 'connector' || !cert.ariReplacementRequestedAt)
    ) {
      const skip = await this.notDue(cert, cert.expiresAt);
      if (skip) return skip;
    }

    // Plan-based limit checks (renewals count against monthly cert limit)
    await this.enforceCertLimits(userId);

    // The new CSR is only stored once the renewal is certain to be queued
    await this.TlsCrtRepository.update(cert.id, {
      ...(newCsr
        ? {
            rawCsr: newCsr.raw,
            // ParsedCsr has `unknown` values, which QueryDeepPartialEntity rejects
            parsedCsr: newCsr.parsed as QueryDeepPartialEntity<ParsedCsr>,
          }
        : {}),
      status: CertStatus.RENEWING,
    });

    // Queue renewal job (separate from initial issuance)
    const jobPayload: TlsCertJobPayload = { certId: cert.id };
    await this.tlsCertQueue.add('tlsCertRenewal', jobPayload, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });

    return {
      id: cert.id,
      status: CertStatus.RENEWING,
      skipped: false,
    };
  }

  /**
   * Issues an awaiting_csr certificate with the connector's CSR, like a new
   * request: the CSR gets the checks a new request gets, its names must
   * equal requestedNames, the names must still be under the account's
   * verified domains, and the plan limits apply. The certificate already
   * holds its place in the total active and monthly counts, so it is left
   * out of them. Then status goes pending -> issuing -> issued.
   */
  private async completeAwaitingCsr(
    cert: TlsCrt,
    userId: string,
    csrPem: string | undefined,
  ): Promise<RenewTlsCertResponse> {
    if (!csrPem) {
      throw new BadRequestException('This certificate is waiting for a CSR');
    }

    const csr = await this.csrUtilService.validateAndParse(csrPem);
    if (!sameNames(certDnsNames(csr.parsed), cert.requestedNames ?? [])) {
      throw new BadRequestException('CSR names must match the certificate');
    }

    // A domain may have lost its verification since the certificate was created
    await this.authorizeNames(userId, csr.domains);

    await this.enforceCertLimits(userId, { excludeCertId: cert.id });

    // Only one CSR can complete it, even if two arrive at once
    const result = await this.TlsCrtRepository.update(
      { id: cert.id, status: CertStatus.AWAITING_CSR },
      {
        rawCsr: csr.raw,
        // ParsedCsr has `unknown` values, which QueryDeepPartialEntity rejects
        parsedCsr: csr.parsed as QueryDeepPartialEntity<ParsedCsr>,
        status: CertStatus.PENDING,
        failureReason: null,
      },
    );
    if (result?.affected === 0) {
      throw new ConflictException(
        'This certificate is no longer waiting for a CSR',
      );
    }

    const jobPayload: TlsCertJobPayload = { certId: cert.id };
    await this.tlsCertQueue.add('tlsCertIssuance', jobPayload, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });

    return { id: cert.id, status: CertStatus.PENDING, skipped: false };
  }

  /**
   * Validates a CSR given for renewal: the checks a new request gets
   * (format, signature, key type and strength), and the same names as the
   * certificate. Names are compared lowercased, deduplicated and sorted.
   */
  private async validateRenewalCsr(cert: TlsCrt, csrPem: string) {
    const csr = await this.csrUtilService.validateAndParse(csrPem);
    if (!sameNames(certDnsNames(cert.parsedCsr), certDnsNames(csr.parsed))) {
      throw new BadRequestException('CSR names must match the certificate');
    }
    return csr;
  }

  /**
   * For `renew?ifDue=true`: the skip response when the certificate is not
   * due yet, or null when it is. Other certificates use the same window the
   * auto-renewal cron applies to the owner's plan. A connector-managed
   * certificate is due once its renewAfter, as the API reports it, has passed.
   */
  private async notDue(
    cert: TlsCrt,
    expiresAt: Date,
  ): Promise<RenewTlsCertResponse | null> {
    const windowDays = certRenewalWindowDays(
      await this.billingService.resolveUserTier(cert.userId),
      cert.managedBy,
    );
    const due =
      cert.managedBy === 'connector'
        ? (renewAfter(cert, windowDays)?.getTime() ?? 0) <= Date.now()
        : daysUntilExpiry(expiresAt) <= windowDays;
    if (due) return null;
    return {
      id: cert.id,
      status: CertStatus.ISSUED,
      skipped: true,
      reason: 'not_due',
      expiresAt: expiresAt.toISOString(),
      renewalWindowDays: windowDays,
    };
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

    // A connector renews these itself with its own keys; never renew them here
    if (cert.managedBy === 'connector') {
      this.logger.log(
        `Auto-renewal skipped for cert #${id}: managed by a connector`,
      );
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
   *
   * `concurrentPending: false` skips the concurrent pending check, for a
   * request that queues nothing. `excludeCertId` leaves a certificate out of
   * the total active and monthly counts, for one that is already counted.
   */
  private async enforceCertLimits(
    userId: string,
    opts: { concurrentPending?: boolean; excludeCertId?: number } = {},
  ): Promise<void> {
    const plan = (await this.billingService.resolveUserTier(
      userId,
    )) as SubscriptionPlan;
    const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;
    const memberIds = await this.billingService.getResourceCountUserIds(userId);

    // Concurrent pending check (awaiting_csr is not in flight, so not counted)
    if (
      opts.concurrentPending !== false &&
      limits.concurrentPending !== Infinity
    ) {
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

    // Total active certs check: issued, plus awaiting_csr, which hold a
    // place until the connector completes or the user deletes them
    if (limits.totalActiveCerts !== Infinity) {
      const activeCount = await this.TlsCrtRepository.count({
        where: {
          userId: In(memberIds),
          status: In([CertStatus.ISSUED, CertStatus.AWAITING_CSR]),
          ...(opts.excludeCertId !== undefined
            ? { id: Not(opts.excludeCertId) }
            : {}),
        },
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
      const monthlyCount = await this.countCertsThisMonth(
        memberIds,
        opts.excludeCertId,
      );
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

  private async countCertsThisMonth(
    userIds: string[],
    excludeCertId?: number,
  ): Promise<number> {
    const startOfMonth = new Date();
    startOfMonth.setUTCDate(1);
    startOfMonth.setUTCHours(0, 0, 0, 0);

    return this.TlsCrtRepository.count({
      where: {
        userId: In(userIds),
        createdAt: MoreThanOrEqual(startOfMonth),
        ...(excludeCertId !== undefined ? { id: Not(excludeCertId) } : {}),
      },
    });
  }
}
