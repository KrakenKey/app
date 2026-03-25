import api from './api';
import { API_ROUTES } from '@krakenkey/shared';
import type {
  Endpoint,
  EndpointHostedRegion,
  EndpointProbeAssignment,
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

export async function requestScan(id: string): Promise<Endpoint> {
  const response = await api.post<Endpoint>(API_ROUTES.ENDPOINTS.SCAN(id));
  return response.data;
}

export function getExportUrl(id: string, format: 'json' | 'csv'): string {
  return `${api.defaults.baseURL}${API_ROUTES.ENDPOINTS.EXPORT_RESULTS(id)}?format=${format}`;
}

/** Probe with basic metadata for the assignment picker */
export interface ProbeOption {
  id: string;
  name: string;
  mode: string;
  region?: string;
  status: string;
  lastSeenAt?: string;
}

export async function fetchUserProbes(): Promise<ProbeOption[]> {
  const response = await api.get<ProbeOption[]>(
    API_ROUTES.ENDPOINTS.PROBES_MINE,
  );
  return response.data;
}

export async function assignProbes(
  endpointId: string,
  probeIds: string[],
): Promise<EndpointProbeAssignment[]> {
  const response = await api.post<EndpointProbeAssignment[]>(
    API_ROUTES.ENDPOINTS.PROBES(endpointId),
    { probeIds },
  );
  return response.data;
}

export async function unassignProbe(
  endpointId: string,
  probeId: string,
): Promise<void> {
  await api.delete(API_ROUTES.ENDPOINTS.PROBE(endpointId, probeId));
}

export async function fetchLatestResults(
  id: string,
): Promise<ProbeScanResult[]> {
  const response = await api.get<ProbeScanResult[]>(
    API_ROUTES.ENDPOINTS.LATEST_RESULTS(id),
  );
  return response.data;
}
