import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { Subscription } from './entities/subscription.entity';

const PLAN_ORDER: Record<string, number> = {
  free: 0,
  starter: 1,
  team: 2,
  business: 3,
  enterprise: 4,
};

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

  async getOrCreateCustomer(
    userId: string,
    email: string,
  ): Promise<Subscription> {
    const existing = await this.subscriptionRepository.findOne({
      where: { userId },
    });
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

    const sub = await this.getOrCreateCustomer(userId, email);
    const appDomain = this.configService.get<string>('KK_APP_DOMAIN');

    const session = await this.stripe.checkout.sessions.create({
      customer: sub.stripeCustomerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `https://${appDomain}/dashboard/billing?success=true`,
      cancel_url: `https://${appDomain}/dashboard/billing?canceled=true`,
      metadata: { userId, plan },
    });

    if (!session.url) {
      throw new BadRequestException('Failed to create checkout session');
    }

    return session.url;
  }

  async getSubscription(userId: string): Promise<Subscription | null> {
    return this.subscriptionRepository.findOne({ where: { userId } });
  }

  async createPortalSession(userId: string): Promise<string> {
    const sub = await this.subscriptionRepository.findOne({
      where: { userId },
    });
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

  async previewUpgrade(
    userId: string,
    newPlan: string,
  ): Promise<{
    immediateAmountCents: number;
    currency: string;
    targetPlan: string;
    currentPeriodEnd: string;
  }> {
    const sub = await this.validateUpgrade(userId, newPlan);
    const newPriceId = this.priceMap[newPlan];

    const stripeSub = await this.stripe.subscriptions.retrieve(
      sub.stripeSubscriptionId!,
    );
    const itemId = stripeSub.items.data[0].id;

    const upcomingInvoice = await this.stripe.invoices.createPreview({
      subscription: sub.stripeSubscriptionId!,
      subscription_details: {
        items: [{ id: itemId, price: newPriceId }],
        proration_behavior: 'create_prorations',
      },
    });

    return {
      immediateAmountCents: upcomingInvoice.amount_due,
      currency: upcomingInvoice.currency,
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
    const sub = await this.validateUpgrade(userId, newPlan);
    const newPriceId = this.priceMap[newPlan];

    const stripeSub = await this.stripe.subscriptions.retrieve(
      sub.stripeSubscriptionId!,
    );
    const itemId = stripeSub.items.data[0].id;

    await this.stripe.subscriptions.update(sub.stripeSubscriptionId!, {
      items: [{ id: itemId, price: newPriceId }],
      proration_behavior: 'create_prorations',
    });

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

  private async validateUpgrade(
    userId: string,
    newPlan: string,
  ): Promise<Subscription> {
    const sub = await this.subscriptionRepository.findOne({
      where: { userId },
    });
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
    const userId = session.metadata?.userId;
    const plan = session.metadata?.plan;
    if (!userId || !plan) {
      this.logger.warn('Checkout session missing userId or plan metadata');
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

    // Fetch the Stripe subscription to get the current period end
    const stripeSub: Stripe.Subscription =
      await this.stripe.subscriptions.retrieve(stripeSubscriptionId);

    await this.subscriptionRepository.upsert(
      {
        userId,
        stripeCustomerId:
          typeof session.customer === 'string'
            ? session.customer
            : (session.customer?.id ?? ''),
        stripeSubscriptionId,
        plan,
        status: 'active',
        currentPeriodEnd: new Date(this.extractPeriodEnd(stripeSub) * 1000),
        cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
      },
      {
        conflictPaths: ['userId'],
      },
    );

    this.logger.log(`Checkout completed: user=${userId} plan=${plan}`);
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

    sub.status = stripeSub.status === 'active' ? 'active' : stripeSub.status;
    sub.currentPeriodEnd = new Date(this.extractPeriodEnd(stripeSub) * 1000);
    sub.cancelAtPeriodEnd = stripeSub.cancel_at_period_end;

    const priceId = stripeSub.items?.data?.[0]?.price?.id;
    if (priceId && this.reversePriceMap[priceId]) {
      sub.plan = this.reversePriceMap[priceId];
    }

    await this.subscriptionRepository.save(sub);
    this.logger.log(
      `Subscription updated: user=${sub.userId} plan=${sub.plan} status=${sub.status}`,
    );
  }

  private async handleSubscriptionDeleted(
    stripeSub: Stripe.Subscription,
  ): Promise<void> {
    const sub = await this.subscriptionRepository.findOne({
      where: { stripeSubscriptionId: stripeSub.id },
    });
    if (!sub) return;

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
    this.logger.warn(`Payment failed: user=${sub.userId}`);
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

  async resolveUserTier(userId: string): Promise<string> {
    const sub = await this.subscriptionRepository.findOne({
      where: { userId },
    });
    if (!sub || sub.status !== 'active') return 'free';
    return sub.plan;
  }
}
