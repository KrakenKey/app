import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  EntityManager,
  In,
  LessThan,
  QueryFailedError,
  Repository,
} from 'typeorm';
import {
  PLAN_ORDER,
  normalizePlan,
  type AwsMarketplaceLandingResponse,
  type AwsMarketplaceLandingState,
} from '@krakenkey/shared';
import { Subscription } from '../entities/subscription.entity';
import { User } from '../../users/entities/user.entity';
import { Organization } from '../../organizations/entities/organization.entity';
import { BillingService } from '../billing.service';
import { MetricsService } from '../../metrics/metrics.service';
import { AWS_EXPIRATION_GRACE_MS } from '../entitlement';
import {
  ORG_ELIGIBLE_PLANS,
  hasLiveAwsMarketplaceSubscription,
  hasLiveMarketplaceSubscription,
  hasLiveStripeSubscription,
  isAwaitingAwsEntitlement,
} from '../subscription-source';
import { MarketplaceOperation } from '../marketplace/entities/marketplace-operation.entity';
import {
  AwsMarketplaceConfig,
  type AwsMarketplacePlan,
} from './aws-marketplace.config';
import {
  AwsMarketplaceApiError,
  AwsMarketplaceClient,
  AwsMarketplaceTokenError,
  type AwsEntitlement,
} from './aws-marketplace.client';
import { AwsMarketplaceRegistration } from './entities/aws-marketplace-registration.entity';
import {
  ADVISORY_EVENT_TYPES,
  AGREEMENT_EVENT_TYPES,
  AWS_MARKETPLACE_EVENT_SOURCE,
  ENDING_EVENT_TYPES,
  LICENSE_EVENT_TYPES,
  MalformedEventError,
  licenseArnCandidates,
  parseAwsMarketplaceEvent,
  type AwsMarketplaceEvent,
} from './aws-marketplace-events';

/** How long a resolved purchase waits for the buyer to sign in and link it. */
export const REGISTRATION_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * An entitlement whose ExpirationDate passed less than this long ago still
 * counts. For an auto-renewing contract ExpirationDate is the renewal date,
 * and the renewed date can show up in GetEntitlements a little after it;
 * without this an hourly check right at the renewal would drop the account
 * to Starter until the License Updated event. A license AWS deprovisions
 * (no entitlement at all) ends at once. The same grace bounds the plan in
 * effectivePlan when AWS can't be reached (see entitlement.ts).
 */
export const EXPIRATION_GRACE_MS = AWS_EXPIRATION_GRACE_MS;

/**
 * Shape of a registration token before it is sent to AWS: an opaque
 * printable string. Anything else is refused without a ResolveCustomer
 * call.
 */
const TOKEN_PATTERN = /^[A-Za-z0-9+/=_.:~-]{16,4096}$/;

/** Bounds the apply step, which holds an advisory and a row lock. */
const APPLY_STATEMENT_TIMEOUT = '10s';
const APPLY_IDLE_TIMEOUT = '15s';

/** Shown when the landing page's registration id is unknown or too old. */
export const REGISTRATION_EXPIRED_MESSAGE =
  'This setup link has expired. Open your KrakenKey subscription in the AWS Marketplace console (Manage subscriptions) and choose Set up your account again.';

/** Why the fulfillment URL sent the buyer to the landing page without a purchase. */
export type RegisterError =
  | 'missing_token'
  | 'invalid_token'
  | 'unknown_product'
  | 'unavailable';

/** KrakenKey's status for an AWS license, stored in marketplaceStatus. */
type LicenseStatus = 'pending' | 'active' | 'ended';

/** The license's entitlement as GetEntitlements reports it. */
export type EntitlementState =
  | {
      kind: 'entitled';
      dimension: string;
      plan: AwsMarketplacePlan | null;
      expiresAt: Date | null;
    }
  /** Entitlements exist, but every one expired more than a grace period ago. */
  | { kind: 'expired'; dimension: string; expiresAt: Date | null }
  /** No entitlement: not granted yet, or deprovisioned. */
  | { kind: 'none' };

export interface SyncOutcome {
  result: MarketplaceOperation['result'];
  detail: string | null;
  /** The row's license status after the sync, when the license is linked. */
  status?: LicenseStatus;
  dissolveOrg?: { id: string; cancel: boolean };
}

export interface SyncHints {
  /** Agreement id from a License Updated event or ResolveCustomer. */
  agreementId?: string | null;
  /** autoRenewalEnabled from an Amended event for the row's agreement. */
  autoRenewalEnabled?: boolean | null;
  /** The event ends the agreement or license; a pending link with no entitlement ends too. */
  ending?: boolean;
}

export type EventResult = 'processed' | 'duplicate' | 'ignored';

/** Why a sync ran, for the sync metric. */
type SyncTrigger = 'link' | 'event' | 'reconcile';

/** Shown when the pending purchase to remove has changed meanwhile. */
export const NO_PENDING_AWS_MESSAGE =
  'This account has no AWS Marketplace purchase waiting for AWS.';

interface Owner {
  userId: string | null;
  organizationId: string | null;
}

interface Assessment {
  response: AwsMarketplaceLandingResponse;
  owner: Owner;
}

const POSTGRES_UNIQUE_VIOLATION = '23505';

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof QueryFailedError &&
    (err.driverError as { code?: string } | undefined)?.code ===
      POSTGRES_UNIQUE_VIOLATION
  );
}

/** An error's name for logs: the AWS error code, never its message. */
function errorCode(err: unknown): string {
  if (err instanceof AwsMarketplaceApiError) return err.code;
  return err instanceof Error ? err.name : 'unknown';
}

/** The stored key for a registration id from the landing page URL. */
export function hashRegistrationId(id: string): string {
  return createHash('sha256').update(id).digest('hex');
}

