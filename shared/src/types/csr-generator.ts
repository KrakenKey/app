/**
 * Shared types for CSR (Certificate Signing Request) generator feature
 */

/**
 * Supported cryptographic key types for CSR generation
 */
export type KeyType = 'RSA-2048' | 'RSA-4096' | 'ECDSA-P256' | 'ECDSA-P384';

/**
 * X.509 subject fields for CSR
 */
export interface CsrSubjectFields {
  commonName: string;           // CN - required (must be a verified domain)
  organization?: string;        // O - optional
  organizationalUnit?: string;  // OU - optional
  locality?: string;            // L - optional (city)
  state?: string;               // ST - optional (state/province)
  country?: string;             // C - optional (2-letter ISO code, e.g., "US")
}

/**
 * Subject Alternative Names (SANs) for CSR
 * These provide additional identities for the certificate
 */
export interface CsrSanFields {
  dnsNames: string[];           // DNS SANs (e.g., ["www.example.com", "api.example.com"])
  ipAddresses: string[];        // IP SANs (IPv4 or IPv6, e.g., ["192.168.1.1", "2001:db8::1"])
  emailAddresses: string[];     // Email SANs (e.g., ["admin@example.com"])
}

/**
 * Result of CSR generation (client-side only)
 * Contains both the CSR and the private key
 */
export interface GeneratedCsrResult {
  csrPem: string;               // PEM-encoded CSR (shareable, submitted to server)
  privateKeyPem: string;        // PEM-encoded private key (SENSITIVE - user must save)
  publicKeyPem: string;         // PEM-encoded public key (for user reference)
  algorithm: string;            // e.g., "RSA" or "ECDSA"
  keySize: number;              // Bit length (e.g., 2048, 4096, 256, 384)
  keyType: KeyType;             // Original key type selection
}

/**
 * Parsed CSR preview data (human-readable representation)
 */
export interface CsrPreviewData {
  commonName: string;
  sans: string[];               // All SANs combined (DNS, IP, email)
  keyType: string;              // e.g., "ECDSA P-384"
  keySize: number;              // Bit length
  securityLevel: string;        // e.g., "~7600-bit RSA equivalent"
}

/**
 * Server-side parsed CSR stored as JSONB in the database.
 * Produced by csr-util.service.ts validateAndParse().
 */
export interface ParsedCsr {
  subject: ParsedCsrAttribute[];
  attributes: ParsedCsrAttribute[];
  publicKey: ParsedCsrPublicKey;
  extensions: ParsedCsrExtension[];
}

export interface ParsedCsrAttribute {
  name: string | undefined;
  shortName?: string;
  value: unknown;
}

export interface ParsedCsrPublicKey {
  keyType: string;
  bitLength: number;
  [key: string]: unknown;       // RSA: n (hex), e (decimal); ECDSA: curve, curveOid
}

export interface ParsedCsrExtension {
  name: string | undefined;
  altNames: ParsedCsrAltName[];
}

export interface ParsedCsrAltName {
  type: number;                 // 2 = DNS, 7 = IP, 1 = email
  value: string;
}
