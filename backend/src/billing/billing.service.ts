import {
  Injectable,
  Logger,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import Stripe from 'stripe';
import { Subscription } from './entities/subscription.entity';
import { User } from '../users/entities/user.entity';
import { Organization } from '../organizations/entities/organization.entity';
import { Domain } from '../domains/entities/domain.entity';
import { TlsCrt } from '../certs/tls/entities/tls-crt.entity';
import { UserApiKey } from '../auth/entities/user-api-key.entity';
import type { OrgDissolutionJobPayload } from './processors/org-dissolution.processor';

const PLAN_ORDER: Record<string, number> = {
  free: 0,
  starter: 1,
  team: 2,
  business: 3,
  enterprise: 4,
};

const ORG_ELIGIBLE_PLANS = new Set(['team', 'business', 'enterprise']);

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
  ) {
    this.stripe = new Stripe(
      this.configService.get<string>('KK_STRIPE_SECRET_KEY', ''),
    );

    this.webhookSecret = this.configService.get<string>(
      'KK_STRIPE_WEBHOOK_SECRET',
      '',
    );

    // Map plan names to Stripe price IDs from env vars.
    this.priceMap = {};
    const starterPrice = this.configService.get<string>(
      'KK_STRIPE_PRICE_STARTER',
    );
    if (starterPrice) this.priceMap['starter'] = starterPrice;

    const teamPrice = this.configService.get<string>('KK_STRIPE_PRICE_TEAM');
    if (teamPrice) this.priceMap['team'] = teamPrice;

    this.reversePriceMap = {};
    for (const [plan, priceId] of Object.entries(this.priceMap)) {
      this.reversePriceMap[priceId] = plan;
    }
  }

  // ---------------------------------------------------------------------------
  // Tier Resolution (org-aware)
  // ---------------------------------------------------------------------------

  async resolveUserTier(userId: string): Promise<string> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: { id: true, organizationId: true },
    });

    if (user?.organizationId) {
      const sub = await this.subscriptionRepository.findOne({
        where: { organizationId: user.organizationId },
      });
      if (sub && sub.status === 'active') return sub.plan;
      return 'free';
    }

    const sub = await this.subscriptionRepository.findOne({
      where: { userId },
    });
    if (!sub || sub.status !== 'active') return 'free';
    return sub.plan;
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
    if (existing) return existing;

    const customer = await this.stripe.customers.create({
      email,
      metadata: { userId },
    });

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
        `Plan "${plan}" is not available for purchase`,
      );
    }

    // If user is in an org, only the owner can perform billing actions
    await this.assertBillingAccess(userId);

    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: { id: true, organizationId: true },
    });

    const sub = await this.getOrCreateCustomer(userId, email);
    const appDomain = this.configService.get<string>('KK_APP_DOMAIN');

    const metadata: Record<string, string> = { plan };
    if (user?.organizationId) {
      metadata.organizationId = user.organizationId;
    } else {
      metadata.userId = userId;
    }

    const session = await this.stripe.checkout.sessions.create({
      customer: sub.stripeCustomerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `https://${appDomain}/dashboard/billing?success=true`,
      cancel_url: `https://${appDomain}/dashboard/billing?canceled=true`,
      metadata,
    });

    if (!session.url) {
      throw new BadRequestException('Failed to create checkout session');
    }

    return session.url;
  }

  async createPortalSession(userId: string): Promise<string> {
    await this.assertBillingAccess(userId);

    const sub = await this.getSubscription(userId);
    if (!sub) {
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
      customer: sub.stripeCustomerId,
      amount: differenceCents,
      currency,
      description: `Plan upgrade: ${sub.plan} \u2192 ${newPlan}`,
    });

    const invoice = await this.stripe.invoices.create({
      customer: sub.stripeCustomerId,
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
    const currentPriceId = this.priceMap[currentPlan];
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
    if (!sub || !sub.stripeSubscriptionId) {
      throw new NotFoundException('No active subscription found');
    }
    if (sub.status !== 'active') {
      throw new BadRequestException(
        'Cannot upgrade a subscription that is not active',
      );
    }
    if ((PLAN_ORDER[newPlan] ?? 0) <= (PLAN_ORDER[sub.plan] ?? 0)) {
      throw new BadRequestException(
        `Cannot upgrade from ${sub.plan} to ${newPlan}`,
      );
    }
    if (!this.priceMap[newPlan]) {
      throw new BadRequestException(
        `Plan "${newPlan}" is not available for purchase`,
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

    await this.dissolutionQueue.add(
      'orgDissolution',
      { organizationId, cancelSubscription },
      {
        jobId: `dissolve-${organizationId}`,
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
      const sub = await manager.findOne(Subscription, {
        where: { organizationId },
      });
      if (sub) {
        sub.userId = org.ownerId;
        sub.organizationId = null;

        if (cancelSubscription) {
          sub.plan = 'free';
          sub.status = 'canceled';
          sub.stripeSubscriptionId = null;
          sub.currentPeriodEnd = null;
          sub.cancelAtPeriodEnd = false;
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
      default:
        this.logger.debug(`Unhandled Stripe event: ${event.type}`);
    }
  }

  private async handleCheckoutCompleted(
    session: Stripe.Checkout.Session,
  ): Promise<void> {
    const plan = session.metadata?.plan;
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

    const stripeSub: Stripe.Subscription =
      await this.stripe.subscriptions.retrieve(stripeSubscriptionId);

    const stripeCustomerId =
      typeof session.customer === 'string'
        ? session.customer
        : (session.customer?.id ?? '');

    const shared = {
      stripeCustomerId,
      stripeSubscriptionId,
      plan,
      status: 'active' as const,
      currentPeriodEnd: new Date(this.extractPeriodEnd(stripeSub) * 1000),
      cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
    };

    // Find existing sub or create a new one.
    // We can't use TypeORM upsert here because userId/organizationId use
    // partial unique indexes which aren't compatible with conflictPaths.
    const where = organizationId ? { organizationId } : { userId: userId! };

    let sub = await this.subscriptionRepository.findOne({ where });

    if (sub) {
      Object.assign(sub, shared);
    } else {
      sub = this.subscriptionRepository.create({
        ...shared,
        userId: organizationId ? null : userId!,
        organizationId: organizationId ?? null,
      });
    }

    await this.subscriptionRepository.save(sub);

    const owner = organizationId ? `org=${organizationId}` : `user=${userId}`;
    this.logger.log(`Checkout completed: ${owner} plan=${plan}`);
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

    const previousPlan = sub.plan;

    sub.status = stripeSub.status === 'active' ? 'active' : stripeSub.status;
    sub.currentPeriodEnd = new Date(this.extractPeriodEnd(stripeSub) * 1000);
    sub.cancelAtPeriodEnd = stripeSub.cancel_at_period_end;

    const priceId = stripeSub.items?.data?.[0]?.price?.id;
    if (priceId && this.reversePriceMap[priceId]) {
      sub.plan = this.reversePriceMap[priceId];
    }

    await this.subscriptionRepository.save(sub);

    const ownerLabel = sub.organizationId
      ? `org=${sub.organizationId}`
      : `user=${sub.userId}`;
    this.logger.log(
      `Subscription updated: ${ownerLabel} plan=${sub.plan} status=${sub.status}`,
    );

    // Detect downgrade below team for org subscriptions
    if (
      sub.organizationId &&
      ORG_ELIGIBLE_PLANS.has(previousPlan) &&
      !ORG_ELIGIBLE_PLANS.has(sub.plan)
    ) {
      this.logger.warn(
        `Org subscription downgraded below team: org=${sub.organizationId} ${previousPlan} -> ${sub.plan}`,
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

    await this.subscriptionRepository.save(sub);
    this.logger.log(`Subscription canceled: user=${sub.userId}`);
  }

  private async handleInvoicePaymentFailed(
    invoice: Stripe.Invoice,
  ): Promise<void> {
    const customerId =
      typeof invoice.customer === 'string'
        ? invoice.customer
        : invoice.customer?.id;

    if (!customerId) return;

    const sub = await this.subscriptionRepository.findOne({
      where: { stripeCustomerId: customerId },
    });
    if (!sub) return;

    sub.status = 'past_due';
    await this.subscriptionRepository.save(sub);

    const ownerLabel = sub.organizationId
      ? `org=${sub.organizationId}`
      : `user=${sub.userId}`;
    this.logger.warn(`Payment failed: ${ownerLabel}`);
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
