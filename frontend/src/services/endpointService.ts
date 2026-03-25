import api from './api';
import { API_ROUTES } from '@krakenkey/shared';
import type {
  Endpoint,
  EndpointHostedRegion,
  CreateEndpointRequest,
  UpdateEndpointRequest,
  AddHostedRegionRequest,
  ProbeScanResult,
} from '@krakenkey/shared';

export async function fetchEndpoints(): Promise<Endpoint[]> {
  const response = await api.get<Endpoint[]>(API_ROUTES.ENDPOINTS.BASE);
  return response.data;
}

export async function fetchEndpoint(id: string): Promise<Endpoint> {
  const response = await api.get<Endpoint>(API_ROUTES.ENDPOINTS.BY_ID(id));
  return response.data;
}

export async function createEndpoint(
  req: CreateEndpointRequest,
): Promise<Endpoint> {
  const response = await api.post<Endpoint>(API_ROUTES.ENDPOINTS.BASE, req);
  return response.data;
}

export async function updateEndpoint(
  id: string,
  req: UpdateEndpointRequest,
): Promise<Endpoint> {
  const response = await api.patch<Endpoint>(
    API_ROUTES.ENDPOINTS.BY_ID(id),
    req,
  );
  return response.data;
}

export async function deleteEndpoint(id: string): Promise<void> {
  await api.delete(API_ROUTES.ENDPOINTS.BY_ID(id));
}

export async function addHostedRegion(
  id: string,
  region: string,
): Promise<EndpointHostedRegion> {
  const payload: AddHostedRegionRequest = { region };
  const response = await api.post<EndpointHostedRegion>(
    API_ROUTES.ENDPOINTS.REGIONS(id),
    payload,
  );
  return response.data;
}

export async function removeHostedRegion(
  id: string,
  region: string,
): Promise<void> {
  await api.delete(API_ROUTES.ENDPOINTS.REGION(id, region));
}

export async function fetchResults(
  id: string,
  page = 1,
  limit = 20,
): Promise<{ data: ProbeScanResult[]; total: number }> {
  const response = await api.get<{ data: ProbeScanResult[]; total: number }>(
    API_ROUTES.ENDPOINTS.RESULTS(id),
    { params: { page, limit } },
  );
  return response.data;
}

export function getExportUrl(id: string, format: 'json' | 'csv'): string {
  return `${api.defaults.baseURL}${API_ROUTES.ENDPOINTS.EXPORT_RESULTS(id)}?format=${format}`;
}

export async function fetchLatestResults(
  id: string,
): Promise<ProbeScanResult[]> {
  const response = await api.get<ProbeScanResult[]>(
    API_ROUTES.ENDPOINTS.LATEST_RESULTS(id),
  );
  return response.data;
}
