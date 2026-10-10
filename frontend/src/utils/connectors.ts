import {
  CONNECTOR_FAILED_STATES,
  CONNECTOR_STALE_AFTER_HOURS,
} from '@krakenkey/shared';
import type {
  Connector,
  ConnectorDeployment,
  ConnectorDeploymentState,
} from '@krakenkey/shared';

type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export type ConnectorStatus =
  | 'waiting'
  | 'expired'
  | 'active'
  | 'stale'
  | 'revoked';

export const CONNECTOR_STATUS_LABEL: Record<ConnectorStatus, string> = {
  waiting: 'Waiting to enroll',
  expired: 'Enrollment token expired',
  active: 'Active',
  stale: 'Stale',
  revoked: 'Revoked',
};

export const CONNECTOR_STATUS_VARIANT: Record<ConnectorStatus, BadgeVariant> = {
  waiting: 'neutral',
  expired: 'warning',
  active: 'success',
  stale: 'warning',
  revoked: 'danger',
};

const STALE_AFTER_MS = CONNECTOR_STALE_AFTER_HOURS * 60 * 60 * 1000;

export type ConnectorStatusFields = Pick<
  Connector,
  'revokedAt' | 'enrolledAt' | 'lastSeenAt' | 'enrollmentTokenExpiresAt'
>;

/** True when the connector hasn't enrolled and its token has expired. */
export function enrollmentTokenExpired(
  connector: ConnectorStatusFields,
  now: number = Date.now(),
): boolean {
  return (
    !connector.revokedAt &&
    !connector.enrolledAt &&
    !!connector.enrollmentTokenExpiresAt &&
    new Date(connector.enrollmentTokenExpiresAt).getTime() <= now
  );
}

/**
 * Revoked; not enrolled yet, with a usable or an expired token; stale (not
 * seen for 24 hours, the same rule as the connector.stale alert); or active.
 */
export function connectorStatus(
  connector: ConnectorStatusFields,
  now: number = Date.now(),
): ConnectorStatus {
  if (connector.revokedAt) return 'revoked';
  if (!connector.enrolledAt) {
    return enrollmentTokenExpired(connector, now) ? 'expired' : 'waiting';
  }
  const seen = connector.lastSeenAt ?? connector.enrolledAt;
  return now - new Date(seen).getTime() > STALE_AFTER_MS ? 'stale' : 'active';
}

export const RESTRICTION_REQUIRED =
  'Pick at least one certificate or domain. A connector can only use what it is limited to.';

export const DEPLOYMENT_STATE_LABEL: Record<ConnectorDeploymentState, string> =
  {
    pending: 'Pending',
    staged: 'Staged',
    activated: 'Activated',
    verified: 'Verified',
    activated_unverifiable: 'Activated (not verified)',
    failed: 'Failed',
    rolled_back: 'Rolled back',
  };

export const DEPLOYMENT_STATE_VARIANT: Record<
  ConnectorDeploymentState,
  BadgeVariant
> = {
  pending: 'neutral',
  staged: 'info',
  activated: 'success',
  verified: 'success',
  activated_unverifiable: 'warning',
  failed: 'danger',
  rolled_back: 'danger',
};

export function isFailedState(state: ConnectorDeploymentState): boolean {
  return CONNECTOR_FAILED_STATES.includes(state);
}

/** "just now", "5 minutes ago", "3 hours ago", "2 days ago". */
export function formatRelative(iso: string, now: number = Date.now()): string {
  const seconds = Math.round((now - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const unit = (n: number, word: string) =>
    `${n} ${word}${n === 1 ? '' : 's'} ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return unit(minutes, 'minute');
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return unit(hours, 'hour');
  return unit(Math.floor(hours / 24), 'day');
}

export const CONNECTOR_CONFIG_PATH = '/etc/krakenkey-connector/config.yaml';
export const CONNECTOR_TOKEN_PATH = '/etc/krakenkey-connector/enrollment-token';
export const CONNECTOR_IMAGE = 'ghcr.io/krakenkey/connector:v${VERSION}';

/** Enrolls a connector installed on the host. */
export function enrollCommand(): string {
  return [
    `install -m 0600 /dev/null ${CONNECTOR_TOKEN_PATH}  # paste the token into this file`,
    `KK_ENROLLMENT_TOKEN_FILE=${CONNECTOR_TOKEN_PATH} \\`,
    `  krakenkey-connector enroll --config ${CONNECTOR_CONFIG_PATH}`,
    `rm ${CONNECTOR_TOKEN_PATH}  # it works only once`,
  ].join('\n');
}

export const CONNECTOR_DOCS_URL =
  'https://github.com/KrakenKey/connector/blob/main/README.md#install';

/**
 * Enrolls a connector that runs in Docker, then starts it. Its identity
 * key is kept in the data volume, so both commands mount the same one.
 */
export function dockerCommands(): string {
  return [
    'VERSION=0.1.0   # the connector release to run, without the leading v',
    '',
    'docker run --rm \\',
    '  -e KK_ENROLLMENT_TOKEN_FILE=/run/secrets/kk_enrollment_token \\',
    `  -v ${CONNECTOR_TOKEN_PATH}:/run/secrets/kk_enrollment_token:ro \\`,
    `  -v ${CONNECTOR_CONFIG_PATH}:${CONNECTOR_CONFIG_PATH}:ro \\`,
    '  -v krakenkey-connector-data:/var/lib/krakenkey-connector \\',
    `  ${CONNECTOR_IMAGE} enroll --config ${CONNECTOR_CONFIG_PATH}`,
    '',
    'docker run -d --name krakenkey-connector \\',
    `  -v ${CONNECTOR_CONFIG_PATH}:${CONNECTOR_CONFIG_PATH}:ro \\`,
    '  -v krakenkey-connector-data:/var/lib/krakenkey-connector \\',
    '  -v /srv/tls:/srv/tls \\',
    `  ${CONNECTOR_IMAGE}`,
  ].join('\n');
}

export interface ConnectorGroup {
  connectorId: string;
  connectorName: string;
  targets: ConnectorDeployment[];
}

/** Deployments grouped by connector, in the order the API returned them. */
export function groupByConnector(
  deployments: ConnectorDeployment[],
): ConnectorGroup[] {
  const groups = new Map<string, ConnectorGroup>();
  for (const d of deployments) {
    let group = groups.get(d.connectorId);
    if (!group) {
      group = {
        connectorId: d.connectorId,
        connectorName: d.connectorName,
        targets: [],
      };
      groups.set(d.connectorId, group);
    }
    group.targets.push(d);
  }
  return [...groups.values()];
}
