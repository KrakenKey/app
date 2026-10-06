import { INestApplication, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import request from 'supertest';
import { API_KEY_PRESETS } from '@krakenkey/shared';
import { AuthService } from '../src/auth/auth.service';
import { ApiKeySecurityService } from '../src/auth/services/api-key-security.service';
import { ApiKeyStrategy } from '../src/auth/strategies/api-key.strategy';
import { JwtStrategy } from '../src/auth/strategies/jwt.strategy';
import { MetricsService } from '../src/metrics/metrics.service';
import { ReportsController } from '../src/reports/reports.controller';
import { PublicReportsController } from '../src/reports/public-reports.controller';
import { ReportsService } from '../src/reports/reports.service';
import { createTestApp } from './helpers/create-test-app';
import { MOCK_USER } from './helpers/mock-data';

const KEY = 'Bearer kk_test_key';
const ID = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'A'.repeat(43);

const PUBLIC_REPORT = {
  name: 'Clients',
  status: 'complete',
  hostCount: 1,
  completedCount: 1,
  createdAt: '2026-10-01T00:00:00.000Z',
  completedAt: '2026-10-01T00:01:00.000Z',
  shareExpiresAt: '2026-10-31T00:00:00.000Z',
  summary: { totalHosts: 1 },
  hosts: [{ host: 'example.com', port: 443, severity: 'ok' }],
};

describe('Reports (e2e)', () => {
  let app: INestApplication;

  const authService = { validateApiKey: jest.fn() };
  const reportsService = {
    create: jest.fn().mockResolvedValue({ id: ID, status: 'pending' }),
    findAll: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue({ id: ID }),
    remove: jest.fn().mockResolvedValue(undefined),
    createShare: jest.fn().mockResolvedValue({
      url: `https://app.krakenkey.io/r/${TOKEN}`,
      token: TOKEN,
      expiresAt: '2026-11-04T00:00:00.000Z',
    }),
    revokeShare: jest.fn().mockResolvedValue(undefined),
    exportCsv: jest
      .fn()
      .mockResolvedValue({ filename: 'clients.csv', data: 'host,port\r\n' }),
    findShared: jest.fn(),
    exportSharedCsv: jest.fn(),
  };

  const asKey = (fields: Record<string, unknown>) =>
    authService.validateApiKey.mockResolvedValue({
      id: 'key-1',
      user: { id: MOCK_USER.userId, groups: [] },
      ...fields,
    });

  beforeAll(async () => {
    ({ app } = await createTestApp({
      controllers: [ReportsController, PublicReportsController],
      imports: [PassportModule],
      guardMode: 'none',
      providers: [
        ApiKeyStrategy,
        JwtStrategy,
        { provide: AuthService, useValue: authService },
        { provide: ReportsService, useValue: reportsService },
        {
          provide: ApiKeySecurityService,
          useValue: {
            isLockedOut: jest.fn().mockResolvedValue(false),
            recordFailure: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: { get: () => 'https://auth.example.com/application/o/kk/' },
        },
        {
          provide: MetricsService,
          useValue: { authTotal: { inc: jest.fn() } },
        },
      ],
    }));
  });

  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  const server = () => app.getHttpServer();

  describe('authentication', () => {
    it('refuses every owner route without credentials', async () => {
      await request(server()).get('/reports').expect(401);
      await request(server())
        .post('/reports')
        .send({ hosts: ['a.com'] })
        .expect(401);
      await request(server()).get(`/reports/${ID}`).expect(401);
      await request(server()).post(`/reports/${ID}/share`).expect(401);
      await request(server()).get(`/reports/${ID}/export`).expect(401);
      expect(reportsService.findAll).not.toHaveBeenCalled();
      expect(reportsService.create).not.toHaveBeenCalled();
    });
  });

  describe('full-access key', () => {
    beforeEach(() => asKey({}));

    it('creates, lists, shares, revokes and deletes', async () => {
      await request(server())
        .post('/reports')
        .set('Authorization', KEY)
        .send({ name: 'Clients', hosts: ['example.com'] })
        .expect(201);
      expect(reportsService.create).toHaveBeenCalledWith(MOCK_USER.userId, {
        name: 'Clients',
        hosts: ['example.com'],
      });
      await request(server())
        .get('/reports')
        .set('Authorization', KEY)
        .expect(200);
      const share = await request(server())
        .post(`/reports/${ID}/share`)
        .set('Authorization', KEY)
        .expect(201);
      expect(share.body.token).toBe(TOKEN);
      await request(server())
        .delete(`/reports/${ID}/share`)
        .set('Authorization', KEY)
        .expect(204);
      await request(server())
        .delete(`/reports/${ID}`)
        .set('Authorization', KEY)
        .expect(204);
      expect(reportsService.remove).toHaveBeenCalledWith(ID, MOCK_USER.userId);
    });

    it('validates the body', async () => {
      await request(server())
        .post('/reports')
        .set('Authorization', KEY)
        .send({ hosts: [] })
        .expect(400);
      await request(server())
        .post('/reports')
        .set('Authorization', KEY)
        .send({ hosts: 'example.com' })
        .expect(400);
      expect(reportsService.create).not.toHaveBeenCalled();
    });

    it('rejects an id that is not a UUID', async () => {
      await request(server())
        .get('/reports/1')
        .set('Authorization', KEY)
        .expect(400);
      expect(reportsService.findOne).not.toHaveBeenCalled();
    });

    it('passes the 404 for a report owned by someone else', async () => {
      reportsService.findOne.mockRejectedValueOnce(
        new NotFoundException(`Report ${ID} not found`),
      );
      await request(server())
        .get(`/reports/${ID}`)
        .set('Authorization', KEY)
        .expect(404);
    });

    it('exports CSV and refuses other formats', async () => {
      const res = await request(server())
        .get(`/reports/${ID}/export?format=csv`)
        .set('Authorization', KEY)
        .expect(200);
      expect(res.headers['content-type']).toMatch(/^text\/csv/);
      expect(res.headers['content-disposition']).toBe(
        'attachment; filename="clients.csv"',
      );
      expect(res.text).toBe('host,port\r\n');
      await request(server())
        .get(`/reports/${ID}/export?format=json`)
        .set('Authorization', KEY)
        .expect(400);
    });
  });

  describe('scopes', () => {
    it('read-only key can read but not create, share or delete', async () => {
      asKey({ scopes: API_KEY_PRESETS['read-only'] });
      await request(server())
        .get('/reports')
        .set('Authorization', KEY)
        .expect(200);
      await request(server())
        .get(`/reports/${ID}`)
        .set('Authorization', KEY)
        .expect(200);
      await request(server())
        .get(`/reports/${ID}/export`)
        .set('Authorization', KEY)
        .expect(200);
      const res = await request(server())
        .post('/reports')
        .set('Authorization', KEY)
        .send({ hosts: ['example.com'] })
        .expect(403);
      expect(res.body.message).toBe(
        'This API key needs the account:write scope for this request.',
      );
      await request(server())
        .post(`/reports/${ID}/share`)
        .set('Authorization', KEY)
        .expect(403);
      await request(server())
        .delete(`/reports/${ID}`)
        .set('Authorization', KEY)
        .expect(403);
      expect(reportsService.create).not.toHaveBeenCalled();
      expect(reportsService.createShare).not.toHaveBeenCalled();
    });

    it('a key without account scopes cannot read reports', async () => {
      asKey({ scopes: ['certs:read'] });
      await request(server())
        .get('/reports')
        .set('Authorization', KEY)
        .expect(403);
    });

    it('keys limited to domains or certificates are refused', async () => {
      asKey({ allowedDomainIds: ['22222222-2222-4222-8222-222222222222'] });
      const res = await request(server())
        .get('/reports')
        .set('Authorization', KEY)
        .expect(403);
      expect(res.body.message).toMatch(/cannot use reports/);
      asKey({ allowedCertIds: [1] });
      await request(server())
        .post('/reports')
        .set('Authorization', KEY)
        .send({ hosts: ['example.com'] })
        .expect(403);
      expect(reportsService.findAll).not.toHaveBeenCalled();
      expect(reportsService.create).not.toHaveBeenCalled();
    });
  });

  describe('public shared view', () => {
    it('serves the report without credentials and without caching', async () => {
      reportsService.findShared.mockResolvedValue(PUBLIC_REPORT);
      const res = await request(server())
        .get(`/public/reports/${TOKEN}`)
        .expect(200);
      expect(res.body).toEqual(PUBLIC_REPORT);
      expect(res.body).not.toHaveProperty('id');
      expect(res.body).not.toHaveProperty('userId');
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
      expect(reportsService.findShared).toHaveBeenCalledWith(TOKEN);
    });

    it('ignores any Authorization header', async () => {
      reportsService.findShared.mockResolvedValue(PUBLIC_REPORT);
      await request(server())
        .get(`/public/reports/${TOKEN}`)
        .set('Authorization', 'Bearer garbage')
        .expect(200);
      expect(authService.validateApiKey).not.toHaveBeenCalled();
    });

    it('404s for unknown, revoked or expired links', async () => {
      reportsService.findShared.mockRejectedValue(
        new NotFoundException('Report not found'),
      );
      const res = await request(server())
        .get(`/public/reports/${TOKEN}`)
        .expect(404);
      expect(res.body.message).toBe('Report not found');
    });

    it('exports CSV without credentials', async () => {
      reportsService.exportSharedCsv.mockResolvedValue({
        filename: 'clients.csv',
        data: 'host\r\n',
      });
      const res = await request(server())
        .get(`/public/reports/${TOKEN}/export?format=csv`)
        .expect(200);
      expect(res.headers['content-type']).toMatch(/^text\/csv/);
      expect(res.headers['cache-control']).toBe('no-store');
    });
  });
});
