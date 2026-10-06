import api from './api';
import { API_ROUTES } from '@krakenkey/shared';
import type {
  CreateGithubOidcTrustRequest,
  GithubOidcTrust,
} from '@krakenkey/shared';

export async function fetchGithubOidcTrusts(): Promise<GithubOidcTrust[]> {
  const response = await api.get<GithubOidcTrust[]>(
    API_ROUTES.AUTH.GITHUB_OIDC_TRUSTS,
  );
  return response.data;
}

/**
 * Creates a trust policy. Optional fields that are blank or empty are left
 * out of the request, so the policy doesn't limit that respect.
 */
export async function createGithubOidcTrust(
  request: CreateGithubOidcTrustRequest,
): Promise<GithubOidcTrust> {
  const payload: CreateGithubOidcTrustRequest = {
    name: request.name,
    repository: request.repository,
  };
  if (request.allowedRefs?.length) payload.allowedRefs = request.allowedRefs;
  const environment = request.environment?.trim();
  if (environment) payload.environment = environment;
  if (request.scopes) payload.scopes = request.scopes;
  if (request.allowedDomainIds?.length) {
    payload.allowedDomainIds = request.allowedDomainIds;
  }
  if (request.allowedCertIds?.length) {
    payload.allowedCertIds = request.allowedCertIds;
  }
  const response = await api.post<GithubOidcTrust>(
    API_ROUTES.AUTH.GITHUB_OIDC_TRUSTS,
    payload,
  );
  return response.data;
}

export async function deleteGithubOidcTrust(id: string): Promise<void> {
  await api.delete(API_ROUTES.AUTH.GITHUB_OIDC_TRUST_BY_ID(id));
}
