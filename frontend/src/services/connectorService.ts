import api from './api';
import { API_ROUTES } from '@krakenkey/shared';
import type {
  Connector,
  ConnectorDeployment,
  ConnectorEnrollmentTokenResponse,
  CreateConnectorRequest,
  CreateConnectorResponse,
  UpdateConnectorRequest,
} from '@krakenkey/shared';

/** Every connector, revoked ones included, with deployment counts. */
export async function fetchConnectors(): Promise<Connector[]> {
  const response = await api.get<Connector[]>(API_ROUTES.CONNECTORS.BASE);
  return response.data;
}

/** One connector with every target it last reported. */
export async function fetchConnector(id: string): Promise<Connector> {
  const response = await api.get<Connector>(API_ROUTES.CONNECTORS.BY_ID(id));
  return response.data;
}

/**
 * Creates a connector. Empty restriction lists and a blank client label are
 * left out of the request.
 */
export async function createConnector(
  request: CreateConnectorRequest,
): Promise<CreateConnectorResponse> {
  const payload: CreateConnectorRequest = {
    name: request.name,
    scopes: request.scopes,
  };
  const clientLabel = request.clientLabel?.trim();
  if (clientLabel) payload.clientLabel = clientLabel;
  if (request.allowedCertIds?.length) {
    payload.allowedCertIds = request.allowedCertIds;
  }
  if (request.allowedDomainIds?.length) {
    payload.allowedDomainIds = request.allowedDomainIds;
  }
  const response = await api.post<CreateConnectorResponse>(
    API_ROUTES.CONNECTORS.BASE,
    payload,
  );
  return response.data;
}

export async function updateConnector(
  id: string,
  changes: UpdateConnectorRequest,
): Promise<Connector> {
  const response = await api.patch<Connector>(
    API_ROUTES.CONNECTORS.BY_ID(id),
    changes,
  );
  return response.data;
}

/** Revokes the connector and every key it was issued. */
export async function revokeConnector(id: string): Promise<void> {
  await api.delete(API_ROUTES.CONNECTORS.BY_ID(id));
}

/** A fresh enrollment token and its expiry; any earlier token stops working. */
export async function newEnrollmentToken(
  id: string,
): Promise<ConnectorEnrollmentTokenResponse> {
  const response = await api.post<ConnectorEnrollmentTokenResponse>(
    API_ROUTES.CONNECTORS.ENROLLMENT_TOKEN(id),
  );
  return response.data;
}

/** Where one certificate is deployed, across the user's active connectors. */
export async function fetchCertificateDeployments(
  certificateId: number,
): Promise<ConnectorDeployment[]> {
  const response = await api.get<ConnectorDeployment[]>(
    API_ROUTES.CONNECTORS.DEPLOYMENTS,
    { params: { certificateId } },
  );
  return response.data;
}
