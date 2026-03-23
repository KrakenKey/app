import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BillingService } from './billing.service';
import { Subscription } from './entities/subscription.entity';
import { User } from '../users/entities/user.entity';
import { Organization } from '../organizations/entities/organization.entity';

// Mock Stripe
const mockStripe = {
  customers: { create: jest.fn() },
  checkout: { sessions: { create: jest.fn() } },
  billingPortal: { sessions: { create: jest.fn() } },
  subscriptions: { retrieve: jest.fn(), update: jest.fn() },
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
    };

    const mockUserRepo = {
      findOne: jest
        .fn()
        .mockResolvedValue({ id: userId, organizationId: null }),
    };
    const mockOrgRepo = {
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

    it('creates checkout session for valid plan', async () => {
      mockRepository.findOne.mockResolvedValue(mockSubscription);
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
      );
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
      // findOne returns existing sub for find-then-save pattern
      mockRepository.findOne.mockResolvedValue({ ...mockSubscription });
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

    it('handles invoice.payment_failed', async () => {
      mockRepository.findOne.mockResolvedValue({ ...mockSubscription });

      await service.handleWebhookEvent({
        type: 'invoice.payment_failed',
        data: {
          object: { customer: 'cus_test123' },
        },
      } as any);

      expect(mockRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'past_due',
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
});
