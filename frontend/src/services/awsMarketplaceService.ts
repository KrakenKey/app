import api from './api';
import { API_ROUTES } from '@krakenkey/shared';
import type {
  AwsMarketplaceLandingResponse,
  AwsMarketplaceStatusResponse,
} from '@krakenkey/shared';

/** sessionStorage key that carries an AWS Marketplace registration across the sign-in redirect. */
export const PENDING_AWS_MARKETPLACE_REGISTRATION_KEY =
  'kk_pending_aws_marketplace_registration';

/**
 * sessionStorage key for the registration the landing page is working on,
 * so it can be taken out of the address bar (and browser history).
 */
export const AWS_MARKETPLACE_REGISTRATION_KEY =
  'kk_aws_marketplace_registration';

/** AWS Marketplace console page where buyers change or cancel their subscriptions. */
export const AWS_MARKETPLACE_CONSOLE_URL =
  'https://console.aws.amazon.com/marketplace/home#/subscriptions';

/** Why the fulfillment URL sent the buyer here without a purchase. */
export type AwsMarketplaceRegisterError =
  | 'missing_token'
  | 'invalid_token'
  | 'unknown_product'
  | 'unavailable';

const REGISTER_ERRORS: readonly string[] = [
  'missing_token',
  'invalid_token',
  'unknown_product',
  'unavailable',
];

/** The `registration` query parameter (base64url), or null. */
export function readAwsRegistration(search: string): string | null {
  const value = new URLSearchParams(search).get('registration');
  return value && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : null;
}

/** The `error` query parameter the fulfillment URL sets, or null. */
export function readAwsRegisterError(
  search: string,
): AwsMarketplaceRegisterError | null {
  const value = new URLSearchParams(search).get('error');
  return value && REGISTER_ERRORS.includes(value)
    ? (value as AwsMarketplaceRegisterError)
    : null;
}

export async function fetchAwsMarketplaceStatus(): Promise<AwsMarketplaceStatusResponse> {
  const response = await api.get<AwsMarketplaceStatusResponse>(
    API_ROUTES.BILLING.AWS_MARKETPLACE_STATUS,
  );
  return response.data;
}

export async function resolveAwsMarketplacePurchase(
  registration: string,
): Promise<AwsMarketplaceLandingResponse> {
  const response = await api.post<AwsMarketplaceLandingResponse>(
    API_ROUTES.BILLING.AWS_MARKETPLACE_RESOLVE,
    { registration },
  );
  return response.data;
}

export async function linkAwsMarketplacePurchase(
  registration: string,
): Promise<AwsMarketplaceLandingResponse> {
  const response = await api.post<AwsMarketplaceLandingResponse>(
    API_ROUTES.BILLING.AWS_MARKETPLACE_LINK,
    { registration },
  );
  return response.data;
}

/**
 * Unlinks an AWS Marketplace purchase that is still waiting for AWS from
 * the account. Nothing is canceled in AWS.
 */
export async function removePendingAwsPurchase(): Promise<void> {
  await api.delete(API_ROUTES.BILLING.AWS_MARKETPLACE_PENDING);
}

/**
 * The registration this visit is about: from the URL (which is then
 * cleaned, so the id doesn't stay in the address bar or history) or from
 * session storage on a reload.
 */
export function takeAwsRegistration(): string | null {
  const fromUrl = readAwsRegistration(window.location.search);
  if (fromUrl) {
    try {
      sessionStorage.setItem(AWS_MARKETPLACE_REGISTRATION_KEY, fromUrl);
    } catch {
      // Without storage a reload just asks to start again from AWS.
    }
    const url = new URL(window.location.href);
    url.searchParams.delete('registration');
    window.history.replaceState(
      window.history.state,
      '',
      `${url.pathname}${url.search}${url.hash}`,
    );
    return fromUrl;
  }
  try {
    const stored = sessionStorage.getItem(AWS_MARKETPLACE_REGISTRATION_KEY);
    return stored && readAwsRegistration(`?registration=${stored}`)
      ? stored
      : null;
  } catch {
    return null;
  }
}

/** Forgets the registration once it is linked (the API has used it up). */
export function forgetAwsRegistration(): void {
  try {
    sessionStorage.removeItem(AWS_MARKETPLACE_REGISTRATION_KEY);
  } catch {
    // nothing stored
  }
}
