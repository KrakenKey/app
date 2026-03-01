export interface DnsProvider {
  createRecord(domain: string, challengeToken: string): Promise<void>;
  removeRecord(domain: string): Promise<void>;
}
