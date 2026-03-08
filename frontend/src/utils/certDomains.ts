import type { TlsCert } from '@krakenkey/shared';

export function getCertDomains(cert: TlsCert): string[] {
  const parsed = cert.parsedCsr;
  if (!parsed || typeof parsed !== 'object') return [];

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
