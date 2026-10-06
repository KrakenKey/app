/** Fields of a scan result that decide whether the endpoint is failing. */
export interface ScanHealthFields {
  connectionSuccess: boolean;
  connectionError?: string | null;
  certChainComplete?: boolean | null;
  certTrusted?: boolean | null;
  certNotAfter?: Date | null;
  certDaysUntilExpiry?: number | null;
  scannedAt?: Date;
}

/**
 * Why a scan counts as failing, or null when it is healthy: the connection
 * failed, the chain is incomplete or untrusted, or the certificate has
 * expired.
 */
export function scanFailureReason(r: ScanHealthFields): string | null {
  if (!r.connectionSuccess) {
    return r.connectionError
      ? `Connection failed: ${r.connectionError.slice(0, 200)}`
      : 'Connection failed';
  }
  const at = r.scannedAt ?? new Date();
  if (
    (r.certNotAfter && new Date(r.certNotAfter) <= at) ||
    (typeof r.certDaysUntilExpiry === 'number' && r.certDaysUntilExpiry < 0)
  ) {
    return 'Certificate has expired';
  }
  if (r.certChainComplete === false) return 'Certificate chain is incomplete';
  if (r.certTrusted === false) return 'Certificate chain is not trusted';
  return null;
}
