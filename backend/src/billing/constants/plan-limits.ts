import type { SubscriptionPlan } from '@krakenkey/shared';

export interface PlanLimits {
  domains: number;
  apiKeys: number;
  certsPerMonth: number;
  totalActiveCerts: number;
  concurrentPending: number;
  renewalWindowDays: number;
}

export const PLAN_LIMITS: Record<SubscriptionPlan, PlanLimits> = {
  free: {
    domains: 3,
    apiKeys: 2,
    certsPerMonth: 5,
    totalActiveCerts: 10,
    concurrentPending: 2,
    renewalWindowDays: 5,
  },
  starter: {
    domains: 10,
    apiKeys: 5,
    certsPerMonth: 50,
    totalActiveCerts: 75,
    concurrentPending: 5,
    renewalWindowDays: 30,
  },
  team: {
    domains: 25,
    apiKeys: 10,
    certsPerMonth: 250,
    totalActiveCerts: 375,
    concurrentPending: 25,
    renewalWindowDays: 30,
  },
  business: {
    domains: 75,
    apiKeys: 25,
    certsPerMonth: 1000,
    totalActiveCerts: 1500,
    concurrentPending: 100,
    renewalWindowDays: 30,
  },
  enterprise: {
    domains: Infinity,
    apiKeys: Infinity,
    certsPerMonth: Infinity,
    totalActiveCerts: Infinity,
    concurrentPending: Infinity,
    renewalWindowDays: 30,
  },
} as const;
