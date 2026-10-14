import api from './api';
import { API_ROUTES } from '@krakenkey/shared';
import type {
  BillingInterval,
  Subscription,
  CheckoutResponse,
  PlansResponse,
  PortalResponse,
  UpgradePreviewResponse,
  UpgradeResponse,
} from '@krakenkey/shared';

export async function fetchSubscription(): Promise<Subscription> {
  const response = await api.get<Subscription>(API_ROUTES.BILLING.SUBSCRIPTION);
  return response.data;
}

/** Plans and intervals with a Stripe price on this installation. */
export async function fetchPlans(): Promise<PlansResponse> {
  const response = await api.get<PlansResponse>(API_ROUTES.BILLING.PLANS);
  return response.data;
}

export async function createCheckout(
  plan: string,
  interval: BillingInterval = 'month',
): Promise<CheckoutResponse> {
  const response = await api.post<CheckoutResponse>(
    API_ROUTES.BILLING.CHECKOUT,
    { plan, interval },
  );
  return response.data;
}

/**
 * The Stripe billing portal; `switch_interval` opens it on confirming a
 * switch between monthly and yearly billing.
 */
export async function createPortalSession(
  flow?: 'switch_interval',
): Promise<PortalResponse> {
  const response = await api.post<PortalResponse>(
    API_ROUTES.BILLING.PORTAL,
    flow ? { flow } : {},
  );
  return response.data;
}

export async function previewUpgrade(
  plan: string,
  interval?: BillingInterval,
): Promise<UpgradePreviewResponse> {
  const response = await api.post<UpgradePreviewResponse>(
    API_ROUTES.BILLING.UPGRADE_PREVIEW,
    { plan, interval },
  );
  return response.data;
}

export async function upgradeSubscription(
  plan: string,
  interval?: BillingInterval,
): Promise<UpgradeResponse> {
  const response = await api.post<UpgradeResponse>(API_ROUTES.BILLING.UPGRADE, {
    plan,
    interval,
  });
  return response.data;
}
