/** Most trust policies an account can have. */
export const MAX_GITHUB_OIDC_TRUSTS = 20;
/** Most refs one policy can list. */
export const MAX_ALLOWED_REFS = 20;

/** `owner/name`, using GitHub's character rules (matches the API). */
const REPOSITORY_PATTERN =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
/** A full ref, optionally ending in `*` for a prefix match (matches the API). */
const REF_PATTERN = /^refs\/[A-Za-z0-9._/-]+\*?$|^refs\/\*$/;

export function isValidRepository(value: string): boolean {
  return REPOSITORY_PATTERN.test(value);
}

export function isValidRef(value: string): boolean {
  return REF_PATTERN.test(value);
}

/** Splits text on newlines, dropping blanks and duplicates. */
export function parseRefList(text: string): {
  entries: string[];
  invalid: string[];
} {
  const entries = [
    ...new Set(
      text
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
  return { entries, invalid: entries.filter((e) => !isValidRef(e)) };
}

/**
 * Workflow snippet for the cert action. `trustId` is only needed when more
 * than one policy covers the repository.
 */
export function workflowSnippet(trustId?: string): string {
  const lines = [
    'permissions:',
    '  id-token: write',
    '  contents: read',
    'steps:',
    '  - uses: krakenkey/cert-action@v1',
    '    with:',
    '      domain: example.com',
  ];
  if (trustId) lines.push(`      trust-id: ${trustId}`);
  lines.push('      # no api-key: the action uses GitHub OIDC');
  return lines.join('\n');
}
