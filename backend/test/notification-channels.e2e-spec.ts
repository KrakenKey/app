import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { NotificationChannelsController } from '../src/notifications/channels/notification-channels.controller';
import { NotificationChannelsService } from '../src/notifications/channels/notification-channels.service';
import { ChannelDeliveryService } from '../src/notifications/channels/channel-delivery.service';
import { NotificationChannel } from '../src/notifications/channels/entities/notification-channel.entity';
import { postJson } from '../src/notifications/channels/http-post';
import { createTestApp } from './helpers/create-test-app';
import { MOCK_USER } from './helpers/mock-data';

jest.mock('../src/notifications/channels/http-post', () => {
  const actual = jest.requireActual('../src/notifications/channels/http-post');
  return { ...actual, postJson: jest.fn() };
});
const mockedPost = postJson as jest.MockedFunction<typeof postJson>;

const SLACK_URL = 'https://hooks.slack.com/services/T000/B000/SECRETTOKEN9';
// A public IP literal, so the webhook check needs no DNS in tests.
const WEBHOOK_URL = 'https://93.184.216.34/kk-hook?token=abcd1234';

/** Minimal in-memory TypeORM repository for NotificationChannel. */
function memoryRepo() {
  let rows: NotificationChannel[] = [];
  const matches = (row: NotificationChannel, where: Record<string, unknown>) =>
    Object.entries(where).every(
      ([k, v]) => (row as unknown as Record<string, unknown>)[k] === v,
    );
  return {
    rows: () => rows,
    reset: () => (rows = []),
    seed: (row: Partial<NotificationChannel>) =>
      rows.push({ ...(row as NotificationChannel) }),
    find: jest.fn(({ where }) =>
      Promise.resolve(rows.filter((r) => matches(r, where))),
    ),
    count: jest.fn(({ where }) =>
      Promise.resolve(rows.filter((r) => matches(r, where)).length),
    ),
    findOne: jest.fn(({ where }) =>
      Promise.resolve(rows.find((r) => matches(r, where)) ?? null),
    ),
    create: jest.fn((data) => ({ ...data })),
    save: jest.fn((entity: NotificationChannel) => {
      const now = new Date();
      if (!entity.id) {
        Object.assign(entity, {
          id: randomUUID(),
          createdAt: now,
          updatedAt: now,
        });
        rows.push(entity);
      } else {
        entity.updatedAt = now;
        rows = rows.map((r) => (r.id === entity.id ? entity : r));
      }
      return Promise.resolve(entity);
    }),
    update: jest.fn((id: string, patch: Partial<NotificationChannel>) => {
      const row = rows.find((r) => r.id === id);
      if (row) Object.assign(row, patch);
      return Promise.resolve({});
    }),
    remove: jest.fn((entity: NotificationChannel) => {
      rows = rows.filter((r) => r.id !== entity.id);
      return Promise.resolve(entity);
    }),
  };
}

