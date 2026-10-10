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

/** How long a used nonce is remembered, per connector. */
export const CONNECTOR_NONCE_TTL_SECONDS = 600;

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
  /** Set when the connector is revoked; revoked connectors stay listed. */
  revokedAt: string | null;
  lastSeenAt: string | null;
  version: string | null;
  os: string | null;
  arch: string | null;
  createdAt: string;
  /** Only on `GET /connectors/:id`. */
  deployments?: ConnectorDeployment[];
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
}

/** `PATCH /connectors/:id`. `clientLabel: null` clears it. */
export interface UpdateConnectorRequest {
  name?: string;
  clientLabel?: string | null;
}

/** `POST /connectors/:id/enrollment-token`. */
export interface ConnectorEnrollmentTokenResponse {
  enrollmentToken: string;
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