/** Whether an entitlement's value grants anything (a contract tier is 1, true or set). */
function grants(e: AwsEntitlement): boolean {
  const v = e.value;
  if (!v) return true;
  if (v.integer !== undefined) return v.integer > 0;
  if (v.double !== undefined) return v.double > 0;
  if (v.boolean !== undefined) return v.boolean;
  if (v.string !== undefined) return v.string.length > 0;
  return true;
}

function latest(dates: (Date | null)[]): Date | null {
  let best: Date | null = null;
  for (const d of dates) {
    if (!d) return null; // no expiration on one of them: open-ended
    if (!best || d > best) best = d;
  }
  return best;
}

/**
 * AWS Marketplace SaaS contract: the fulfillment URL, the landing page
 * (resolve and link a purchase), entitlement sync, EventBridge events and
 * the hourly reconcile.
 *
 * Everything is keyed on the license ARN: with Concurrent Agreements one
 * AWS account can hold several licenses for the product, and
 * CustomerIdentifier is empty for new products.
 *
 * A sync reads GetEntitlements first, with no database transaction or lock
 * held, then applies the result in a short transaction under a
 * transaction-scoped Postgres advisory lock on the license ARN (plus a row
 * lock, a statement timeout and an idle timeout). Two API processes (a
 * blue/green deploy) handling events for the same license, or an event
 * racing the reconcile job, therefore apply one at a time. Two reads made
 * moments apart can still be applied in the opposite order; the next event
 * or the hourly reconcile corrects that, and no event is applied from its
 * own payload, so order and redelivery don't matter.
 *
 * Paid access never depends on this running: effectivePlan stops applying
 * an AWS plan 24 hours after its term ends (see entitlement.ts).
 */
@Injectable()
export class AwsMarketplaceService {
  private readonly logger = new Logger(AwsMarketplaceService.name);

