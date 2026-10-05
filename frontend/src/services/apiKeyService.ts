import api from './api';
import { API_ROUTES } from '@krakenkey/shared';
import type {
  ApiKey,
  CreateApiKeyRequest,
  CreateApiKeyResponse,
} from '@krakenkey/shared';

/** Active keys plus those revoked in the last 30 days. */
export async function fetchApiKeys(): Promise<ApiKey[]> {
  const response = await api.get<ApiKey[]>(API_ROUTES.API_KEYS.BASE, {
    params: { includeRevoked: true },
  });
  return response.data;
}

/**
 * Limits for a new key. An omitted or empty field leaves the key
 * unrestricted in that respect, so it is left out of the request.
 */
export type ApiKeyAccess = Pick<
  CreateApiKeyRequest,
  'scopes' | 'allowedDomainIds' | 'allowedCertIds' | 'allowedIps'
>;

export async function createApiKey(
  name: string,
  expiresAt?: string,
  access: ApiKeyAccess = {},
): Promise<CreateApiKeyResponse> {
  const payload: CreateApiKeyRequest = { name };
  if (expiresAt) {
    payload.expiresAt = new Date(expiresAt + 'T23:59:59Z').toISOString();
  }
  if (access.scopes) payload.scopes = access.scopes;
  if (access.allowedDomainIds?.length) {
    payload.allowedDomainIds = access.allowedDomainIds;
  }
  if (access.allowedCertIds?.length) {
    payload.allowedCertIds = access.allowedCertIds;
  }
  if (access.allowedIps?.length) payload.allowedIps = access.allowedIps;
  const response = await api.post<CreateApiKeyResponse>(
    API_ROUTES.API_KEYS.BASE,
    payload,
  );
  return response.data;
}

export async function revokeApiKey(id: string): Promise<void> {
  await api.delete(API_ROUTES.API_KEYS.BY_ID(id));
}
