import type { ReportHostResult } from '@krakenkey/shared';

const COLUMNS = [
  'host',
  'port',
  'severity',
  'status',
  'reachable',
  'days_left',
  'not_after',
  'issuer',
  'lets_encrypt',
  'tls_version',
  'key',
  'hostname_covered',
  'trusted',
  'problems',
] as const;

/**
 * Quotes a CSV cell, and defuses spreadsheet formulas: a cell starting with
 * = + - @ or a tab/CR gets a leading apostrophe.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(value);
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

function yesNo(value: boolean | null): string {
  if (value === null) return '';
  return value ? 'yes' : 'no';
}

/** One row per host, in the order given (callers pass the sorted list). */
export function reportToCsv(hosts: ReportHostResult[]): string {
  const rows = hosts.map((h) =>
    [
      h.host,
      h.port,
      h.severity ?? 'pending',
      h.status,
      yesNo(h.reachable),
      h.daysLeft,
      h.notAfter,
      h.issuerName,
      yesNo(h.letsEncrypt),
      h.tlsVersion,
      h.keyType ? `${h.keyType}${h.keySize ? ` ${h.keySize}` : ''}` : '',
      yesNo(h.hostnameCovered),
      yesNo(h.trusted),
      h.problems.map((p) => p.message).join('; '),
    ]
      .map(csvCell)
      .join(','),
  );
  return [COLUMNS.join(','), ...rows].join('\r\n') + '\r\n';
}

/** A filename-safe slug of the report name, for Content-Disposition. */
export function csvFilename(name: string | null, createdAt: Date): string {
  const slug = (name ?? 'tls-report')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  const date = createdAt.toISOString().slice(0, 10);
  return `${slug || 'tls-report'}-${date}.csv`;
}
