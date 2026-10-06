import api from './api';
import { API_ROUTES } from '@krakenkey/shared';
import type {
  NotificationChannel,
  CreateNotificationChannelRequest,
  CreateNotificationChannelResponse,
  UpdateNotificationChannelRequest,
  TestNotificationChannelResponse,
  RotateNotificationChannelSecretResponse,
} from '@krakenkey/shared';

export async function fetchNotificationChannels(): Promise<
  NotificationChannel[]
> {
  const response = await api.get<NotificationChannel[]>(
    API_ROUTES.NOTIFICATION_CHANNELS.BASE,
  );
  return response.data;
}

/** Webhook channels come back with `secret`, which is only sent this once. */
export async function createNotificationChannel(
  payload: CreateNotificationChannelRequest,
): Promise<CreateNotificationChannelResponse> {
  const response = await api.post<CreateNotificationChannelResponse>(
    API_ROUTES.NOTIFICATION_CHANNELS.BASE,
    payload,
  );
  return response.data;
}

/** Only the fields present in `changes` are sent. */
export async function updateNotificationChannel(
  id: string,
  changes: UpdateNotificationChannelRequest,
): Promise<NotificationChannel> {
  const response = await api.patch<NotificationChannel>(
    API_ROUTES.NOTIFICATION_CHANNELS.BY_ID(id),
    changes,
  );
  return response.data;
}

export async function deleteNotificationChannel(id: string): Promise<void> {
  await api.delete(API_ROUTES.NOTIFICATION_CHANNELS.BY_ID(id));
}

export async function testNotificationChannel(
  id: string,
): Promise<TestNotificationChannelResponse> {
  const response = await api.post<TestNotificationChannelResponse>(
    API_ROUTES.NOTIFICATION_CHANNELS.TEST(id),
  );
  return response.data;
}

export async function rotateNotificationChannelSecret(
  id: string,
): Promise<RotateNotificationChannelSecretResponse> {
  const response = await api.post<RotateNotificationChannelSecretResponse>(
    API_ROUTES.NOTIFICATION_CHANNELS.ROTATE_SECRET(id),
  );
  return response.data;
}
