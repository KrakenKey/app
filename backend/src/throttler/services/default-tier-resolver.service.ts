import { Injectable } from '@nestjs/common';
import { TierResolver } from '../interfaces/tier-resolver.interface';
import { DEFAULT_TIER } from '../config/rate-limit-tiers.config';

/**
 * Default tier resolver — returns 'free' for all users.
 *
 * When a subscription system is implemented, replace this provider
 * via the TIER_RESOLVER token in throttler.module.ts.
 */
@Injectable()
export class DefaultTierResolver implements TierResolver {
  async resolve(_userId: string): Promise<string> {
    return DEFAULT_TIER;
  }
}
