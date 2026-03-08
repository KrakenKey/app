import { CertStatus } from '@krakenkey/shared';

export const STATUS_LABEL: Record<CertStatus, string> = {
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
  [CertStatus.PENDING]: 'neutral',
  [CertStatus.ISSUING]: 'info',
  [CertStatus.ISSUED]: 'success',
  [CertStatus.FAILED]: 'danger',
  [CertStatus.RENEWING]: 'info',
  [CertStatus.REVOKING]: 'warning',
  [CertStatus.REVOKED]: 'danger',
};

export const STATUS_ORDER: Record<string, number> = {
  [CertStatus.PENDING]: 0,
  [CertStatus.ISSUING]: 1,
  [CertStatus.ISSUED]: 2,
  [CertStatus.RENEWING]: 3,
  [CertStatus.REVOKING]: 4,
  [CertStatus.REVOKED]: 5,
  [CertStatus.FAILED]: 6,
};
