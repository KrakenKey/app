import type { ApiKeyScope } from './api-key';

/** Issuer of GitHub Actions OIDC tokens. */
export const GITHUB_OIDC_ISSUER = 'https://token.actions.githubusercontent.com';

/** Lifetime of a key minted by a GitHub OIDC exchange, in seconds. */
export const GITHUB_OIDC_KEY_TTL_SECONDS = 15 * 60;

export interface GithubOidcTrust {
  id: string;
  name: string;
  /** `owner/name`. */
  repository: string;
  /** Pinned from the first token; null until then. */
  repositoryId: string | null;
  allowedRefs: string[] | null;
  environment: string | null;
  scopes: ApiKeyScope[] | null;
  allowedDomainIds: string[] | null;
  allowedCertIds: number[] | null;
  lastUsedAt: string | null;
  lastUsedRef: string | null;
  createdAt: string;
}

export interface CreateGithubOidcTrustRequest {
  name: string;
  repository: string;
  allowedRefs?: string[];
  environment?: string;
  scopes?: ApiKeyScope[];
  allowedDomainIds?: string[];
  allowedCertIds?: number[];
}

export interface GithubOidcExchangeRequest {
  /** The GitHub Actions OIDC JWT. */
  token: string;
  /** Needed only when more than one trust policy matches the repository. */
  trustId?: string;
}

export interface GithubOidcExchangeResponse {
  apiKey: string;
  expiresAt: string;
  trustId: string;
  scopes: ApiKeyScope[] | null;
}
