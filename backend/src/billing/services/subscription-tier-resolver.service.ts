import { Injectable, Logger } from '@nestjs/common';
import { TierResolver } from '../../throttler/interfaces/tier-resolver.interface';
import { BillingService } from '../billing.service';

@Injectable()
export class SubscriptionTierResolver implements TierResolver {
  private readonly logger = new Logger(SubscriptionTierResolver.name);

  constructor(private readonly billingService: BillingService) {}

  async resolve(userId: string): Promise<string> {
    try {
      return await this.billingService.resolveUserTier(userId);
    } catch (error) {
      this.logger.warn(
        `Failed to resolve tier for user ${userId}: ${error.message}`,
      );
      return 'free';
    }
  }
}
