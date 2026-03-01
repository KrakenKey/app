export interface TierResolver {
  resolve(userId: string): Promise<string>;
}

export const TIER_RESOLVER = Symbol('TIER_RESOLVER');
