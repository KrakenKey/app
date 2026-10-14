import {
  CONNECTOR_MIN_RENEWAL_WINDOW_DAYS,
  CertStatus,
} from '@krakenkey/shared';
import type { CertManagedBy, SubscriptionPlan } from '@krakenkey/shared';
import { PLAN_LIMITS } from '../../../billing/constants/plan-limits';

const MS_PER_DAY = 86_400_000;

/**
 * After a renewal fails while the current certificate is still valid
 * (renewalFailedAt), automatic renewal waits this long before trying
 * again: the daily expiry check retries about once a day, and the hourly
 * ARI check, a connector or a `renew?ifDue=true` timer don't send a
 * failing order every hour. A little under a day, so a failure recorded
 * shortly after the 6 AM check doesn't push the retry to the day after.
 * A renewal requested without ifDue (or a retry) is never held back.
 */
export const RENEWAL_RETRY_BACKOFF_MS = 20 * 60 * 60 * 1000;

/**
 * When automatic renewal may try again after a failed renewal, or null when
 * the last renewal didn't fail.
 */
export function renewalRetryAt(cert: {
  renewalFailedAt?: Date | string | null;
}): Date | null {
  if (!cert.renewalFailedAt) return null;
  return new Date(
    new Date(cert.renewalFailedAt).getTime() + RENEWAL_RETRY_BACKOFF_MS,
  );
}

/** Whole days until `expiresAt`, rounded down (negative once expired). */
export function daysUntilExpiry(expiresAt: Date, now = Date.now()): number {
  return Math.floor((expiresAt.getTime() - now) / MS_PER_DAY);
}

/** Renewal window for a plan in days. Unknown plans fall back to free. */
export function renewalWindowDays(plan: string): number {
  return (PLAN_LIMITS[plan as SubscriptionPlan] ?? PLAN_LIMITS.free)
    .renewalWindowDays;
}

/**
 * Renewal window for one certificate: the plan's window, but at least
 * CONNECTOR_MIN_RENEWAL_WINDOW_DAYS for certificates a connector renews.
 */
export function certRenewalWindowDays(
  plan: string,
  managedBy: CertManagedBy | null | undefined,
): number {
  const planDays = renewalWindowDays(plan);
  return managedBy === 'connector'
    ? Math.max(planDays, CONNECTOR_MIN_RENEWAL_WINDOW_DAYS)
    : planDays;
}

/** The fields renewAfter reads. */
export interface RenewAfterInput {
  status?: CertStatus | null;
  expiresAt: Date | string | null;
  ariWindowStart?: Date | string | null;
  ariReplacementRequestedAt?: Date | string | null;
  managedBy?: CertManagedBy | null;
  createdAt?: Date | string | null;
  renewalFailedAt?: Date | string | null;
}

/**
 * When a certificate will be renewed: expiry minus the renewal window
 * (`windowDays`, see certRenewalWindowDays), or the start of the CA's
 * suggested ARI window when that is earlier and applies:
 *
 * - connector-managed: any stored window, routine or early, since the
 *   connector follows the CA's suggestion (RFC 9773);
 * - everything else: only when the CA asked for early replacement
 *   (ariReplacementRequestedAt), the one case the server renews early.
 *
 * After a failed renewal it is never earlier than renewalRetryAt, when
 * automatic renewal tries again.
 *
 * An awaiting_csr certificate has never been issued, so it is due from the
 * moment it was created. Otherwise null when there is no expiry yet, or the
 * certificate is revoked.
 */
export function renewAfter(
  cert: RenewAfterInput,
  windowDays: number,
): Date | null {
  if (cert.status === CertStatus.AWAITING_CSR) {
    return cert.createdAt ? new Date(cert.createdAt) : null;
  }
  if (!cert.expiresAt) return null;
  if (
    cert.status === CertStatus.REVOKED ||
    cert.status === CertStatus.REVOKING
  ) {
    return null;
  }
  const byWindow = new Date(cert.expiresAt).getTime() - windowDays * MS_PER_DAY;
  const ariApplies =
    cert.managedBy === 'connector' || Boolean(cert.ariReplacementRequestedAt);
  const ariStart =
    ariApplies && cert.ariWindowStart
      ? new Date(cert.ariWindowStart).getTime()
      : NaN;
  const due = Number.isNaN(ariStart) ? byWindow : Math.min(byWindow, ariStart);
  const retryAt = renewalRetryAt(cert)?.getTime() ?? NaN;
  return new Date(Number.isNaN(retryAt) ? due : Math.max(due, retryAt));
}
