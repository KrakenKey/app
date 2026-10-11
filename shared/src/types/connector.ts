/**
 * Connectors: agents that run on a customer's own machines, keep private
 * keys there, renew certificates and install them on local targets. A
 * connector enrolls once with a single-use token, then proves itself with
 * an Ed25519 key to get short-lived API keys.
 */

/** Scopes a connector can be given. `certs:read` is always required. */
export const CONNECTOR_SCOPES = ['certs:read', 'certs:renew'] as const;

export type ConnectorScope = (typeof CONNECTOR_SCOPES)[number];

/** Active (not revoked) connectors per user. */
export const MAX_CONNECTORS_PER_USER = 50;

/** Prefix of enrollment tokens. */
export const CONNECTOR_ENROLLMENT_TOKEN_PREFIX = 'kkce_';

/** Lifetime of an enrollment token, in seconds. */
export const CONNECTOR_ENROLLMENT_TOKEN_TTL_SECONDS = 24 * 60 * 60;

/** Lifetime of an API key issued to a connector, in seconds. */
export const CONNECTOR_KEY_TTL_SECONDS = 60 * 60;

/** Largest accepted difference between a signed timestamp and server time. */
export const CONNECTOR_MAX_CLOCK_SKEW_SECONDS = 300;

/**
 * An enrolled connector not seen for this long gets one `connector.stale`
 * alert.
 */
export const CONNECTOR_STALE_AFTER_HOURS = 24;

/**
 * How long a used nonce is remembered, per connector: longer than the whole
 * window a signed timestamp is accepted in (skew either side), plus a
 * margin, so a request can't be replayed once its nonce is forgotten.
 */
export const CONNECTOR_NONCE_TTL_SECONDS =
  2 * CONNECTOR_MAX_CLOCK_SKEW_SECONDS + 60;

/**
 * First line of the message signed for `POST /connectors/token`. The full
 * message is `<prefix>\n<connectorId>\n<timestamp>\n<nonce>` (UTF-8, no
 * trailing newline).
 */
export const CONNECTOR_TOKEN_SIGNING_PREFIX = 'KRAKENKEY-CONNECTOR-TOKEN-V1';

/**
 * First line of the message signed for `POST /connectors/rotate`:
 * `<prefix>\n<connectorId>\n<newPublicKey>\n<timestamp>\n<nonce>`.
 */
export const CONNECTOR_ROTATE_SIGNING_PREFIX = 'KRAKENKEY-CONNECTOR-ROTATE-V1';

export interface Connector {
  id: string;
  name: string;
  clientLabel: string | null;
  scopes: ConnectorScope[];
  allowedCertIds: number[] | null;
  allowedDomainIds: string[] | null;
  enrolledAt: string | null;
  /**
   * When the current enrollment token expires; null once the connector has
   * enrolled or been revoked (no token is usable then).
   */
  enrollmentTokenExpiresAt: string | null;
  /** Set when the connector is revoked; revoked connectors stay listed. */
  revokedAt: string | null;
  lastSeenAt: string | null;
  version: string | null;
  os: string | null;
  arch: string | null;
  createdAt: string;
  /** Only on `GET /connectors/:id`. */
  deployments?: ConnectorDeployment[];
  /** Only on `GET /connectors`: counts of what the connector last reported. */
  deploymentSummary?: ConnectorDeploymentSummary;
  /**
   * Only on `GET /connectors/:id`: the config summary the connector last
   * shared, or null when it has not shared one (or turned sharing off).
   */
  configSummary?: ConnectorConfigSummary | null;
  /** Only on `GET /connectors/:id`: hash of the stored summary. */
  configHash?: string | null;
  /** Only on `GET /connectors/:id`: when the summary was last received. */
  configReportedAt?: string | null;
}

/** Counts of a connector's reported deployments, for the connector list. */
export interface ConnectorDeploymentSummary {
  /** Certificates with at least one reported target. */
  certificates: number;
  /** Targets across all of those certificates. */
  targets: number;
  /** Targets whose state is `failed` or `rolled_back`. */
  failing: number;
}

/** Where a connector installs a certificate, and how that went. */
export const CONNECTOR_DEPLOYMENT_STATES = [
  'pending',
  'staged',
  'activated',
  'verified',
  'activated_unverifiable',
  'failed',
  'rolled_back',
] as const;

