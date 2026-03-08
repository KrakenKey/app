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
  status: CertStatus;
  expiresAt: string | null;
  lastRenewedAt: string | null;
  autoRenew: boolean;
  renewalCount: number;
  lastRenewalAttemptAt: string | null;
  revocationReason: number | null;
  revokedAt: string | null;
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

export interface TlsCertJobPayload {
  certId: number;
}
