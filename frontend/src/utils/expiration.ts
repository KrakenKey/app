import type { TlsCert } from '@krakenkey/shared';

export interface ExpirationInfo {
  expiresAt: Date;
  daysUntilExpiry: number;
  isExpired: boolean;
  colorClass: string;
}

export function getExpirationInfo(cert: TlsCert): ExpirationInfo | null {
  if (!cert.expiresAt) return null;

  const expiresAt = new Date(cert.expiresAt);
  const now = new Date();
  const daysUntilExpiry = Math.floor(
    (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
  );

  const isExpired = daysUntilExpiry < 0;
  let colorClass = 'text-emerald-400';
  if (isExpired) colorClass = 'text-red-400';
  else if (daysUntilExpiry < 7) colorClass = 'text-red-400';
  else if (daysUntilExpiry <= 30) colorClass = 'text-amber-400';

  return { expiresAt, daysUntilExpiry, isExpired, colorClass };
}

export interface KeyExpiry {
  /** "Never", or the expiry date, e.g. "Jul 3, 2027". */
  label: string;
  /** Days left, shown next to the date. Null for keys that never expire. */
  days: string | null;
  /** Color only near expiry: muted beyond 30 days. */
  tone: 'muted' | 'warning' | 'danger';
}

/** Expiry of an API key, colored only when 30 days or less remain. */
export function getKeyExpiry(
  expiresAt: string | null,
  now: number = Date.now(),
): KeyExpiry {
  if (!expiresAt) return { label: 'Never', days: null, tone: 'muted' };
  const expiry = new Date(expiresAt);
  const daysLeft = Math.floor((expiry.getTime() - now) / 86_400_000);
  const label = expiry.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  if (daysLeft < 0) return { label, days: 'expired', tone: 'danger' };
  return {
    label,
    days: `${daysLeft}d`,
    tone: daysLeft < 7 ? 'danger' : daysLeft <= 30 ? 'warning' : 'muted',
  };
}
