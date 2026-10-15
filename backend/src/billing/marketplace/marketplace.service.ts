import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, QueryFailedError, Repository } from 'typeorm';
import {
  normalizePlan,
  type MarketplaceLandingResponse,
  type MarketplaceLandingState,
  type MarketplaceSaasStatus,
} from '@krakenkey/shared';
import { Subscription } from '../entities/subscription.entity';
import { User } from '../../users/entities/user.entity';
import { Organization } from '../../organizations/entities/organization.entity';
import { BillingService } from '../billing.service';
import {
  ORG_ELIGIBLE_PLANS,
  ORG_MIN_PLAN_LABEL,
  hasLiveAwsMarketplaceSubscription,
  hasLiveMarketplaceSubscription,
  hasLiveStripeSubscription,
  isAwaitingAwsEntitlement,
} from '../subscription-source';
import { MarketplaceConfig, type MarketplacePlan } from './marketplace.config';
import {
  MarketplaceApiError,
  MarketplaceFulfillmentClient,
  type ResolvedPurchase,
  type SaasOperation,
  type SaasSubscription,
} from './marketplace-fulfillment.client';
import { MarketplaceWebhookVerifier } from './marketplace-webhook.verifier';
import { MarketplaceOperation } from './entities/marketplace-operation.entity';

/** Shown when Microsoft doesn't recognize the landing page token. */
export const EXPIRED_TOKEN_MESSAGE =
  "We couldn't identify this purchase. Reopen the subscription in the Azure portal or the Microsoft 365 admin center and select Configure account or Manage account again.";

/** Webhook actions Microsoft waits on: the publisher accepts or rejects them. */
const ACK_ACTIONS = new Set(['ChangePlan', 'ChangeQuantity', 'Reinstate']);

/** Operation statuses that mean Microsoft already gave up on the change. */
const FINAL_FAILED_STATUSES = new Set(['Failed', 'Conflict']);

const POSTGRES_UNIQUE_VIOLATION = '23505';

/** Purchased but not activated yet (manual activation). */
const PENDING = 'PendingFulfillmentStart';

interface WebhookPayload {
  id: string;
  subscriptionId: string;
  action: string;
  planId?: string;
  offerId?: string;
  quantity?: number | null;
}

interface Outcome {
  result: MarketplaceOperation['result'];
  detail: string | null;
  /** The answer to send Microsoft, for operations it waits on. */
  ack?: 'Success' | 'Failure';
  /** Org to dissolve after the change commits. */
  dissolveOrg?: { id: string; cancel: boolean };
}

/**
 * Budget for answering a webhook. Microsoft accepts a plan or quantity
 * change on its own after 10 seconds without an answer.
 */
const WEBHOOK_DEADLINE_MS = 8000;

/**
 * The status a completed (non-pending) operation leaves the subscription
 * in. If Microsoft's subscription still shows something else, the read is
 * stale or a newer change happened; see applyOperation.
 */
const IMPLIED_STATUS: Record<string, MarketplaceSaasStatus> = {
  Subscribe: 'Subscribed',
  Reinstate: 'Subscribed',
  Suspend: 'Suspended',
  Unsubscribe: 'Unsubscribed',
};

export type WebhookResult = 'processed' | 'duplicate';

interface Assessment {
  response: MarketplaceLandingResponse;
  plan: MarketplacePlan | null;
  owner: { userId: string | null; organizationId: string | null };
}

class DuplicateOperation extends Error {}

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof QueryFailedError &&
    (err.driverError as { code?: string } | undefined)?.code ===
      POSTGRES_UNIQUE_VIOLATION
  );
}