export type ConnectorDeploymentState =
  (typeof CONNECTOR_DEPLOYMENT_STATES)[number];

export interface ConnectorDeployment {
  connectorId: string;
  connectorName: string;
  certificateId: number;
  /** The connector's name for the target, e.g. `nginx-main`. */
  label: string;
  state: ConnectorDeploymentState;
  /** Hex serial of the certificate installed on the target. */
  serial: string | null;
  /** Short error code or message for failed targets. */
  error: string | null;
  /** When the target last changed, as reported by the connector. */
  updatedAt: string;
  /** When KrakenKey last received this target in a report. */
  reportedAt: string;
}

/** `POST /connectors` (dashboard session only). */
export interface CreateConnectorRequest {
  name: string;
  clientLabel?: string;
  /** Must include `certs:read`. */
  scopes: ConnectorScope[];
  /** At least one of allowedCertIds and allowedDomainIds is required. */
  allowedCertIds?: number[];
  allowedDomainIds?: string[];
}

export interface CreateConnectorResponse {
  connector: Connector;
  /** Shown once. Single use, expires after 24 hours. */
  enrollmentToken: string;
  /** When the token expires (24 hours). */
  expiresAt: string;
}

/**
 * `PATCH /connectors/:id`. Every field is optional. `clientLabel: null`
 * clears it. `allowedCertIds` / `allowedDomainIds` replace the current
 * list (`[]` or `null` clears one), but at least one must remain.
 * Changing scopes or restrictions revokes the connector's live keys.
 */
export interface UpdateConnectorRequest {
  name?: string;
  clientLabel?: string | null;
  scopes?: ConnectorScope[];
  allowedCertIds?: number[] | null;
  allowedDomainIds?: string[] | null;
}

/** `POST /connectors/:id/enrollment-token`. */
export interface ConnectorEnrollmentTokenResponse {
  enrollmentToken: string;
  /** When the token expires (24 hours). */
  expiresAt: string;
}

/** `POST /connectors/enroll` (no bearer token). */
export interface ConnectorEnrollRequest {
  token: string;
  /** Standard base64 (padded) of the raw 32-byte Ed25519 public key. */
  publicKey: string;
  version: string;
  os: string;
  arch: string;
}

export interface ConnectorEnrollResponse {
  connectorId: string;
  name: string;
}

/** `POST /connectors/token` (no bearer token). */
export interface ConnectorTokenRequest {
  connectorId: string;
  /** RFC 3339 UTC with second precision, e.g. `2026-10-10T14:00:00Z`. */
  timestamp: string;
  /** base64url (no padding) of at least 16 random bytes, at most 64 characters. */
  nonce: string;
  /** Standard base64 of the 64-byte Ed25519 signature. */
  signature: string;
}

export interface ConnectorTokenResponse {
  apiKey: string;
  expiresAt: string;
}

/** `POST /connectors/rotate` (no bearer token), signed by the current key. */
export interface ConnectorRotateRequest {
  connectorId: string;
  newPublicKey: string;
  timestamp: string;
  nonce: string;
  signature: string;
}

/** Upper bounds on `POST /connectors/report`. */
export const CONNECTOR_REPORT_LIMITS = {
  certificates: 500,
  targetsPerCertificate: 50,
  errorLength: 200,
  serialLength: 64,
  labelLength: 64,
} as const;

/** Target labels: letters, digits, `.`, `_` and `-`, 1 to 64 characters. */
export const CONNECTOR_TARGET_LABEL_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

/** States that raise a `deploy.failed` alert when a target enters them. */
export const CONNECTOR_FAILED_STATES: ConnectorDeploymentState[] = [
  'failed',
  'rolled_back',
];

export interface ConnectorReportTarget {
  label: string;
  state: ConnectorDeploymentState;
  /** Hex, at most 64 characters. */
  serial?: string | null;
  /** Short, sanitised error code or message, at most 200 characters. */
  error?: string | null;
  /** RFC 3339, e.g. `2026-10-10T14:00:00.000Z`. */
  updatedAt: string;
}

export interface ConnectorReportCertificate {
  certificateId: number;
  /**
   * Every target the connector deploys this certificate to. Targets missing
   * here are removed; an empty list removes them all.
   */
  targets: ConnectorReportTarget[];
}

