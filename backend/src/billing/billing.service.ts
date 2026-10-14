import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, UnrecoverableError } from 'bullmq';
import Stripe from 'stripe';
import { Subscription } from './entities/subscription.entity';
import { User } from '../users/entities/user.entity';
import { Organization } from '../organizations/entities/organization.entity';
import { Domain } from '../domains/entities/domain.entity';
import { TlsCrt } from '../certs/tls/entities/tls-crt.entity';
import { UserApiKey } from '../auth/entities/user-api-key.entity';
import type { OrgDissolutionJobPayload } from './processors/org-dissolution.processor';
import { EmailService } from '../notifications/email.service';
import {
  LEGACY_PLAN_ALIASES,
  PLAN_ORDER,
  normalizePlan,
  planLabel,
  type SubscriptionPlan,
} from '@krakenkey/shared';
import {
  effectivePlan,
  entitledSubscriptionSql,
  entitlementSqlParams,
  graceEndsAt,
} from './entitlement';
import {
  BILLED_BY_MICROSOFT_MESSAGE,
  LIVE_STRIPE_STATUSES,
  ORG_ELIGIBLE_PLANS,
  hasLiveMarketplaceSubscription,
  hasLiveStripeSubscription,
  isActivatingMarketplacePurchase,
} from './subscription-source';

const ENDED_STRIPE_STATUSES = new Set(['canceled', 'incomplete_expired']);

/**
 * The Stripe subscription an invoice belongs to, or null for one-off
 * invoices. Newer API versions nest it under parent.subscription_details;
 * older webhook payloads have it at the top level.
 */
function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const ref =
    invoice.parent?.subscription_details?.subscription ??
    (invoice as unknown as { subscription?: string | { id: string } | null })
      .subscription;
  if (!ref) return null;
  return typeof ref === 'string' ? ref : ref.id;
}

/**
 * Window for the checkout idempotency key. Repeat requests for the same
 * owner and plan inside one window get the same Stripe session back.
 */
const CHECKOUT_IDEMPOTENCY_WINDOW_MS = 60_000;

/** Narrows an unknown error to a Stripe SDK error of the given type. */
function isStripeError(
  err: unknown,
  type: string,
): err is { type: string; code?: string } {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { type?: unknown }).type === type
  );
}

/**
 * True when someone still bills for the subscription: a Stripe subscription
 * that has not ended, or a live Microsoft Marketplace subscription.
 */
