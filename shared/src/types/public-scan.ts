export interface PublicScanRequest {
  hostname: string;
  port?: number;
}

export interface PublicScanConnection {
  success: boolean;
  error?: string;
  latencyMs?: number;
  tlsVersion?: string;
  cipherSuite?: string;
  ocspStapled?: boolean;
}

export interface PublicScanCertificate {
  subject?: string;
  sans?: string[];
  issuer?: string;
  serialNumber?: string;
  notBefore?: string;
  notAfter?: string;
  daysUntilExpiry?: number;
  keyType?: string;
  keySize?: number;
  signatureAlgorithm?: string;
  fingerprint?: string;
  chainDepth?: number;
  chainComplete?: boolean;
  trusted?: boolean;
}

export interface PublicScanResponse {
  endpoint: { host: string; port: number; sni: string };
  connection: PublicScanConnection;
  certificate?: PublicScanCertificate;
  scannedAt: string;
}