  constructor(
    @InjectRepository(Subscription)
    private readonly subscriptionRepository: Repository<Subscription>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Organization)
    private readonly orgRepository: Repository<Organization>,
    @InjectRepository(MarketplaceOperation)
    private readonly operationRepository: Repository<MarketplaceOperation>,
    @InjectRepository(AwsMarketplaceRegistration)
    private readonly registrationRepository: Repository<AwsMarketplaceRegistration>,
    private readonly config: AwsMarketplaceConfig,
    private readonly client: AwsMarketplaceClient,
    private readonly billingService: BillingService,
    private readonly metrics: MetricsService,
  ) {}

  get enabled(): boolean {
    return this.config.enabled;
  }

  /** 404 while AWS Marketplace is switched off, like a route that doesn't exist. */
  assertEnabled(method: string, path: string): void {
    if (!this.config.enabled) {
      throw new NotFoundException(`Cannot ${method} ${path}`);
    }
  }

  /** The dashboard's landing page, with query parameters. */
  landingUrl(params: Record<string, string>): string {
    const query = new URLSearchParams(params).toString();
    return `https://${this.config.appDomain}/aws-marketplace${query ? `?${query}` : ''}`;
  }

  // ---------------------------------------------------------------------------
  // Fulfillment URL
  // ---------------------------------------------------------------------------

  /**
   * Handles the buyer's POST to the fulfillment URL: resolves the
   * registration token right away (it is single-purpose and short-lived),
   * stores the purchase under a new random id and returns the landing page
   * URL to redirect the browser to. Failures also return a landing page URL,
   * with an `error` the page explains. The token is never stored or logged
   * and never put in a URL.
   */
  async register(token: unknown, offerType: unknown): Promise<string> {
    if (typeof token !== 'string' || !token.trim()) {
      return this.landingUrl({
        error: 'missing_token' satisfies RegisterError,
      });
    }
    if (!TOKEN_PATTERN.test(token.trim())) {
      this.logger.warn(
        `AWS Marketplace registration with a malformed token refused (length ${token.length})`,
      );
      return this.landingUrl({
        error: 'invalid_token' satisfies RegisterError,
      });
    }

    let customer;
    try {
      customer = await this.client.resolveCustomer(token.trim());
    } catch (err) {
      if (err instanceof AwsMarketplaceTokenError) {
        this.logger.warn(`AWS Marketplace registration refused: ${err.code}`);
        return this.landingUrl({
          error: 'invalid_token' satisfies RegisterError,
        });
      }
      const code = err instanceof AwsMarketplaceApiError ? err.code : 'unknown';
      this.logger.error(`AWS Marketplace ResolveCustomer failed: ${code}`);
      return this.landingUrl({ error: 'unavailable' satisfies RegisterError });
    }

    if (!this.config.acceptsProduct(customer.productCode)) {
      this.logger.warn(
        `AWS Marketplace registration for a product not sold here: product=${customer.productCode}`,
      );
      return this.landingUrl({
        error: 'unknown_product' satisfies RegisterError,
      });
    }

    const id = randomBytes(32).toString('base64url');
    try {
      await this.registrationRepository.insert({
        id: hashRegistrationId(id),
        customerAwsAccountId: customer.customerAwsAccountId,
        licenseArn: customer.licenseArn,
        productCode: customer.productCode,
        agreementId: customer.agreementId,
        offerType:
          typeof offerType === 'string' && offerType.trim()
            ? offerType.trim().slice(0, 64)
            : null,
        expiresAt: new Date(Date.now() + REGISTRATION_TTL_MS),
      });
    } catch (err) {
      // The buyer starts over from the AWS console; a page beats a 500.
      this.logger.error(
        `Could not store an AWS Marketplace registration: license=${customer.licenseArn} error=${err instanceof Error ? err.name : 'unknown'}`,
      );
      return this.landingUrl({ error: 'unavailable' satisfies RegisterError });
    }
    this.logger.log(
      `AWS Marketplace purchase resolved: account=${customer.customerAwsAccountId} license=${customer.licenseArn}`,
    );
    return this.landingUrl({ registration: id });
  }

  // ---------------------------------------------------------------------------
  // Landing page
  // ---------------------------------------------------------------------------

  /** What the landing page shows for a registration and the signed-in user. */
  async describe(
    userId: string,
    registrationId: string,
  ): Promise<AwsMarketplaceLandingResponse> {
    const reg = await this.loadRegistration(registrationId);
    return (await this.assess(userId, reg)).response;
  }

  /**
   * Links the purchase to the signed-in user (or their organization, for
   * its owner). The row is claimed as pending first (no paid limits), which
   * is where an account with another live subscription is refused; then the
   * license is synced from GetEntitlements. If AWS hasn't granted the
   * entitlement yet the link stays pending, and the License Updated event
   * or the hourly reconcile applies the plan once it has. Linking the same
   * purchase again is harmless.
   */
  async link(
    userId: string,
    registrationId: string,
  ): Promise<AwsMarketplaceLandingResponse> {
    const reg = await this.loadRegistration(registrationId);
    const { response, owner } = await this.assess(userId, reg);

    if (response.state === 'active' || response.state === 'pending') {
      await this.registrationRepository.delete({ id: reg.id });
      return response;
    }
    if (response.state === 'not_owner') {
      throw new ForbiddenException(
        'Only the organization owner can manage billing',
      );
    }
    if (
      response.state !== 'ready' &&
      response.state !== 'awaiting_entitlement'
    ) {
      throw new ConflictException(
        response.message ?? this.stateMessage(response.state),
      );
    }

    await this.claim(owner, reg);
    // The purchase is on the account now; the setup link has done its job.
    await this.registrationRepository.delete({ id: reg.id });

    let outcome: SyncOutcome;
    try {
      outcome = await this.syncLicense(
        reg.licenseArn,
        { agreementId: reg.agreementId },
        'link',
      );
    } catch (err) {
      // Linked and pending: the next event or the reconcile finishes it.
      const code = err instanceof AwsMarketplaceApiError ? err.code : 'unknown';
      this.logger.warn(
        `AWS Marketplace license linked but not synced yet: license=${reg.licenseArn} error=${code}`,
      );
      return { ...response, state: 'pending' };
    }
    await this.queueDissolution(outcome);

    this.logger.log(
      `AWS Marketplace license linked: license=${reg.licenseArn} ${owner.organizationId ? `org=${owner.organizationId}` : `user=${owner.userId}`} status=${outcome.status ?? 'unknown'}`,
    );
    const linked = await this.subscriptionRepository.findOne({
      where: { marketplaceSubscriptionId: reg.licenseArn },
    });
    return {
      ...response,
      state:
        outcome.status === 'active'
          ? 'active'
          : outcome.status === 'ended'
            ? 'ended'
            : 'pending',
      dimension: linked?.marketplacePlanId ?? response.dimension,
      plan: linked?.marketplacePlanId
        ? this.config.planFor(linked.marketplacePlanId)
        : response.plan,
      expiresAt: linked?.currentPeriodEnd?.toISOString() ?? response.expiresAt,
    };
  }

  private async loadRegistration(
    registrationId: string,
  ): Promise<AwsMarketplaceRegistration> {
    const reg = await this.registrationRepository.findOne({
      where: { id: hashRegistrationId(registrationId) },
    });
    if (!reg || reg.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException(REGISTRATION_EXPIRED_MESSAGE);
    }
    return reg;
  }

  private async assess(
    userId: string,
    reg: AwsMarketplaceRegistration,
  ): Promise<Assessment> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        username: true,
        organizationId: true,
        role: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');

    let targetName = user.email || user.username;
    if (user.organizationId) {
      const org = await this.orgRepository.findOne({
        where: { id: user.organizationId },
        select: { id: true, name: true },
      });
      targetName = org?.name ?? targetName;
    }
    const owner: Owner = user.organizationId
      ? { userId: null, organizationId: user.organizationId }
      : { userId, organizationId: null };

    // A failed read shows the purchase as waiting; linking still works and
    // the sync catches up.
    let entitlement: EntitlementState;
    try {
      entitlement = await this.readEntitlement(reg.productCode, reg.licenseArn);
    } catch (err) {
      const code = err instanceof AwsMarketplaceApiError ? err.code : 'unknown';
      this.logger.warn(
        `AWS Marketplace GetEntitlements failed on the landing page: license=${reg.licenseArn} error=${code}`,
      );
      entitlement = { kind: 'none' };
    }

    const linked = await this.subscriptionRepository.findOne({
      where: { marketplaceSubscriptionId: reg.licenseArn },
    });
    const own = await this.billingService.getSubscription(userId);

    const dimension =
      entitlement.kind === 'none'
        ? (linked?.marketplacePlanId ?? null)
        : entitlement.dimension;
    const expiresAt =
      entitlement.kind === 'none' ? null : entitlement.expiresAt;
    const response = (
      state: AwsMarketplaceLandingState,
      message?: string,
    ): Assessment => ({
      response: {
        state,
        ...(message ? { message } : {}),
        awsAccountId: reg.customerAwsAccountId,
        dimension,
        plan: this.config.planFor(dimension),
        expiresAt: expiresAt?.toISOString() ?? null,
        target: {
          kind: user.organizationId ? 'organization' : 'user',
          name: targetName,
        },
      },
      owner,
    });

    if (linked && linked.source === 'aws_marketplace') {
      if (own?.id !== linked.id) return response('linked_elsewhere');
      if (linked.marketplaceStatus === 'active') return response('active');
      if (linked.marketplaceStatus === 'pending') return response('pending');
      // Ended here: it can be linked again only if AWS granted it again.
      if (entitlement.kind !== 'entitled') return response('ended');
    }
    if (entitlement.kind === 'expired') return response('ended');
    if (entitlement.kind === 'entitled' && !entitlement.plan) {
      return response('unknown_plan');
    }
    if (user.organizationId && user.role !== 'owner') {
      return response('not_owner');
    }
    if (hasLiveStripeSubscription(own)) {
      return response(
        'conflict',
        'This account already has a paid subscription billed by KrakenKey. Cancel it on the billing page first, or sign in with another account.',
      );
    }
    if (hasLiveMarketplaceSubscription(own)) {
      return response(
        'conflict',
        'This account already has a Microsoft Marketplace subscription. Cancel it in the Azure portal first, or sign in with another account.',
      );
    }
    if (
      hasLiveAwsMarketplaceSubscription(own) ||
      isAwaitingAwsEntitlement(own)
    ) {
      return response(
        'conflict',
        'This account already has another AWS Marketplace subscription. Cancel it in the AWS Marketplace console first, or sign in with another account.',
      );
    }
    return response(
      entitlement.kind === 'entitled' ? 'ready' : 'awaiting_entitlement',
    );
  }

  private stateMessage(state: AwsMarketplaceLandingState): string {
    switch (state) {
      case 'linked_elsewhere':
        return 'This purchase is already linked to another KrakenKey account.';
      case 'ended':
        return 'This AWS Marketplace contract has ended.';
      case 'unknown_plan':
        return 'This plan is not available. Contact support.';
      default:
        return 'This purchase cannot be linked to this account.';
    }
  }

  /**
   * Puts the license on the owner's row (or a new one) as pending, with no
   * paid limits until syncLicense finds an entitlement. Refuses an account
   * that already has a live subscription.
   */
  private async claim(
    owner: Owner,
    reg: AwsMarketplaceRegistration,
  ): Promise<void> {
    const fields: Partial<Subscription> = {
      source: 'aws_marketplace',
      marketplaceSubscriptionId: reg.licenseArn,
      marketplaceOfferId: reg.productCode,
      marketplacePlanId: null,
      marketplaceStatus: 'pending',
      marketplaceQuantity: null,
      awsCustomerAccountId: reg.customerAwsAccountId,
      awsAgreementId: reg.agreementId,
      // Stripe events for an older, ended Stripe subscription must not
      // touch this row.
      stripeSubscriptionId: null,
      billingInterval: null,
      plan: 'free',
      status: 'incomplete',
      pastDueSince: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    };

    try {
      await this.subscriptionRepository.manager.transaction(async (m) => {
        const where = owner.organizationId
          ? { organizationId: owner.organizationId }
          : { userId: owner.userId! };
        const existing = await m.findOne(Subscription, {
          where,
          lock: { mode: 'pessimistic_write' },
        });
        if (existing) {
          const same = existing.marketplaceSubscriptionId === reg.licenseArn;
          if (
            !same &&
            (hasLiveStripeSubscription(existing) ||
              hasLiveMarketplaceSubscription(existing) ||
              hasLiveAwsMarketplaceSubscription(existing) ||
              isAwaitingAwsEntitlement(existing))
          ) {
            throw new ConflictException(
              'This account already has a paid subscription.',
            );
          }
          // Linked here already and still current: nothing to claim.
          if (same && existing.marketplaceStatus !== 'ended') return;
          Object.assign(existing, fields);
          await m.save(Subscription, existing);
          return;
        }
        await m.save(
          Subscription,
          m.create(Subscription, {
            ...fields,
            userId: owner.userId,
            organizationId: owner.organizationId,
            stripeCustomerId: null,
          }),
        );
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        // Linked by another account in the meantime, or a parallel click.
        const linked = await this.subscriptionRepository.findOne({
          where: { marketplaceSubscriptionId: reg.licenseArn },
        });
        const mine =
          linked &&
          (owner.organizationId
            ? linked.organizationId === owner.organizationId
            : linked.userId === owner.userId);
        if (mine) return;
        throw new ConflictException(this.stateMessage('linked_elsewhere'));
      }
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Entitlements
  // ---------------------------------------------------------------------------

  /**
   * The license's current entitlement. With more than one current
   * entitlement (a mid-term upgrade can briefly show both tiers), the
   * highest mapped plan wins.
   */
  async readEntitlement(
    productCode: string,
    licenseArn: string,
    now: Date = new Date(),
  ): Promise<EntitlementState> {
    const entitlements = (
      await this.client.getEntitlements(productCode, licenseArn)
    ).filter(
      (e) =>
        (!e.licenseArn ||
          licenseArnCandidates(e.licenseArn).includes(licenseArn)) &&
        grants(e),
    );
    if (entitlements.length === 0) return { kind: 'none' };

    const current = entitlements.filter(
      (e) =>
        !e.expirationDate ||
        e.expirationDate.getTime() + EXPIRATION_GRACE_MS > now.getTime(),
    );
    if (current.length === 0) {
      return {
        kind: 'expired',
        dimension: entitlements[0].dimension,
        expiresAt: latest(entitlements.map((e) => e.expirationDate)),
      };
    }

    let best: AwsEntitlement | null = null;
    let bestPlan: AwsMarketplacePlan | null = null;
    for (const e of current) {
      const plan = this.config.planFor(e.dimension);
      if (!plan) continue;
      if (!bestPlan || PLAN_ORDER[plan] > PLAN_ORDER[bestPlan]) {
        best = e;
        bestPlan = plan;
      }
    }
    if (best && bestPlan) {
      return {
        kind: 'entitled',
        dimension: best.dimension,
        plan: bestPlan,
        expiresAt: best.expirationDate,
      };
    }
    return {
      kind: 'entitled',
      dimension: current[0].dimension,
      plan: null,
      expiresAt: current[0].expirationDate,
    };
  }

  /**
   * Re-reads the license's entitlements and applies them to the linked row.
   * GetEntitlements (and any STS refresh) runs first, outside any
   * transaction; then a short transaction takes the advisory lock on the
   * license (see the class comment), re-loads the row with a row lock and
   * applies what AWS reported. Throws when AWS can't be reached, so an event
   * is retried. The caller queues any organization dissolution the outcome
   * asks for, after the commit.
   */
  async syncLicense(
    licenseArn: string,
    hints: SyncHints = {},
    trigger: SyncTrigger = 'event',
  ): Promise<SyncOutcome> {
    const linked = await this.subscriptionRepository.findOne({
      where: { marketplaceSubscriptionId: licenseArn },
    });
    // Not linked yet (the buyer hasn't finished on the landing page), or a
    // later Stripe checkout or Microsoft purchase replaced it. The landing
    // page reads entitlements itself when the buyer gets there.
    if (!linked || linked.source !== 'aws_marketplace') {
      return { result: 'ignored', detail: 'not linked to an account' };
    }
    const productCode = linked.marketplaceOfferId ?? '';

    let entitlement: EntitlementState;
    try {
      entitlement = await this.readEntitlement(productCode, licenseArn);
    } catch (err) {
      this.metrics.awsMarketplaceSyncsTotal.inc({ trigger, result: 'error' });
      throw err;
    }

    const outcome = await this.subscriptionRepository.manager.transaction(
      async (m): Promise<SyncOutcome> => {
        await m.query(
          `SET LOCAL statement_timeout = '${APPLY_STATEMENT_TIMEOUT}'`,
        );
        await m.query(
          `SET LOCAL idle_in_transaction_session_timeout = '${APPLY_IDLE_TIMEOUT}'`,
        );
        await m.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          `aws-marketplace:${licenseArn}`,
        ]);
        const sub = await m.findOne(Subscription, {
          where: { marketplaceSubscriptionId: licenseArn },
          lock: { mode: 'pessimistic_write' },
        });
        // Unlinked or replaced while AWS was being asked.
        if (
          !sub ||
          sub.source !== 'aws_marketplace' ||
          sub.marketplaceOfferId !== linked.marketplaceOfferId
        ) {
          return { result: 'ignored', detail: 'not linked to an account' };
        }
        return this.apply(m, sub, entitlement, hints);
      },
    );
    this.metrics.awsMarketplaceSyncsTotal.inc({
      trigger,
      result: outcome.result === 'applied' ? 'changed' : 'unchanged',
    });
    return outcome;
  }

  private async apply(
    m: EntityManager,
    sub: Subscription,
    entitlement: EntitlementState,
    hints: SyncHints,
  ): Promise<SyncOutcome> {
    const before = {
      plan: sub.plan,
      status: sub.status,
      marketplaceStatus: sub.marketplaceStatus,
      marketplacePlanId: sub.marketplacePlanId,
      currentPeriodEnd: sub.currentPeriodEnd?.getTime() ?? null,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      awsAgreementId: sub.awsAgreementId,
    };
    const previous = sub.marketplaceStatus as LicenseStatus | null;
    const previousPlan = normalizePlan(sub.plan);
    let detail: string | null = null;

    if (hints.agreementId) sub.awsAgreementId = hints.agreementId;

    if (entitlement.kind === 'entitled') {
      if (entitlement.plan) {
        sub.plan = entitlement.plan;
        sub.status = 'active';
        sub.pastDueSince = null;
        sub.marketplaceStatus = 'active';
        sub.marketplacePlanId = entitlement.dimension;
        // An entitlement without an end date (contracts have one) is
        // treated as verified for a day at a time, so effectivePlan still
        // stops applying it if KrakenKey can't reach AWS.
        if (entitlement.expiresAt) {
          sub.currentPeriodEnd = entitlement.expiresAt;
        } else if (
          !sub.currentPeriodEnd ||
          sub.currentPeriodEnd.getTime() <
            Date.now() + AWS_EXPIRATION_GRACE_MS / 2
        ) {
          sub.currentPeriodEnd = new Date(Date.now() + AWS_EXPIRATION_GRACE_MS);
        }
        if (previous === 'ended') sub.cancelAtPeriodEnd = false;
        if (
          hints.autoRenewalEnabled !== undefined &&
          hints.autoRenewalEnabled !== null
        ) {
          sub.cancelAtPeriodEnd = !hints.autoRenewalEnabled;
        }
      } else {
        // Keep the current plan rather than guess.
        detail = `dimension ${entitlement.dimension} not in KK_AWS_MARKETPLACE_DIMENSION_MAP`;
        this.logger.error(
          `AWS Marketplace license ${sub.marketplaceSubscriptionId} is on unmapped dimension ${entitlement.dimension}; kept ${sub.plan}`,
        );
      }
    } else if (
      previous === 'active' ||
      entitlement.kind === 'expired' ||
      (previous === 'pending' && hints.ending)
    ) {
      if (previous !== 'ended') {
        sub.plan = 'free';
        sub.status = 'canceled';
        sub.pastDueSince = null;
        sub.currentPeriodEnd = null;
        sub.cancelAtPeriodEnd = false;
        sub.marketplaceStatus = 'ended';
      }
    } else if (previous === 'pending') {
      detail = 'waiting for the entitlement';
    }

    const changed =
      before.plan !== sub.plan ||
      before.status !== sub.status ||
      before.marketplaceStatus !== sub.marketplaceStatus ||
      before.marketplacePlanId !== sub.marketplacePlanId ||
      before.currentPeriodEnd !== (sub.currentPeriodEnd?.getTime() ?? null) ||
      before.cancelAtPeriodEnd !== sub.cancelAtPeriodEnd ||
      before.awsAgreementId !== sub.awsAgreementId;
    if (!changed) {
      return {
        result: 'ignored',
        detail: detail ?? 'no change',
        status: sub.marketplaceStatus as LicenseStatus,
      };
    }

    // A link still waiting for its entitlement had no paid plan, so nothing
    // it goes through dissolves an organization.
    let dissolveOrg: SyncOutcome['dissolveOrg'];
    if (sub.organizationId && previous === 'active') {
      if (sub.marketplaceStatus === 'ended') {
        dissolveOrg = { id: sub.organizationId, cancel: true };
      } else if (
        ORG_ELIGIBLE_PLANS.has(previousPlan) &&
        !ORG_ELIGIBLE_PLANS.has(normalizePlan(sub.plan))
      ) {
        dissolveOrg = { id: sub.organizationId, cancel: false };
      }
    }

    await m.save(Subscription, sub);
    if (
      before.marketplaceStatus !== sub.marketplaceStatus ||
      before.plan !== sub.plan
    ) {
      this.logger.log(
        `AWS Marketplace license ${sub.marketplaceSubscriptionId}: ${before.marketplaceStatus}/${before.plan} -> ${sub.marketplaceStatus}/${sub.plan}`,
      );
    }
    return {
      result: 'applied',
      detail,
      status: sub.marketplaceStatus as LicenseStatus,
      dissolveOrg,
    };
  }

  private async queueDissolution(outcome: SyncOutcome): Promise<void> {
    if (!outcome.dissolveOrg) return;
    await this.billingService.queueDissolution(
      outcome.dissolveOrg.id,
      outcome.dissolveOrg.cancel,
    );
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  /**
   * Handles one SQS message holding an EventBridge event. Returns once the
   * message can be deleted; throws to leave it on the queue for a retry
   * (AWS or the database unreachable).
   *
   * Every event for a known license re-reads GetEntitlements and copies it,
   * so processing one twice, or out of order, ends in the same state. The
   * event id is recorded in marketplace_operation (as `aws:<id>`) after the
   * licenses are synced, so a redelivery is skipped; an event that fails
   * half way isn't recorded and is processed again in full.
   */
  async handleEventMessage(body: string): Promise<EventResult> {
    let event: AwsMarketplaceEvent;
    try {
      event = parseAwsMarketplaceEvent(body);
    } catch (err) {
      if (err instanceof MalformedEventError) {
        this.logger.warn(
          `Dropped an AWS Marketplace queue message: ${err.message}`,
        );
        return 'ignored';
      }
      throw err;
    }

    const recordId = `aws:${event.id}`;
    const previous = await this.operationRepository.findOne({
      where: { id: recordId },
    });
    if (previous) {
      await this.finishRecordedEvent(previous);
      return 'duplicate';
    }

    if (
      event.source === AWS_MARKETPLACE_EVENT_SOURCE &&
      ADVISORY_EVENT_TYPES.has(event.detailType)
    ) {
      // AWS flags (or clears) a possible problem with the buyer's account,
      // such as fraud or closure. Access isn't changed automatically; an
      // operator decides.
      this.logger.warn(
        `AWS Marketplace ${event.detailType}: agreement=${event.agreementId ?? '-'} account=${event.acceptorAccountId ?? '-'} event=${event.id}`,
      );
      await this.record(event, null, {
        result: 'ignored',
        detail: 'advisory: review the account',
      });
      return 'processed';
    }

    const handled =
      event.source === AWS_MARKETPLACE_EVENT_SOURCE &&
      (AGREEMENT_EVENT_TYPES.has(event.detailType) ||
        LICENSE_EVENT_TYPES.has(event.detailType));
    if (!handled) {
      await this.record(event, null, {
        result: 'ignored',
        detail: `not handled: ${event.source} / ${event.detailType}`,
      });
      return 'ignored';
    }
    if (event.productCode && !this.config.acceptsProduct(event.productCode)) {
      await this.record(event, null, {
        result: 'ignored',
        detail: `product ${event.productCode} not sold here`,
      });
      return 'ignored';
    }

    const rows = await this.rowsForEvent(event);
    if (rows.length === 0) {
      await this.record(event, null, {
        result: 'ignored',
        detail: await this.unlinkedDetail(event),
      });
      return 'processed';
    }

    const ending = ENDING_EVENT_TYPES.has(event.detailType);
    const outcomes: SyncOutcome[] = [];
    for (const row of rows) {
      const licenseArn = row.marketplaceSubscriptionId!;
      const isLicenseEvent =
        !!event.licenseArn &&
        licenseArnCandidates(event.licenseArn).includes(licenseArn);
      const sameAgreement =
        !!event.agreementId && row.awsAgreementId === event.agreementId;
      // An ending event only ends the license it names, or licenses on the
      // agreement it names. Other licenses of the same buyer account are
      // only re-read.
      const outcome = await this.syncLicense(licenseArn, {
        agreementId: isLicenseEvent ? event.agreementId : undefined,
        autoRenewalEnabled: sameAgreement ? event.autoRenewalEnabled : null,
        ending: ending && (isLicenseEvent || sameAgreement),
      });
      outcomes.push(outcome);
      await this.queueDissolution(outcome);
    }

    const applied = outcomes.some((o) => o.result === 'applied');
    const detail = outcomes
      .map(
        (o, i) =>
          `${rows[i].marketplaceSubscriptionId}: ${o.status ?? '-'}${o.detail ? ` (${o.detail})` : ''}`,
      )
      .join('; ');
    this.logger.log(
      `AWS Marketplace ${event.detailType}: event=${event.id} ${detail}`,
    );
    await this.record(event, rows[0].marketplaceSubscriptionId, {
      result: applied ? 'applied' : 'ignored',
      detail: detail.slice(0, 2000),
      dissolveOrg: outcomes.find((o) => o.dissolveOrg)?.dissolveOrg,
    });
    return 'processed';
  }

  /**
   * The note recorded for an event about a license no account has linked.
   * For License Updated, an entitled license of a product sold here means a
   * buyer paid and hasn't finished setting up (or a link was removed), so
   * it is logged as a warning for follow-up.
   */
  private async unlinkedDetail(event: AwsMarketplaceEvent): Promise<string> {
    if (
      event.detailType !== 'License Updated - Manufacturer' ||
      !event.licenseArn ||
      !event.productCode
    ) {
      return 'not linked to an account';
    }
    const candidates = licenseArnCandidates(event.licenseArn);
    const licenseArn = candidates[candidates.length - 1];
    try {
      const entitlement = await this.readEntitlement(
        event.productCode,
        licenseArn,
      );
      if (entitlement.kind !== 'entitled') return 'not linked to an account';
    } catch (err) {
      const code = err instanceof AwsMarketplaceApiError ? err.code : 'unknown';
      return `not linked to an account (entitlement not checked: ${code})`;
    }
    this.logger.warn(
      `AWS Marketplace license is entitled but not linked to an account yet: license=${licenseArn} account=${event.acceptorAccountId ?? '-'}`,
    );
    return 'entitled, not linked to an account';
  }

  /**
   * Linked licenses an event is about: the license itself for license
   * events; for agreement events (which don't name the license) every
   * license on that agreement, the agreement it renews, or the buyer's AWS
   * account. Re-reading a license the event didn't change is harmless.
   */
  private async rowsForEvent(
    event: AwsMarketplaceEvent,
  ): Promise<Subscription[]> {
    const where: Record<string, unknown>[] = [];
    if (event.licenseArn) {
      where.push({
        source: 'aws_marketplace',
        marketplaceSubscriptionId: In(licenseArnCandidates(event.licenseArn)),
      });
    } else {
      const agreements = [event.agreementId, event.previousAgreementId].filter(
        (a): a is string => !!a,
      );
      if (agreements.length > 0) {
        where.push({
          source: 'aws_marketplace',
          awsAgreementId: In(agreements),
        });
      }
      if (event.acceptorAccountId) {
        where.push({
          source: 'aws_marketplace',
          awsCustomerAccountId: event.acceptorAccountId,
        });
      }
    }
    if (where.length === 0) return [];
    const rows = await this.subscriptionRepository.find({ where });
    const seen = new Set<string>();
    return rows.filter((r) => {
      const arn = r.marketplaceSubscriptionId;
      if (!arn || seen.has(arn)) return false;
      seen.add(arn);
      return true;
    });
  }

  private async record(
    event: AwsMarketplaceEvent,
    licenseArn: string | null,
    outcome: Pick<SyncOutcome, 'result' | 'detail' | 'dissolveOrg'>,
  ): Promise<void> {
    try {
      await this.operationRepository.insert({
        id: `aws:${event.id}`,
        subscriptionId:
          licenseArn ?? event.licenseArn ?? event.agreementId ?? 'unknown',
        action: event.detailType.slice(0, 255),
        result: outcome.result,
        detail: outcome.detail,
        ackStatus: null,
        dissolveOrganizationId: outcome.dissolveOrg?.id ?? null,
        dissolveCancel: outcome.dissolveOrg?.cancel ?? null,
      });
    } catch (err) {
      // Another process handled the same delivery at the same time.
      if (isUniqueViolation(err)) return;
      throw err;
    }
  }

  /**
   * A redelivered event: re-queue the dissolution it triggered, in case the
   * first delivery failed after recording it. queueDissolution ignores a job
   * that is already queued, and a finished dissolution deleted the
   * organization.
   */
  private async finishRecordedEvent(
    previous: MarketplaceOperation,
  ): Promise<void> {
    if (
      previous.dissolveOrganizationId &&
      (await this.orgRepository.exists({
        where: { id: previous.dissolveOrganizationId },
      }))
    ) {
      await this.billingService.queueDissolution(
        previous.dissolveOrganizationId,
        previous.dissolveCancel === true,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Reconcile
  // ---------------------------------------------------------------------------

  /**
   * Re-checks every linked license that is pending or active, so a missed
   * or delayed event (or an expiry without one) is still applied. Runs with
   * or without the feature flag: licenses already sold keep being followed.
   * Changes are recorded in marketplace_operation as `aws-reconcile:<uuid>`.
   * One failing license doesn't stop the others; failures are logged as
   * errors and counted in `aws_marketplace_syncs_total{result="error"}`.
   *
   * Expired registrations are checked once before they are deleted: a
   * license that is entitled but was never linked means a buyer paid and
   * didn't finish setting up, which is logged as a warning and recorded.
   */
  async reconcile(): Promise<{
    checked: number;
    changed: number;
    failed: number;
    skipped?: true;
  }> {
    const rows = await this.subscriptionRepository.find({
      where: {
        source: 'aws_marketplace',
        marketplaceStatus: In(['pending', 'active']),
      },
      select: { id: true, marketplaceSubscriptionId: true },
    });
    if (!this.config.canCheckEntitlements) {
      if (rows.length > 0) {
        this.logger.error(
          `AWS Marketplace reconcile skipped: ${rows.length} AWS-billed subscription(s) exist but KK_AWS_MARKETPLACE_ROLE_ARN is not set, so their entitlements can't be checked. Their paid limits end with the current term`,
        );
      }
      return { checked: 0, changed: 0, failed: 0, skipped: true };
    }
    if (rows.length > 0 && !this.config.consumerEnabled) {
      this.logger.warn(
        'AWS-billed subscriptions exist but KK_AWS_MARKETPLACE_QUEUE_URL is not set: AWS Marketplace events are not read, only this hourly check',
      );
    }

    let changed = 0;
    let failed = 0;
    for (const row of rows) {
      const licenseArn = row.marketplaceSubscriptionId;
      if (!licenseArn) continue;
      try {
        const outcome = await this.syncLicense(licenseArn, {}, 'reconcile');
        if (outcome.result === 'applied') {
          changed++;
          await this.operationRepository.insert({
            id: `aws-reconcile:${randomUUID()}`,
            subscriptionId: licenseArn,
            action: 'Reconcile',
            result: 'applied',
            detail: `${outcome.status ?? '-'}${outcome.detail ? ` (${outcome.detail})` : ''}`,
            ackStatus: null,
            dissolveOrganizationId: outcome.dissolveOrg?.id ?? null,
            dissolveCancel: outcome.dissolveOrg?.cancel ?? null,
          });
          await this.queueDissolution(outcome);
        }
      } catch (err) {
        failed++;
        this.logger.error(
          `AWS Marketplace reconcile failed for license ${licenseArn}: ${errorCode(err)}`,
        );
      }
    }

    await this.checkAbandonedRegistrations();

    const summary = `AWS Marketplace reconcile: checked=${rows.length} changed=${changed} failed=${failed}`;
    if (failed > 0) {
      this.logger.error(
        `${summary}. Licenses that keep failing lose their paid limits when their term ends`,
      );
    } else {
      this.logger.log(summary);
    }
    return { checked: rows.length, changed, failed };
  }

  /**
   * Looks at registrations that expired without being linked, then deletes
   * them. An entitled license among them is logged and recorded as
   * `aws-unlinked:<uuid>`.
   */
  private async checkAbandonedRegistrations(): Promise<void> {
    const expired = await this.registrationRepository.find({
      where: { expiresAt: LessThan(new Date()) },
    });
    const seen = new Set<string>();
    for (const reg of expired) {
      if (seen.has(reg.licenseArn)) continue;
      seen.add(reg.licenseArn);
      const linked = await this.subscriptionRepository.findOne({
        where: { marketplaceSubscriptionId: reg.licenseArn },
      });
      if (linked?.source === 'aws_marketplace') continue;
      try {
        const entitlement = await this.readEntitlement(
          reg.productCode,
          reg.licenseArn,
        );
        if (entitlement.kind !== 'entitled') continue;
      } catch (err) {
        this.logger.warn(
          `Could not check an unlinked AWS Marketplace license: license=${reg.licenseArn} error=${errorCode(err)}`,
        );
        continue;
      }
      this.logger.warn(
        `AWS Marketplace license is entitled but was never linked to an account: license=${reg.licenseArn} account=${reg.customerAwsAccountId}`,
      );
      await this.operationRepository.insert({
        id: `aws-unlinked:${randomUUID()}`,
        subscriptionId: reg.licenseArn,
        action: 'Reconcile',
        result: 'ignored',
        detail: `entitled, never linked (account ${reg.customerAwsAccountId})`,
        ackStatus: null,
        dissolveOrganizationId: null,
        dissolveCancel: null,
      });
    }
    if (expired.length > 0) {
      await this.registrationRepository.delete({
        expiresAt: LessThan(new Date()),
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Removing a pending link
  // ---------------------------------------------------------------------------

  /**
   * Removes an AWS Marketplace purchase that is linked to the account but
   * still waiting for AWS, so the account can be billed another way. It
   * only unlinks the purchase in KrakenKey; nothing is canceled in AWS. A
   * purchase AWS has confirmed meanwhile is not removed.
   */
  async removePendingLink(userId: string): Promise<void> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: { id: true, organizationId: true, role: true },
    });
    if (!user) throw new NotFoundException('User not found');
    if (user.organizationId && user.role !== 'owner') {
      throw new ForbiddenException(
        'Only the organization owner can manage billing',
      );
    }
    const where = user.organizationId
      ? { organizationId: user.organizationId }
      : { userId };
    const current = await this.subscriptionRepository.findOne({ where });
    const licenseArn = current?.marketplaceSubscriptionId;
    if (
      !current ||
      !licenseArn ||
      current.source !== 'aws_marketplace' ||
      current.marketplaceStatus !== 'pending'
    ) {
      throw new ConflictException(NO_PENDING_AWS_MESSAGE);
    }

    await this.subscriptionRepository.manager.transaction(async (m) => {
      await m.query(
        `SET LOCAL statement_timeout = '${APPLY_STATEMENT_TIMEOUT}'`,
      );
      await m.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `aws-marketplace:${licenseArn}`,
      ]);
      const sub = await m.findOne(Subscription, {
        where: { id: current.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (
        !sub ||
        sub.source !== 'aws_marketplace' ||
        sub.marketplaceSubscriptionId !== licenseArn ||
        sub.marketplaceStatus !== 'pending'
      ) {
        throw new ConflictException(NO_PENDING_AWS_MESSAGE);
      }
      Object.assign(sub, {
        source: 'stripe',
        marketplaceSubscriptionId: null,
        marketplaceOfferId: null,
        marketplacePlanId: null,
        marketplaceStatus: null,
        marketplaceQuantity: null,
        awsCustomerAccountId: null,
        awsAgreementId: null,
        plan: 'free',
        status: 'active',
        pastDueSince: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
      } satisfies Partial<Subscription>);
      await m.save(Subscription, sub);
      await m.insert(MarketplaceOperation, {
        id: `aws-unlink:${randomUUID()}`,
        subscriptionId: licenseArn,
        action: 'RemovePendingLink',
        result: 'applied',
        detail: `removed by user ${userId}`,
        ackStatus: null,
        dissolveOrganizationId: null,
        dissolveCancel: null,
      });
    });
    this.logger.warn(
      `Pending AWS Marketplace link removed: license=${licenseArn} ${user.organizationId ? `org=${user.organizationId}` : `user=${userId}`}`,
    );
  }
}
