import { REPORT_HOST_LIMITS } from '../types/report';
import type { SubscriptionPlan } from '../types/subscription';

/**
 * What each plan allows. The API enforces these, and the dashboard reads the
 * same numbers to show usage on the billing page. `Infinity` means unlimited.
 * Resource counts are pooled across an organization's members.
 */
export interface PlanLimits {
  domains: number;
  apiKeys: number;
  certsPerMonth: number;
  totalActiveCerts: number;
  concurrentPending: number;
  renewalWindowDays: number;
  monitoredEndpoints: number;
  minScanInterval: number; // minutes
  /** Distinct hosted regions in use; Infinity means every region that runs. */
  hostedProbeRegions: number;
  hostedMonitoredEndpoints: number;
  hostedScanInterval: number; // minutes
  scanResultRetentionDays: number;
  /** Most hosts in one portfolio report (shared REPORT_HOST_LIMITS) */
  reportHosts: number;
}

export const PLAN_LIMITS: Record<SubscriptionPlan, PlanLimits> = {
  // Shown as "Starter" (PLAN_LABELS)
  free: {
    domains: 3,
    apiKeys: 2,
    certsPerMonth: 5,
    totalActiveCerts: 10,
    concurrentPending: 2,
    renewalWindowDays: 10,
    monitoredEndpoints: 3,
    minScanInterval: 60,
    hostedProbeRegions: 1,
    hostedMonitoredEndpoints: 1,
    hostedScanInterval: 60,
    scanResultRetentionDays: 7,
    reportHosts: REPORT_HOST_LIMITS.free,
  },
  pro: {
    domains: 15,
    apiKeys: 10,
    certsPerMonth: 100,
    totalActiveCerts: 150,
    concurrentPending: 10,
    renewalWindowDays: 30,
    monitoredEndpoints: 50,
    minScanInterval: 15,
    hostedProbeRegions: Infinity,
    hostedMonitoredEndpoints: 25,
    hostedScanInterval: 30,
    scanResultRetentionDays: 30,
    reportHosts: REPORT_HOST_LIMITS.pro,
  },
  business: {
    domains: 100,
    apiKeys: 50,
    certsPerMonth: 1000,
    totalActiveCerts: 1000,
    concurrentPending: 50,
    renewalWindowDays: 30,
    monitoredEndpoints: 300,
    minScanInterval: 1,
    hostedProbeRegions: Infinity,
    hostedMonitoredEndpoints: 150,
    hostedScanInterval: 5,
    scanResultRetentionDays: 90,
    reportHosts: REPORT_HOST_LIMITS.business,
  },
  // Custom deals: limits are set per agreement; until per-account limits
  // exist, the plan is unlimited under fair-use terms.
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
    reportHosts: REPORT_HOST_LIMITS.enterprise,
  },
} as const;
