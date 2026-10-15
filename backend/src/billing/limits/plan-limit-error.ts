import { HttpException } from '@nestjs/common';
import {
  PLAN_LIMITS,
  nextPlan,
  normalizePlan,
  planLabel,
  type PlanLimits,
  type SubscriptionPlan,
} from '@krakenkey/shared';

/** Plan limits that count resources an account creates. */
export type CountedLimit = Extract<
  keyof PlanLimits,
  'connectors' | 'alertChannels' | 'githubOidcTrusts' | 'orgMembers'
>;

const NOUNS: Record<CountedLimit, string> = {
  connectors: 'Connector',
  alertChannels: 'Alert channel',
  githubOidcTrusts: 'GitHub trust policy',
  orgMembers: 'Organization member',
};

function formatCount(n: number): string {
  return n.toLocaleString('en-US');
}

/**
 * What to tell the user about a limit: what the plan includes and which
 * plan raises it, e.g. "Connector limit reached: the Starter plan includes
 * 1. Upgrade to Pro for 5."
 */
export function planLimitMessage(limit: CountedLimit, plan: string): string {
  const current = normalizePlan(plan);
  const included = PLAN_LIMITS[current][limit];
  const next = nextPlan(current);
  let message = `${NOUNS[limit]} limit reached: the ${planLabel(current)} plan includes ${formatCount(included)}.`;
  if (next === 'enterprise') {
    message += ' Contact us about Enterprise for a higher limit.';
  } else if (next) {
    const more = PLAN_LIMITS[next][limit];
    message += Number.isFinite(more)
      ? ` Upgrade to ${planLabel(next)} for ${formatCount(more)}.`
      : ` Upgrade to ${planLabel(next)} to remove the limit.`;
  }
  return message;
}

/**
 * 402 for a plan limit, in the shape the other limits use, plus `upgradeTo`
 * (the next plan up). The global exception filter passes these fields on.
 */
export function planLimitExceeded(
  limit: CountedLimit,
  plan: SubscriptionPlan,
  current: number,
): HttpException {
  return new HttpException(
    {
      message: planLimitMessage(limit, plan),
      code: 'plan_limit_exceeded',
      limit: PLAN_LIMITS[plan][limit],
      current,
      plan,
      upgradeTo: nextPlan(plan),
    },
    402,
  );
}
