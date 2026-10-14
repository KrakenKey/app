import { Transform } from 'class-transformer';
import { LEGACY_PLAN_ALIASES } from '@krakenkey/shared';

/** Plans a checkout or upgrade can ask for. */
export const PAID_PLANS = ['pro', 'business', 'enterprise'] as const;
export type PaidPlan = (typeof PAID_PLANS)[number];

/**
 * Reads a legacy plan id (starter, team) from a dashboard that was loaded
 * before the plans were renamed as the plan that replaced it.
 */
export function AcceptLegacyPlanId(): PropertyDecorator {
  return Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? (LEGACY_PLAN_ALIASES[value] ?? value) : value,
  );
}
