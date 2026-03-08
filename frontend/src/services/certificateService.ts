import api from './api';
import { API_ROUTES } from '@krakenkey/shared';
import type {
  TlsCert,
  TlsCertDetails,
  CreateTlsCertRequest,
  CreateTlsCertResponse,
  RenewTlsCertResponse,
  RetryTlsCertResponse,
  RevokeTlsCertRequest,
  RevokeTlsCertResponse,
  DeleteTlsCertResponse,
} from '@krakenkey/shared';

export async function fetchCertificates(): Promise<TlsCert[]> {
  const response = await api.get<TlsCert[]>(API_ROUTES.TLS_CERTS.BASE);
  return response.data;
}

export async function fetchCertificate(id: number): Promise<TlsCert> {
  const response = await api.get<TlsCert>(
    API_ROUTES.TLS_CERTS.BY_ID(String(id)),
  );
  return response.data;
}

export async function fetchCertificateDetails(
  id: number,
): Promise<TlsCertDetails> {
  const response = await api.get<TlsCertDetails>(
    API_ROUTES.TLS_CERTS.DETAILS(String(id)),
  );
  return response.data;
}

export async function submitCsr(
  csrPem: string,
): Promise<CreateTlsCertResponse> {
  const payload: CreateTlsCertRequest = { csrPem };
  const response = await api.post<CreateTlsCertResponse>(
    API_ROUTES.TLS_CERTS.BASE,
    payload,
  );
  return response.data;
}

export async function renewCertificate(
  id: number,
): Promise<RenewTlsCertResponse> {
  const response = await api.post<RenewTlsCertResponse>(
    API_ROUTES.TLS_CERTS.RENEW(String(id)),
  );
  return response.data;
}

export async function retryCertificate(
  id: number,
): Promise<RetryTlsCertResponse> {
  const response = await api.post<RetryTlsCertResponse>(
    API_ROUTES.TLS_CERTS.RETRY(String(id)),
  );
  return response.data;
}

export async function revokeCertificate(
  id: number,
  request: RevokeTlsCertRequest = {},
): Promise<RevokeTlsCertResponse> {
  const response = await api.post<RevokeTlsCertResponse>(
    API_ROUTES.TLS_CERTS.REVOKE(String(id)),
    request,
  );
  return response.data;
}

export async function deleteCertificate(
  id: number,
): Promise<DeleteTlsCertResponse> {
  const response = await api.delete<DeleteTlsCertResponse>(
    API_ROUTES.TLS_CERTS.DELETE(String(id)),
  );
  return response.data;
}

export async function updateCertificate(
  id: number,
  data: { autoRenew?: boolean },
): Promise<void> {
  await api.patch(API_ROUTES.TLS_CERTS.BY_ID(String(id)), data);
}
