import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { BillingService } from './billing.service';
import { Subscription } from './entities/subscription.entity';
import { User } from '../users/entities/user.entity';
import { Organization } from '../organizations/entities/organization.entity';
import { UnrecoverableError } from 'bullmq';
import { EmailService } from '../notifications/email.service';

// Mock Stripe
const mockStripe = {
  customers: { create: jest.fn() },
  checkout: { sessions: { create: jest.fn() } },
  billingPortal: { sessions: { create: jest.fn() } },
  subscriptions: { retrieve: jest.fn(), update: jest.fn(), cancel: jest.fn() },
  prices: { retrieve: jest.fn() },
  invoiceItems: { create: jest.fn() },
  invoices: { create: jest.fn(), pay: jest.fn() },
  webhooks: { constructEvent: jest.fn() },
};
jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => mockStripe);
});

describe('BillingService', () => {
  let service: BillingService;
  let mockRepository: Record<string, jest.Mock>;
  let mockUserRepo: Record<string, jest.Mock>;
  let mockOrgRepo: Record<string, any>;
  let mockEmailService: { sendPaymentFailed: jest.Mock };

  const userId = 'user-123';
  const mockSubscription: Partial<Subscription> = {
    id: 'sub-uuid-1',
    userId,
    stripeCustomerId: 'cus_test123',
    stripeSubscriptionId: 'sub_test123',
    plan: 'starter',
    status: 'active',
    currentPeriodEnd: new Date('2026-04-09'),
    cancelAtPeriodEnd: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    mockRepository = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    mockEmailService = { sendPaymentFailed: jest.fn() };

    mockUserRepo = {
      findOne: jest
        .fn()
        .mockResolvedValue({ id: userId, organizationId: null }),
    };
    mockOrgRepo = {
      findOne: jest.fn(),
      update: jest.fn(),
      manager: {
        transaction: jest.fn().mockImplementation((cb: any) =>
          cb({
            findOne: jest.fn(),
            find: jest.fn(),
            save: jest.fn(),
            delete: jest.fn(),
            createQueryBuilder: jest.fn().mockReturnValue({
              update: jest.fn().mockReturnThis(),
              set: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              execute: jest.fn(),
            }),
          }),
        ),
      },
    };
    const mockDissolutionQueue = { add: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        {
          provide: getRepositoryToken(Subscription),
          useValue: mockRepository,
        },
        { provide: getRepositoryToken(User), useValue: mockUserRepo },
        { provide: getRepositoryToken(Organization), useValue: mockOrgRepo },
        {
          provide: getQueueToken('orgDissolution'),
          useValue: mockDissolutionQueue,
        },
        { provide: EmailService, useValue: mockEmailService },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: string) => {
              const config: Record<string, string> = {
                KK_STRIPE_SECRET_KEY: 'sk_test_123',
                KK_STRIPE_WEBHOOK_SECRET: 'whsec_test',
                KK_STRIPE_PRICE_STARTER: 'price_starter_123',
                KK_STRIPE_PRICE_TEAM: 'price_team_456',
                KK_APP_DOMAIN: 'app.krakenkey.io',
              };
              return config[key] ?? defaultValue ?? '';
            }),
          },
        },
      ],
    }).compile();

    service = module.get<BillingService>(BillingService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('boots without a Stripe key instead of crashing the app', () => {
    // Local dev has no Stripe secret; construction must not throw.
    expect(
      () =>
        new BillingService(
          {} as any,
          {} as any,
          {} as any,
          {} as any,
          { get: jest.fn(() => '') } as any,
          {} as any,
        ),
    ).not.toThrow();
  });

  describe('resolveUserTier', () => {
    it('returns plan for active subscription', async () => {
      mockRepository.findOne.mockResolvedValue(mockSubscription);
      const tier = await service.resolveUserTier(userId);
      expect(tier).toBe('starter');
    });

    it('returns free when no subscription exists', async () => {
      mockRepository.findOne.mockResolvedValue(null);
      const tier = await service.resolveUserTier(userId);
      expect(tier).toBe('free');
    });

    it('returns free when subscription is canceled', async () => {
      mockRepository.findOne.mockResolvedValue({
        ...mockSubscription,
        status: 'canceled',
      });
      const tier = await service.resolveUserTier(userId);
      expect(tier).toBe('free');
    });

    const daysAgo = (n: number) =>
      new Date(Date.now() - n * 24 * 60 * 60 * 1000);

    it('keeps the paid plan while past_due inside the grace period', async () => {
      mockRepository.findOne.mockResolvedValue({
        ...mockSubscription,
        status: 'past_due',
        pastDueSince: daysAgo(13),
      });
      expect(await service.resolveUserTier(userId)).toBe('starter');
    });

    it('drops to free once the grace period has passed', async () => {
      mockRepository.findOne.mockResolvedValue({
        ...mockSubscription,
        status: 'past_due',
        pastDueSince: daysAgo(15),
      });
      expect(await service.resolveUserTier(userId)).toBe('free');
    });

    it('gives no grace to a past_due row without pastDueSince', async () => {
      mockRepository.findOne.mockResolvedValue({
        ...mockSubscription,
        status: 'past_due',
        pastDueSince: null,
      });
      expect(await service.resolveUserTier(userId)).toBe('free');
    });

    it('returns free when the subscription is unpaid', async () => {
      mockRepository.findOne.mockResolvedValue({
        ...mockSubscription,
        status: 'unpaid',
        pastDueSince: daysAgo(1),
      });
      expect(await service.resolveUserTier(userId)).toBe('free');
    });

    it('applies the grace period to an org subscription', async () => {
      mockUserRepo.findOne.mockResolvedValueOnce({
        id: userId,
        organizationId: 'org-1',
      });
      mockRepository.findOne.mockResolvedValue({
        ...mockSubscription,
        userId: null,
        organizationId: 'org-1',
        plan: 'team',
        status: 'past_due',
        pastDueSince: daysAgo(2),
      });
      expect(await service.resolveUserTier(userId)).toBe('team');
      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { organizationId: 'org-1' },
      });
    });
  });

  describe('getSubscription', () => {
    it('returns subscription when found', async () => {
      mockRepository.findOne.mockResolvedValue(mockSubscription);
      const result = await service.getSubscription(userId);
      expect(result).toEqual(mockSubscription);
    });

    it('returns null when not found', async () => {
      mockRepository.findOne.mockResolvedValue(null);
      const result = await service.getSubscription(userId);
      expect(result).toBeNull();
    });
  });

  describe('getOrCreateCustomer', () => {
    it('returns existing subscription if found', async () => {
      mockRepository.findOne.mockResolvedValue(mockSubscription);
      const result = await service.getOrCreateCustomer(
        userId,
        'test@example.com',
      );
      expect(result).toEqual(mockSubscription);
      expect(mockStripe.customers.create).not.toHaveBeenCalled();
    });

    it('creates Stripe customer and subscription record if not found', async () => {
      mockRepository.findOne.mockResolvedValue(null);
      mockStripe.customers.create.mockResolvedValue({ id: 'cus_new' });
      mockRepository.create.mockReturnValue({
        userId,
        stripeCustomerId: 'cus_new',
        plan: 'free',
        status: 'active',
      });
      mockRepository.save.mockResolvedValue({
        userId,
        stripeCustomerId: 'cus_new',
        plan: 'free',
        status: 'active',
      });

      const result = await service.getOrCreateCustomer(
        userId,
        'test@example.com',
      );
      expect(mockStripe.customers.create).toHaveBeenCalledWith({
        email: 'test@example.com',
        metadata: { userId },
      });
      expect(result.stripeCustomerId).toBe('cus_new');
    });
  });

  describe('createCheckoutSession', () => {
    it('throws BadRequestException for unavailable plan', async () => {
      await expect(
        service.createCheckoutSession(userId, 'test@example.com', 'enterprise'),
      ).rejects.toThrow(BadRequestException);
    });

    const freeSubscription: Partial<Subscription> = {
      ...mockSubscription,
      stripeSubscriptionId: null,
      plan: 'free',
      status: 'active',
    };

    it('creates checkout session for valid plan', async () => {
      mockRepository.findOne.mockResolvedValue(freeSubscription);
      mockStripe.checkout.sessions.create.mockResolvedValue({
        url: 'https://checkout.stripe.com/session123',
      });

      const url = await service.createCheckoutSession(
        userId,
        'test@example.com',
        'starter',
      );
      expect(url).toBe('https://checkout.stripe.com/session123');
      expect(mockStripe.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          customer: 'cus_test123',
          mode: 'subscription',
          metadata: expect.objectContaining({ plan: 'starter' }),
        }),
        {
          idempotencyKey: expect.stringMatching(
            new RegExp(`^checkout-user-${userId}-starter-\\d+$`),
          ),
        },
      );
    });

    it.each(['active', 'past_due', 'trialing', 'unpaid'])(
      'rejects with 409 when the user already has a %s subscription',
      async (status) => {
        mockRepository.findOne.mockResolvedValue({
          ...mockSubscription,
          status,
        });

        const err = await service
          .createCheckoutSession(userId, 'test@example.com', 'team')
          .catch((e: unknown) => e);

        expect(err).toBeInstanceOf(ConflictException);
        expect((err as ConflictException).message).toMatch(/billing portal/);
        expect(mockStripe.checkout.sessions.create).not.toHaveBeenCalled();
        expect(mockStripe.customers.create).not.toHaveBeenCalled();
      },
    );

    it('rejects with 409 when the org the owner bills for is already paid', async () => {
      const orgId = 'org-1';
      const userRepo = (service as any).userRepository;
      userRepo.findOne.mockResolvedValue({
        id: userId,
        organizationId: orgId,
        role: 'owner',
      });
      mockRepository.findOne.mockImplementation(({ where }: any) =>
        Promise.resolve(
          where.organizationId === orgId
            ? {
                ...mockSubscription,
                userId: null,
                organizationId: orgId,
                plan: 'team',
              }
            : null,
        ),
      );

      await expect(
        service.createCheckoutSession(userId, 'test@example.com', 'team'),
      ).rejects.toThrow(ConflictException);
      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { organizationId: orgId },
      });
      expect(mockStripe.checkout.sessions.create).not.toHaveBeenCalled();
    });

    it.each([
      ['a canceled subscription', { status: 'canceled' }],
      ['a free row', { stripeSubscriptionId: null }],
    ])('allows checkout with %s', async (_label, overrides) => {
      mockRepository.findOne.mockResolvedValue({
        ...mockSubscription,
        ...overrides,
      });
      mockStripe.checkout.sessions.create.mockResolvedValue({
        url: 'https://checkout.stripe.com/session123',
      });

      await expect(
        service.createCheckoutSession(userId, 'test@example.com', 'starter'),
      ).resolves.toBe('https://checkout.stripe.com/session123');
    });

    it('allows checkout when there is no subscription row yet', async () => {
      mockRepository.findOne.mockResolvedValue(null);
      mockStripe.customers.create.mockResolvedValue({ id: 'cus_new' });
      mockRepository.create.mockImplementation((d: any) => d);
      mockRepository.save.mockImplementation((d: any) => Promise.resolve(d));
      mockStripe.checkout.sessions.create.mockResolvedValue({
        url: 'https://checkout.stripe.com/session123',
      });

      await expect(
        service.createCheckoutSession(userId, 'test@example.com', 'starter'),
      ).resolves.toBe('https://checkout.stripe.com/session123');
    });

    it('sends the same idempotency key for two quick clicks', async () => {
      mockRepository.findOne.mockResolvedValue(freeSubscription);
      mockStripe.checkout.sessions.create.mockResolvedValue({
        url: 'https://checkout.stripe.com/session123',
      });
      const now = jest.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);

      try {
        await service.createCheckoutSession(userId, 'a@b.c', 'starter');
        await service.createCheckoutSession(userId, 'a@b.c', 'starter');
      } finally {
        now.mockRestore();
      }

      const [first, second] = mockStripe.checkout.sessions.create.mock.calls;
      expect(first[1].idempotencyKey).toBe(second[1].idempotencyKey);
    });

    it('maps a Stripe idempotency error to 409', async () => {
      mockRepository.findOne.mockResolvedValue(freeSubscription);
      mockStripe.checkout.sessions.create.mockRejectedValue(
        Object.assign(new Error('Keys for idempotent requests'), {
          type: 'StripeIdempotencyError',
        }),
      );

      await expect(
        service.createCheckoutSession(userId, 'test@example.com', 'team'),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('createPortalSession', () => {
    it('throws NotFoundException when no subscription', async () => {
      mockRepository.findOne.mockResolvedValue(null);
      await expect(service.createPortalSession(userId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('creates portal session', async () => {
      mockRepository.findOne.mockResolvedValue(mockSubscription);
      mockStripe.billingPortal.sessions.create.mockResolvedValue({
        url: 'https://billing.stripe.com/portal123',
      });

      const url = await service.createPortalSession(userId);
      expect(url).toBe('https://billing.stripe.com/portal123');
    });
  });

  describe('handleWebhookEvent', () => {
    it('handles checkout.session.completed', async () => {
      mockStripe.subscriptions.retrieve.mockResolvedValue({
        current_period_end: Math.floor(Date.now() / 1000) + 86400 * 30,
        cancel_at_period_end: false,
      });
      // findOne returns the existing free row for find-then-save pattern
      mockRepository.findOne.mockResolvedValue({
        ...mockSubscription,
        stripeSubscriptionId: null,
        plan: 'free',
      });
      mockRepository.save.mockResolvedValue({ ...mockSubscription });

      await service.handleWebhookEvent({
        type: 'checkout.session.completed',
        data: {
          object: {
            metadata: { userId, plan: 'starter' },
            subscription: 'sub_new123',
            customer: 'cus_test123',
          },
        },
      } as any);

      expect(mockRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          plan: 'starter',
          status: 'active',
          stripeSubscriptionId: 'sub_new123',
        }),
      );
    });

    describe('checkout.session.completed with an existing subscription', () => {
      const checkoutEvent = (subscription: string) =>
        ({
          type: 'checkout.session.completed',
          data: {
            object: {
              id: 'cs_test_2',
              metadata: { userId, plan: 'team' },
              subscription,
              customer: 'cus_test123',
            },
          },
        }) as any;

      const stripeSubs: Record<string, any> = {};
      beforeEach(() => {
        for (const k of Object.keys(stripeSubs)) delete stripeSubs[k];
        mockStripe.subscriptions.retrieve.mockImplementation((id: string) =>
          stripeSubs[id]
            ? Promise.resolve(stripeSubs[id])
            : Promise.reject(
                Object.assign(new Error('No such subscription'), {
                  type: 'StripeInvalidRequestError',
                  code: 'resource_missing',
                }),
              ),
        );
      });

      it('keeps the tracked subscription and cancels the duplicate', async () => {
        stripeSubs.sub_test123 = { id: 'sub_test123', status: 'active' };
        stripeSubs.sub_dup = { id: 'sub_dup', status: 'active' };
        mockRepository.findOne.mockResolvedValue({ ...mockSubscription });
        const errorLog = jest
          .spyOn((service as any).logger, 'error')
          .mockImplementation(() => undefined);

        await service.handleWebhookEvent(checkoutEvent('sub_dup'));

        expect(mockRepository.save).not.toHaveBeenCalled();
        expect(mockStripe.subscriptions.cancel).toHaveBeenCalledWith('sub_dup');
        expect(errorLog).toHaveBeenCalledWith(
          expect.stringMatching(/kept=sub_test123 duplicate=sub_dup/),
        );
      });

      it('does not cancel twice when the event is redelivered', async () => {
        stripeSubs.sub_test123 = { id: 'sub_test123', status: 'active' };
        stripeSubs.sub_dup = { id: 'sub_dup', status: 'canceled' };
        mockRepository.findOne.mockResolvedValue({ ...mockSubscription });

        await service.handleWebhookEvent(checkoutEvent('sub_dup'));

        expect(mockRepository.save).not.toHaveBeenCalled();
        expect(mockStripe.subscriptions.cancel).not.toHaveBeenCalled();
      });

      it('replaces the row when Stripe says the old subscription ended', async () => {
        // The old subscription's deleted event has not arrived yet.
        stripeSubs.sub_test123 = { id: 'sub_test123', status: 'canceled' };
        stripeSubs.sub_new = {
          id: 'sub_new',
          status: 'active',
          current_period_end: Math.floor(Date.now() / 1000) + 86400 * 30,
          cancel_at_period_end: false,
          cancel_at: null,
        };
        mockRepository.findOne.mockResolvedValue({ ...mockSubscription });

        await service.handleWebhookEvent(checkoutEvent('sub_new'));

        expect(mockStripe.subscriptions.cancel).not.toHaveBeenCalled();
        expect(mockRepository.save).toHaveBeenCalledWith(
          expect.objectContaining({
            stripeSubscriptionId: 'sub_new',
            plan: 'team',
          }),
        );
      });

      it('replaces a canceled row without asking Stripe about it', async () => {
        stripeSubs.sub_new = {
          id: 'sub_new',
          status: 'active',
          current_period_end: Math.floor(Date.now() / 1000) + 86400 * 30,
          cancel_at_period_end: false,
          cancel_at: null,
        };
        mockRepository.findOne.mockResolvedValue({
          ...mockSubscription,
          status: 'canceled',
        });

        await service.handleWebhookEvent(checkoutEvent('sub_new'));

        expect(mockStripe.subscriptions.retrieve).not.toHaveBeenCalledWith(
          'sub_test123',
        );
        expect(mockRepository.save).toHaveBeenCalledWith(
          expect.objectContaining({ stripeSubscriptionId: 'sub_new' }),
        );
      });

      it('is a no-op when the same session is delivered again', async () => {
        mockRepository.findOne.mockResolvedValue({
          ...mockSubscription,
          stripeSubscriptionId: 'sub_dup',
          plan: 'business',
        });

        await service.handleWebhookEvent(checkoutEvent('sub_dup'));

        expect(mockRepository.save).not.toHaveBeenCalled();
        expect(mockStripe.subscriptions.retrieve).not.toHaveBeenCalled();
        expect(mockStripe.subscriptions.cancel).not.toHaveBeenCalled();
      });
    });

    it('handles customer.subscription.updated', async () => {
      mockRepository.findOne.mockResolvedValue({ ...mockSubscription });

      await service.handleWebhookEvent({
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_test123',
            status: 'active',
            current_period_end: Math.floor(Date.now() / 1000) + 86400 * 30,
            cancel_at_period_end: true,
          },
        },
      } as any);

      expect(mockRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          cancelAtPeriodEnd: true,
        }),
      );
    });

    it('handles customer.subscription.deleted', async () => {
      mockRepository.findOne.mockResolvedValue({ ...mockSubscription });

      await service.handleWebhookEvent({
        type: 'customer.subscription.deleted',
        data: {
          object: { id: 'sub_test123' },
        },
      } as any);

      expect(mockRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          plan: 'free',
          status: 'canceled',
          stripeSubscriptionId: null,
        }),
      );
    });

    it('syncs plan from price ID on subscription.updated', async () => {
      mockRepository.findOne.mockResolvedValue({ ...mockSubscription });

      await service.handleWebhookEvent({
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_test123',
            status: 'active',
            items: {
              data: [
                {
                  current_period_end:
                    Math.floor(Date.now() / 1000) + 86400 * 30,
                  price: { id: 'price_team_456' },
                },
              ],
            },
            cancel_at_period_end: false,
          },
        },
      } as any);

      expect(mockRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          plan: 'team',
        }),
      );
    });
  });

  describe('failed payments', () => {
    const invoice = (subscription = 'sub_test123') => ({
      customer: 'cus_test123',
      parent: { subscription_details: { subscription } },
    });
    const event = (type: string, object: unknown) =>
      ({ type, data: { object } }) as any;

    beforeEach(() => {
      mockUserRepo.findOne.mockResolvedValue({
        id: userId,
        email: 'owner@example.com',
        username: 'owner',
      });
    });

    it('marks the subscription past_due and starts the grace period once', async () => {
      const sub = { ...mockSubscription, pastDueSince: null };
      mockRepository.findOne.mockResolvedValue(sub);

      const before = Date.now();
      await service.handleWebhookEvent(
        event('invoice.payment_failed', invoice()),
      );

      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { stripeSubscriptionId: 'sub_test123' },
      });
      expect(mockRepository.update).toHaveBeenCalledWith(
        { id: 'sub-uuid-1', pastDueSince: expect.anything() },
        { pastDueSince: expect.any(Date) },
      );
      const saved = mockRepository.save.mock.calls[0][0];
      expect(saved.status).toBe('past_due');
      expect(saved.pastDueSince.getTime()).toBeGreaterThanOrEqual(before);

      expect(mockEmailService.sendPaymentFailed).toHaveBeenCalledTimes(1);
      const ctx = mockEmailService.sendPaymentFailed.mock.calls[0][0];
      expect(ctx).toMatchObject({
        userId,
        email: 'owner@example.com',
        username: 'owner',
        plan: 'starter',
      });
      expect(ctx.graceEndsAt.getTime() - saved.pastDueSince.getTime()).toBe(
        14 * 24 * 60 * 60 * 1000,
      );
    });

    it('does not move pastDueSince or email again on later failures', async () => {
      const first = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      mockRepository.findOne.mockResolvedValue({
        ...mockSubscription,
        status: 'past_due',
        pastDueSince: first,
      });

      await service.handleWebhookEvent(
        event('invoice.payment_failed', invoice()),
      );

      expect(mockRepository.update).not.toHaveBeenCalled();
      expect(mockRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'past_due', pastDueSince: first }),
      );
      expect(mockEmailService.sendPaymentFailed).not.toHaveBeenCalled();
    });

    it('sends one email when subscription.updated wins the race', async () => {
      // Both webhooks loaded the row before either stamped it; the
      // conditional update only succeeds for one of them.
      const stamped = new Date();
      mockRepository.findOne
        .mockResolvedValueOnce({ ...mockSubscription, pastDueSince: null })
        .mockResolvedValueOnce({ ...mockSubscription, pastDueSince: stamped });
      mockRepository.update.mockResolvedValueOnce({ affected: 0 });

      await service.handleWebhookEvent(
        event('invoice.payment_failed', invoice()),
      );

      expect(mockRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ pastDueSince: stamped }),
      );
      expect(mockEmailService.sendPaymentFailed).not.toHaveBeenCalled();
    });

    it('starts the grace period from subscription.updated too', async () => {
      mockRepository.findOne.mockResolvedValue({
        ...mockSubscription,
        pastDueSince: null,
      });

      await service.handleWebhookEvent(
        event('customer.subscription.updated', {
          id: 'sub_test123',
          status: 'past_due',
          cancel_at_period_end: false,
          cancel_at: null,
        }),
      );

      expect(mockRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'past_due',
          pastDueSince: expect.any(Date),
        }),
      );
      expect(mockEmailService.sendPaymentFailed).toHaveBeenCalledTimes(1);
    });

    it('emails the org owner for an org subscription', async () => {
      mockRepository.findOne.mockResolvedValue({
        ...mockSubscription,
        userId: null,
        organizationId: 'org-1',
        plan: 'team',
        pastDueSince: null,
      });
      mockOrgRepo.findOne.mockResolvedValue({
        id: 'org-1',
        name: 'Acme',
        ownerId: 'owner-1',
      });
      mockUserRepo.findOne.mockResolvedValue({
        id: 'owner-1',
        email: 'boss@example.com',
        username: 'boss',
      });

      await service.handleWebhookEvent(
        event('invoice.payment_failed', invoice()),
      );

      expect(mockUserRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'owner-1' } }),
      );
      expect(mockEmailService.sendPaymentFailed).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'owner-1',
          email: 'boss@example.com',
          plan: 'team',
          organizationName: 'Acme',
        }),
      );
    });

    it('reads the subscription from older invoice payloads', async () => {
      mockRepository.findOne.mockResolvedValue({
        ...mockSubscription,
        pastDueSince: null,
      });

      await service.handleWebhookEvent(
        event('invoice.payment_failed', {
          customer: 'cus_test123',
          subscription: 'sub_test123',
        }),
      );

      expect(mockRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'past_due' }),
      );
    });

    it('ignores failed one-off invoices', async () => {
      await service.handleWebhookEvent(
        event('invoice.payment_failed', { customer: 'cus_test123' }),
      );

      expect(mockRepository.findOne).not.toHaveBeenCalled();
      expect(mockRepository.save).not.toHaveBeenCalled();
      expect(mockEmailService.sendPaymentFailed).not.toHaveBeenCalled();
    });

    it('does not reopen the grace period for an unpaid subscription', async () => {
      mockRepository.findOne.mockResolvedValue({
        ...mockSubscription,
        status: 'unpaid',
        pastDueSince: null,
      });

      await service.handleWebhookEvent(
        event('invoice.payment_failed', invoice()),
      );

      expect(mockRepository.save).not.toHaveBeenCalled();
      expect(mockEmailService.sendPaymentFailed).not.toHaveBeenCalled();
    });

    it('keeps the webhook working when the email fails', async () => {
      mockRepository.findOne.mockResolvedValue({
        ...mockSubscription,
        pastDueSince: null,
      });
      mockEmailService.sendPaymentFailed.mockRejectedValueOnce(
        new Error('smtp down'),
      );

      await expect(
        service.handleWebhookEvent(event('invoice.payment_failed', invoice())),
      ).resolves.toBeUndefined();
    });

    it('clears the grace period when the invoice is paid', async () => {
      mockRepository.findOne.mockResolvedValue({
        ...mockSubscription,
        status: 'past_due',
        pastDueSince: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      });

      await service.handleWebhookEvent(event('invoice.paid', invoice()));

      expect(mockRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'active', pastDueSince: null }),
      );
    });

    it('leaves an active subscription alone on invoice.paid', async () => {
      mockRepository.findOne.mockResolvedValue({ ...mockSubscription });

      await service.handleWebhookEvent(event('invoice.paid', invoice()));

      expect(mockRepository.save).not.toHaveBeenCalled();
    });

    it('clears the grace period when the subscription is active again', async () => {
      mockRepository.findOne.mockResolvedValue({
        ...mockSubscription,
        status: 'past_due',
        pastDueSince: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      });

      await service.handleWebhookEvent(
        event('customer.subscription.updated', {
          id: 'sub_test123',
          status: 'active',
          cancel_at_period_end: false,
          cancel_at: null,
        }),
      );

      expect(mockRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'active', pastDueSince: null }),
      );
    });

    it('keeps pastDueSince when the subscription becomes unpaid', async () => {
      const first = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
      mockRepository.findOne.mockResolvedValue({
        ...mockSubscription,
        status: 'past_due',
        pastDueSince: first,
      });

      await service.handleWebhookEvent(
        event('customer.subscription.updated', {
          id: 'sub_test123',
          status: 'unpaid',
          cancel_at_period_end: false,
          cancel_at: null,
        }),
      );

      const saved = mockRepository.save.mock.calls[0][0];
      expect(saved).toMatchObject({ status: 'unpaid', pastDueSince: first });
      // The row the webhook saved now resolves to Free.
      mockRepository.findOne.mockResolvedValue(saved);
      expect(await service.resolveUserTier(userId)).toBe('free');
    });

    it('downgrades and clears the grace period when Stripe deletes the subscription', async () => {
      mockRepository.findOne.mockResolvedValue({
        ...mockSubscription,
        status: 'past_due',
        pastDueSince: new Date(),
      });

      await service.handleWebhookEvent(
        event('customer.subscription.deleted', { id: 'sub_test123' }),
      );

      expect(mockRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          plan: 'free',
          status: 'canceled',
          pastDueSince: null,
        }),
      );
    });
  });

  describe('previewUpgrade', () => {
    it('throws NotFoundException when no subscription exists', async () => {
      mockRepository.findOne.mockResolvedValue(null);
      await expect(service.previewUpgrade(userId, 'team')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws BadRequestException when subscription is not active', async () => {
      mockRepository.findOne.mockResolvedValue({
        ...mockSubscription,
        status: 'past_due',
      });
      await expect(service.previewUpgrade(userId, 'team')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when target plan is not higher', async () => {
      mockRepository.findOne.mockResolvedValue({
        ...mockSubscription,
        plan: 'team',
      });
      await expect(service.previewUpgrade(userId, 'starter')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException for same plan', async () => {
      mockRepository.findOne.mockResolvedValue(mockSubscription);
      await expect(service.previewUpgrade(userId, 'starter')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('returns preview for valid upgrade', async () => {
      mockRepository.findOne.mockResolvedValue(mockSubscription);
      mockStripe.prices.retrieve
        .mockResolvedValueOnce({ unit_amount: 2900, currency: 'usd' })
        .mockResolvedValueOnce({ unit_amount: 7900, currency: 'usd' });

      const result = await service.previewUpgrade(userId, 'team');
      expect(result).toEqual({
        immediateAmountCents: 5000,
        currency: 'usd',
        targetPlan: 'team',
        currentPeriodEnd: mockSubscription.currentPeriodEnd!.toISOString(),
      });
      expect(mockStripe.prices.retrieve).toHaveBeenCalledWith(
        'price_starter_123',
      );
      expect(mockStripe.prices.retrieve).toHaveBeenCalledWith('price_team_456');
    });
  });

  describe('upgradeSubscription', () => {
    it('throws NotFoundException when no subscription exists', async () => {
      mockRepository.findOne.mockResolvedValue(null);
      await expect(service.upgradeSubscription(userId, 'team')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws BadRequestException when target plan is not higher', async () => {
      mockRepository.findOne.mockResolvedValue(mockSubscription);
      await expect(
        service.upgradeSubscription(userId, 'starter'),
      ).rejects.toThrow(BadRequestException);
    });

    it('upgrades subscription with flat difference', async () => {
      mockRepository.findOne.mockResolvedValue({ ...mockSubscription });
      mockStripe.prices.retrieve
        .mockResolvedValueOnce({ unit_amount: 2900, currency: 'usd' })
        .mockResolvedValueOnce({ unit_amount: 7900, currency: 'usd' });
      mockStripe.subscriptions.retrieve.mockResolvedValue({
        items: { data: [{ id: 'si_item1' }] },
      });
      mockStripe.subscriptions.update.mockResolvedValue({});
      mockStripe.invoiceItems.create.mockResolvedValue({});
      mockStripe.invoices.create.mockResolvedValue({ id: 'inv_123' });
      mockStripe.invoices.pay.mockResolvedValue({});
      mockRepository.save.mockResolvedValue({
        ...mockSubscription,
        plan: 'team',
      });

      const result = await service.upgradeSubscription(userId, 'team');
      expect(result.plan).toBe('team');
      expect(mockStripe.subscriptions.update).toHaveBeenCalledWith(
        'sub_test123',
        {
          items: [{ id: 'si_item1', price: 'price_team_456' }],
          proration_behavior: 'none',
        },
      );
      expect(mockStripe.invoiceItems.create).toHaveBeenCalledWith({
        customer: 'cus_test123',
        amount: 5000,
        currency: 'usd',
        description: 'Plan upgrade: starter → team',
      });
      expect(mockStripe.invoices.create).toHaveBeenCalledWith({
        customer: 'cus_test123',
        auto_advance: true,
      });
      expect(mockStripe.invoices.pay).toHaveBeenCalledWith('inv_123');
      expect(mockRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ plan: 'team' }),
      );
    });
  });

  describe('queueDissolution', () => {
    const orgId = 'org-1';
    let queue: { add: jest.Mock; getJob: jest.Mock };

    beforeEach(() => {
      queue = (service as any).dissolutionQueue;
      queue.getJob = jest.fn();
    });

    it('should remove a failed job with the same id before re-queueing', async () => {
      const failed = {
        isFailed: jest.fn().mockResolvedValue(true),
        remove: jest.fn(),
        failedReason: 'boom',
      };
      queue.getJob.mockResolvedValue(failed);

      await service.queueDissolution(orgId, true);

      expect(queue.getJob).toHaveBeenCalledWith(`dissolve-${orgId}`);
      expect(failed.remove).toHaveBeenCalled();
      expect(queue.add).toHaveBeenCalledWith(
        'orgDissolution',
        { organizationId: orgId, cancelSubscription: true },
        expect.objectContaining({ jobId: `dissolve-${orgId}` }),
      );
    });

    it('should leave a job that has not failed in place', async () => {
      const pending = {
        isFailed: jest.fn().mockResolvedValue(false),
        remove: jest.fn(),
      };
      queue.getJob.mockResolvedValue(pending);

      await service.queueDissolution(orgId);

      expect(pending.remove).not.toHaveBeenCalled();
      expect(queue.add).toHaveBeenCalled();
    });
  });

  describe('dissolveOrganization', () => {
    const orgId = 'org-1';
    const ownerId = 'owner-1';
    let manager: Record<string, jest.Mock>;

    const orgSub = (): Partial<Subscription> => ({
      id: 'org-sub',
      userId: null,
      organizationId: orgId,
      stripeSubscriptionId: 'sub_org',
      plan: 'team',
      status: 'active',
    });

    function setup(personalSub: Partial<Subscription> | null) {
      const subs = { org: orgSub(), personal: personalSub };
      manager = {
        findOne: jest.fn((entity: unknown, opts: { where: any }) => {
          if (entity === Organization) {
            return Promise.resolve({ id: orgId, ownerId });
          }
          if (opts.where.organizationId) return Promise.resolve(subs.org);
          if (opts.where.userId === ownerId) {
            return Promise.resolve(subs.personal);
          }
          return Promise.resolve(null);
        }),
        find: jest.fn().mockResolvedValue([{ id: ownerId, role: 'owner' }]),
        save: jest.fn(),
        delete: jest.fn(),
        createQueryBuilder: jest.fn().mockReturnValue({
          update: jest.fn().mockReturnThis(),
          set: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          execute: jest.fn(),
        }),
      };
      const orgRepo = (service as any).orgRepository;
      orgRepo.manager.transaction.mockImplementation((cb: any) => cb(manager));
      return subs;
    }

    it('should convert the org subscription to the owner when they have none', async () => {
      setup(null);

      await service.dissolveOrganization(orgId);

      expect(manager.save).toHaveBeenCalledWith(
        Subscription,
        expect.objectContaining({
          id: 'org-sub',
          userId: ownerId,
          organizationId: null,
        }),
      );
      expect(manager.delete).toHaveBeenCalledWith(Organization, orgId);
    });

    it('should drop the canceled org subscription and keep the owner paid one', async () => {
      setup({
        id: 'personal-sub',
        userId: ownerId,
        stripeSubscriptionId: 'sub_personal',
        plan: 'starter',
        status: 'active',
      });

      await service.dissolveOrganization(orgId, true);

      expect(manager.delete).toHaveBeenCalledWith(Subscription, 'org-sub');
      expect(manager.delete).not.toHaveBeenCalledWith(
        Subscription,
        'personal-sub',
      );
      expect(manager.save).not.toHaveBeenCalledWith(
        Subscription,
        expect.anything(),
      );
      expect(manager.delete).toHaveBeenCalledWith(Organization, orgId);
    });

    it('should replace an inactive owner subscription with the org one', async () => {
      setup({
        id: 'personal-sub',
        userId: ownerId,
        stripeSubscriptionId: null,
        plan: 'free',
        status: 'active',
      });

      await service.dissolveOrganization(orgId);

      const deleteOrder = manager.delete.mock.invocationCallOrder[0];
      const saveOrder = manager.save.mock.invocationCallOrder[0];
      expect(manager.delete).toHaveBeenCalledWith(Subscription, 'personal-sub');
      expect(deleteOrder).toBeLessThan(saveOrder);
      expect(manager.save).toHaveBeenCalledWith(
        Subscription,
        expect.objectContaining({ id: 'org-sub', userId: ownerId }),
      );
    });

    it('should treat a canceled Stripe subscription as inactive', async () => {
      setup({
        id: 'personal-sub',
        userId: ownerId,
        stripeSubscriptionId: 'sub_old',
        plan: 'starter',
        status: 'canceled',
      });

      await service.dissolveOrganization(orgId);

      expect(manager.delete).toHaveBeenCalledWith(Subscription, 'personal-sub');
      expect(manager.save).toHaveBeenCalledWith(
        Subscription,
        expect.objectContaining({ id: 'org-sub', userId: ownerId }),
      );
    });

    it('should fail without retry when both subscriptions are still billing', async () => {
      setup({
        id: 'personal-sub',
        userId: ownerId,
        stripeSubscriptionId: 'sub_personal',
        plan: 'starter',
        status: 'past_due',
      });

      await expect(service.dissolveOrganization(orgId)).rejects.toBeInstanceOf(
        UnrecoverableError,
      );
      expect(manager.delete).not.toHaveBeenCalledWith(
        Subscription,
        expect.anything(),
      );
      expect(manager.delete).not.toHaveBeenCalledWith(Organization, orgId);
    });
  });

  describe('Microsoft Marketplace subscriptions (one live subscription across sources)', () => {
    const marketplaceSub = (status: string): Partial<Subscription> => ({
      ...mockSubscription,
      source: 'marketplace',
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      marketplaceSubscriptionId: 'mp-sub-1',
      marketplaceStatus: status === 'active' ? 'Subscribed' : 'Suspended',
      plan: 'team',
      status,
    });

    it.each(['active', 'past_due'])(
      'refuses a Stripe checkout with 409 while a Marketplace subscription is %s',
      async (status) => {
        mockRepository.findOne.mockResolvedValue(marketplaceSub(status));

        const err = await service
          .createCheckoutSession(userId, 'test@example.com', 'team')
          .catch((e: unknown) => e);

        expect(err).toBeInstanceOf(ConflictException);
        expect((err as ConflictException).message).toMatch(/Microsoft/);
        expect(mockStripe.checkout.sessions.create).not.toHaveBeenCalled();
        expect(mockStripe.customers.create).not.toHaveBeenCalled();
      },
    );

    it('allows a Stripe checkout after the Marketplace subscription ended, creating the Stripe customer', async () => {
      const ended = { ...marketplaceSub('canceled'), plan: 'free' };
      mockRepository.findOne.mockResolvedValue(ended);
      mockStripe.customers.create.mockResolvedValue({ id: 'cus_new' });
      mockRepository.save.mockImplementation((d: any) => Promise.resolve(d));
      mockStripe.checkout.sessions.create.mockResolvedValue({
        url: 'https://checkout.stripe.com/session123',
      });

      await expect(
        service.createCheckoutSession(userId, 'test@example.com', 'starter'),
      ).resolves.toBe('https://checkout.stripe.com/session123');
      // Only the customer column is written, so a Marketplace activation
      // that changed the row meanwhile isn't undone.
      expect(mockRepository.update).toHaveBeenCalledWith(
        { id: ended.id, stripeCustomerId: expect.anything() },
        { stripeCustomerId: 'cus_new' },
      );
      expect(mockRepository.save).not.toHaveBeenCalled();
      expect(mockStripe.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({ customer: 'cus_new' }),
        expect.anything(),
      );
    });

    it('refuses a Stripe checkout with 409 while a Marketplace purchase is being activated', async () => {
      mockRepository.findOne.mockResolvedValue({
        ...marketplaceSub('incomplete'),
        plan: 'free',
        marketplaceStatus: 'PendingFulfillmentStart',
        updatedAt: new Date(),
      });
      await expect(
        service.createCheckoutSession(userId, 'test@example.com', 'starter'),
      ).rejects.toThrow(/being activated/);
      expect(mockStripe.customers.create).not.toHaveBeenCalled();
    });

    it('allows a Stripe checkout over a Marketplace claim that was abandoned', async () => {
      mockRepository.findOne.mockResolvedValue({
        ...marketplaceSub('incomplete'),
        plan: 'free',
        stripeCustomerId: 'cus_1',
        marketplaceStatus: 'PendingFulfillmentStart',
        updatedAt: new Date(Date.now() - 60 * 60 * 1000),
      });
      mockStripe.checkout.sessions.create.mockResolvedValue({
        url: 'https://checkout.stripe.com/session123',
      });
      await expect(
        service.createCheckoutSession(userId, 'test@example.com', 'starter'),
      ).resolves.toBe('https://checkout.stripe.com/session123');
    });

    it('refuses the Stripe portal with 409', async () => {
      mockRepository.findOne.mockResolvedValue(marketplaceSub('active'));
      await expect(service.createPortalSession(userId)).rejects.toThrow(
        ConflictException,
      );
      expect(mockStripe.billingPortal.sessions.create).not.toHaveBeenCalled();
    });

    it('refuses a Stripe upgrade with 409', async () => {
      mockRepository.findOne.mockResolvedValue({
        ...marketplaceSub('active'),
        plan: 'starter',
      });
      await expect(service.previewUpgrade(userId, 'team')).rejects.toThrow(
        ConflictException,
      );
      await expect(service.upgradeSubscription(userId, 'team')).rejects.toThrow(
        ConflictException,
      );
      expect(mockStripe.subscriptions.update).not.toHaveBeenCalled();
    });

    it('cancels a Stripe checkout that completes after Microsoft started billing', async () => {
      mockRepository.findOne.mockResolvedValue(marketplaceSub('active'));
      mockStripe.subscriptions.retrieve.mockResolvedValue({
        id: 'sub_new',
        status: 'active',
      });
      jest
        .spyOn((service as any).logger, 'error')
        .mockImplementation(() => undefined);

      await service.handleWebhookEvent({
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_late',
            metadata: { userId, plan: 'starter' },
            subscription: 'sub_new',
            customer: 'cus_test123',
          },
        },
      } as any);

      expect(mockStripe.subscriptions.cancel).toHaveBeenCalledWith('sub_new');
      expect(mockRepository.save).not.toHaveBeenCalled();
    });

    it('cancels the Stripe subscription when Microsoft started billing while checkout completed', async () => {
      mockRepository.findOne
        .mockResolvedValueOnce({
          ...mockSubscription,
          stripeSubscriptionId: null,
          plan: 'free',
        })
        .mockResolvedValueOnce(marketplaceSub('active'));
      mockStripe.subscriptions.retrieve.mockResolvedValue({
        id: 'sub_new',
        status: 'active',
        current_period_end: Math.floor(Date.now() / 1000) + 86400 * 30,
        cancel_at_period_end: false,
        cancel_at: null,
      });
      jest
        .spyOn((service as any).logger, 'error')
        .mockImplementation(() => undefined);

      await service.handleWebhookEvent({
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_race',
            metadata: { userId, plan: 'starter' },
            subscription: 'sub_new',
            customer: 'cus_test123',
          },
        },
      } as any);

      expect(mockStripe.subscriptions.cancel).toHaveBeenCalledWith('sub_new');
      expect(mockRepository.save).not.toHaveBeenCalled();
    });

    it('clears the Marketplace fields when a Stripe checkout replaces an ended one', async () => {
      mockRepository.findOne.mockResolvedValue({
        ...marketplaceSub('canceled'),
        plan: 'free',
      });
      mockStripe.subscriptions.retrieve.mockResolvedValue({
        id: 'sub_new',
        status: 'active',
        current_period_end: Math.floor(Date.now() / 1000) + 86400 * 30,
        cancel_at_period_end: false,
        cancel_at: null,
      });

      await service.handleWebhookEvent({
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_new',
            metadata: { userId, plan: 'starter' },
            subscription: 'sub_new',
            customer: 'cus_test123',
          },
        },
      } as any);

      expect(mockRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'stripe',
          stripeSubscriptionId: 'sub_new',
          marketplaceSubscriptionId: null,
          marketplaceStatus: null,
          plan: 'starter',
        }),
      );
    });
  });
});
