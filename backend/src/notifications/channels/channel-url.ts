import { isIP } from 'net';
import type { NotificationChannelType } from '@krakenkey/shared';
import {
  isPrivateIP,
  resolveToPublicIPs,
  SsrfError,
} from '../../common/net/ssrf';

export const MAX_CHANNEL_URL_LENGTH = 2048;

/**
 * Host suffixes Power Automate Workflows webhooks are served from. Office 365
 * connectors (outlook.office.com/webhook) are retired by Microsoft, so only
 * Workflows URLs are accepted.
 */
export const TEAMS_HOST_SUFFIXES = [
  '.logic.azure.com',
  '.powerplatform.com',
  '.environment.api.powerplatform.com',
  '.webhook.office.com',
];

export class ChannelUrlError extends Error {
  constructor(
    message: string,
    /** True when the failure may clear up on its own (DNS lookup). */
    readonly transient = false,
  ) {
    super(message);
    this.name = 'ChannelUrlError';
  }
}

/**
 * Checks a channel URL without network access. Throws ChannelUrlError with a
 * message safe to return to the user (it never echoes the URL).
 */
export function parseChannelUrl(
  type: NotificationChannelType,
  raw: string,
): URL {
  if (typeof raw !== 'string' || raw.length > MAX_CHANNEL_URL_LENGTH) {
    throw new ChannelUrlError(
      `URL must be at most ${MAX_CHANNEL_URL_LENGTH} characters`,
    );
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ChannelUrlError('URL is not valid');
  }
  if (url.protocol !== 'https:') {
    throw new ChannelUrlError('URL must use https');
  }
  if (url.username || url.password) {
    throw new ChannelUrlError('URL must not contain a username or password');
  }
  const host = url.hostname.toLowerCase();

  switch (type) {
    case 'slack':
      if (
        host !== 'hooks.slack.com' ||
        url.port !== '' ||
        !/^\/services\/[^/]+\/[^/]+\/[^/]+$/.test(url.pathname)
      ) {
        throw new ChannelUrlError(
          'Slack URL must be an incoming webhook URL (https://hooks.slack.com/services/...)',
        );
      }
      return url;

    case 'teams':
      if (
        url.port !== '' ||
        !TEAMS_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))
      ) {
        throw new ChannelUrlError(
          'Teams URL must be a Workflows webhook URL (for example https://...logic.azure.com/... or https://...powerplatform.com/...). Office 365 connector URLs are retired and not supported.',
        );
      }
      return url;

    case 'webhook': {
      if (host === 'localhost' || host.endsWith('.localhost')) {
        throw new ChannelUrlError('Webhook URL must point to a public address');
      }
      const literal = host.replace(/^\[|\]$/g, '');
      if (isIP(literal) && isPrivateIP(literal)) {
        throw new ChannelUrlError('Webhook URL must point to a public address');
      }
      return url;
    }

    default:
      throw new ChannelUrlError('Unknown channel type');
  }
}

/**
 * Full check for create, update and every delivery: the syntax rules above,
 * plus (for webhooks) a DNS lookup that every address is public.
 */
export async function validateChannelUrl(
  type: NotificationChannelType,
  raw: string,
): Promise<URL> {
  const url = parseChannelUrl(type, raw);
  if (type !== 'webhook') return url;

  const literal = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(literal)) return url; // checked in parseChannelUrl

  try {
    await resolveToPublicIPs(literal);
  } catch (err) {
    if (err instanceof SsrfError) {
      throw err.reason === 'private'
        ? new ChannelUrlError('Webhook URL must point to a public address')
        : new ChannelUrlError('Webhook host could not be resolved', true);
    }
    throw err;
  }
  return url;
}