function isBillingLive(sub: Subscription): boolean {
  if (sub.source === 'marketplace') return hasLiveMarketplaceSubscription(sub);
  return !!sub.stripeSubscriptionId && !ENDED_STRIPE_STATUSES.has(sub.status);
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private readonly stripe: Stripe;
  private readonly priceMap: Record<string, string>;
  private readonly reversePriceMap: Record<string, string>;
  private readonly webhookSecret: string;

  constructor(
    @InjectRepository(Subscription)
    private readonly subscriptionRepository: Repository<Subscription>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Organization)
    private readonly orgRepository: Repository<Organization>,
    @InjectQueue('orgDissolution')
    private readonly dissolutionQueue: Queue<OrgDissolutionJobPayload>,
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
  ) {
    // Stripe's constructor throws on an empty key, which would prevent the
    // whole app from booting (certs, auth, everything) just because billing
    // is unconfigured. Local dev runs without Stripe, so fall back to a
    // placeholder and warn — billing calls will fail, nothing else will.
    // Same convention as the KK_HMAC_SECRET handling in AuthService.
    const stripeKey = this.configService.get<string>(
      'KK_STRIPE_SECRET_KEY',
      '',
    );
    if (!stripeKey) {
      this.logger.warn(
        'KK_STRIPE_SECRET_KEY is not set — billing operations will fail until it is configured',
      );
    }
    this.stripe = new Stripe(stripeKey || 'sk_placeholder_billing_disabled');

    this.webhookSecret = this.configService.get<string>(
      'KK_STRIPE_WEBHOOK_SECRET',
      '',
    );

    // Map plan names to Stripe price IDs from env vars. Pro and Business
    // need their own prices: the old Starter and Team prices are not used
    // for them, so a plan without its variable can't be bought.
    this.priceMap = {};
    const proPrice = this.configService.get<string>(
      'KK_STRIPE_PRICE_PRO_MONTHLY',
    );
    if (proPrice) this.priceMap['pro'] = proPrice;

    const businessPrice = this.configService.get<string>(
      'KK_STRIPE_PRICE_BUSINESS_MONTHLY',
    );
    if (businessPrice) this.priceMap['business'] = businessPrice;

    this.reversePriceMap = {};
    for (const [plan, priceId] of Object.entries(this.priceMap)) {
      this.reversePriceMap[priceId] = plan;
    }
  }

  // ---------------------------------------------------------------------------
  // Tier Resolution (org-aware)
  // ---------------------------------------------------------------------------

  /**
   * The plan whose limits apply to the user: their org's plan or their own.
   * A past_due subscription keeps its plan during the grace period (see
   * entitlement.ts); anything else that isn't active counts as Free.
   */
  async resolveUserTier(userId: string): Promise<SubscriptionPlan> {
    return effectivePlan(await this.getSubscription(userId));
  }

  /**
   * resolveUserTier for many users in one query: the organization's plan
   * for an org member, otherwise the user's own. Users that don't exist are
   * left out of the map.
   */
  async resolveTiers(
    userIds: string[],
  ): Promise<Map<string, SubscriptionPlan>> {
    const ids = [...new Set(userIds)];
    const tiers = new Map<string, SubscriptionPlan>();
    if (ids.length === 0) return tiers;
    const rows = await this.userRepository
      .createQueryBuilder('u')
      .leftJoin(
        Subscription,
        's_personal',
        `s_personal."userId" = u.id AND ${entitledSubscriptionSql('s_personal')}`,
      )
      .leftJoin(
        Subscription,
        's_org',
        `u."organizationId" IS NOT NULL AND s_org."organizationId" = u."organizationId" AND ${entitledSubscriptionSql('s_org')}`,
      )
      .select('u.id', 'id')
      .addSelect(
        `CASE WHEN u."organizationId" IS NOT NULL THEN s_org.plan ELSE s_personal.plan END`,
        'plan',
      )
      .where('u.id IN (:...ids)', { ids })
      .setParameters(entitlementSqlParams())
      .getRawMany<{ id: string; plan: string | null }>();
    for (const row of rows) tiers.set(row.id, normalizePlan(row.plan));
    return tiers;
  }

  async getSubscription(userId: string): Promise<Subscription | null> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: { id: true, organizationId: true },
    });

    if (user?.organizationId) {
      return this.subscriptionRepository.findOne({
        where: { organizationId: user.organizationId },
      });
    }

    return this.subscriptionRepository.findOne({ where: { userId } });
  }

  /**
   * Returns all user IDs whose resources should be counted together for limits.
   * For org members, returns all member IDs; for solo users, returns [userId].
   */
  async getResourceCountUserIds(userId: string): Promise<string[]> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: { id: true, organizationId: true },
    });
    if (!user?.organizationId) return [userId];

    const members = await this.userRepository.find({
      where: { organizationId: user.organizationId },
      select: { id: true },
    });
    return members.map((m) => m.id);
  }

  // ---------------------------------------------------------------------------
  // Customer & Checkout
  // ---------------------------------------------------------------------------

  async getOrCreateCustomer(
    userId: string,
    email: string,
  ): Promise<Subscription> {
    // Check for existing sub (personal or org)
    const existing = await this.getSubscription(userId);
    if (existing?.stripeCustomerId) return existing;

    const customer = await this.stripe.customers.create({
      email,
      metadata: { userId },
    });

    // An account that so far only bought through Microsoft Marketplace has
    // a row but no Stripe customer. Write only that column: saving the whole
    // row could undo a Marketplace activation that changed it meanwhile.
    if (existing) {
      await this.subscriptionRepository.update(
        { id: existing.id, stripeCustomerId: IsNull() },
        { stripeCustomerId: customer.id },
      );
      const latest = await this.subscriptionRepository.findOne({
        where: { id: existing.id },
      });
      const row = latest ?? existing;
      // Another request may have set a customer first; keep that one.
      row.stripeCustomerId ??= customer.id;
      return row;
    }

    const subscription = this.subscriptionRepository.create({
      userId,
      stripeCustomerId: customer.id,
      plan: 'free',
      status: 'active',
    });

    return this.subscriptionRepository.save(subscription);
  }

  async createCheckoutSession(
    userId: string,
    email: string,
    plan: string,
  ): Promise<string> {
    const priceId = this.priceMap[plan];
    if (!priceId) {
      throw new BadRequestException(
        `The ${planLabel(plan)} plan is not available for purchase`,
      );
    }

    // If user is in an org, only the owner can perform billing actions
    await this.assertBillingAccess(userId);

    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: { id: true, organizationId: true },
    });

    // getSubscription resolves the org's subscription for org members, so
    // this covers both a personal plan and the org pool the owner pays for.
    const existing = await this.getSubscription(userId);
    if (hasLiveMarketplaceSubscription(existing)) {
      throw new ConflictException(BILLED_BY_MICROSOFT_MESSAGE);
    }
    if (isActivatingMarketplacePurchase(existing)) {
      throw new ConflictException(
        'A Microsoft Marketplace purchase is being activated for this account. Wait a few minutes, then check the billing page.',
      );
    }
    if (hasLiveStripeSubscription(existing)) {
      throw new ConflictException(
        'You already have a paid subscription. Upgrade your plan from the billing page or manage it in the billing portal instead of starting a new checkout.',
      );
    }

    const sub = await this.getOrCreateCustomer(userId, email);
    const appDomain = this.configService.get<string>('KK_APP_DOMAIN');

    const metadata: Record<string, string> = { plan };
    if (user?.organizationId) {
      metadata.organizationId = user.organizationId;
    } else {
      metadata.userId = userId;
    }

    // Two quick clicks send the same key, so Stripe returns the first
    // session instead of opening a second one.
    const owner = user?.organizationId
      ? `org-${user.organizationId}`
      : `user-${userId}`;
    const bucket = Math.floor(Date.now() / CHECKOUT_IDEMPOTENCY_WINDOW_MS);
    const idempotencyKey = `checkout-${owner}-${plan}-${bucket}`;

    let session: Stripe.Checkout.Session;
    try {
      session = await this.stripe.checkout.sessions.create(
        {
          customer: sub.stripeCustomerId!,
          mode: 'subscription',
          line_items: [{ price: priceId, quantity: 1 }],
          success_url: `https://${appDomain}/dashboard/billing?success=true`,
          cancel_url: `https://${appDomain}/dashboard/billing?canceled=true`,
          metadata,
        },
        { idempotencyKey },
      );
    } catch (err) {
      // Same key with different parameters, or the first request is still
      // in flight: both mean a checkout for this plan was just started.
      if (isStripeError(err, 'StripeIdempotencyError')) {
        throw new ConflictException(
          'A checkout for this plan was just started. Wait a moment and try again.',
        );
      }
      throw err;
    }

    if (!session.url) {
      throw new BadRequestException('Failed to create checkout session');
    }

    return session.url;
  }

  async createPortalSession(userId: string): Promise<string> {
    await this.assertBillingAccess(userId);

    const sub = await this.getSubscription(userId);
    if (hasLiveMarketplaceSubscription(sub)) {
      throw new ConflictException(
        'Your subscription is billed through Microsoft. Manage it in the Azure portal.',
      );
    }
    if (!sub?.stripeCustomerId) {
      throw new NotFoundException('No subscription record found');
    }

    const appDomain = this.configService.get<string>('KK_APP_DOMAIN');
    const session = await this.stripe.billingPortal.sessions.create({
      customer: sub.stripeCustomerId,
      return_url: `https://${appDomain}/dashboard/billing`,
    });

    return session.url;
  }

  // ---------------------------------------------------------------------------
  // Upgrade
  // ---------------------------------------------------------------------------

  async previewUpgrade(
    userId: string,
    newPlan: string,
  ): Promise<{
    immediateAmountCents: number;
    currency: string;
    targetPlan: string;
    currentPeriodEnd: string;
  }> {
    await this.assertBillingAccess(userId);
    const sub = await this.validateUpgrade(userId, newPlan);

    const { currentPriceCents, newPriceCents, currency } =
      await this.getPriceDifference(sub.plan, newPlan);

    return {
      immediateAmountCents: newPriceCents - currentPriceCents,
      currency,
      targetPlan: newPlan,
      currentPeriodEnd: sub.currentPeriodEnd!.toISOString(),
    };
  }

  async upgradeSubscription(
    userId: string,
    newPlan: string,
  ): Promise<{
    plan: string;
    status: string;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
  }> {
    await this.assertBillingAccess(userId);
    const sub = await this.validateUpgrade(userId, newPlan);
    const newPriceId = this.priceMap[newPlan];

    const { currentPriceCents, newPriceCents, currency } =
      await this.getPriceDifference(sub.plan, newPlan);
    const differenceCents = newPriceCents - currentPriceCents;

    const stripeSub = await this.stripe.subscriptions.retrieve(
      sub.stripeSubscriptionId!,
    );
    const itemId = stripeSub.items.data[0].id;

    // Switch the plan without Stripe's day-based proration.
    await this.stripe.subscriptions.update(sub.stripeSubscriptionId!, {
      items: [{ id: itemId, price: newPriceId }],
      proration_behavior: 'none',
    });

    // Charge the flat price difference immediately.
    await this.stripe.invoiceItems.create({
      customer: sub.stripeCustomerId!,
      amount: differenceCents,
      currency,
      description: `Plan upgrade: ${planLabel(sub.plan)} \u2192 ${planLabel(newPlan)}`,
    });

    const invoice = await this.stripe.invoices.create({
      customer: sub.stripeCustomerId!,
      auto_advance: true,
    });
    await this.stripe.invoices.pay(invoice.id);

    sub.plan = newPlan;
    await this.subscriptionRepository.save(sub);

    this.logger.log(`Subscription upgraded: user=${userId} newPlan=${newPlan}`);

    return {
      plan: sub.plan,
      status: sub.status,
      currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    };
  }

  private async getPriceDifference(
    currentPlan: string,
    newPlan: string,
  ): Promise<{
    currentPriceCents: number;
    newPriceCents: number;
    currency: string;
  }> {
    const currentPriceId = this.priceMap[normalizePlan(currentPlan)];
    const newPriceId = this.priceMap[newPlan];

    const [currentPrice, newPrice] = await Promise.all([
      this.stripe.prices.retrieve(currentPriceId),
      this.stripe.prices.retrieve(newPriceId),
    ]);

    return {
      currentPriceCents: currentPrice.unit_amount ?? 0,
      newPriceCents: newPrice.unit_amount ?? 0,
      currency: newPrice.currency,
    };
  }

  private async validateUpgrade(
    userId: string,
    newPlan: string,
  ): Promise<Subscription> {
    const sub = await this.getSubscription(userId);
    if (hasLiveMarketplaceSubscription(sub)) {
      throw new ConflictException(
        'Your subscription is billed through Microsoft. Change your plan in the Azure portal.',
      );
    }
    if (!sub || !sub.stripeSubscriptionId) {
      throw new NotFoundException('No active subscription found');
    }
    if (sub.status !== 'active') {
      throw new BadRequestException(
        'Cannot upgrade a subscription that is not active',
      );
    }
    if (
      PLAN_ORDER[normalizePlan(newPlan)] <= PLAN_ORDER[normalizePlan(sub.plan)]
    ) {
      throw new BadRequestException(
        `Cannot upgrade from ${planLabel(sub.plan)} to ${planLabel(newPlan)}`,
      );
    }
    if (!this.priceMap[newPlan]) {
      throw new BadRequestException(
        `The ${planLabel(newPlan)} plan is not available for purchase`,
      );
    }
    return sub;
  }

  // ---------------------------------------------------------------------------
  // Billing Access Control
  // ---------------------------------------------------------------------------

  /**
   * If user is in an org, only the owner may perform billing actions.
   */
  private async assertBillingAccess(userId: string): Promise<void> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: { id: true, organizationId: true, role: true },
    });
    if (user?.organizationId && user.role !== 'owner') {
      throw new ForbiddenException(
        'Only the organization owner can manage billing',
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Subscription Conversion (personal <-> org)
  // ---------------------------------------------------------------------------

  /**
   * Converts a personal subscription to an org subscription.
   * Called when an org is created by a user with an active personal sub.
   */
  async convertToOrgSubscription(
    userId: string,
    organizationId: string,
    manager?: EntityManager,
  ): Promise<void> {
    const repo = manager
      ? manager.getRepository(Subscription)
      : this.subscriptionRepository;

    const sub = await repo.findOne({ where: { userId } });
    if (!sub) return;

    sub.organizationId = organizationId;
    sub.userId = null;
    await repo.save(sub);
    this.logger.log(
      `Subscription converted to org: sub=${sub.id} org=${organizationId}`,
    );
  }

  /**
   * Converts an org subscription back to a personal subscription for the owner.
   * Called when an org is deleted or dissolved.
   */
  async convertToPersonalSubscription(
    organizationId: string,
    ownerId: string,
  ): Promise<void> {
    const sub = await this.subscriptionRepository.findOne({
      where: { organizationId },
    });
    if (!sub) return;

    sub.userId = ownerId;
    sub.organizationId = null;
    await this.subscriptionRepository.save(sub);
    this.logger.log(
      `Subscription converted to personal: sub=${sub.id} user=${ownerId}`,
    );
  }

  // ---------------------------------------------------------------------------
  // Org Dissolution (triggered by downgrade below team or sub deletion)
  // ---------------------------------------------------------------------------

  /**
   * Queues an org dissolution job. Used by webhook handlers and org deletion.
   * The job handles resource transfer, member cleanup, and org deletion.
   */
  async queueDissolution(
    organizationId: string,
    cancelSubscription = false,
  ): Promise<void> {
    // Mark org as dissolving to block further operations
    await this.orgRepository.update(organizationId, { status: 'dissolving' });

    // BullMQ ignores add() for a jobId that already exists, so a failed
    // earlier attempt would silently block every retry for this org.
    const jobId = `dissolve-${organizationId}`;
    const previous = await this.dissolutionQueue.getJob(jobId);
    if (previous && (await previous.isFailed())) {
      await previous.remove();
      this.logger.warn(
        `Removed failed dissolution job before re-queueing: org=${organizationId} reason=${previous.failedReason}`,
      );
    }

    await this.dissolutionQueue.add(
      'orgDissolution',
      { organizationId, cancelSubscription },
      {
        jobId,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    );
    this.logger.log(`Queued org dissolution job: org=${organizationId}`);
  }

  /**
   * Dissolves an organization when its subscription drops below team tier.
   * Transfers all member resources to the org owner, then deletes the org.
   * Called by the OrgDissolutionProcessor (not directly from webhooks).
   */
  async dissolveOrganization(
    organizationId: string,
    cancelSubscription = false,
  ): Promise<void> {
    await this.orgRepository.manager.transaction(async (manager) => {
      const org = await manager.findOne(Organization, {
        where: { id: organizationId },
      });
      if (!org) return;

      const members = await manager.find(User, {
        where: { organizationId },
        select: { id: true, role: true },
      });

      const nonOwnerIds = members
        .filter((m) => m.role !== 'owner')
        .map((m) => m.id);

      if (nonOwnerIds.length > 0) {
        // Transfer all non-owner resources to the org owner
        await manager
          .createQueryBuilder()
          .update(Domain)
          .set({ userId: org.ownerId })
          .where('userId IN (:...ids)', { ids: nonOwnerIds })
          .execute();

        await manager
          .createQueryBuilder()
          .update(TlsCrt)
          .set({ userId: org.ownerId })
          .where('userId IN (:...ids)', { ids: nonOwnerIds })
          .execute();

        await manager
          .createQueryBuilder()
          .update(UserApiKey)
          .set({ userId: org.ownerId })
          .where('userId IN (:...ids)', { ids: nonOwnerIds })
          .execute();
      }

      // Clear all member associations
      await manager
        .createQueryBuilder()
        .update(User)
        .set({ organizationId: () => 'NULL', role: () => 'NULL' })
        .where('organizationId = :organizationId', { organizationId })
        .execute();

      // Convert org subscription back to owner's personal subscription
      let sub = await manager.findOne(Subscription, {
        where: { organizationId },
      });

      // A user may hold only one personal subscription
      // (UQ_subscription_userId_partial), and the owner can already have one,
      // e.g. a member who kept a personal sub and was later made owner.
      const personalSub = sub
        ? await manager.findOne(Subscription, {
            where: { userId: org.ownerId },
          })
        : null;

      if (sub && personalSub) {
        if (cancelSubscription) {
          // The org's Stripe subscription is gone; keep the owner's own.
          await manager.delete(Subscription, sub.id);
          this.logger.log(
            `Dropped canceled org subscription: sub=${sub.id} org=${organizationId}, owner keeps sub=${personalSub.id}`,
          );
          sub = null;
        } else if (!isBillingLive(personalSub)) {
          // The owner's own sub is free or canceled; the org's paid sub replaces it.
          await manager.delete(Subscription, personalSub.id);
          this.logger.log(
            `Replaced owner's inactive subscription: sub=${personalSub.id} with org sub=${sub.id}`,
          );
        } else {
          // Both are still billed. Deleting either row would orphan a
          // subscription that is still billing, so leave it for manual review.
          throw new UnrecoverableError(
            `Owner ${org.ownerId} has a billing personal subscription (sub=${personalSub.id}) and org ${organizationId} has a billing subscription (sub=${sub.id}); resolve manually`,
          );
        }
      }

      if (sub) {
        sub.userId = org.ownerId;
        sub.organizationId = null;

        if (cancelSubscription) {
          sub.plan = 'free';
          sub.status = 'canceled';
          sub.stripeSubscriptionId = null;
          if (sub.source === 'marketplace')
            sub.marketplaceStatus = 'Unsubscribed';
          sub.currentPeriodEnd = null;
          sub.cancelAtPeriodEnd = false;
          sub.pastDueSince = null;
        }

        await manager.save(Subscription, sub);
      }

      // Delete the organization
      await manager.delete(Organization, organizationId);

      this.logger.log(
        `Organization dissolved: org=${organizationId} owner=${org.ownerId} transferredFrom=${nonOwnerIds.length} members`,
      );
    });
  }

  // ---------------------------------------------------------------------------
  // Webhooks
  // ---------------------------------------------------------------------------

  constructWebhookEvent(rawBody: Buffer, signature: string): Stripe.Event {
    return this.stripe.webhooks.constructEvent(
      rawBody,
      signature,
      this.webhookSecret,
    );
  }

  async handleWebhookEvent(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'checkout.session.completed':
        await this.handleCheckoutCompleted(
          event.data.object as Stripe.Checkout.Session,
        );
        break;
      case 'customer.subscription.updated':
        await this.handleSubscriptionUpdated(
          event.data.object as Stripe.Subscription,
        );
        break;
      case 'customer.subscription.deleted':
        await this.handleSubscriptionDeleted(
          event.data.object as Stripe.Subscription,
        );
        break;
      case 'invoice.payment_failed':
        await this.handleInvoicePaymentFailed(
          event.data.object as Stripe.Invoice,
        );
        break;
      case 'invoice.paid':
        await this.handleInvoicePaid(event.data.object as Stripe.Invoice);
        break;
      default:
        this.logger.debug(`Unhandled Stripe event: ${event.type}`);
    }
  }

  private async handleCheckoutCompleted(
    session: Stripe.Checkout.Session,
  ): Promise<void> {
    // A checkout opened before the plans were renamed carries the old id.
    const rawPlan = session.metadata?.plan;
    const plan = rawPlan ? (LEGACY_PLAN_ALIASES[rawPlan] ?? rawPlan) : rawPlan;
    const userId = session.metadata?.userId;
    const organizationId = session.metadata?.organizationId;

    if (!plan || (!userId && !organizationId)) {
      this.logger.warn('Checkout session missing plan or owner metadata');
      return;
    }

    const stripeSubscriptionId =
      typeof session.subscription === 'string'
        ? session.subscription
        : session.subscription?.id;

    if (!stripeSubscriptionId) {
      this.logger.warn('Checkout session missing subscription ID');
      return;
    }

    // Find existing sub or create a new one.
    // We can't use TypeORM upsert here because userId/organizationId use
    // partial unique indexes which aren't compatible with conflictPaths.
    const where = organizationId ? { organizationId } : { userId: userId! };
    const owner = organizationId ? `org=${organizationId}` : `user=${userId}`;

    let sub = await this.subscriptionRepository.findOne({ where });

    if (sub?.stripeSubscriptionId === stripeSubscriptionId) {
      // Stripe redelivered an event we already applied. Applying it again
      // could roll back a plan change made since, so do nothing.
      this.logger.log(
        `Checkout already applied: ${owner} subscription=${stripeSubscriptionId}`,
      );
      return;
    }

    if (sub && hasLiveMarketplaceSubscription(sub)) {
      // Microsoft started billing this account (Marketplace) after the
      // checkout was opened. Keep the Marketplace subscription.
      await this.cancelDuplicateSubscription(
        owner,
        `marketplace:${sub.marketplaceSubscriptionId}`,
        stripeSubscriptionId,
        session.id,
      );
      return;
    }

    if (
      sub &&
      hasLiveStripeSubscription(sub) &&
      (await this.isStripeSubscriptionLive(sub.stripeSubscriptionId!))
    ) {
      await this.cancelDuplicateSubscription(
        owner,
        sub.stripeSubscriptionId!,
        stripeSubscriptionId,
        session.id,
      );
      return;
    }

    const stripeSub: Stripe.Subscription =
      await this.stripe.subscriptions.retrieve(stripeSubscriptionId);

    const stripeCustomerId =
      typeof session.customer === 'string'
        ? session.customer
        : (session.customer?.id ?? '');

    const shared = {
      stripeCustomerId,
      stripeSubscriptionId,
      // A previous Marketplace subscription has ended; Stripe bills now.
      source: 'stripe' as const,
      marketplaceSubscriptionId: null,
      marketplaceOfferId: null,
      marketplacePlanId: null,
      marketplaceStatus: null,
      marketplaceQuantity: null,
      plan,
      status: 'active' as const,
      pastDueSince: null,
      currentPeriodEnd: new Date(this.extractPeriodEnd(stripeSub) * 1000),
      cancelAtPeriodEnd:
        stripeSub.cancel_at_period_end || stripeSub.cancel_at !== null,
    };

    if (sub) {
      // Microsoft may have started billing this account while Stripe was
      // being asked about the subscription above.
      const latest = await this.subscriptionRepository.findOne({
        where: { id: sub.id },
      });
      if (hasLiveMarketplaceSubscription(latest)) {
        await this.cancelDuplicateSubscription(
          owner,
          `marketplace:${latest!.marketplaceSubscriptionId}`,
          stripeSubscriptionId,
          session.id,
        );
        return;
      }
      Object.assign(sub, shared);
    } else {
      sub = this.subscriptionRepository.create({
        ...shared,
        userId: organizationId ? null : userId!,
        organizationId: organizationId ?? null,
      });
    }

    await this.subscriptionRepository.save(sub);

    this.logger.log(`Checkout completed: ${owner} plan=${plan}`);
  }

  /**
   * Checks Stripe rather than our row, which can lag behind: if the old
   * subscription was canceled but its deleted event has not arrived yet, the
   * new checkout is a legitimate resubscribe and must not be canceled.
   */
  private async isStripeSubscriptionLive(
    stripeSubscriptionId: string,
  ): Promise<boolean> {
    try {
      const current =
        await this.stripe.subscriptions.retrieve(stripeSubscriptionId);
      return LIVE_STRIPE_STATUSES.has(current.status);
    } catch (err) {
      if (
        isStripeError(err, 'StripeInvalidRequestError') &&
        err.code === 'resource_missing'
      ) {
        return false;
      }
      throw err;
    }
  }

  /**
   * A second checkout completed while the owner already had a live
   * subscription. Keep the one KrakenKey tracks and cancel the new one right
   * away so it never renews. The first invoice of the new subscription is
   * already paid and is not refunded here; the error log carries the ids
   * needed to refund it from the Stripe dashboard.
   */
  private async cancelDuplicateSubscription(
    owner: string,
    keptSubscriptionId: string,
    duplicateSubscriptionId: string,
    checkoutSessionId: string,
  ): Promise<void> {
    // Stripe can deliver the same event twice; a second cancel would fail.
    if (!(await this.isStripeSubscriptionLive(duplicateSubscriptionId))) {
      this.logger.warn(
        `Duplicate subscription already ended: ${owner} kept=${keptSubscriptionId} duplicate=${duplicateSubscriptionId}`,
      );
      return;
    }
    this.logger.error(
      `Duplicate subscription from checkout: ${owner} kept=${keptSubscriptionId} duplicate=${duplicateSubscriptionId} session=${checkoutSessionId}; canceling the duplicate, refund its first invoice manually`,
    );
    await this.stripe.subscriptions.cancel(duplicateSubscriptionId);
    this.logger.warn(
      `Canceled duplicate subscription: ${owner} duplicate=${duplicateSubscriptionId}`,
    );
  }

  private async handleSubscriptionUpdated(
    stripeSub: Stripe.Subscription,
  ): Promise<void> {
    const sub = await this.subscriptionRepository.findOne({
      where: { stripeSubscriptionId: stripeSub.id },
    });
    if (!sub) {
      this.logger.warn(`Subscription not found for Stripe ID: ${stripeSub.id}`);
      return;
    }

    const previousPlan = normalizePlan(sub.plan);

    sub.status = stripeSub.status === 'active' ? 'active' : stripeSub.status;
    // Stripe may send this before or after invoice.payment_failed, so
    // whichever arrives first starts the grace period.
    let graceStarted = false;
    if (sub.status === 'past_due') {
      graceStarted = await this.startGracePeriod(sub);
    } else if (sub.status === 'active') {
      sub.pastDueSince = null;
    }
    sub.currentPeriodEnd = new Date(this.extractPeriodEnd(stripeSub) * 1000);
    // Stripe portal may use cancel_at (timestamp) instead of cancel_at_period_end (boolean)
    sub.cancelAtPeriodEnd =
      stripeSub.cancel_at_period_end || stripeSub.cancel_at !== null;

    const priceId = stripeSub.items?.data?.[0]?.price?.id;
    if (priceId && this.reversePriceMap[priceId]) {
      sub.plan = this.reversePriceMap[priceId];
    } else {
      // A row an older release wrote with a legacy plan id
      sub.plan = LEGACY_PLAN_ALIASES[sub.plan] ?? sub.plan;
    }

    await this.subscriptionRepository.save(sub);

    const ownerLabel = sub.organizationId
      ? `org=${sub.organizationId}`
      : `user=${sub.userId}`;
    this.logger.log(
      `Subscription updated: ${ownerLabel} plan=${sub.plan} status=${sub.status}`,
    );
    if (graceStarted) await this.notifyPaymentFailed(sub);

    // Detect a downgrade to a plan that can't back an organization
    if (
      sub.organizationId &&
      ORG_ELIGIBLE_PLANS.has(previousPlan) &&
      !ORG_ELIGIBLE_PLANS.has(normalizePlan(sub.plan))
    ) {
      this.logger.warn(
        `Org subscription downgraded below an organization plan: org=${sub.organizationId} ${previousPlan} -> ${sub.plan}`,
      );
      await this.queueDissolution(sub.organizationId);
    }
  }

  private async handleSubscriptionDeleted(
    stripeSub: Stripe.Subscription,
  ): Promise<void> {
    const sub = await this.subscriptionRepository.findOne({
      where: { stripeSubscriptionId: stripeSub.id },
    });
    if (!sub) return;

    // If this is an org subscription, queue dissolution (handles resource
    // transfer, member cleanup, sub conversion, and org deletion)
    if (sub.organizationId) {
      await this.queueDissolution(sub.organizationId, true);
      return;
    }

    sub.plan = 'free';
    sub.status = 'canceled';
    sub.stripeSubscriptionId = null;
    sub.currentPeriodEnd = null;
    sub.cancelAtPeriodEnd = false;
    sub.pastDueSince = null;

    await this.subscriptionRepository.save(sub);
    this.logger.log(`Subscription canceled: user=${sub.userId}`);
  }

  /** Our subscription row for an invoice, or null for one-off invoices. */
  private async findInvoiceSubscription(
    invoice: Stripe.Invoice,
  ): Promise<Subscription | null> {
    const stripeSubscriptionId = invoiceSubscriptionId(invoice);
    if (!stripeSubscriptionId) return null;
    return this.subscriptionRepository.findOne({
      where: { stripeSubscriptionId },
    });
  }

  private async handleInvoicePaymentFailed(
    invoice: Stripe.Invoice,
  ): Promise<void> {
    const sub = await this.findInvoiceSubscription(invoice);
    if (!sub) return;

    const ownerLabel = sub.organizationId
      ? `org=${sub.organizationId}`
      : `user=${sub.userId}`;

    // Stripe stops retrying once it marks a subscription unpaid; a later
    // failure must not reopen the grace period.
    if (sub.status !== 'active' && sub.status !== 'past_due') {
      this.logger.warn(
        `Payment failed: ${ownerLabel} status=${sub.status}, not starting a grace period`,
      );
      return;
    }

    sub.status = 'past_due';
    const graceStarted = await this.startGracePeriod(sub);
    await this.subscriptionRepository.save(sub);

    this.logger.warn(
      `Payment failed: ${ownerLabel} pastDueSince=${sub.pastDueSince?.toISOString()}`,
    );
    if (graceStarted) await this.notifyPaymentFailed(sub);
  }

  private async handleInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
    const sub = await this.findInvoiceSubscription(invoice);
    if (!sub) return;
    if (sub.status !== 'past_due' && sub.status !== 'unpaid') return;

    sub.status = 'active';
    sub.pastDueSince = null;
    await this.subscriptionRepository.save(sub);

    const ownerLabel = sub.organizationId
      ? `org=${sub.organizationId}`
      : `user=${sub.userId}`;
    this.logger.log(`Payment recovered: ${ownerLabel}`);
  }

  /**
   * Records the first failed payment of a past_due run. Later failures
   * don't move it. Returns true only for the call that set it, so the
   * payment-failed email goes out once even when Stripe delivers
   * invoice.payment_failed and customer.subscription.updated together.
   */
  private async startGracePeriod(sub: Subscription): Promise<boolean> {
    if (sub.pastDueSince) return false;

    const now = new Date();
    const result = await this.subscriptionRepository.update(
      { id: sub.id, pastDueSince: IsNull() },
      { pastDueSince: now },
    );
    if (result.affected) {
      sub.pastDueSince = now;
      return true;
    }

    // Another webhook got there first; keep its timestamp.
    const current = await this.subscriptionRepository.findOne({
      where: { id: sub.id },
    });
    sub.pastDueSince = current?.pastDueSince ?? now;
    return false;
  }

  /**
   * Emails the account owner (or the org owner, for an org subscription)
   * that the payment failed and when the paid limits end.
   */
  private async notifyPaymentFailed(sub: Subscription): Promise<void> {
    const endsAt = graceEndsAt(sub);
    if (!endsAt || sub.plan === 'free') return;

    try {
      let recipientId = sub.userId;
      let organizationName: string | undefined;
      if (sub.organizationId) {
        const org = await this.orgRepository.findOne({
          where: { id: sub.organizationId },
        });
        recipientId = org?.ownerId ?? null;
        organizationName = org?.name;
      }
      if (!recipientId) return;

      const owner = await this.userRepository.findOne({
        where: { id: recipientId },
        select: { id: true, email: true, username: true },
      });
      if (!owner?.email) return;

      await this.emailService.sendPaymentFailed({
        userId: owner.id,
        username: owner.username,
        email: owner.email,
        plan: sub.plan,
        graceEndsAt: endsAt,
        organizationName,
      });
    } catch (err) {
      this.logger.error(
        `Failed to send payment failed email: sub=${sub.id}`,
        err instanceof Error ? err.stack : err,
      );
    }
  }

  /**
   * Extract current_period_end from a Stripe Subscription.
   * In SDK v20+ this moved to items.data[0], but webhook payloads
   * may still include it at the top level.
   */
  private extractPeriodEnd(sub: Stripe.Subscription): number {
    const fromItem = sub.items?.data?.[0]?.current_period_end;
    if (fromItem) return fromItem;
    return (sub as any).current_period_end ?? Math.floor(Date.now() / 1000);
  }
}
