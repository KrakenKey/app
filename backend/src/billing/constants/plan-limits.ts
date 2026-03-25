import type { SubscriptionPlan } from '@krakenkey/shared';

export interface PlanLimits {
  domains: number;
  apiKeys: number;
  certsPerMonth: number;
  totalActiveCerts: number;
  concurrentPending: number;
  renewalWindowDays: number;
  monitoredEndpoints: number;
  minScanInterval: number; // minutes
  hostedProbeRegions: number;
  hostedMonitoredEndpoints: number;
  hostedScanInterval: number; // minutes, 0 = unavailable
  scanResultRetentionDays: number;
}

export const PLAN_LIMITS: Record<SubscriptionPlan, PlanLimits> = {
  free: {
    domains: 3,
    apiKeys: 2,
    certsPerMonth: 5,
    totalActiveCerts: 10,
    concurrentPending: 2,
    renewalWindowDays: 5,
    monitoredEndpoints: 3,
    minScanInterval: 60,
    hostedProbeRegions: 0,
    hostedMonitoredEndpoints: 0,
    hostedScanInterval: 0,
    scanResultRetentionDays: 5,
  },
  starter: {
    domains: 10,
    apiKeys: 5,
    certsPerMonth: 50,
    totalActiveCerts: 75,
    concurrentPending: 5,
    renewalWindowDays: 30,
    monitoredEndpoints: 10,
    minScanInterval: 30,
    hostedProbeRegions: 0,
    hostedMonitoredEndpoints: 0,
    hostedScanInterval: 0,
    scanResultRetentionDays: 30,
  },
  team: {
    domains: 25,
    apiKeys: 10,
    certsPerMonth: 250,
    totalActiveCerts: 375,
    concurrentPending: 25,
    renewalWindowDays: 30,
    monitoredEndpoints: 50,
    minScanInterval: 5,
    hostedProbeRegions: 5,
    hostedMonitoredEndpoints: 25,
    hostedScanInterval: 15,
    scanResultRetentionDays: 90,
  },
  business: {
    domains: 75,
    apiKeys: 25,
    certsPerMonth: 1000,
    totalActiveCerts: 1500,
    concurrentPending: 100,
    renewalWindowDays: 30,
    monitoredEndpoints: 200,
    minScanInterval: 1,
    hostedProbeRegions: 15,
    hostedMonitoredEndpoints: 100,
    hostedScanInterval: 5,
    scanResultRetentionDays: 90,
  },
  enterprise: {
    domains: Infinity,
    apiKeys: Infinity,
    certsPerMonth: Infinity,
    totalActiveCerts: Infinity,
    concurrentPending: Infinity,
    renewalWindowDays: 30,
    monitoredEndpoints: Infinity,
    minScanInterval: 1,
    hostedProbeRegions: Infinity,
    hostedMonitoredEndpoints: Infinity,
    hostedScanInterval: 1,
    scanResultRetentionDays: 90,
  },
} as const;
