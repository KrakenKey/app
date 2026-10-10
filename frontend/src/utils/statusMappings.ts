import { CertStatus } from '@krakenkey/shared';

export const STATUS_LABEL: Record<CertStatus, string> = {
  [CertStatus.AWAITING_CSR]: 'Awaiting CSR',
  [CertStatus.PENDING]: 'Pending',
  [CertStatus.ISSUING]: 'Issuing',
  [CertStatus.ISSUED]: 'Issued',
  [CertStatus.FAILED]: 'Failed',
  [CertStatus.RENEWING]: 'Renewing',
  [CertStatus.REVOKING]: 'Revoking',
  [CertStatus.REVOKED]: 'Revoked',
};

export const STATUS_BADGE_VARIANT: Record<
  CertStatus,
  'success' | 'warning' | 'danger' | 'info' | 'neutral'
> = {
  [CertStatus.AWAITING_CSR]: 'neutral',
  [CertStatus.PENDING]: 'neutral',
  [CertStatus.ISSUING]: 'info',
  [CertStatus.ISSUED]: 'success',
  [CertStatus.FAILED]: 'danger',
  [CertStatus.RENEWING]: 'info',
  [CertStatus.REVOKING]: 'warning',
  [CertStatus.REVOKED]: 'danger',
};

export const STATUS_ORDER: Record<string, number> = {
  [CertStatus.AWAITING_CSR]: 0,
  [CertStatus.PENDING]: 1,
  [CertStatus.ISSUING]: 2,
  [CertStatus.ISSUED]: 3,
  [CertStatus.RENEWING]: 4,
  [CertStatus.REVOKING]: 5,
  [CertStatus.REVOKED]: 6,
  [CertStatus.FAILED]: 7,
};
