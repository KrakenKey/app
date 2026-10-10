import type { TlsCert } from '@krakenkey/shared';

/**
 * The names a certificate covers: the CSR's CN and SANs, or, for a
 * certificate still waiting for a connector's CSR, the names it was
 * requested with.
 */
export function getCertDomains(cert: TlsCert): string[] {
  const parsed = cert.parsedCsr;
  if (!parsed || typeof parsed !== 'object') {
    return Array.isArray(cert.requestedNames) ? [...cert.requestedNames] : [];
  }

  const domains: string[] = [];

  const subject = (parsed as unknown as Record<string, unknown>).subject;
  if (Array.isArray(subject)) {
    for (const entry of subject) {
      if (
        entry &&
        typeof entry === 'object' &&
        'shortName' in entry &&
        entry.shortName === 'CN'
      ) {
        domains.push(String((entry as Record<string, unknown>).value));
      }
    }
  }

  const extensions = (parsed as unknown as Record<string, unknown>).extensions;
  if (Array.isArray(extensions)) {
    for (const ext of extensions) {
      if (ext && typeof ext === 'object' && 'altNames' in ext) {
        const altNames = (ext as Record<string, unknown>).altNames;
        if (Array.isArray(altNames)) {
          for (const alt of altNames) {
            if (alt && typeof alt === 'object' && 'value' in alt) {
              const val = String((alt as Record<string, unknown>).value);
              if (!domains.includes(val)) domains.push(val);
            }
          }
        }
      }
    }
  }

  return domains;
}

const DNS_LABEL = '[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?';
const DNS_NAME = new RegExp(`^(\\*\\.)?(${DNS_LABEL}\\.)+${DNS_LABEL}$`);

/**
 * Splits text on newlines, commas and spaces into lowercase names, dropping
 * blanks and duplicates. `invalid` lists entries that aren't DNS names
 * (an optional leading `*.` is allowed). The server does the real checks.
 */
export function parseNameList(text: string): {
  names: string[];
  invalid: string[];
} {
  const names = [
    ...new Set(
      text
        .split(/[\s,]+/)
        .map((s) => s.trim().toLowerCase().replace(/\.$/, ''))
        .filter(Boolean),
    ),
  ];
  return {
    names,
    invalid: names.filter((n) => n.length > 253 || !DNS_NAME.test(n)),
  };
}