/** `POST /connectors/report`, with a key issued to the connector. */
export interface ConnectorReportRequest {
  version: string;
  os: string;
  arch: string;
  certificates: ConnectorReportCertificate[];
}

/**
 * Response to `POST /connectors/report`. `accepted` counts the certificates
 * stored; certificates the connector may not use (outside its restrictions
 * or not owned by its user) are skipped and listed.
 */
export interface ConnectorReportResponse {
  accepted: number;
  rejectedCertificateIds: number[];
}

// --- Config summary --------------------------------------------------------

/** Where a connector loaded a plugin from. */
export const CONNECTOR_PLUGIN_SOURCES = [
  'bundled',
  'data_dir',
  'path',
  'builtin',
] as const;

export type ConnectorPluginSource = (typeof CONNECTOR_PLUGIN_SOURCES)[number];

/** Plugin names: letters, digits, `.`, `_` and `-`, 1 to 64 characters. */
export const CONNECTOR_PLUGIN_NAME_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

/** Keys of a `settings` map: lowercase, starting with a letter, at most 32. */
export const CONNECTOR_SETTING_KEY_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;

/** sha256 of the canonical summary, lowercase hex. */
export const CONNECTOR_CONFIG_HASH_PATTERN = /^[0-9a-f]{64}$/;

/** Upper bounds on `PUT /connectors/config`. */
export const CONNECTOR_CONFIG_LIMITS = {
  plugins: 50,
  certificates: CONNECTOR_REPORT_LIMITS.certificates,
  namesPerCertificate: 100,
  nameLength: 253,
  targetsPerCertificate: CONNECTOR_REPORT_LIMITS.targetsPerCertificate,
  settingsKeys: 10,
  settingValueLength: 256,
  versionLength: 64,
  keyTypeLength: 32,
  hostLength: 253,
  /** checkIntervalSeconds: 1 second to 7 days. */
  maxCheckIntervalSeconds: 7 * 24 * 60 * 60,
} as const;

/** A setting value: text, a flag or a number. Nothing nested. */
export type ConnectorConfigSettingValue = string | number | boolean;

/**
 * A flat map of known-safe settings. The connector only sends keys on its
 * allowlist for the plugin, so commands, owners, tags, account ids and
 * secrets are never included.
 */
export type ConnectorConfigSettings = Record<
  string,
  ConnectorConfigSettingValue
>;

export interface ConnectorConfigPlugin {
  name: string;
  /** Null for plugins without a version, such as one loaded from a path. */
  version: string | null;
  source: ConnectorPluginSource;
}

export interface ConnectorConfigKeyStore {
  plugin: string;
  /** e.g. `ecdsa-p256`; null when the config leaves it to the default. */
  keyType: string | null;
  settings: ConnectorConfigSettings;
}

/** The TLS check a connector runs after deploying to a target. */
export interface ConnectorConfigVerify {
  host: string | null;
  port: number | null;
  skipChainValidation: boolean;
}

export interface ConnectorConfigTarget {
  label: string;
  plugin: string;
  /** Added by the connector (e.g. a key store that is also a target). */
  implicit: boolean;
  /** Runs a command after deploying, or is the `exec` target. */
  runsCommand: boolean;
  verify: ConnectorConfigVerify | null;
  settings: ConnectorConfigSettings;
}

export interface ConnectorConfigCertificate {
  certificateId: number;
  names: string[];
  keyStore: ConnectorConfigKeyStore;
  targets: ConnectorConfigTarget[];
}

/**
 * `PUT /connectors/config`, with a key issued to the connector: a read-only
 * summary of what the connector is configured to do. KrakenKey stores and
 * shows it; nothing in KrakenKey changes the config, which lives on the
 * connector's host. `DELETE /connectors/config` clears it.
 */
export interface ConnectorConfigSummary {
  /** sha256 (lowercase hex) of the canonical summary without `hash`. */
  hash: string;
  /** Connector version. */
  version: string;
  /** Seconds between passes; null when not reported. */
  checkIntervalSeconds: number | null;
  plugins: ConnectorConfigPlugin[];
  /** Every certificate in the config, in config order. */
  certificates: ConnectorConfigCertificate[];
  /** True when the connector cut certificates or targets to the limits. */
  truncated: boolean;
}
