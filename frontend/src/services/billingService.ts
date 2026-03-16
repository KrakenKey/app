import api from './api';
import { API_ROUTES } from '@krakenkey/shared';
import type {
  Subscription,
  CheckoutResponse,
  PortalResponse,
  UpgradePreviewResponse,
  UpgradeResponse,
} from '@krakenkey/shared';

export async function fetchSubscription(): Promise<Subscription> {
  const response = await api.get<Subscription>(API_ROUTES.BILLING.SUBSCRIPTION);
  return response.data;
}

export async function createCheckout(plan: string): Promise<CheckoutResponse> {
  const response = await api.post<CheckoutResponse>(
    API_ROUTES.BILLING.CHECKOUT,
    { plan },
  );
  return response.data;
}

export async function createPortalSession(): Promise<PortalResponse> {
  const response = await api.post<PortalResponse>(API_ROUTES.BILLING.PORTAL);
  return response.data;
}

export async function previewUpgrade(
  plan: string,
): Promise<UpgradePreviewResponse> {
  const response = await api.post<UpgradePreviewResponse>(
    API_ROUTES.BILLING.UPGRADE_PREVIEW,
    { plan },
  );
  return response.data;
}

export async function upgradeSubscription(
  plan: string,
): Promise<UpgradeResponse> {
  const response = await api.post<UpgradeResponse>(API_ROUTES.BILLING.UPGRADE, {
    plan,
  });
  return response.data;
}
