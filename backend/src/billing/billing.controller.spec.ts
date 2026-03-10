import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';

describe('BillingController', () => {
  let controller: BillingController;
  let mockBillingService: Record<string, jest.Mock>;

  const userId = 'user-123';
  const mockReq = {
    user: { userId, email: 'test@example.com' },
  } as any;

  beforeEach(async () => {
    mockBillingService = {
      createCheckoutSession: jest.fn(),
      getSubscription: jest.fn(),
      createPortalSession: jest.fn(),
      constructWebhookEvent: jest.fn(),
      handleWebhookEvent: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BillingController],
      providers: [
        {
          provide: BillingService,
          useValue: mockBillingService,
        },
      ],
    }).compile();

    controller = module.get<BillingController>(BillingController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('checkout', () => {
    it('returns sessionUrl from service', async () => {
      mockBillingService.createCheckoutSession.mockResolvedValue(
        'https://checkout.stripe.com/session',
      );

      const result = await controller.checkout(mockReq, { plan: 'starter' });
      expect(result).toEqual({
        sessionUrl: 'https://checkout.stripe.com/session',
      });
      expect(mockBillingService.createCheckoutSession).toHaveBeenCalledWith(
        userId,
        'test@example.com',
        'starter',
      );
    });
  });

  describe('getSubscription', () => {
    it('returns subscription when found', async () => {
      const sub = {
        id: 'sub-1',
        plan: 'starter',
        status: 'active',
        currentPeriodEnd: new Date(),
        cancelAtPeriodEnd: false,
        createdAt: new Date(),
      };
      mockBillingService.getSubscription.mockResolvedValue(sub);

      const result = await controller.getSubscription(mockReq);
      expect(result.plan).toBe('starter');
    });

    it('returns free default when no subscription', async () => {
      mockBillingService.getSubscription.mockResolvedValue(null);

      const result = await controller.getSubscription(mockReq);
      expect(result).toEqual({
        plan: 'free',
        status: 'active',
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
      });
    });
  });

  describe('createPortal', () => {
    it('returns portalUrl from service', async () => {
      mockBillingService.createPortalSession.mockResolvedValue(
        'https://billing.stripe.com/portal',
      );

      const result = await controller.createPortal(mockReq);
      expect(result).toEqual({
        portalUrl: 'https://billing.stripe.com/portal',
      });
    });
  });

  describe('webhook', () => {
    it('throws on missing signature', async () => {
      const req = { rawBody: Buffer.from('{}') } as any;
      await expect(controller.webhook(req, '')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws on missing raw body', async () => {
      const req = { rawBody: undefined } as any;
      await expect(controller.webhook(req, 'sig_test')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('processes valid webhook event', async () => {
      const event = { type: 'checkout.session.completed', data: {} };
      mockBillingService.constructWebhookEvent.mockReturnValue(event);
      mockBillingService.handleWebhookEvent.mockResolvedValue(undefined);

      const req = { rawBody: Buffer.from('{}') } as any;
      const result = await controller.webhook(req, 'sig_valid');

      expect(result).toEqual({ received: true });
      expect(mockBillingService.constructWebhookEvent).toHaveBeenCalledWith(
        req.rawBody,
        'sig_valid',
      );
      expect(mockBillingService.handleWebhookEvent).toHaveBeenCalledWith(event);
    });

    it('throws on invalid signature', async () => {
      mockBillingService.constructWebhookEvent.mockImplementation(() => {
        throw new Error('Invalid signature');
      });

      const req = { rawBody: Buffer.from('{}') } as any;
      await expect(controller.webhook(req, 'sig_bad')).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
