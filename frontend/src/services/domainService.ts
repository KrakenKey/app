import api from './api';
import { API_ROUTES } from '@krakenkey/shared';
import type { Domain, CreateDomainRequest } from '@krakenkey/shared';

export async function fetchDomains(): Promise<Domain[]> {
  const response = await api.get<Domain[]>(API_ROUTES.DOMAINS.BASE);
  return response.data;
}

export async function addDomain(hostname: string): Promise<Domain> {
  const payload: CreateDomainRequest = { hostname };
  const response = await api.post<Domain>(API_ROUTES.DOMAINS.BASE, payload);
  return response.data;
}

export async function verifyDomain(id: string): Promise<Domain> {
  const response = await api.post<Domain>(API_ROUTES.DOMAINS.VERIFY(id));
  return response.data;
}

export async function deleteDomain(id: string): Promise<void> {
  await api.delete(API_ROUTES.DOMAINS.DELETE(id));
}