describe('Notification channels (e2e)', () => {
  let app: INestApplication;
  let delivery: ChannelDeliveryService;
  const repo = memoryRepo();
  const config = {
    get: (key: string) =>
      key === 'KK_HMAC_SECRET' ? 'e2e-hmac-secret' : undefined,
  };

  const providers = [
    NotificationChannelsService,
    ChannelDeliveryService,
    { provide: ConfigService, useValue: config },
    { provide: getRepositoryToken(NotificationChannel), useValue: repo },
  ];

  beforeAll(async () => {
    ({ app } = await createTestApp({
      controllers: [NotificationChannelsController],
      providers,
    }));
    delivery = app.get(ChannelDeliveryService);
  });

  afterAll(() => app.close());

  beforeEach(() => {
    repo.reset();
    mockedPost.mockReset();
  });

  const create = (body: Record<string, unknown>) =>
    request(app.getHttpServer()).post('/notifications/channels').send(body);

  it('creates a Slack channel with default events and a masked URL', async () => {
    const res = await create({ type: 'slack', name: 'Ops', url: SLACK_URL });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      type: 'slack',
      name: 'Ops',
      urlMasked: 'https://hooks.slack.com/…KEN9',
      enabled: true,
      hasSecret: false,
      lastDeliveryStatus: null,
      events: [
        'cert.failed',
        'cert.expiring',
        'cert.revoked',
        'cert.replacement_requested',
        'domain.verification_failed',
        'endpoint.scan_failed',
        'deploy.failed',
        'connector.stale',
      ],
    });
    expect(res.body.secret).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('SECRETTOKEN');
    expect(res.body).not.toHaveProperty('urlEncrypted');

    // Stored encrypted, owned by the caller.
    const [row] = repo.rows();
    expect(row.userId).toBe(MOCK_USER.userId);
    expect(row.urlEncrypted).toMatch(/^v1:/);
    expect(delivery.decrypt(row.urlEncrypted)).toBe(SLACK_URL);
  });

  it('returns the webhook secret once, on create only', async () => {
    const res = await create({
      type: 'webhook',
      name: 'SIEM',
      url: WEBHOOK_URL,
      events: ['cert.issued'],
    });

    expect(res.status).toBe(201);
    expect(res.body.secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    expect(res.body.hasSecret).toBe(true);
    expect(res.body.urlMasked).toBe('https://93.184.216.34/…1234');
    expect(delivery.decrypt(repo.rows()[0].secretEncrypted!)).toBe(
      res.body.secret,
    );

    const list = await request(app.getHttpServer()).get(
      '/notifications/channels',
    );
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].secret).toBeUndefined();
    expect(JSON.stringify(list.body)).not.toContain(res.body.secret);
    expect(JSON.stringify(list.body)).not.toContain('abcd1234?');
  });

  it('rotates a webhook secret and returns the new one once', async () => {
    const created = await create({
      type: 'webhook',
      name: 'SIEM',
      url: WEBHOOK_URL,
    });
    const res = await request(app.getHttpServer()).post(
      `/notifications/channels/${created.body.id}/rotate-secret`,
    );
    expect(res.status).toBe(200);
    expect(res.body.secret).toMatch(/^whsec_/);
    expect(res.body.secret).not.toBe(created.body.secret);
    expect(delivery.decrypt(repo.rows()[0].secretEncrypted!)).toBe(
      res.body.secret,
    );
  });

  it('refuses to rotate a secret on a Slack channel', async () => {
    const created = await create({ type: 'slack', name: 'x', url: SLACK_URL });
    const res = await request(app.getHttpServer()).post(
      `/notifications/channels/${created.body.id}/rotate-secret`,
    );
    expect(res.status).toBe(400);
  });

  it.each([
    [
      { type: 'slack', name: 'x', url: 'https://example.com/hook' },
      'Slack URL',
    ],
    [
      { type: 'teams', name: 'x', url: 'https://outlook.office.com/webhook/x' },
      'Teams URL',
    ],
    [
      { type: 'webhook', name: 'x', url: 'https://127.0.0.1/hook' },
      'public address',
    ],
    [{ type: 'webhook', name: 'x', url: 'http://93.184.216.34/' }, 'https'],
  ])('rejects invalid URLs (%o)', async (body, message) => {
    const res = await create(body);
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body.message)).toContain(message);
    expect(repo.rows()).toHaveLength(0);
  });

  it('rejects unknown events and types', async () => {
    const badEvent = await create({
      type: 'slack',
      name: 'x',
      url: SLACK_URL,
      events: ['cert.exploded'],
    });
    expect(badEvent.status).toBe(400);
    const badType = await create({ type: 'pager', name: 'x', url: SLACK_URL });
    expect(badType.status).toBe(400);
  });

  it('limits each user to 10 channels', async () => {
    for (let i = 0; i < 10; i++) {
      repo.seed({
        id: randomUUID(),
        userId: MOCK_USER.userId,
        type: 'slack',
        name: `c${i}`,
        urlEncrypted: delivery.encrypt(SLACK_URL),
        events: [],
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
    const res = await create({
      type: 'slack',
      name: 'eleventh',
      url: SLACK_URL,
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('at most 10 notification channels');
  });

  describe("another user's channel", () => {
    const otherId = randomUUID();
    beforeEach(() =>
      repo.seed({
        id: otherId,
        userId: 'someone-else',
        type: 'slack',
        name: 'theirs',
        urlEncrypted: delivery.encrypt(SLACK_URL),
        secretEncrypted: null,
        events: ['cert.failed'],
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );

    it('is not listed', async () => {
      const res = await request(app.getHttpServer()).get(
        '/notifications/channels',
      );
      expect(res.body).toEqual([]);
    });

    it.each([
      ['patch', ''],
      ['delete', ''],
      ['post', '/test'],
      ['post', '/rotate-secret'],
    ] as const)('returns 404 for %s %s', async (method, suffix) => {
      const res = await request(app.getHttpServer())
        [method](`/notifications/channels/${otherId}${suffix}`)
        .send({ name: 'mine now' });
      expect(res.status).toBe(404);
      expect(repo.rows()[0].name).toBe('theirs');
      expect(mockedPost).not.toHaveBeenCalled();
    });
  });

  it('updates name, events, enabled and URL', async () => {
    const created = await create({ type: 'slack', name: 'x', url: SLACK_URL });
    const res = await request(app.getHttpServer())
      .patch(`/notifications/channels/${created.body.id}`)
      .send({
        name: 'Renamed',
        events: ['cert.issued'],
        enabled: false,
        url: 'https://hooks.slack.com/services/T1/B1/NEWTOKEN',
      });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: 'Renamed',
      events: ['cert.issued'],
      enabled: false,
      urlMasked: 'https://hooks.slack.com/…OKEN',
    });
  });

  it('rejects a URL change that fails validation', async () => {
    const created = await create({ type: 'slack', name: 'x', url: SLACK_URL });
    const res = await request(app.getHttpServer())
      .patch(`/notifications/channels/${created.body.id}`)
      .send({ url: 'https://example.com/elsewhere' });
    expect(res.status).toBe(400);
    expect(delivery.decrypt(repo.rows()[0].urlEncrypted)).toBe(SLACK_URL);
  });

  it('deletes a channel', async () => {
    const created = await create({ type: 'slack', name: 'x', url: SLACK_URL });
    const res = await request(app.getHttpServer()).delete(
      `/notifications/channels/${created.body.id}`,
    );
    expect(res.status).toBe(204);
    expect(repo.rows()).toHaveLength(0);
  });

  it('returns 400 for a malformed id', async () => {
    const res = await request(app.getHttpServer()).delete(
      '/notifications/channels/not-a-uuid',
    );
    expect(res.status).toBe(400);
  });

  it('sends a test alert and records the outcome', async () => {
    const created = await create({ type: 'slack', name: 'x', url: SLACK_URL });
    mockedPost.mockResolvedValueOnce({ status: 404 });

    const res = await request(app.getHttpServer()).post(
      `/notifications/channels/${created.body.id}/test`,
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: false, status: 404, error: 'HTTP 404' });
    const [, body] = mockedPost.mock.calls[0];
    expect(JSON.parse(body).text).toContain('Test notification from KrakenKey');
    expect(repo.rows()[0]).toMatchObject({
      lastDeliveryStatus: 'failed',
      lastError: 'HTTP 404',
    });

    mockedPost.mockResolvedValueOnce({ status: 200 });
    const ok = await request(app.getHttpServer()).post(
      `/notifications/channels/${created.body.id}/test`,
    );
    expect(ok.body).toEqual({ ok: true, status: 200, error: null });
    expect(repo.rows()[0].lastDeliveryStatus).toBe('ok');
  });

  describe('with an API key limited to specific domains', () => {
    let restrictedApp: INestApplication;

    beforeAll(async () => {
      ({ app: restrictedApp } = await createTestApp({
        controllers: [NotificationChannelsController],
        providers,
        mockUser: {
          ...MOCK_USER,
          apiKey: {
            id: 'k1',
            scopes: null,
            allowedDomainIds: ['d1'],
            allowedCertIds: null,
          },
        },
      }));
    });
    afterAll(() => restrictedApp.close());

    it('can list but not create channels', async () => {
      const list = await request(restrictedApp.getHttpServer()).get(
        '/notifications/channels',
      );
      expect(list.status).toBe(200);
      const res = await request(restrictedApp.getHttpServer())
        .post('/notifications/channels')
        .send({ type: 'slack', name: 'x', url: SLACK_URL });
      expect(res.status).toBe(403);
    });
  });
});
