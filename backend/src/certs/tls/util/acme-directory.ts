import * as acme from 'acme-client';
import type { ConfigService } from '@nestjs/config';

/**
 * The ACME directory KrakenKey uses: KK_ACME_DIRECTORY_URL when set,
 * otherwise Let's Encrypt staging (KK_ACME_STAGING=true) or production.
 * Shared by issuance and ARI so both always talk to the same CA.
 */
export function resolveAcmeDirectoryUrl(config: ConfigService): {
  url: string;
  label: string;
} {
  const custom = config.get<string>('KK_ACME_DIRECTORY_URL');
  if (custom) return { url: custom, label: `custom ACME directory: ${custom}` };
  if (config.get<string>('KK_ACME_STAGING')?.toLowerCase() === 'true') {
    return {
      url: acme.directory.letsencrypt.staging,
      label:
        "Let's Encrypt Staging environment for ACME (KK_ACME_STAGING=true)",
    };
  }
  return {
    url: acme.directory.letsencrypt.production,
    label: "Let's Encrypt Production environment for ACME",
  };
}
