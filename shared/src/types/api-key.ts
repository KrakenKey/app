/**
 * Scopes an API key can be limited to. A key with `scopes: null` has full
 * access (every scope, including any added later); that is the default and
 * what every key created before scopes existed has.
 */
export const API_KEY_SCOPES = [
  'certs:read',
  'certs:issue',
  'certs:renew',
  'certs:revoke',
  'domains:read',
  'domains:write',
  'endpoints:read',
  'endpoints:write',
  'probes:report',
  'account:read',
  'account:write',
] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

/** What each scope allows, for the dashboard and CLI help. */
export const API_KEY_SCOPE_DESCRIPTIONS: Record<ApiKeyScope, string> = {
  'certs:read': 'List and show certificates, download the chain',
  'certs:issue': 'Submit CSRs and retry failed issuance',
  'certs:renew': 'Renew certificates and change auto-renew',
  'certs:revoke': 'Revoke and delete certificates',
  'domains:read': 'List and show domains',
  'domains:write': 'Add, verify and delete domains',
  'endpoints:read': 'List monitored endpoints and scan results',
  'endpoints:write':
    'Add, change and delete monitored endpoints, request scans',
  'probes:report': 'Register a connected probe and report scan results',
  'account:read':
    'Show the profile, plan, organization, API key list and notification channels',
  'account:write':
    'Change profile settings, manage notification channels and send feedback',
};

export type ApiKeyPreset = 'full' | 'read-only' | 'cert-renewal' | 'probe';

/** Scope sets offered by the dashboard and `krakenkey auth keys create`. */
export const API_KEY_PRESETS: Record<ApiKeyPreset, ApiKeyScope[] | null> = {
  full: null,
  'read-only': ['certs:read', 'domains:read', 'endpoints:read', 'account:read'],
  'cert-renewal': ['certs:read', 'certs:renew', 'account:read'],
  probe: ['probes:report'],
};

/** Upper bounds on the restriction lists accepted at key creation. */
export const API_KEY_RESTRICTION_LIMITS = {
  domains: 50,
  certs: 50,
  ips: 20,
} as const;

export interface ApiKey {
  id: string;
  name: string;
  createdAt: string;
  expiresAt: string | null;
  /** Set once the key is revoked. Only listed with includeRevoked. */
  revokedAt: string | null;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  /** null = full access. */
  scopes: ApiKeyScope[] | null;
  /** null = every domain the account can use. */
  allowedDomainIds: string[] | null;
  /** null = every certificate the account can use. */
  allowedCertIds: number[] | null;
  /** IPs or CIDR ranges the key may be used from; null = anywhere. */
  allowedIps: string[] | null;
}

export interface CreateApiKeyRequest {
  name: string;
  expiresAt?: string;
  /** Omit for full access. Fixed once the key is created. */
  scopes?: ApiKeyScope[];
  allowedDomainIds?: string[];
  allowedCertIds?: number[];
  allowedIps?: string[];
}

export interface CreateApiKeyResponse {
  apiKey: string;
  id: string;
  name: string;
  scopes: ApiKeyScope[] | null;
  allowedDomainIds: string[] | null;
  allowedCertIds: number[] | null;
  allowedIps: string[] | null;
}

export interface DeleteApiKeyResponse {
  message: string;
}
