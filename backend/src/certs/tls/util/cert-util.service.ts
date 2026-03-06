import { Injectable } from '@nestjs/common';
import { X509Certificate } from 'crypto';
import type { TlsCertDetails } from '@krakenkey/shared';

@Injectable()
export class CertUtilService {
  /**
   * Extracts the expiration date from a PEM-encoded certificate
   * @param certPem PEM-encoded certificate
   * @returns Expiration date (notAfter field from certificate)
   * @throws Error if certificate cannot be parsed
   */
  getExpirationDate(certPem: string): Date {
    try {
      const cert = new X509Certificate(certPem);
      return new Date(cert.validTo);
    } catch (error: unknown) {
      if (error instanceof Error) {
        throw new Error(`Failed to parse certificate: ${error.message}`);
      }
      throw new Error('Failed to parse certificate: Unknown error');
    }
  }

  /**
   * Checks if a certificate is expiring soon (within threshold days)
   * @param expiresAt Certificate expiration date
   * @param thresholdDays Number of days threshold (default: 30)
   * @returns true if certificate expires within threshold days
   */
  isExpiringSoon(expiresAt: Date, thresholdDays: number = 30): boolean {
    const now = new Date();
    const daysUntilExpiry =
      (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    return daysUntilExpiry <= thresholdDays && daysUntilExpiry >= 0;
  }

  /**
   * Checks if a certificate has already expired
   * @param expiresAt Certificate expiration date
   * @returns true if certificate has expired
   */
  isExpired(expiresAt: Date): boolean {
    return expiresAt.getTime() < Date.now();
  }

  private curveToKeySize(curve?: string): number {
    const sizes: Record<string, number> = {
      'prime256v1': 256,
      'secp384r1': 384,
      'secp521r1': 521,
    };
    return curve ? (sizes[curve] ?? 0) : 0;
  }

  getDetails(certPem: string): TlsCertDetails {
    try {
      const cert = new X509Certificate(certPem);
      const keyType =
        cert.publicKey.asymmetricKeyType?.toUpperCase() ?? 'UNKNOWN';
      const details = cert.publicKey.asymmetricKeyDetails;
      const keySize =
        (details as { modulusLength?: number })?.modulusLength ??
        this.curveToKeySize(
          (details as { namedCurve?: string })?.namedCurve,
        );

      return {
        serialNumber: cert.serialNumber,
        issuer: cert.issuer.replace(/\n/g, ', '),
        subject: cert.subject.replace(/\n/g, ', '),
        validFrom: new Date(cert.validFrom).toISOString(),
        validTo: new Date(cert.validTo).toISOString(),
        keyType,
        keySize,
        fingerprint: cert.fingerprint256,
      };
    } catch (error: unknown) {
      if (error instanceof Error) {
        throw new Error(
          `Failed to parse certificate details: ${error.message}`,
        );
      }
      throw new Error('Failed to parse certificate details: Unknown error');
    }
  }
}
