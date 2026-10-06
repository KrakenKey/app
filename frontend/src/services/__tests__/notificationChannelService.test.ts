import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { API_URL } from '../api';
import {
  createNotificationChannel,
  deleteNotificationChannel,
  fetchNotificationChannels,
  rotateNotificationChannelSecret,
  testNotificationChannel,
  updateNotificationChannel,
} from '../notificationChannelService';

const BASE = `${API_URL}/notifications/channels`;

describe('notificationChannelService', () => {
  it('lists channels', async () => {
    server.use(http.get(BASE, () => HttpResponse.json([{ id: 'c1' }])));
    await expect(fetchNotificationChannels()).resolves.toEqual([{ id: 'c1' }]);
  });

  it('posts a new channel and returns the one-time secret', async () => {
    let posted: unknown = null;
    server.use(
      http.post(BASE, async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json(
          { id: 'c1', type: 'webhook', secret: 'whsec_x' },
          { status: 201 },
        );
      }),
    );

    const created = await createNotificationChannel({
      type: 'webhook',
      name: 'SIEM',
      url: 'https://hooks.example.com/kk',
      events: ['cert.failed'],
    });

    expect(posted).toEqual({
      type: 'webhook',
      name: 'SIEM',
      url: 'https://hooks.example.com/kk',
      events: ['cert.failed'],
    });
    expect(created.secret).toBe('whsec_x');
  });

  it('patches only the given fields', async () => {
    let patched: unknown = null;
    server.use(
      http.patch(`${BASE}/c1`, async ({ request }) => {
        patched = await request.json();
        return HttpResponse.json({ id: 'c1', enabled: false });
      }),
    );

    await updateNotificationChannel('c1', { enabled: false });
    expect(patched).toEqual({ enabled: false });
  });

  it('deletes a channel', async () => {
    let called = false;
    server.use(
      http.delete(`${BASE}/c1`, () => {
        called = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await deleteNotificationChannel('c1');
    expect(called).toBe(true);
  });

  it('sends a test and returns the result', async () => {
    server.use(
      http.post(`${BASE}/c1/test`, () =>
        HttpResponse.json({ ok: true, status: 200, error: null }),
      ),
    );
    await expect(testNotificationChannel('c1')).resolves.toEqual({
      ok: true,
      status: 200,
      error: null,
    });
  });

  it('rotates a webhook secret', async () => {
    server.use(
      http.post(`${BASE}/c1/rotate-secret`, () =>
        HttpResponse.json({ secret: 'whsec_new' }),
      ),
    );
    await expect(rotateNotificationChannelSecret('c1')).resolves.toEqual({
      secret: 'whsec_new',
    });
  });
});
