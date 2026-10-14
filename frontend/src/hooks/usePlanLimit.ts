import { useAuth } from './useAuth';
import {
  formatLimit,
  planLimits,
  upgradeHint,
  type CountedLimitKey,
} from '../utils/planUsage';

type PooledKey = 'connectors' | 'alertChannels' | 'githubOidcTrusts';

export interface PlanLimitState {
  /** Infinity on unlimited plans. */
  limit: number;
  /** "5" or "Unlimited". */
  limitText: string;
  used: number;
  atLimit: boolean;
  /** Which plan raises the limit, or null. */
  hint: string | null;
}

/**
 * The plan limit for a resource the account creates. Outside an
 * organization the list on the page is the count; inside one the API counts
 * across every member, so the profile's pooled count is used when it has one.
 */
export function usePlanLimit(
  key: PooledKey,
  listCount: number,
): PlanLimitState {
  const { user } = useAuth();
  const plan = (user as { plan?: string } | null)?.plan;
  const limit = planLimits(plan)[key];
  const pooled = (
    user as { resourceCounts?: Partial<Record<CountedLimitKey, number>> } | null
  )?.resourceCounts?.[key];
  const used =
    user?.organizationId && typeof pooled === 'number'
      ? Math.max(pooled, listCount)
      : listCount;
  return {
    limit,
    limitText: formatLimit(limit),
    used,
    atLimit: used >= limit,
    hint: upgradeHint(plan, key),
  };
}
