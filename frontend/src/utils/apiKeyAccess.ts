import { API_KEY_PRESETS } from '@krakenkey/shared';
import type { ApiKeyPreset, ApiKeyScope } from '@krakenkey/shared';

export const API_KEY_PRESET_ORDER: ApiKeyPreset[] = [
  'full',
  'read-only',
  'cert-renewal',
  'probe',
];

export const API_KEY_PRESET_LABELS: Record<ApiKeyPreset, string> = {
  full: 'Full access',
  'read-only': 'Read-only',
  'cert-renewal': 'Certificate renewal',
  probe: 'Probe',
};

export const API_KEY_PRESET_DESCRIPTIONS: Record<ApiKeyPreset, string> = {
  full: 'Everything your account can do, including scopes added later.',
  'read-only': 'View certificates, domains, endpoints and account details.',
  'cert-renewal': 'View and renew existing certificates.',
  probe: 'Run a connected probe and report scan results.',
};

/**
 * The preset whose scopes equal these, ignoring order. null scopes means
 * full access. Returns null for a custom set.
 */
export function matchPreset(
  scopes: readonly ApiKeyScope[] | null | undefined,
): ApiKeyPreset | null {
  if (scopes == null) return 'full';
  const wanted = new Set(scopes);
  for (const preset of API_KEY_PRESET_ORDER) {
    const presetScopes = API_KEY_PRESETS[preset];
    if (!presetScopes) continue;
    if (
      presetScopes.length === wanted.size &&
      presetScopes.every((s) => wanted.has(s))
    ) {
      return preset;
    }
  }
  return null;
}

function isIpv4(value: string): boolean {
  const parts = value.split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => /^(0|[1-9]\d{0,2})$/.test(p) && Number(p) <= 255);
}

function isIpv6(value: string): boolean {
  if (!/^[0-9a-fA-F:.]+$/.test(value)) return false;
  const halves = value.split('::');
  if (halves.length > 2) return false;

  const groups = halves.flatMap((h) => (h === '' ? [] : h.split(':')));
  let count = 0;
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    if (g.includes('.')) {
      // An embedded IPv4 address may only be the last part and counts as two groups.
      if (i !== groups.length - 1 || !isIpv4(g)) return false;
      count += 2;
    } else if (/^[0-9a-fA-F]{1,4}$/.test(g)) {
      count += 1;
    } else {
      return false;
    }
  }
  return halves.length === 2 ? count < 8 : count === 8;
}

/**
 * Light check for an IPv4/IPv6 address with an optional /prefix. The server
 * does the real validation; this only catches typos before submitting.
 */
export function isValidIpOrCidr(entry: string): boolean {
  const parts = entry.split('/');
  if (parts.length > 2) return false;
  const [address, prefix] = parts;
  const v4 = isIpv4(address);
  if (!v4 && !isIpv6(address)) return false;
  if (prefix === undefined) return true;
  if (!/^\d{1,3}$/.test(prefix)) return false;
  return Number(prefix) <= (v4 ? 32 : 128);
}

/** Splits text on newlines and commas, dropping blanks and duplicates. */
export function parseIpList(text: string): {
  entries: string[];
  invalid: string[];
} {
  const entries = [
    ...new Set(
      text
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
  return { entries, invalid: entries.filter((e) => !isValidIpOrCidr(e)) };
}
