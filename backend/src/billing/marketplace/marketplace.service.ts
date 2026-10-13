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
import type {
  MarketplaceLandingResponse,
  MarketplaceLandingState,
  MarketplaceSaasStatus,
} from '@krakenkey/shared';
import { Subscription } from '../entities/subscription.entity';
import { User } from '../../users/entities/user.entity';
import { Organization } from '../../organizations/entities/organization.entity';
import { BillingService } from '../billing.service';
import {
  ORG_ELIGIBLE_PLANS,
  hasLiveMarketplaceSubscription,
  hasLiveStripeSubscription,
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
  /** Org to dissolve after the change commits. */
  dissolveOrg?: { id: string; cancel: boolean };
}

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
   * activated, then switched to active. A conflict is caught before
   * Microsoft starts billing, and webhooks that arrive while activation is
   * in flight find the claimed row.
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

    if (response.saasStatus === 'PendingFulfillmentStart') {
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

    await this.finishActivation(purchase, plan);
    this.logger.log(
      `Marketplace subscription activated: subscription=${purchase.id} ${owner.organizationId ? `org=${owner.organizationId}` : `user=${owner.userId}`} plan=${plan}`,
    );

    return { ...response, state: 'active', saasStatus: 'Subscribed' };
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
      where: { marketplaceSubscriptionId: purchase.id },
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
    const fields: Partial<Subscription> = {
      source: 'marketplace',
      marketplaceSubscriptionId: purchase.id,
      marketplaceOfferId: purchase.offerId,
      marketplacePlanId: purchase.planId,
      marketplaceStatus: PENDING,
      marketplaceQuantity:
        purchase.quantity ?? purchase.subscription.quantity ?? null,
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
          if (
            existing.marketplaceSubscriptionId !== purchase.id &&
            (hasLiveStripeSubscription(existing) ||
              hasLiveMarketplaceSubscription(existing))
          ) {
            throw new ConflictException(
              'This account already has a paid subscription.',
            );
          }
          if (existing.marketplaceSubscriptionId === purchase.id) return;
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
          where: { marketplaceSubscriptionId: purchase.id },
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

  /** Switches the claimed row to active after Microsoft accepted it. */
  private async finishActivation(
    purchase: ResolvedPurchase,
    plan: MarketplacePlan,
  ): Promise<void> {
    const saas = purchase.subscription;
    const result = await this.subscriptionRepository.update(
      { marketplaceSubscriptionId: purchase.id, marketplaceStatus: PENDING },
      {
        marketplaceStatus: 'Subscribed',
        plan,
        status: 'active',
        pastDueSince: null,
        currentPeriodEnd: termEnd(saas),
        cancelAtPeriodEnd: saas.autoRenew === false,
      },
    );
    if (result.affected) return;

    // A webhook may already have brought the row up to date.
    const row = await this.subscriptionRepository.findOne({
      where: { marketplaceSubscriptionId: purchase.id },
    });
    if (row?.source === 'marketplace') return;
    // A Stripe checkout replaced the claim between the claim and here, so
    // both may now bill this account.
    this.logger.error(
      `Marketplace subscription ${purchase.id} was activated but its account row was taken over; check for double billing`,
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
   * accepts or rejects it where Microsoft waits for that.
   */
  async handleWebhook(
    authorization: string | undefined,
    body: unknown,
  ): Promise<WebhookResult> {
    await this.verifier.verify(authorization);
    const payload = this.parsePayload(body);

    if (await this.operationRepository.exists({ where: { id: payload.id } })) {
      this.logger.log(
        `Marketplace operation already handled: op=${payload.id} action=${payload.action}`,
      );
      // An earlier delivery may have failed after recording the operation
      // but before the dissolution was queued.
      await this.queuePendingDissolution(payload.subscriptionId);
      return 'duplicate';
    }

    const op = await this.confirmOperation(payload);

    let outcome: Outcome;
    try {
      outcome = await this.applyOperation(payload, op);
    } catch (err) {
      if (err instanceof DuplicateOperation) return 'duplicate';
      throw err;
    }

    this.logger.log(
      `Marketplace ${payload.action}: subscription=${payload.subscriptionId} op=${payload.id} result=${outcome.result}${outcome.detail ? ` (${outcome.detail})` : ''}`,
    );

    if (ACK_ACTIONS.has(payload.action) && op.status === 'InProgress') {
      const status = outcome.result === 'rejected' ? 'Failure' : 'Success';
      try {
        await this.client.updateOperation(
          payload.subscriptionId,
          payload.id,
          status,
        );
      } catch (err) {
        // Microsoft accepts ChangePlan/ChangeQuantity on its own after 10
        // seconds without an answer, which matches what was applied unless
        // this was a rejection.
        this.logger.error(
          `Could not report ${status} for Marketplace operation ${payload.id}: status=${err instanceof MarketplaceApiError ? err.status : 'unknown'}`,
        );
      }
    }

    if (outcome.dissolveOrg) {
      await this.billingService.queueDissolution(
        outcome.dissolveOrg.id,
        outcome.dissolveOrg.cancel,
      );
    }
    return 'processed';
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
      id,
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
  ): Promise<SaasOperation> {
    let op: SaasOperation;
    try {
      op = await this.client.getOperation(payload.subscriptionId, payload.id);
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
    if (op.id && op.id !== payload.id) mismatches.push('id');
    if (op.subscriptionId !== payload.subscriptionId) {
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
   * Re-queues an organization's dissolution if its Marketplace subscription
   * ended or dropped below Team and the organization still exists.
   * queueDissolution ignores a job that is already queued.
   */
  private async queuePendingDissolution(subscriptionId: string): Promise<void> {
    const sub = await this.subscriptionRepository.findOne({
      where: { marketplaceSubscriptionId: subscriptionId },
    });
    if (!sub?.organizationId || sub.source !== 'marketplace') return;
    if (sub.marketplaceStatus === 'Unsubscribed') {
      await this.billingService.queueDissolution(sub.organizationId, true);
    } else if (!ORG_ELIGIBLE_PLANS.has(sub.plan)) {
      await this.billingService.queueDissolution(sub.organizationId, false);
    }
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
   */
  private async applyOperation(
    payload: WebhookPayload,
    op: SaasOperation,
  ): Promise<Outcome> {
    const awaitsAnswer =
      ACK_ACTIONS.has(op.action) && op.status === 'InProgress';
    let saas: SaasSubscription | undefined;
    if (!awaitsAnswer && !FINAL_FAILED_STATUSES.has(op.status)) {
      try {
        saas = await this.client.getSubscription(op.subscriptionId);
      } catch {
        // Microsoft retries the webhook; nothing is recorded.
        throw new ServiceUnavailableException(
          'Could not read the subscription from Microsoft',
        );
      }
    }

    try {
      return await this.subscriptionRepository.manager.transaction(
        async (m) => {
          const outcome = await this.applyToSubscription(m, op, saas);
          await m.insert(MarketplaceOperation, {
            id: payload.id,
            subscriptionId: payload.subscriptionId,
            action: payload.action,
            result: outcome.result,
            detail: outcome.detail,
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
  ): Promise<Outcome> {
    if (FINAL_FAILED_STATUSES.has(op.status)) {
      return { result: 'ignored', detail: `operation ${op.status}` };
    }

    // A plan KrakenKey doesn't sell is refused even before the purchase is
    // linked to an account.
    let newPlan: MarketplacePlan | null = null;
    if (op.action === 'ChangePlan' && !saas) {
      newPlan = op.planId ? this.config.planFor(op.offerId, op.planId) : null;
      if (!newPlan) {
        return { result: 'rejected', detail: 'plan not available' };
      }
    }

    const sub = await m.findOne(Subscription, {
      where: { marketplaceSubscriptionId: op.subscriptionId },
      lock: { mode: 'pessimistic_write' },
    });
    // Not linked yet (the buyer hasn't finished on the landing page), or a
    // later Stripe checkout replaced it. The landing page reads the current
    // state from Microsoft when the buyer gets there.
    if (!sub || sub.source !== 'marketplace') {
      return { result: 'ignored', detail: 'not linked to an account' };
    }
    // A canceled SaaS subscription can't be reactivated.
    if (sub.marketplaceStatus === 'Unsubscribed') {
      return { result: 'ignored', detail: 'subscription already ended' };
    }

    const previousPlan = sub.plan;
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
    if (sub.organizationId) {
      if (sub.marketplaceStatus === 'Unsubscribed') {
        dissolveOrg = { id: sub.organizationId, cancel: true };
      } else if (
        ORG_ELIGIBLE_PLANS.has(previousPlan) &&
        !ORG_ELIGIBLE_PLANS.has(sub.plan)
      ) {
        dissolveOrg = { id: sub.organizationId, cancel: false };
      }
    }

    await m.save(Subscription, sub);
    return { result: 'applied', detail, dissolveOrg };
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
