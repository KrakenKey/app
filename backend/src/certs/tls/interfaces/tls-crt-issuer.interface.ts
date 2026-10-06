import { DnsProvider } from './dns-provider.interface';

export interface CertIssuerStrategy {
  issue(
    csrPem: string,
    dnsProvider: DnsProvider,
    options?: { replaces?: string | null },
  ): Promise<string>;
  revoke(certPem: string, reason?: number): Promise<void>;
}