function termEnd(sub: SaasSubscription | undefined): Date | null {
  const end = sub?.term?.endDate;
  if (!end) return null;
  const date = new Date(end);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Whether the user's email is one of the purchase's (case-insensitive). */
function emailMatches(
  email: string | null | undefined,
  candidates: (string | null | undefined)[],
): boolean {
  const mine = email?.trim().toLowerCase();
  if (!mine) return false;
  return candidates.some((c) => c?.trim().toLowerCase() === mine);
}

/** Microsoft ids are GUIDs; compare and store them in one case. */
function mpId(id: string): string {
  return id.trim().toLowerCase();
}

function normalizeStatus(status: string | undefined): MarketplaceSaasStatus {
  // Microsoft's examples pad the value with spaces.
  return (status ?? '').trim() as MarketplaceSaasStatus;
}

/**
 * Microsoft Marketplace SaaS offer: the landing page (resolve, link and
 * activate a purchase) and the fulfillment webhook.
 *
 * Usage-based (metered) billing is not implemented. If plans ever include a
 * metered dimension, the usage report belongs in a scheduled job next to
 * this service that posts to the Marketplace metering API at most hourly
 * per (subscription, dimension, hour) and records what Microsoft accepted.
 */
@Injectable()
export class MarketplaceService {
  private readonly logger = new Logger(MarketplaceService.name);

  constructor(
    @InjectRepository(Subscription)
    private readonly subscriptionRepository: Repository<Subscription>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Organization)
    private readonly orgRepository: Repository<Organization>,
    @InjectRepository(MarketplaceOperation)
    private readonly operationRepository: Repository<MarketplaceOperation>,
    private readonly config: MarketplaceConfig,
    private readonly client: MarketplaceFulfillmentClient,
    private readonly verifier: MarketplaceWebhookVerifier,
    private readonly billingService: BillingService,
  ) {}

  get enabled(): boolean {
    return this.config.enabled;
  }

  /** 404 while the Marketplace is switched off, like a route that doesn't exist. */
  assertEnabled(method: string, path: string): void {
    if (!this.config.enabled) {
      throw new NotFoundException(`Cannot ${method} ${path}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Landing page
  // ---------------------------------------------------------------------------

  /** What the landing page shows for a purchase token and the signed-in user. */
  async describe(
    userId: string,
    token: string,
  ): Promise<MarketplaceLandingResponse> {
    const purchase = await this.resolveToken(token);
    return (await this.assess(userId, purchase)).response;
  }

  /**
   * Links the purchase to the signed-in user (or their organization) and
   * activates it with Microsoft, which starts billing. A purchase that is
   * already linked to this account is returned as is, so a second visit
   * ("Manage account" in the Azure portal) is harmless.
   *
   * The purchase is claimed on the account first (no paid limits yet), then
   * activated, then switched to Microsoft's current state of it. A conflict
   * is caught before Microsoft starts billing, and webhooks that arrive
   * while activation is in flight find the claimed row.
   */
  async activate(
    userId: string,
    token: string,
  ): Promise<MarketplaceLandingResponse> {
    const purchase = await this.resolveToken(token);
    const assessment = await this.assess(userId, purchase);
    const { response, plan, owner } = assessment;

    if (response.state === 'active') return response;
    if (response.state === 'not_owner') {
      throw new ForbiddenException(
        'Only the organization owner can manage billing',
      );
    }
    if (response.state !== 'ready' || !plan) {
      throw new ConflictException(
        response.message ?? this.stateMessage(response.state),
      );
    }

    await this.claim(owner, purchase);

    if (response.saasStatus === PENDING) {
      try {
        await this.client.activate(purchase.id);
      } catch (err) {
        // The claim stays as a pending row with no paid limits; opening the
        // page again retries.
        this.logger.error(
          `Marketplace activation failed: subscription=${purchase.id} status=${err instanceof MarketplaceApiError ? err.status : 'unknown'}`,
        );
        throw new BadGatewayException(
          "Microsoft didn't accept the activation. Try again in a minute.",
        );
      }
    }

    // Read the subscription again: a webhook (a suspension, a cancellation,
    // a plan change) may have come in since Resolve and been recorded while
    // nothing was linked yet.
    let current: SaasSubscription;
    try {
      current = await this.client.getSubscription(purchase.id);
    } catch {
      // Still pending: the next visit finishes it without activating again.
      throw new BadGatewayException(
        "Microsoft accepted the activation but we couldn't confirm it yet. Open this page again in a minute.",
      );
    }
    const saasStatus = await this.finishActivation(purchase.id, current);
    this.logger.log(
      `Marketplace subscription activated: subscription=${purchase.id} ${owner.organizationId ? `org=${owner.organizationId}` : `user=${owner.userId}`} status=${saasStatus}`,
    );

    return {
      ...response,
      state: saasStatus === 'Unsubscribed' ? 'ended' : 'active',
      saasStatus,
    };
  }

  private async resolveToken(token: string): Promise<ResolvedPurchase> {
    try {
      const purchase = await this.client.resolve(token);
      if (!purchase?.id || !purchase.subscription) {
        throw new MarketplaceApiError('Resolve returned no subscription', 200);
      }
      return purchase;
    } catch (err) {
      const status = err instanceof MarketplaceApiError ? err.status : 0;
      if (status === 400 || status === 404) {
        throw new BadRequestException(EXPIRED_TOKEN_MESSAGE);
      }
      this.logger.error(`Marketplace resolve failed: status=${status}`);
      throw new BadGatewayException(
        "We couldn't reach Microsoft to look up this purchase. Try again in a minute.",
      );
    }
  }

  private async assess(
    userId: string,
    purchase: ResolvedPurchase,
  ): Promise<Assessment> {
    const saas = purchase.subscription;
    const saasStatus = normalizeStatus(saas.saasSubscriptionStatus);
    const plan = this.config.planFor(purchase.offerId, purchase.planId);

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

    const owner = user.organizationId
      ? { userId: null, organizationId: user.organizationId }
      : { userId, organizationId: null };

    const linked = await this.subscriptionRepository.findOne({
      where: { marketplaceSubscriptionId: mpId(purchase.id) },
    });
    const own = await this.billingService.getSubscription(userId);

    const base = {
      subscriptionName: purchase.subscriptionName ?? saas.name ?? '',
      planId: purchase.planId,
      plan,
      saasStatus,
      purchaserEmail: saas.purchaser?.emailId ?? null,
      beneficiaryEmail: saas.beneficiary?.emailId ?? null,
      termUnit: saas.term?.termUnit ?? null,
      isFreeTrial: saas.isFreeTrial === true,
      accountMatchesPurchase: emailMatches(user.email, [
        saas.purchaser?.emailId,
        saas.beneficiary?.emailId,
      ]),
      target: {
        kind: user.organizationId
          ? ('organization' as const)
          : ('user' as const),
        name: targetName,
      },
    };
    const result = (
      state: MarketplaceLandingState,
      message?: string,
    ): Assessment => ({
      response: { ...base, state, ...(message ? { message } : {}) },
      plan,
      owner,
    });

    if (linked && linked.source === 'marketplace') {
      if (own?.id !== linked.id) return result('linked_elsewhere');
      if (saasStatus === 'Unsubscribed') return result('ended');
      // Claimed here but activation didn't finish: offer it again below.
      if (linked.marketplaceStatus !== PENDING) return result('active');
    }
    if (saasStatus === 'Unsubscribed') return result('ended');
    if (saasStatus === 'Suspended') return result('suspended');
    if (saasStatus !== PENDING && saasStatus !== 'Subscribed') {
      this.logger.error(
        `Marketplace purchase ${purchase.id} has an unexpected status: ${saasStatus || '(none)'}`,
      );
      throw new BadGatewayException(
        'Microsoft returned an unexpected status for this purchase. Contact support.',
      );
    }
    if (!plan) return result('unknown_plan');
    if (user.organizationId && user.role !== 'owner') {
      return result('not_owner');
    }
    // Organizations need a plan that can back one, as with Stripe; any
    // other plan on an organization would dissolve it.
    if (user.organizationId && !ORG_ELIGIBLE_PLANS.has(plan)) {
      return result('needs_team');
    }
    if (hasLiveStripeSubscription(own)) {
      return result(
        'conflict',
        'This account already has a paid subscription billed by KrakenKey. Cancel it on the billing page first, or sign in with another account.',
      );
    }
    if (hasLiveMarketplaceSubscription(own)) {
      return result(
        'conflict',
        'This account already has another Microsoft Marketplace subscription. Cancel it in the Azure portal first, or sign in with another account.',
      );
    }
    if (
      hasLiveAwsMarketplaceSubscription(own) ||
      isAwaitingAwsEntitlement(own)
    ) {
      return result(
        'conflict',
        'This account already has an AWS Marketplace subscription. Cancel it in the AWS Marketplace console first, or sign in with another account.',
      );
    }
    return result('ready');
  }

  private stateMessage(state: MarketplaceLandingState): string {
    switch (state) {
      case 'linked_elsewhere':
        return 'This subscription is already linked to another KrakenKey account.';
      case 'ended':
        return 'This subscription has been canceled.';
      case 'suspended':
        return 'Microsoft has suspended this subscription because of a payment problem. Resolve it in the Azure portal, then try again.';
      case 'unknown_plan':
        return 'This plan is not available. Contact support.';
      case 'needs_team':
        return `Organizations need the ${ORG_MIN_PLAN_LABEL} plan or higher. Change the plan in the Azure portal, or sign in with an account that is not in an organization.`;
      default:
        return 'This subscription cannot be activated for this account.';
    }
  }

  /**
   * Puts the purchase on the owner's row (or a new one) as pending: no paid
   * limits until finishActivation. Refuses an account that already has a
   * live subscription.
   */
  private async claim(
    owner: Assessment['owner'],
    purchase: ResolvedPurchase,
  ): Promise<void> {
    const id = mpId(purchase.id);
    const fields: Partial<Subscription> = {
      source: 'marketplace',
      marketplaceSubscriptionId: id,
      marketplaceOfferId: purchase.offerId,
      marketplacePlanId: purchase.planId,
      marketplaceStatus: PENDING,
      marketplaceQuantity:
        purchase.quantity ?? purchase.subscription.quantity ?? null,
      // Left over from an ended AWS Marketplace license on this row.
      awsCustomerAccountId: null,
      awsAgreementId: null,
      // Stripe events for an older, ended Stripe subscription must not
      // touch this row.
      stripeSubscriptionId: null,
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
          const same =
            !!existing.marketplaceSubscriptionId &&
            mpId(existing.marketplaceSubscriptionId) === id;
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
          if (same) return;
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
        // Claimed by another account in the meantime, or a parallel click.
        const linked = await this.subscriptionRepository.findOne({
          where: { marketplaceSubscriptionId: id },
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

  /**
   * Applies Microsoft's current state of the subscription to the claimed
   * row. Right after Activate, Microsoft may still report the purchase as
   * PendingFulfillmentStart; it was accepted, so that counts as Subscribed.
   * Returns the status applied.
   */
  private async finishActivation(
    subscriptionId: string,
    current: SaasSubscription,
  ): Promise<MarketplaceSaasStatus> {
    const reported = normalizeStatus(current.saasSubscriptionStatus);
    const status: MarketplaceSaasStatus =
      reported === PENDING ? 'Subscribed' : reported;

    const updated = await this.subscriptionRepository.manager.transaction(
      async (m) => {
        const row = await m.findOne(Subscription, {
          where: { marketplaceSubscriptionId: mpId(subscriptionId) },
          lock: { mode: 'pessimistic_write' },
        });
        if (!row || row.source !== 'marketplace') return false;
        if (row.marketplaceStatus !== 'Unsubscribed') {
          this.syncFromMicrosoft(row, {
            ...current,
            saasSubscriptionStatus: status,
          });
          await m.save(Subscription, row);
        }
        return true;
      },
    );
    if (updated) return status;

    // A Stripe checkout replaced the claim between the claim and here, so
    // both may now bill this account.
    this.logger.error(
      `Marketplace subscription ${subscriptionId} was activated but its account row was taken over; check for double billing`,
    );
    throw new ConflictException(
      'This account changed while the subscription was being activated. Contact support.',
    );
  }

  // ---------------------------------------------------------------------------
  // Webhook
  // ---------------------------------------------------------------------------

  /**
   * Handles a webhook call: verifies Microsoft's token, confirms the
   * operation with Microsoft, applies it once (by operation id), and
   * accepts or rejects it where Microsoft waits for that. Calls to Microsoft
   * share an 8-second budget so the answer comes inside Microsoft's
   * 10-second window.
   */
  async handleWebhook(
    authorization: string | undefined,
    body: unknown,
  ): Promise<WebhookResult> {
    const deadline = Date.now() + WEBHOOK_DEADLINE_MS;
    await this.verifier.verify(authorization);
    const payload = this.parsePayload(body);

    const previous = await this.operationRepository.findOne({
      where: { id: payload.id },
    });
    if (previous) {
      this.logger.log(
        `Marketplace operation already handled: op=${payload.id} action=${payload.action}`,
      );
      await this.finishRecordedOperation(payload, previous, deadline);
      return 'duplicate';
    }

    const op = await this.confirmOperation(payload, deadline);

    let outcome: Outcome;
    try {
      outcome = await this.applyOperation(payload, op, deadline);
    } catch (err) {
      if (err instanceof DuplicateOperation) return 'duplicate';
      throw err;
    }

    this.logger.log(
      `Marketplace ${payload.action}: subscription=${payload.subscriptionId} op=${payload.id} result=${outcome.result}${outcome.detail ? ` (${outcome.detail})` : ''}`,
    );

    if (outcome.ack) {
      await this.sendAck(payload, outcome.ack, deadline);
    }
    if (outcome.dissolveOrg) {
      await this.billingService.queueDissolution(
        outcome.dissolveOrg.id,
        outcome.dissolveOrg.cancel,
      );
    }
    return 'processed';
  }

  private async sendAck(
    payload: WebhookPayload,
    status: 'Success' | 'Failure',
    deadline: number,
  ): Promise<void> {
    try {
      await this.client.updateOperation(
        payload.subscriptionId,
        payload.id,
        status,
        deadline,
      );
    } catch (err) {
      // Microsoft accepts ChangePlan/ChangeQuantity on its own after 10
      // seconds without an answer; a redelivery sends it again.
      this.logger.error(
        `Could not report ${status} for Marketplace operation ${payload.id}: status=${err instanceof MarketplaceApiError ? err.status : 'unknown'}`,
      );
    }
  }

  /**
   * A redelivered operation: re-send the answer while Microsoft still
   * waits for it, and re-queue the dissolution it triggered, in case the
   * first delivery failed after recording the operation. queueDissolution
   * ignores a job that is already queued, and a finished dissolution
   * deleted the organization.
   */
  private async finishRecordedOperation(
    payload: WebhookPayload,
    previous: MarketplaceOperation,
    deadline: number,
  ): Promise<void> {
    if (previous.ackStatus) {
      try {
        const op = await this.client.getOperation(
          payload.subscriptionId,
          payload.id,
          deadline,
        );
        if (op.status === 'InProgress') {
          await this.sendAck(payload, previous.ackStatus, deadline);
        }
      } catch {
        // Microsoft retries; nothing else to do now.
      }
    }
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

  private parsePayload(body: unknown): WebhookPayload {
    const b = (body ?? {}) as Record<string, unknown>;
    const str = (v: unknown) =>
      typeof v === 'string' && v.trim() ? v.trim() : undefined;
    const id = str(b.id);
    const subscriptionId = str(b.subscriptionId);
    const action = str(b.action);
    if (!id || !subscriptionId || !action) {
      throw new BadRequestException(
        'Webhook payload needs id, subscriptionId and action',
      );
    }
    return {
      id: mpId(id),
      subscriptionId,
      action,
      planId: str(b.planId),
      offerId: str(b.offerId),
      quantity: typeof b.quantity === 'number' ? b.quantity : null,
    };
  }

  /**
   * Asks Microsoft for the operation and checks it matches the webhook
   * payload, so only changes Microsoft actually made are applied.
   */
  private async confirmOperation(
    payload: WebhookPayload,
    deadline: number,
  ): Promise<SaasOperation> {
    let op: SaasOperation;
    try {
      op = await this.client.getOperation(
        payload.subscriptionId,
        payload.id,
        deadline,
      );
    } catch (err) {
      const status = err instanceof MarketplaceApiError ? err.status : 0;
      if (status === 404) {
        this.logger.warn(
          `Marketplace webhook for an unknown operation: op=${payload.id} subscription=${payload.subscriptionId}`,
        );
        throw new BadRequestException('Unknown operation');
      }
      // Microsoft retries the webhook; let it.
      throw new ServiceUnavailableException(
        'Could not confirm the operation with Microsoft',
      );
    }

    const mismatches: string[] = [];
    if (op.id && mpId(op.id) !== payload.id) mismatches.push('id');
    if (mpId(op.subscriptionId ?? '') !== mpId(payload.subscriptionId)) {
      mismatches.push('subscriptionId');
    }
    if (op.action !== payload.action) mismatches.push('action');
    if (payload.offerId && op.offerId && op.offerId !== payload.offerId) {
      mismatches.push('offerId');
    }
    if (payload.action === 'ChangePlan' && op.planId !== payload.planId) {
      mismatches.push('planId');
    }
    if (
      payload.action === 'ChangeQuantity' &&
      (op.quantity ?? null) !== payload.quantity
    ) {
      mismatches.push('quantity');
    }
    if (mismatches.length > 0) {
      this.logger.warn(
        `Marketplace webhook does not match the operation: op=${payload.id} fields=${mismatches.join(',')}`,
      );
      throw new BadRequestException('Webhook does not match the operation');
    }
    return op;
  }

  /**
   * Applies the confirmed operation and records it in one transaction. The
   * operation id is the primary key of the record, so a concurrent delivery
   * of the same operation fails here and is treated as a duplicate.
   *
   * Changes Microsoft waits on (ChangePlan, ChangeQuantity, Reinstate still
   * InProgress) are applied from the operation. Everything else sets the row
   * to Microsoft's current state of the subscription, so a webhook that
   * arrives late or out of order (Microsoft retries for hours) can't roll
   * back a newer change.
   *
   * When that state disagrees with what the completed action implies, the
   * read is stale or a newer change has happened, and there's no way to
   * tell which:
   * - Unsubscribe is final, so its state is applied regardless.
   * - Anything else answers 503 without recording the operation. Microsoft
   *   retries; once its read catches up the change is applied, and if a
   *   newer change caused the difference, the row already reflects it and
   *   retries stop after Microsoft's retry window. Applying the implied
   *   state instead could undo that newer change (a late Reinstate
   *   reactivating a subscription suspended since).
   */
  private async applyOperation(
    payload: WebhookPayload,
    op: SaasOperation,
    deadline: number,
  ): Promise<Outcome> {
    const awaitsAnswer =
      ACK_ACTIONS.has(op.action) && op.status === 'InProgress';
    let saas: SaasSubscription | undefined;
    if (!awaitsAnswer && !FINAL_FAILED_STATUSES.has(op.status)) {
      try {
        saas = await this.client.getSubscription(op.subscriptionId, deadline);
      } catch {
        // Microsoft retries the webhook; nothing is recorded.
        throw new ServiceUnavailableException(
          'Could not read the subscription from Microsoft',
        );
      }
      const implied = IMPLIED_STATUS[op.action];
      const reported = normalizeStatus(saas.saasSubscriptionStatus);
      if (implied && reported !== implied) {
        if (op.action === 'Unsubscribe') {
          saas = { ...saas, saasSubscriptionStatus: 'Unsubscribed' };
        } else {
          this.logger.warn(
            `Marketplace ${op.action} op=${payload.id}: subscription still reports ${reported || '(none)'}; asking Microsoft to retry`,
          );
          throw new ServiceUnavailableException(
            'The subscription does not reflect this operation yet',
          );
        }
      }
    }

    try {
      return await this.subscriptionRepository.manager.transaction(
        async (m) => {
          const outcome = await this.applyToSubscription(
            m,
            op,
            saas,
            awaitsAnswer,
          );
          await m.insert(MarketplaceOperation, {
            id: payload.id,
            subscriptionId: mpId(payload.subscriptionId),
            action: payload.action,
            result: outcome.result,
            detail: outcome.detail,
            ackStatus: outcome.ack ?? null,
            dissolveOrganizationId: outcome.dissolveOrg?.id ?? null,
            dissolveCancel: outcome.dissolveOrg?.cancel ?? null,
          });
          return outcome;
        },
      );
    } catch (err) {
      if (isUniqueViolation(err)) throw new DuplicateOperation();
      throw err;
    }
  }

  private async applyToSubscription(
    m: EntityManager,
    op: SaasOperation,
    saas: SaasSubscription | undefined,
    awaitsAnswer: boolean,
  ): Promise<Outcome> {
    if (FINAL_FAILED_STATUSES.has(op.status)) {
      return { result: 'ignored', detail: `operation ${op.status}` };
    }

    // A plan KrakenKey doesn't sell is refused even before the purchase is
    // linked to an account.
    let newPlan: MarketplacePlan | null = null;
    if (op.action === 'ChangePlan' && awaitsAnswer) {
      newPlan = op.planId ? this.config.planFor(op.offerId, op.planId) : null;
      if (!newPlan) {
        return {
          result: 'rejected',
          detail: 'plan not available',
          ack: 'Failure',
        };
      }
    }
    const accepted = awaitsAnswer ? ('Success' as const) : undefined;

    const sub = await m.findOne(Subscription, {
      where: { marketplaceSubscriptionId: mpId(op.subscriptionId) },
      lock: { mode: 'pessimistic_write' },
    });
    // Not linked yet (the buyer hasn't finished on the landing page), or a
    // later Stripe checkout replaced it. The landing page reads the current
    // state from Microsoft when the buyer gets there.
    if (!sub || sub.source !== 'marketplace') {
      return {
        result: 'ignored',
        detail: 'not linked to an account',
        ack: accepted,
      };
    }
    // A canceled SaaS subscription can't be reactivated or changed.
    if (sub.marketplaceStatus === 'Unsubscribed') {
      return {
        result: 'ignored',
        detail: 'subscription already ended',
        ack: awaitsAnswer ? 'Failure' : undefined,
      };
    }

    // A row still waiting for activation on the landing page has no paid
    // plan yet, so nothing it goes through dissolves an organization.
    const wasPending = sub.marketplaceStatus === PENDING;
    const previousPlan = normalizePlan(sub.plan);
    let detail: string | null = null;

    if (saas) {
      detail = this.syncFromMicrosoft(sub, saas);
    } else {
      switch (op.action) {
        case 'ChangePlan':
          sub.plan = newPlan!;
          sub.marketplacePlanId = op.planId!;
          break;
        case 'ChangeQuantity':
          sub.marketplaceQuantity = op.quantity ?? null;
          break;
        case 'Reinstate':
          sub.status = 'active';
          sub.pastDueSince = null;
          sub.marketplaceStatus = 'Subscribed';
          break;
      }
    }

    let dissolveOrg: Outcome['dissolveOrg'];
    if (sub.organizationId && !wasPending) {
      if (sub.marketplaceStatus === 'Unsubscribed') {
        dissolveOrg = { id: sub.organizationId, cancel: true };
      } else if (
        ORG_ELIGIBLE_PLANS.has(previousPlan) &&
        !ORG_ELIGIBLE_PLANS.has(normalizePlan(sub.plan))
      ) {
        dissolveOrg = { id: sub.organizationId, cancel: false };
      }
    }

    await m.save(Subscription, sub);
    return { result: 'applied', detail, ack: accepted, dissolveOrg };
  }

  /**
   * Sets status, plan, quantity and term from Microsoft's subscription.
   * Returns a note for the operation record, or null.
   */
  private syncFromMicrosoft(
    sub: Subscription,
    saas: SaasSubscription,
  ): string | null {
    const status = normalizeStatus(saas.saasSubscriptionStatus);
    switch (status) {
      case 'Subscribed':
        sub.status = 'active';
        sub.pastDueSince = null;
        sub.marketplaceStatus = 'Subscribed';
        break;
      case 'Suspended':
        // Paid limits stay for Microsoft's 30-day grace (see entitlement.ts).
        sub.status = 'past_due';
        sub.pastDueSince ??= new Date();
        sub.marketplaceStatus = 'Suspended';
        break;
      case 'Unsubscribed':
        sub.plan = 'free';
        sub.status = 'canceled';
        sub.pastDueSince = null;
        sub.currentPeriodEnd = null;
        sub.cancelAtPeriodEnd = false;
        sub.marketplaceStatus = 'Unsubscribed';
        return null;
      case PENDING:
        // Claimed on the landing page; activation finishes there.
        return 'activation pending';
      default:
        return `unexpected status ${status || '(none)'}`;
    }

    let note: string | null = null;
    const plan = this.config.planFor(saas.offerId, saas.planId);
    if (plan) {
      sub.plan = plan;
      sub.marketplacePlanId = saas.planId;
    } else {
      // Keep the current plan rather than guess.
      note = `plan ${saas.planId} not in KK_MARKETPLACE_PLAN_MAP`;
      this.logger.error(
        `Marketplace subscription ${saas.id} is on unmapped plan ${saas.planId}; kept ${sub.plan}`,
      );
    }
    if (saas.quantity !== undefined) sub.marketplaceQuantity = saas.quantity;
    sub.currentPeriodEnd = termEnd(saas) ?? sub.currentPeriodEnd;
    if (saas.autoRenew !== undefined) {
      sub.cancelAtPeriodEnd = saas.autoRenew === false;
    }
    return note;
  }
}
