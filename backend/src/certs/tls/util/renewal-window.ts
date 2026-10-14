import {
  CONNECTOR_MIN_RENEWAL_WINDOW_DAYS,
  CertStatus,
} from '@krakenkey/shared';
import type { CertManagedBy, SubscriptionPlan } from '@krakenkey/shared';
import { PLAN_LIMITS } from '../../../billing/constants/plan-limits';

const MS_PER_DAY = 86_400_000;

/**
 * How long automatic renewal waits after a renewal fails while the current
 * certificate is still valid (renewalFailedAt): a quarter of the time left
 * until the deadline, but never more than RENEWAL_RETRY_BACKOFF_MS and
 * never less than RENEWAL_RETRY_MIN_BACKOFF_MS. The deadline is the
 * certificate's expiry, or the end of the CA's window when the CA asked
 * for early replacement (ARI) and that comes first.
 *
 * So a failing renewal with weeks left is tried about once a day (not on
 * every hourly check, connector pass or `renew?ifDue=true` timer), and one
 * close to its deadline is tried more often: with a day left, every 6
 * hours; with 8 hours or less left, every 2 hours. A renewal requested
 * without ifDue, or a retry, is never held back.
 */
export const RENEWAL_RETRY_BACKOFF_MS = 20 * 60 * 60 * 1000;
export const RENEWAL_RETRY_MIN_BACKOFF_MS = 2 * 60 * 60 * 1000;

/** The fields renewalRetryAt and hasRenewalFailure read. */
export interface RenewalFailureInput {
  renewalFailedAt?: Date | string | null;
  lastRenewedAt?: Date | string | null;
  expiresAt?: Date | string | null;
  ariReplacementRequestedAt?: Date | string | null;
  ariWindowEnd?: Date | string | null;
}

const ms = (d: Date | string | null | undefined) =>
  d ? new Date(d).getTime() : NaN;

/**
 * Whether the certificate's last renewal failed. A renewalFailedAt older
 * than lastRenewedAt is left over from a renewal that a previous release
 * finished without clearing it (during a deploy), so it doesn't count.
 */
export function hasRenewalFailure(cert: RenewalFailureInput): boolean {
  const failedAt = ms(cert.renewalFailedAt);
  if (Number.isNaN(failedAt)) return false;
  const renewedAt = ms(cert.lastRenewedAt);
  return Number.isNaN(renewedAt) || failedAt > renewedAt;
}

/**
 * When automatic renewal may try again after a failed renewal, or null when
 * the last renewal didn't fail. See RENEWAL_RETRY_BACKOFF_MS for the rule.
 */
export function renewalRetryAt(cert: RenewalFailureInput): Date | null {
  if (!hasRenewalFailure(cert)) return null;
  const failedAt = ms(cert.renewalFailedAt);
  const deadlines = [ms(cert.expiresAt)];
  if (cert.ariReplacementRequestedAt) deadlines.push(ms(cert.ariWindowEnd));
  const deadline = Math.min(
    ...deadlines.filter((d) => !Number.isNaN(d)),
    Infinity,
  );
  const delay = Math.min(
    RENEWAL_RETRY_BACKOFF_MS,
    Math.max(RENEWAL_RETRY_MIN_BACKOFF_MS, (deadline - failedAt) / 4),
  );
  return new Date(failedAt + delay);
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
  lastRenewedAt?: Date | string | null;
  ariWindowEnd?: Date | string | null;
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
