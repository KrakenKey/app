export interface ApiKey {
  id: string;
  name: string;
  createdAt: string;
  expiresAt: string | null;
  /** Set once the key is revoked. Only listed with includeRevoked. */
  revokedAt: string | null;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
}

export interface CreateApiKeyRequest {
  name: string;
  expiresAt?: string;
}

export interface CreateApiKeyResponse {
  apiKey: string;
  id: string;
  name: string;
}

export interface DeleteApiKeyResponse {
  message: string;
}
