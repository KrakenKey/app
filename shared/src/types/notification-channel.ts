/**
 * Events a notification channel (Slack, Microsoft Teams or a signed webhook)
 * can subscribe to.
 */
export const AlertEvent = {
  CERT_ISSUED: 'cert.issued',
  CERT_RENEWED: 'cert.renewed',
  CERT_FAILED: 'cert.failed',
  CERT_EXPIRING: 'cert.expiring',
  CERT_REVOKED: 'cert.revoked',
  CERT_REPLACEMENT_REQUESTED: 'cert.replacement_requested',
  DOMAIN_VERIFICATION_FAILED: 'domain.verification_failed',
  ENDPOINT_SCAN_FAILED: 'endpoint.scan_failed',
  DEPLOY_FAILED: 'deploy.failed',
  CONNECTOR_STALE: 'connector.stale',
} as const;

export type AlertEvent = (typeof AlertEvent)[keyof typeof AlertEvent];

export const ALERT_EVENTS: AlertEvent[] = Object.values(AlertEvent);

/** What each event means, for the dashboard and API docs. */
export const ALERT_EVENT_DESCRIPTIONS: Record<AlertEvent, string> = {
  'cert.issued': 'A new certificate was issued',
  'cert.renewed': 'A certificate was renewed',
  'cert.failed': 'Certificate issuance or renewal failed after all retries',
  'cert.expiring': 'A certificate is close to expiry',
  'cert.revoked': 'A certificate was revoked',
  'cert.replacement_requested':
    'The CA asked for a certificate to be replaced early (ACME ARI)',
  'domain.verification_failed':
    'A verified domain failed its periodic DNS re-check',
  'endpoint.scan_failed':
    'A monitored endpoint started failing (connection error, invalid chain or expired certificate)',
  'deploy.failed':
    'A connector failed to install a certificate on a target, or rolled it back',
  'connector.stale': 'A connector has not checked in for 24 hours',
};

/** Events a new channel subscribes to when none are given. */
export const DEFAULT_ALERT_EVENTS: AlertEvent[] = [
  'cert.failed',
  'cert.expiring',
  'cert.revoked',
  'cert.replacement_requested',
  'domain.verification_failed',
  'endpoint.scan_failed',
  'deploy.failed',
  'connector.stale',
];

/** Event name used by the test-send button. Never stored as a subscription. */
export const ALERT_TEST_EVENT = 'test' as const;

export const NOTIFICATION_CHANNEL_TYPES = [
  'slack',
  'teams',
  'webhook',
] as const;

export type NotificationChannelType =
  (typeof NOTIFICATION_CHANNEL_TYPES)[number];

/** Channels a single user may create. */
export const MAX_NOTIFICATION_CHANNELS = 10;

export type NotificationDeliveryStatus = 'ok' | 'failed';

/**
 * A channel as returned by the API. The destination URL is never returned
 * in full; `urlMasked` shows the scheme, host and last four characters.
 */
export interface NotificationChannel {
  id: string;
  type: NotificationChannelType;
  name: string;
  urlMasked: string;
  events: AlertEvent[];
  enabled: boolean;
  /** True for webhook channels, which sign each delivery. */
  hasSecret: boolean;
  lastDeliveryAt: string | null;
  lastDeliveryStatus: NotificationDeliveryStatus | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Create response. `secret` is present for webhook channels, shown once. */
export interface CreateNotificationChannelResponse extends NotificationChannel {
  secret?: string;
}

export interface CreateNotificationChannelRequest {
  type: NotificationChannelType;
  name: string;
  url: string;
  events?: AlertEvent[];
  enabled?: boolean;
}

export interface UpdateNotificationChannelRequest {
  name?: string;
  url?: string;
  events?: AlertEvent[];
  enabled?: boolean;
}

export interface TestNotificationChannelResponse {
  ok: boolean;
  /** HTTP status from the destination, when one was received. */
  status: number | null;
  error: string | null;
}

export interface RotateNotificationChannelSecretResponse {
  secret: string;
}
