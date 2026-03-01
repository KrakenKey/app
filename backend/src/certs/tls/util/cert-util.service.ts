import { Injectable } from '@nestjs/common';
import { X509Certificate } from 'crypto';

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
}
