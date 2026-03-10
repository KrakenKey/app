import type { SubscriptionPlan } from './subscription';

export interface ApiErrorResponse {
  statusCode: number;
  message: string | string[];
  error: string;
  timestamp: string;
  path: string;
}

export interface PlanLimitExceededResponse {
  message: string;
  limit: number;
  current: number;
  plan: SubscriptionPlan;
}
