import type { ParsedCsr } from './csr-generator';

export const CertStatus = {
  /**
   * Created from a list of names (`POST /certs/tls` with `names`); waiting
   * for a connector to send a CSR made with its own key through
   * `POST /certs/tls/:id/renew`. Not yet sent to the CA.
   */
  AWAITING_CSR: 'awaiting_csr',
  PENDING: 'pending',
  ISSUING: 'issuing',
  ISSUED: 'issued',
  FAILED: 'failed',
  RENEWING: 'renewing',
  REVOKING: 'revoking',
  REVOKED: 'revoked',
} as const;

export type CertStatus = (typeof CertStatus)[keyof typeof CertStatus];

/**
 * Who renews a certificate. `connector` means a customer-hosted connector
 * renews it with its own keys, so the server never renews it on its own.
 */
export const CERT_MANAGERS = ['connector'] as const;
export type CertManagedBy = (typeof CERT_MANAGERS)[number];

/**
 * Renewal window in days for connector-managed certificates: the plan's
 * window, but never less than this.
 */
export const CONNECTOR_MIN_RENEWAL_WINDOW_DAYS = 30;

export interface TlsCert {
  id: number;
  /** The CSR in PEM; null while the certificate is `awaiting_csr`. */
  rawCsr: string | null;
  /** The parsed CSR; null while the certificate is `awaiting_csr`. */
  parsedCsr: ParsedCsr | null;
  /**
   * The names a certificate was created with when it was requested by
   * names instead of a CSR (lowercased, duplicates removed). Kept after the
   * connector's CSR arrives. Null for certificates requested with a CSR.
   */
  requestedNames: string[] | null;
  crtPem: string | null;
  chainPem: string | null;
  status: CertStatus;
  expiresAt: string | null;
  lastRenewedAt: string | null;
  autoRenew: boolean;
  renewalCount: number;
  lastRenewalAttemptAt: string | null;
  revocationReason: number | null;
  /** Why the last issuance or renewal attempt failed; null otherwise. */
  failureReason: string | null;
  revokedAt: string | null;
  /**
   * The CA's suggested renewal window (ACME Renewal Information, RFC 9773)
   * from the last check; null until checked or when the CA doesn't offer it.
   */
  ariWindowStart?: string | null;
  ariWindowEnd?: string | null;
  /** Set when the CA explained why it moved the window. */
  ariExplanationUrl?: string | null;
  /** Set when the CA asked for early replacement; renewal is queued outside the plan window. */
  ariReplacementRequestedAt?: string | null;
  /** `connector` when a customer-hosted connector renews it; null otherwise. */
  managedBy: CertManagedBy | null;
  /**
   * When the certificate will be renewed (ISO 8601): expiry minus the
   * renewal window, or the start of the CA's suggested ARI window when that
   * is earlier. Connector-managed certificates use any ARI window and a
   * window of at least 30 days; other certificates use the plan window and
   * only an early-replacement ARI window (ariReplacementRequestedAt set).
   * Null when the certificate has no expiry yet (not issued) or is revoked.
   * For an `awaiting_csr` certificate it is the creation time: it is due now.
   */
  renewAfter: string | null;
  createdAt: string;
  userId: string;
}

/**
 * Body for `POST /certs/tls`: either a CSR, or the names of a certificate a
 * connector will issue with its own key (status `awaiting_csr`).
 */
export type CreateTlsCertRequest =
  | { csrPem: string }
  | {
      /** DNS names (wildcards allowed), at most MAX_REQUESTED_NAMES. */
      names: string[];
      managedBy: 'connector';
    };

/** Most names a certificate can be requested with (Let's Encrypt's limit). */
export const MAX_REQUESTED_NAMES = 100;

/**
 * Optional body for `POST /certs/tls/:id/renew`. With `csrPem` the
 * certificate is renewed with that CSR (a new key); its names must equal the
 * certificate's names. An `awaiting_csr` certificate needs it: the CSR's
 * names must equal `requestedNames`, and the certificate is then issued.
 */
export interface RenewTlsCertRequest {
  csrPem?: string;
}

export interface CreateTlsCertResponse {
  id: number;
  status: CertStatus;
}

export interface RenewTlsCertResponse {
  id: number;
  status: CertStatus;
  /**
   * True when the request used `ifDue=true` and the certificate is not yet
   * inside its renewal window. Nothing was queued and the status is unchanged.
   */
  skipped: boolean;
  /** Why the renewal was skipped. Only set when `skipped` is true. */
  reason?: 'not_due';
  /** Current expiry (ISO 8601). Only set when `skipped` is true. */
  expiresAt?: string;
  /**
   * The renewal window in days: the plan's window, at least 30 for
   * connector-managed certificates. Only set when `skipped` is true.
   */
  renewalWindowDays?: number;
}

export interface RetryTlsCertResponse {
  id: number;
  status: CertStatus;
}

export interface RevokeTlsCertRequest {
  reason?: number;
}

export interface RevokeTlsCertResponse {
  id: number;
  status: CertStatus;
}

export interface DeleteTlsCertResponse {
  id: number;
}

export interface TlsCertDetails {
  serialNumber: string;
  issuer: string;
  subject: string;
  validFrom: string;
  validTo: string;
  keyType: string;
  keySize: number;
  fingerprint: string;
}

export interface TlsCertChainEntry {
  serialNumber: string;
  issuer: string;
  subject: string;
  validFrom: string;
  validTo: string;
  fingerprint: string;
}

export interface TlsCertChainInfo {
  leafCert: TlsCertDetails;
  intermediates: TlsCertChainEntry[];
  fullChainPem: string;
}

export interface TlsCertJobPayload {
  certId: number;
}
