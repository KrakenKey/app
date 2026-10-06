import type { ParsedCsr } from './csr-generator';

export const CertStatus = {
  PENDING: 'pending',
  ISSUING: 'issuing',
  ISSUED: 'issued',
  FAILED: 'failed',
  RENEWING: 'renewing',
  REVOKING: 'revoking',
  REVOKED: 'revoked',
} as const;

export type CertStatus = (typeof CertStatus)[keyof typeof CertStatus];

export interface TlsCert {
  id: number;
  rawCsr: string;
  parsedCsr: ParsedCsr;
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
  createdAt: string;
  userId: string;
}

export interface CreateTlsCertRequest {
  csrPem: string;
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
  /** The plan's renewal window in days. Only set when `skipped` is true. */
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
