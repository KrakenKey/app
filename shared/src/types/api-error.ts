import type { SubscriptionPlan } from './subscription';

export interface ApiErrorResponse {
  statusCode: number;
  message: string | string[];
  error: string;
  timestamp: string;
  path: string;
  /** `plan_limit_exceeded` when a plan limit refused the request. */
  code?: string;
  /** For plan limit errors: the limit, current usage and plan. */
  limit?: number;
  current?: number;
  plan?: SubscriptionPlan;
  /** For plan limit errors: the next plan up, or null on the largest. */
  upgradeTo?: SubscriptionPlan | null;
}

export interface PlanLimitExceededResponse {
  message: string;
  code: 'plan_limit_exceeded';
  limit: number;
  current: number;
  plan: SubscriptionPlan;
  upgradeTo?: SubscriptionPlan | null;
}
