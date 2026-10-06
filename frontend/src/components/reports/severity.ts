import type { ReportSeverity } from '@krakenkey/shared';

export const SEVERITY_LABELS: Record<ReportSeverity, string> = {
  critical: 'Critical',
  warning: 'Warning',
  notice: 'Notice',
  ok: 'OK',
};

export const SEVERITY_BADGE: Record<
  ReportSeverity,
  'danger' | 'warning' | 'info' | 'success'
> = {
  critical: 'danger',
  warning: 'warning',
  notice: 'info',
  ok: 'success',
};

export const SEVERITY_RANK: Record<ReportSeverity, number> = {
  critical: 0,
  warning: 1,
  notice: 2,
  ok: 3,
};

export const SEVERITY_TEXT: Record<ReportSeverity, string> = {
  critical: 'text-red-400',
  warning: 'text-amber-400',
  notice: 'text-cyan-400',
  ok: 'text-emerald-400',
};

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
