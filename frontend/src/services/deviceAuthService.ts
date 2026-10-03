import api from './api';
import { API_ROUTES } from '@krakenkey/shared';
import type { DeviceAuthRequestInfo } from '@krakenkey/shared';

/** sessionStorage key that carries a CLI login code across the sign-in redirect. */
export const PENDING_DEVICE_CODE_KEY = 'kk_pending_device_code';

export async function fetchDeviceRequest(
  userCode: string,
): Promise<DeviceAuthRequestInfo> {
  const response = await api.get<DeviceAuthRequestInfo>(
    API_ROUTES.DEVICE_AUTH.REQUEST(userCode),
  );
  return response.data;
}

export async function approveDevice(userCode: string): Promise<void> {
  await api.post(API_ROUTES.DEVICE_AUTH.APPROVE, { userCode });
}

export async function denyDevice(userCode: string): Promise<void> {
  await api.post(API_ROUTES.DEVICE_AUTH.DENY, { userCode });
}
