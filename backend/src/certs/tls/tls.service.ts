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
import {
  In,
  IsNull,
  LessThan,
  MoreThanOrEqual,
  Not,
  Repository,
  type FindOptionsWhere,
} from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, type JobType } from 'bullmq';
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
import { MetricsService } from '../../metrics/metrics.service';
import { BillingService } from '../../billing/billing.service';
import { PLAN_LIMITS } from '../../billing/constants/plan-limits';
import type { SubscriptionPlan } from '@krakenkey/shared';
import {
  certRenewalWindowDays,
  daysUntilExpiry,
  renewAfter,
  renewalRetryAt,
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
 * - issued: Certificate successfully issued (renewalFailedAt is set when
 *   its last renewal failed; the certificate itself is still valid)
 * - failed: ACME challenge or issuance failed, or a renewal failed once the
 *   certificate had expired
 * - renewing: Certificate renewal in progress
 */
/** How long a create request stays idempotent (seconds). */
const IDEMPOTENCY_TTL_SECONDS = 15 * 60;
/** Placeholder stored while the original request is still being processed. */
const IDEMPOTENCY_PENDING = '__pending__';

const RENEWAL_IN_PROGRESS =
  'A renewal of this certificate is already in progress';

/** First key of the renewal queue's advisory lock ('KKRQ'). */
const RENEWAL_QUEUE_LOCK_NAMESPACE = 0x4b4b5251;
/** How long to wait for Redis to accept jobs inside a transaction. */
export const QUEUE_ADD_TIMEOUT_MS = 10_000;
/**
 * A request in flight this long with no live job is recovered. Longer than
 * any issuance with its retries; a job merely waiting behind others is
 * still live and left alone.
 */
export const STUCK_AFTER_MS = 30 * 60_000;
/** A renewal recovered this many times is marked failed, not re-queued. */
export const MAX_RECOVERIES = 3;
const IN_FLIGHT_STATUSES: CertStatus[] = [
  CertStatus.PENDING,
  CertStatus.ISSUING,
  CertStatus.RENEWING,
];
const LIVE_JOB_STATES: JobType[] = [
  'active',
  'waiting',
  'delayed',
  'prioritized',
  'paused',
  'waiting-children',
];

/** BullMQ options for issuance and renewal jobs. */
const CERT_JOB_OPTS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
} as const;

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
    private readonly metricsService: MetricsService,
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

        const inFlightSince = new Date();
        const savedCsr = await this.TlsCrtRepository.save({
          rawCsr: csr.raw,
          parsedCsr: csr.parsed,
          status: CertStatus.PENDING,
          inFlightSince,
          userId,
        });
        // Queue background job for ACME issuance
        await this.queueIssuance(savedCsr.id, inFlightSince);
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

    // A renewal still waiting for a slot hasn't touched the certificate,
    // so it can be revoked: the waiting renewal is dropped
    const queuedRenewal =
      cert.status === CertStatus.RENEWING && !!cert.renewalQueuedAt;
    if (cert.status !== CertStatus.ISSUED && !queuedRenewal) {
      throw new BadRequestException(
        `Certificate must be in 'issued' state to revoke. Current status: ${cert.status}`,
      );
    }

    if (!cert.crtPem) {
      throw new BadRequestException(
        'Certificate has no PEM data, cannot revoke',
      );
    }

    // Claimed in one conditional update, so a renewal starting or another
    // revoke at the same moment can't both act on it
    const claimed = await this.TlsCrtRepository.update(
      queuedRenewal
        ? {
            id: cert.id,
            status: CertStatus.RENEWING,
            renewalQueuedAt: Not(IsNull()),
          }
        : { id: cert.id, status: CertStatus.ISSUED },
      {
        status: CertStatus.REVOKING,
        renewalQueuedAt: null,
        inFlightSince: null,
      },
    );
    if ((claimed?.affected ?? 0) === 0) {
      throw new ConflictException(
        queuedRenewal
          ? 'The renewal of this certificate started meanwhile; revoke it once the renewal finishes'
          : 'This certificate changed state meanwhile; check its status and try again',
      );
    }

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
      // Back as it was: an issued certificate, or one whose renewal was
      // waiting (at its old place in the queue, so it isn't lost)
      await this.TlsCrtRepository.update(
        cert.id,
        queuedRenewal
          ? {
              status: CertStatus.RENEWING,
              renewalQueuedAt: cert.renewalQueuedAt,
            }
          : { status: CertStatus.ISSUED },
      );
      if (queuedRenewal) await this.startQueuedRenewalsSafely(cert.userId);
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

    // Already renewing (started or waiting): a renew timer sees "nothing to
    // do", anyone else a conflict
    if (cert.status === CertStatus.RENEWING) {
      if (options.ifDue) {
        return {
          id: cert.id,
          status: CertStatus.RENEWING,
          skipped: true,
          reason: 'in_progress',
          queued: !!cert.renewalQueuedAt,
        };
      }
      throw new ConflictException(RENEWAL_IN_PROGRESS);
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

    // A renewal that failed recently isn't retried by a timer more than
    // about once a day; asking without ifDue renews right away
    if (options.ifDue) {
      const skip = await this.recentlyFailed(cert);
      if (skip) return skip;
    }

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

    // A renewal replaces a certificate rather than adding one, so the total
    // active and monthly limits don't apply, and past the concurrent pending
    // limit it waits for a slot instead of being refused. The new CSR is
    // stored with the claim, so a queued renewal uses it when it starts.
    const claimed = await this.claimRenewal(cert.id, {
      ...(newCsr
        ? {
            rawCsr: newCsr.raw,
            // ParsedCsr has `unknown` values, which QueryDeepPartialEntity rejects
            parsedCsr: newCsr.parsed as QueryDeepPartialEntity<ParsedCsr>,
          }
        : {}),
    });
    if (!claimed) throw new ConflictException(RENEWAL_IN_PROGRESS);

    await this.startQueuedRenewalsSafely(cert.userId);
    // Re-read: this renewal may have been started by another caller (a job
    // finishing, the sweep) rather than by the call above
    const after = await this.TlsCrtRepository.findOneBy({ id: cert.id });
    return {
      id: cert.id,
      status: CertStatus.RENEWING,
      skipped: false,
      queued: after?.status === CertStatus.RENEWING && !!after.renewalQueuedAt,
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
    const inFlightSince = new Date();
    const result = await this.TlsCrtRepository.update(
      { id: cert.id, status: CertStatus.AWAITING_CSR },
      {
        rawCsr: csr.raw,
        // ParsedCsr has `unknown` values, which QueryDeepPartialEntity rejects
        parsedCsr: csr.parsed as QueryDeepPartialEntity<ParsedCsr>,
        status: CertStatus.PENDING,
        failureReason: null,
        inFlightSince,
      },
    );
    if (result?.affected === 0) {
      throw new ConflictException(
        'This certificate is no longer waiting for a CSR',
      );
    }

    await this.queueIssuance(cert.id, inFlightSince);

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
   * For `renew?ifDue=true`: the skip response while the last renewal failed
   * less than RENEWAL_RETRY_BACKOFF_MS ago, or null.
   */
  private async recentlyFailed(
    cert: TlsCrt,
  ): Promise<RenewTlsCertResponse | null> {
    const retryAt = renewalRetryAt(cert);
    if (!retryAt || retryAt.getTime() <= Date.now()) return null;
    const windowDays = certRenewalWindowDays(
      await this.billingService.resolveUserTier(cert.userId),
      cert.managedBy,
    );
    return {
      id: cert.id,
      status: CertStatus.ISSUED,
      skipped: true,
      reason: 'not_due',
      ...(cert.expiresAt ? { expiresAt: cert.expiresAt.toISOString() } : {}),
      renewalWindowDays: windowDays,
      retryAfter: retryAt.toISOString(),
    };
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
   *
   * An issued certificate whose last renewal failed (renewalFailedAt) is
   * renewed again instead, like POST /renew: no plan limits, and past the
   * concurrent pending limit it waits for a slot. `allowed` says what the
   * caller's API key may do (a scoped key needs certs:issue to issue again
   * and certs:renew to renew); a dashboard session may do both.
   */
  async retry(
    id: number,
    userId: string,
    allowed: { issue: boolean; renew: boolean } = { issue: true, renew: true },
  ): Promise<RetryTlsCertResponse> {
    const cert = await this.findOne(id, userId);

    if (cert.status === CertStatus.ISSUED && cert.renewalFailedAt) {
      if (!allowed.renew) {
        throw new ForbiddenException(
          'This API key needs the certs:renew scope to retry a renewal.',
        );
      }
      return this.retryRenewal(cert);
    }

    if (!allowed.issue) {
      throw new ForbiddenException(
        'This API key needs the certs:issue scope for this request.',
      );
    }

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

    const inFlightSince = new Date();
    await this.TlsCrtRepository.update(cert.id, {
      status: CertStatus.PENDING,
      inFlightSince,
      recoveryCount: 0,
    });

    await this.queueIssuance(cert.id, inFlightSince);

    const response: RetryTlsCertResponse = {
      id: cert.id,
      status: CertStatus.PENDING,
    };
    return response;
  }

  /** retry() for an issued certificate whose last renewal failed. */
  private async retryRenewal(cert: TlsCrt): Promise<RetryTlsCertResponse> {
    if (!cert.rawCsr) {
      throw new BadRequestException(
        'Certificate missing CSR data, cannot retry',
      );
    }
    const claimed = await this.claimRenewal(cert.id, {});
    if (!claimed) throw new ConflictException(RENEWAL_IN_PROGRESS);

    await this.startQueuedRenewalsSafely(cert.userId);
    const after = await this.TlsCrtRepository.findOneBy({ id: cert.id });
    return {
      id: cert.id,
      status: CertStatus.RENEWING,
      queued: after?.status === CertStatus.RENEWING && !!after.renewalQueuedAt,
    };
  }

  /** Queues an issuance job carrying the certificate's fencing token. */
  private async queueIssuance(certId: number, inFlightSince: Date) {
    const jobPayload: TlsCertJobPayload = {
      certId,
      inFlightSince: inFlightSince.getTime(),
    };
    await this.tlsCertQueue.add('tlsCertIssuance', jobPayload, CERT_JOB_OPTS);
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
   * For the worker: moves a certificate into processing (issuing, or
   * renewing), but only while it is in the state the job was queued for
   * and, for jobs that carry one, with the same inFlightSince token.
   * Returns false when the job is stale.
   *
   * A renewal keeps the current certificate (crtPem, chainPem, expiry): it
   * stays readable while the renewal runs, and stays in place if the
   * renewal fails. Only a successful renewal replaces it.
   */
  async beginProcessing(
    id: number,
    job: { renewal: boolean; token?: number; status: CertStatus },
  ): Promise<boolean> {
    const result = await this.TlsCrtRepository.update(
      {
        id,
        status: job.renewal
          ? CertStatus.RENEWING
          : In([CertStatus.PENDING, CertStatus.ISSUING]),
        renewalQueuedAt: IsNull(),
        ...(job.token !== undefined
          ? { inFlightSince: new Date(job.token) }
          : {}),
      },
      job.renewal
        ? { status: job.status }
        : {
            status: job.status,
            crtPem: null,
            chainPem: null,
            failureReason: null,
          },
    );
    return (result?.affected ?? 0) > 0;
  }

  /**
   * @internal
   * For the worker: records a job's final result, but only while the
   * certificate is still in the processing status this job set and, for
   * jobs that carry one, still has the job's inFlightSince token. A job
   * that stalled and was replaced (BullMQ failed it while process() kept
   * running, and the sweep queued it again) can't overwrite the new job's
   * result. Returns false when nothing matched.
   */
  async finishProcessing(
    id: number,
    guard: { status: CertStatus; token?: number },
    changes: InternalUpdateTlsCrtDto & Record<string, unknown>,
    status: CertStatus,
  ): Promise<boolean> {
    const result = await this.TlsCrtRepository.update(
      {
        id,
        status: guard.status,
        renewalQueuedAt: IsNull(),
        ...(guard.token !== undefined
          ? { inFlightSince: new Date(guard.token) }
          : {}),
      },
      { ...(changes as QueryDeepPartialEntity<TlsCrt>), status },
    );
    return (result?.affected ?? 0) > 0;
  }

  /**
   * @internal
   * SYSTEM USE ONLY. Do not use this in Controllers.
   * Queues a renewal for a certificate without an ownership check.
   * Intended for automated monitoring (CertMonitorService, AriMonitorService).
   * Silently skips certificates that are not in 'issued' state, are missing
   * CSR data, are managed by a connector, or that another caller claimed
   * first (two API processes running the same job).
   *
   * Like a renewal through the API, it waits past the concurrent pending
   * limit and starts as slots free up.
   */
  async renewInternal(id: number): Promise<void> {
    const cert = await this.findOneInternal(id);
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

    // The last renewal failed recently: try again about once a day, not on
    // every hourly ARI check
    const retryAt = renewalRetryAt(cert);
    if (retryAt && retryAt.getTime() > Date.now()) {
      this.logger.log(
        `Auto-renewal skipped for cert #${id}: the last renewal failed at ${cert.renewalFailedAt!.toISOString()}; next attempt after ${retryAt.toISOString()}`,
      );
      return;
    }

    const claimed = await this.claimRenewal(
      cert.id,
      {
        renewalCount: () => '"renewalCount" + 1',
        lastRenewalAttemptAt: new Date(),
      },
      { managedBy: IsNull() },
    );
    if (!claimed) {
      this.logger.log(
        `Auto-renewal skipped for cert #${id}: no longer issued (already claimed)`,
      );
      return;
    }

    // Errors are logged; the renewal stays queued and the sweep starts it
    await this.startQueuedRenewalsSafely(cert.userId);
  }

  // --- Renewal queue ---

  /**
   * Moves an issued certificate to 'renewing', queued, in one conditional
   * UPDATE. Of two callers racing for the same certificate (two API
   * processes running the same cron, or two renew requests) only one
   * matches the row, so only one renewal and one ACME order are queued.
   * Returns false when the certificate was no longer issued.
   *
   * A previous renewal failure is cleared here, so renewalFailedAt on an
   * issued certificate always describes the latest renewal: a client that
   * renewed and sees 'issued' with renewalFailedAt set knows its renewal
   * failed. The recovery count starts over for the new request.
   */
  private async claimRenewal(
    id: number,
    changes: QueryDeepPartialEntity<TlsCrt>,
    where: FindOptionsWhere<TlsCrt> = {},
  ): Promise<boolean> {
    const result = await this.TlsCrtRepository.update(
      { ...where, id, status: CertStatus.ISSUED },
      {
        ...changes,
        status: CertStatus.RENEWING,
        renewalQueuedAt: new Date(),
        renewalFailedAt: null,
        failureReason: null,
        recoveryCount: 0,
      },
    );
    return (result?.affected ?? 0) > 0;
  }

  /**
   * Starts an account's queued renewals, oldest first, while it has room
   * under its plan's concurrent pending limit. Counts are pooled across
   * organization members, like the limit itself.
   *
   * Called after a renewal is queued, when an issuance or renewal job
   * finishes, and every minute by RenewalQueueService. A Postgres advisory
   * lock per account (organization or user) makes concurrent calls take
   * turns, so the limit is never overshot. Each start is a conditional
   * update, so a revoke at the same moment wins cleanly, and only rows
   * that were actually started get a job.
   *
   * Each job carries the row's new inFlightSince as a fencing token: the
   * worker drops a job whose token doesn't match the row. The jobs are
   * added before the transaction commits; if Redis refuses them or doesn't
   * answer within QUEUE_ADD_TIMEOUT_MS, the transaction rolls back and the
   * renewals stay queued, and a job that still lands later is dropped by
   * the worker. Returns the ids of the certificates started.
   */
  async startQueuedRenewals(userId: string): Promise<number[]> {
    const memberIds = await this.billingService.getResourceCountUserIds(userId);
    const plan = (await this.billingService.resolveUserTier(
      userId,
    )) as SubscriptionPlan;
    const limit = (PLAN_LIMITS[plan] ?? PLAN_LIMITS.free).concurrentPending;
    const lockKey = await this.accountLockKey(userId);

    return this.TlsCrtRepository.manager.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [
        RENEWAL_QUEUE_LOCK_NAMESPACE,
        lockKey,
      ]);
      const repo = manager.getRepository(TlsCrt);

      let room: number | undefined;
      if (limit !== Infinity) {
        room = limit - (await repo.count({ where: inFlight(memberIds) }));
        if (room <= 0) return [];
      }

      const waiting = await repo.find({
        select: { id: true },
        where: {
          userId: In(memberIds),
          status: CertStatus.RENEWING,
          renewalQueuedAt: Not(IsNull()),
        },
        order: { renewalQueuedAt: 'ASC', id: 'ASC' },
        take: room,
      });
      if (waiting.length === 0) return [];

      const inFlightSince = new Date();
      const started: number[] = [];
      for (const { id } of waiting) {
        const result = await repo.update(
          { id, status: CertStatus.RENEWING, renewalQueuedAt: Not(IsNull()) },
          { renewalQueuedAt: null, inFlightSince },
        );
        if ((result?.affected ?? 0) > 0) started.push(id);
      }
      if (started.length === 0) return [];

      const token = inFlightSince.getTime();
      await withTimeout(
        this.tlsCertQueue.addBulk(
          started.map((id) => ({
            name: 'tlsCertRenewal',
            data: {
              certId: id,
              inFlightSince: token,
            } satisfies TlsCertJobPayload,
            opts: {
              ...CERT_JOB_OPTS,
              // BullMQ ignores a repeated jobId only while the earlier job
              // is kept: setting removeOnComplete on this queue would lose
              // that. The fencing token above is what keeps a duplicate
              // from sending a second order either way.
              jobId: `renewal-${id}-${token}`,
            },
          })),
        ),
        QUEUE_ADD_TIMEOUT_MS,
        'Queuing renewal jobs',
      );
      this.logger.log(
        `Started ${started.length} queued renewal(s): ${started.map((id) => `#${id}`).join(', ')}`,
      );
      return started;
    });
  }

  /** The advisory lock key for an account's renewal queue. */
  private async accountLockKey(userId: string): Promise<string> {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: { id: true, organizationId: true },
    });
    return user?.organizationId
      ? `org:${user.organizationId}`
      : `user:${userId}`;
  }

  /** startQueuedRenewals for callers that must not fail: logs and returns []. */
  async startQueuedRenewalsSafely(userId: string): Promise<number[]> {
    try {
      return await this.startQueuedRenewals(userId);
    } catch (err) {
      this.logger.warn(
        `Could not start queued renewals for user ${userId} now; the next sweep will: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  }

  /** Owners of certificates with a renewal waiting, for the periodic sweep. */
  async findUsersWithQueuedRenewals(): Promise<string[]> {
    const rows = await this.TlsCrtRepository.find({
      select: { userId: true },
      where: {
        status: CertStatus.RENEWING,
        renewalQueuedAt: Not(IsNull()),
      },
    });
    return [...new Set(rows.map((r) => r.userId))];
  }

  // --- Recovery of lost jobs ---

  /**
   * Recovers certificates stuck in flight with no live job: BullMQ failed
   * a job that stalled too often (no worker 'failed' event for that), Redis
   * lost its data, or a process died between saving a request and queuing
   * its job. Runs from RenewalQueueService's sweep; safe in several
   * processes, since each recovery is a conditional update.
   *
   * Rows in flight with no inFlightSince (from before this column, or
   * written by an older release during a deploy) are given one now and
   * judged STUCK_AFTER_MS later. A row is recovered once it has been in
   * flight that long and no waiting, active or delayed job names it.
   * Returns the ids recovered.
   */
  async recoverStuck(now = new Date()): Promise<number[]> {
    await this.TlsCrtRepository.update(
      {
        status: In(IN_FLIGHT_STATUSES),
        renewalQueuedAt: IsNull(),
        inFlightSince: IsNull(),
      },
      { inFlightSince: now },
    );
    const stale = await this.TlsCrtRepository.find({
      where: {
        status: In(IN_FLIGHT_STATUSES),
        renewalQueuedAt: IsNull(),
        inFlightSince: LessThan(new Date(now.getTime() - STUCK_AFTER_MS)),
      },
    });
    if (stale.length === 0) return [];

    let live: Set<number>;
    try {
      const jobs = await withTimeout(
        this.tlsCertQueue.getJobs(LIVE_JOB_STATES),
        QUEUE_ADD_TIMEOUT_MS,
        'Listing live jobs',
      );
      live = new Set(
        jobs
          .filter((j): j is NonNullable<typeof j> => !!j)
          .map((j) => (j.data as TlsCertJobPayload).certId),
      );
    } catch (err) {
      // Can't tell which jobs are alive: leave everything for the next sweep
      this.logger.warn(
        `Stuck certificate check skipped: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }

    const recovered: number[] = [];
    for (const cert of stale) {
      if (live.has(cert.id)) continue;
      if (
        await this.recoverInterrupted(
          cert,
          'its job was lost before it finished',
          now,
        )
      ) {
        recovered.push(cert.id);
      }
    }
    return recovered;
  }

  /**
   * Worker 'failed' event for a job that won't be retried. Normally the
   * job has already marked its certificate failed; this covers a final
   * failure that couldn't (for example the database was unreachable). Only
   * acts when the certificate is still in flight with this job's token.
   */
  async recoverAfterFailedJob(
    certId: number,
    token: number | undefined,
    reason: string,
  ): Promise<void> {
    const cert = await this.TlsCrtRepository.findOneBy({ id: certId });
    if (
      !cert ||
      !IN_FLIGHT_STATUSES.includes(cert.status) ||
      cert.renewalQueuedAt ||
      (token !== undefined && cert.inFlightSince?.getTime() !== token)
    ) {
      return;
    }
    await this.recoverInterrupted(cert, `its job failed: ${reason}`);
  }

  /**
   * Puts an interrupted request back in a state the user or the system can
   * act on, if the row is still exactly as seen (status and inFlightSince):
   * - a renewal is queued again, up to MAX_RECOVERIES times. A renewal no
   *   longer clears the current certificate when it starts, so a renewal
   *   that started and one whose job was lost before it started are
   *   handled alike: either way it was requested and hasn't happened.
   * - a renewal recovered too often, or one that can't be queued again
   *   (no CSR), keeps its current certificate as a failed renewal
   *   (issued, renewalFailedAt) while that is still valid, like a renewal
   *   that failed inside its job;
   * - otherwise (a new certificate, or a renewal with no valid certificate
   *   left) it goes to 'failed' with a reason, so retry works.
   */
  private async recoverInterrupted(
    cert: TlsCrt,
    why: string,
    now = new Date(),
  ): Promise<boolean> {
    const seen: FindOptionsWhere<TlsCrt> = {
      id: cert.id,
      status: cert.status,
      renewalQueuedAt: IsNull(),
      inFlightSince: cert.inFlightSince ?? IsNull(),
    };
    const recoveries = (cert.recoveryCount ?? 0) + 1;
    const renewal = cert.status === CertStatus.RENEWING;
    const what = renewal ? 'Renewal' : 'Issuance';
    const keepsCert = renewal && hasValidCert(cert, now);
    let changes: QueryDeepPartialEntity<TlsCrt>;
    let outcome: string;
    let failureReason: string | null = null;
    if (renewal && cert.rawCsr && recoveries < MAX_RECOVERIES) {
      changes = { renewalQueuedAt: now, inFlightSince: null };
      outcome = 'queued to renew again';
    } else {
      const retryHow = keepsCert
        ? `Renew it again with POST /certs/tls/${cert.id}/renew or /retry`
        : `Retry it with POST /certs/tls/${cert.id}/retry`;
      failureReason =
        recoveries >= MAX_RECOVERIES && renewal
          ? `${what} was interrupted ${recoveries} times without finishing, so it was stopped. ${retryHow}.`
          : `${what} was interrupted and did not finish. ${retryHow}.`;
      if (keepsCert) {
        changes = {
          status: CertStatus.ISSUED,
          inFlightSince: null,
          renewalFailedAt: now,
          failureReason,
        };
        outcome =
          'back to issued with its current certificate (renewal failed)';
      } else {
        changes = {
          status: CertStatus.FAILED,
          inFlightSince: null,
          failureReason,
          // An expired certificate is no use; same as a failure in the job
          ...(renewal ? { crtPem: null, chainPem: null } : {}),
        };
        outcome = 'marked failed';
      }
    }
    // Counted so a request that keeps crashing its worker stops after
    // MAX_RECOVERIES instead of sending an order every half hour
    changes.recoveryCount = recoveries;
    const result = await this.TlsCrtRepository.update(seen, changes);
    if ((result?.affected ?? 0) === 0) return false;

    this.logger.warn(
      `Recovered certificate #${cert.id} (${cert.status}) because ${why}: ${outcome}`,
    );
    if (failureReason !== null) {
      // Same notifications as a failure inside the job
      this.metricsService.certIssuanceTotal.inc({ status: 'failed' });
      await this.notifyFailure(cert, {
        renewal,
        error: failureReason,
        currentExpiresAt: keepsCert ? cert.expiresAt : null,
      }).catch(() => undefined);
    }
    await this.startQueuedRenewalsSafely(cert.userId);
    return true;
  }

  /**
   * @internal
   * Emails the owner (per their preferences) and sends the cert.failed
   * alert for an issuance or renewal that failed for good. With
   * `currentExpiresAt`, a renewal failed but the current certificate stays
   * in place until then. Emails never throw (EmailService logs delivery
   * errors); an alert queuing error is passed on to the caller.
   */
  async notifyFailure(
    cert: TlsCrt,
    failure: {
      renewal: boolean;
      error: string;
      currentExpiresAt?: Date | null;
    },
  ): Promise<void> {
    const commonName = certDisplayName(cert);
    const owner =
      cert.user ??
      (await this.userRepo
        .findOne({
          where: { id: cert.userId },
          select: { id: true, username: true, email: true },
        })
        .catch(() => null));
    if (owner?.email) {
      const ctx = {
        userId: owner.id,
        username: owner.username,
        email: owner.email,
        certId: cert.id,
        commonName,
        errorMessage: failure.error,
      };
      if (failure.currentExpiresAt) {
        await this.emailService.sendCertRenewalFailed({
          ...ctx,
          expiresAt: failure.currentExpiresAt,
        });
      } else {
        await this.emailService.sendCertFailed(ctx);
      }
    }
    await this.alerts.emit(owner?.id ?? cert.userId, 'cert.failed', {
      subject: commonName,
      resource: { type: 'certificate', id: cert.id },
      details: {
        certificateId: cert.id,
        renewal: failure.renewal,
        error: failure.error,
        ...(failure.currentExpiresAt
          ? {
              currentCertificateExpiresAt: new Date(
                failure.currentExpiresAt,
              ).toISOString(),
            }
          : {}),
      },
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
   * Renewals don't come through here: they replace a certificate rather
   * than adding one, and past the concurrent pending limit they wait (see
   * startQueuedRenewals).
   */
  private async enforceCertLimits(
    userId: string,
    opts: {
      concurrentPending?: boolean;
      excludeCertId?: number;
    } = {},
  ): Promise<void> {
    const plan = (await this.billingService.resolveUserTier(
      userId,
    )) as SubscriptionPlan;
    const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;
    const memberIds = await this.billingService.getResourceCountUserIds(userId);

    // Concurrent pending check (awaiting_csr and queued renewals are not in
    // flight, so not counted)
    if (
      opts.concurrentPending !== false &&
      limits.concurrentPending !== Infinity
    ) {
      const pendingCount = await this.TlsCrtRepository.count({
        where: inFlight(memberIds),
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

    // Monthly cert count check (new certificates only)
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

/**
 * Whether a certificate still has a usable certificate to keep when its
 * renewal fails: PEM data and an expiry still ahead.
 */
export function hasValidCert(
  cert: Pick<TlsCrt, 'crtPem' | 'expiresAt'>,
  now = new Date(),
): boolean {
  return (
    !!cert.crtPem &&
    !!cert.expiresAt &&
    new Date(cert.expiresAt).getTime() > now.getTime()
  );
}

/**
 * Certificates holding one of an account's concurrent pending slots: new
 * requests on their way to the CA, and renewals that have started. A
 * renewal still waiting for a slot (renewalQueuedAt set) doesn't hold one.
 */
function inFlight(userIds: string[]): FindOptionsWhere<TlsCrt>[] {
  return [
    {
      userId: In(userIds),
      status: In([CertStatus.PENDING, CertStatus.ISSUING]),
    },
    {
      userId: In(userIds),
      status: CertStatus.RENEWING,
      renewalQueuedAt: IsNull(),
    },
  ];
}

/** Waits for `promise`, or fails after `ms` so a caller can roll back. */
function withTimeout<T>(promise: Promise<T>, ms: number, what: string) {
  // The original may still settle later; nothing waits for it then
  promise.catch(() => undefined);
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${what} timed out after ${ms / 1000}s`)),
        ms,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}
