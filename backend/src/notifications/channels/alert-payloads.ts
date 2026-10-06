import { createHmac } from 'crypto';
import type { AlertEvent } from '@krakenkey/shared';

export type AlertDeliveryEvent = AlertEvent | 'test';

export type AlertResourceType = 'certificate' | 'domain' | 'endpoint';

export type AlertDetailValue = string | number | boolean | null;

/** What a call site passes to AlertsService.emit. */
export interface AlertPayload {
  /** Cert common name, domain hostname or endpoint host:port. */
  subject: string;
  resource?: { type: AlertResourceType; id: string | number };
  /** Short facts, keyed in camelCase (rendered as labels for chat). */
  details?: Record<string, AlertDetailValue | undefined>;
}

/** One delivery, as queued and as rendered for every channel type. */
export interface AlertMessage {
  /** Delivery id, sent as X-KrakenKey-Delivery and in the webhook body. */
  id: string;
  event: AlertDeliveryEvent;
  createdAt: string;
  payload: AlertPayload;
}

export const ALERT_TITLES: Record<AlertDeliveryEvent, string> = {
  'cert.issued': 'Certificate issued',
  'cert.renewed': 'Certificate renewed',
  'cert.failed': 'Certificate issuance failed',
  'cert.expiring': 'Certificate expiring soon',
  'cert.revoked': 'Certificate revoked',
  'cert.replacement_requested': 'Certificate replacement requested by the CA',
  'domain.verification_failed': 'Domain verification failed',
  'endpoint.scan_failed': 'Endpoint scan failing',
  test: 'Test notification from KrakenKey',
};

const DASHBOARD_PATHS: Record<AlertResourceType, string> = {
  certificate: '/dashboard/certificates',
  domain: '/dashboard/domains',
  endpoint: '/dashboard/endpoints',
};

/** Dashboard page for the alert's resource (same host as email links). */
export function dashboardLink(
  appDomain: string,
  payload: AlertPayload,
): string {
  const path = payload.resource
    ? DASHBOARD_PATHS[payload.resource.type]
    : '/dashboard';
  return `https://${appDomain}${path}`;
}

/** expiresAt -> "Expires at" */
function label(key: string): string {
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function detailEntries(payload: AlertPayload): [string, string][] {
  return Object.entries(payload.details ?? {})
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => [label(k), String(v)]);
}

/** Slack mrkdwn treats &, < and > as control characters. */
function slackEscape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function buildSlackBody(msg: AlertMessage, link: string) {
  const title = ALERT_TITLES[msg.event];
  const lines = [
    `*${slackEscape(title)}*`,
    slackEscape(msg.payload.subject),
    ...detailEntries(msg.payload).map(
      ([k, v]) => `*${slackEscape(k)}:* ${slackEscape(v)}`,
    ),
    `<${link}|Open in KrakenKey>`,
  ];
  return {
    text: `${title}: ${msg.payload.subject}`,
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: lines.join('\n').slice(0, 3000) },
      },
    ],
  };
}

export function buildTeamsBody(msg: AlertMessage, link: string) {
  const title = ALERT_TITLES[msg.event];
  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        contentUrl: null,
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body: [
            {
              type: 'TextBlock',
              text: title,
              weight: 'Bolder',
              size: 'Medium',
              wrap: true,
            },
            { type: 'TextBlock', text: msg.payload.subject, wrap: true },
            ...detailEntries(msg.payload).map(([k, v]) => ({
              type: 'TextBlock',
              text: `**${k}:** ${v}`,
              wrap: true,
              spacing: 'Small',
            })),
          ],
          actions: [
            { type: 'Action.OpenUrl', title: 'Open in KrakenKey', url: link },
          ],
        },
      },
    ],
  };
}

export function buildWebhookBody(msg: AlertMessage, link: string) {
  const details: Record<string, AlertDetailValue> = {};
  for (const [k, v] of Object.entries(msg.payload.details ?? {})) {
    if (v !== undefined) details[k] = v;
  }
  return {
    id: msg.id,
    type: msg.event,
    createdAt: msg.createdAt,
    data: {
      title: ALERT_TITLES[msg.event],
      subject: msg.payload.subject,
      resource: msg.payload.resource ?? null,
      details,
      url: link,
    },
  };
}

/**
 * `t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`. The
 * HMAC key is the full secret string, including the `whsec_` prefix.
 */
export function signWebhookPayload(
  secret: string,
  rawBody: string,
  timestamp: number,
): string {
  const mac = createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');
  return `t=${timestamp},v1=${mac}`;
}
