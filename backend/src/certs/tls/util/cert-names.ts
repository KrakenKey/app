import type { ParsedCsr } from '@krakenkey/shared';
import { certDnsNames } from '../../../auth/api-key-restrictions';

/** The fields of a certificate that say which names it covers. */
export interface CertNamesInput {
  id: number;
  parsedCsr?: ParsedCsr | null;
  requestedNames?: string[] | null;
}

/**
 * Lowercased, deduplicated names in their original order: how names given
 * without a CSR are stored, so the first stays the "main" name.
 */
export function normalizeRequestedNames(names: string[]): string[] {
  return [...new Set(names.map((n) => n.trim().toLowerCase()))];
}

/** Lowercased, deduplicated, sorted names, for comparing two name sets. */
export function normalizedNames(names: string[]): string[] {
  return [...new Set(names.map((n) => n.toLowerCase()))].sort();
}

/** Whether two name lists cover the same names (case and order ignored). */
export function sameNames(a: string[], b: string[]): boolean {
  const x = normalizedNames(a);
  const y = normalizedNames(b);
  return x.length === y.length && x.every((name, i) => name === y[i]);
}

/**
 * The DNS names a certificate covers: from its CSR (CN plus DNS SANs), or
 * the requested names while it is still waiting for one.
 */
export function certNames(cert: CertNamesInput): string[] {
  if (cert.parsedCsr) return certDnsNames(cert.parsedCsr);
  return cert.requestedNames ?? [];
}

/**
 * The name to show for a certificate in emails and alerts: the CSR's CN,
 * else its first SAN, else the first requested name, else "cert #id".
 */
export function certDisplayName(cert: CertNamesInput): string {
  const parsed = cert.parsedCsr;
  const cn = parsed?.subject?.find((a) => a.shortName === 'CN')?.value;
  if (typeof cn === 'string' && cn) return cn;
  const san = parsed?.extensions?.[0]?.altNames?.[0]?.value;
  if (san) return san;
  return cert.requestedNames?.[0] ?? `cert #${cert.id}`;
}
