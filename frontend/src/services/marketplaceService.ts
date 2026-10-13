import api from './api';
import { API_ROUTES } from '@krakenkey/shared';
import type {
  MarketplaceLandingResponse,
  MarketplaceStatusResponse,
} from '@krakenkey/shared';

/** sessionStorage key that carries a Marketplace purchase token across the sign-in redirect. */
export const PENDING_MARKETPLACE_TOKEN_KEY = 'kk_pending_marketplace_token';

/**
 * Azure portal list of SaaS subscriptions, where Marketplace customers
 * change their plan, update payment or cancel.
 */
export const AZURE_PORTAL_SAAS_URL =
  'https://portal.azure.com/#view/HubsExtension/BrowseResource/resourceType/Microsoft.SaaS%2Fresources';

/**
 * The `token` query parameter, percent-decoded only. URLSearchParams would
 * also turn "+" into a space, which corrupts a token that has one.
 */
export function readMarketplaceToken(search: string): string | null {
  const match = /[?&]token=([^&#]*)/.exec(search);
  if (!match || !match[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

export async function fetchMarketplaceStatus(): Promise<MarketplaceStatusResponse> {
  const response = await api.get<MarketplaceStatusResponse>(
    API_ROUTES.BILLING.MARKETPLACE_STATUS,
  );
  return response.data;
}

export async function resolveMarketplacePurchase(
  token: string,
): Promise<MarketplaceLandingResponse> {
  const response = await api.post<MarketplaceLandingResponse>(
    API_ROUTES.BILLING.MARKETPLACE_RESOLVE,
    { token },
  );
  return response.data;
}

export async function activateMarketplacePurchase(
  token: string,
): Promise<MarketplaceLandingResponse> {
  const response = await api.post<MarketplaceLandingResponse>(
    API_ROUTES.BILLING.MARKETPLACE_ACTIVATE,
    { token },
  );
  return response.data;
}
