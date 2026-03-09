import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionTierResolver } from './subscription-tier-resolver.service';
import { BillingService } from '../billing.service';

describe('SubscriptionTierResolver', () => {
  let resolver: SubscriptionTierResolver;
  let mockBillingService: Record<string, jest.Mock>;

  beforeEach(async () => {
    mockBillingService = {
      resolveUserTier: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionTierResolver,
        {
          provide: BillingService,
          useValue: mockBillingService,
        },
      ],
    }).compile();

    resolver = module.get<SubscriptionTierResolver>(SubscriptionTierResolver);
  });

  it('should be defined', () => {
    expect(resolver).toBeDefined();
  });

  it('returns plan from billing service', async () => {
    mockBillingService.resolveUserTier.mockResolvedValue('starter');
    const tier = await resolver.resolve('user-123');
    expect(tier).toBe('starter');
  });

  it('returns free when billing service returns free', async () => {
    mockBillingService.resolveUserTier.mockResolvedValue('free');
    const tier = await resolver.resolve('user-123');
    expect(tier).toBe('free');
  });

  it('gracefully degrades to free on error', async () => {
    mockBillingService.resolveUserTier.mockRejectedValue(
      new Error('DB connection failed'),
    );
    const tier = await resolver.resolve('user-123');
    expect(tier).toBe('free');
  });
});
