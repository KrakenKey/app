import {
  CONNECTOR_FAILED_STATES,
  CONNECTOR_STALE_AFTER_HOURS,
} from '@krakenkey/shared';
import type {
  Connector,
  ConnectorConfigSettings,
  ConnectorConfigSummary,
  ConnectorConfigVerify,
  ConnectorDeployment,
  ConnectorDeploymentState,
  ConnectorPluginSource,
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
/** The service user the Linux packages create. */
export const CONNECTOR_USER = 'krakenkey-connector';
/** The image runs as this uid, so files it reads must be owned by it. */
export const CONNECTOR_IMAGE_UID = 10001;

/**
 * Enrolls a connector installed on the host, as the user it runs as. The
 * token file must be readable by that user and not by others.
 */
export function enrollCommand(): string {
  return [
    `sudo install -m 0640 -g ${CONNECTOR_USER} /dev/null ${CONNECTOR_TOKEN_PATH}  # paste the token into this file`,
    `sudo -u ${CONNECTOR_USER} env KK_ENROLLMENT_TOKEN_FILE=${CONNECTOR_TOKEN_PATH} \\`,
    `  krakenkey-connector enroll --config ${CONNECTOR_CONFIG_PATH}`,
    `sudo rm ${CONNECTOR_TOKEN_PATH}  # it works only once`,
  ].join('\n');
}

export const CONNECTOR_DOCS_URL = 'https://krakenkey.io/docs/connector/';

/**
 * Enrolls a connector that runs in Docker, then starts it. Its identity
 * key is kept in the data volume, so both commands mount the same one.
 */
export function dockerCommands(): string {
  return [
    'VERSION=0.2.0   # the connector release to run, without the leading v',
    '',
    `# the image runs as uid ${CONNECTOR_IMAGE_UID}, so the token file must belong to it`,
    `sudo install -m 0600 -o ${CONNECTOR_IMAGE_UID} /dev/null ${CONNECTOR_TOKEN_PATH}  # paste the token into this file`,
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

// --- Config summary ----------------------------------------------------------

export const PLUGIN_SOURCE_LABEL: Record<ConnectorPluginSource, string> = {
  bundled: 'Bundled',
  data_dir: 'Data directory',
  path: 'Path',
  builtin: 'Built in',
};

/** "90 seconds", "30 minutes", "1 hour", "1 hour 30 minutes", "2 days". */
export function formatInterval(seconds: number): string {
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  if (seconds < 60 || seconds % 60 !== 0) return unit(seconds, 'second');
  const minutes = seconds / 60;
  if (minutes < 60) return unit(minutes, 'minute');
  if (minutes % (24 * 60) === 0) return unit(minutes / (24 * 60), 'day');
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest
    ? `${unit(hours, 'hour')} ${unit(rest, 'minute')}`
    : unit(hours, 'hour');
}

/** Settings as `key: value` pairs, in the order the connector sent them. */
export function settingPairs(settings: ConnectorConfigSettings): string[] {
  return Object.entries(settings).map(([k, v]) => `${k}: ${String(v)}`);
}

/** Where the post-deploy check connects: `host:port`, `host`, `port 8443`. */
export function formatCheck(verify: ConnectorConfigVerify): string {
  const { host, port } = verify;
  if (host && port) return `${host.includes(':') ? `[${host}]` : host}:${port}`;
  if (host) return host;
  if (port) return `port ${port}`;
  return 'Default host and port';
}

export interface ConfigDrift {
  /** In the config, but outside the connector's allowedCertIds. */
  notAllowed: number[];
  /** In allowedCertIds, but not in the config. */
  missing: number[];
}

/**
 * Differences between what the connector is allowed to manage and what its
 * config lists. Only certificate restrictions can be compared: with a
 * domain restriction alone, any certificate in those domains is allowed.
 */
export function configDrift(
  summary: Pick<ConnectorConfigSummary, 'certificates'>,
  allowedCertIds: number[] | null,
): ConfigDrift {
  if (!allowedCertIds) return { notAllowed: [], missing: [] };
  const allowed = new Set(allowedCertIds);
  const configured = new Set(summary.certificates.map((c) => c.certificateId));
  return {
    notAllowed: [...configured].filter((id) => !allowed.has(id)),
    missing: [...allowed].filter((id) => !configured.has(id)),
  };
}
