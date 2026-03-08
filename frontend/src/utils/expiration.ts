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

export interface ExpirationBadgeInfo {
  label: string;
  variant: 'success' | 'warning' | 'danger' | 'neutral';
}

export function getExpirationBadge(
  expiresAt: string | null,
): ExpirationBadgeInfo {
  if (!expiresAt) return { label: 'Never', variant: 'neutral' };
  const expiry = new Date(expiresAt);
  const now = new Date();
  const daysLeft = Math.floor(
    (expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
  );

  if (daysLeft < 0)
    return { label: `Expired ${Math.abs(daysLeft)}d ago`, variant: 'danger' };
  if (daysLeft < 7)
    return { label: `${daysLeft}d remaining`, variant: 'danger' };
  if (daysLeft <= 30)
    return { label: `${daysLeft}d remaining`, variant: 'warning' };
  return { label: expiry.toLocaleDateString(), variant: 'neutral' };
}
