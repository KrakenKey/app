import api from './api';
import { API_ROUTES } from '@krakenkey/shared';
import type { ApiKey, CreateApiKeyResponse } from '@krakenkey/shared';

export async function fetchApiKeys(): Promise<ApiKey[]> {
  const response = await api.get<ApiKey[]>(API_ROUTES.API_KEYS.BASE);
  return response.data;
}

export async function createApiKey(
  name: string,
  expiresAt?: string,
): Promise<CreateApiKeyResponse> {
  const payload: { name: string; expiresAt?: string } = { name };
  if (expiresAt) {
    payload.expiresAt = new Date(expiresAt + 'T23:59:59Z').toISOString();
  }
  const response = await api.post<CreateApiKeyResponse>(
    API_ROUTES.API_KEYS.BASE,
    payload,
  );
  return response.data;
}

export async function deleteApiKey(id: string): Promise<void> {
  await api.delete(API_ROUTES.API_KEYS.BY_ID(id));
}
