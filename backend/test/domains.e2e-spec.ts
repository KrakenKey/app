import { INestApplication, NotFoundException } from '@nestjs/common';
import request from 'supertest';
import { DomainsController } from '../src/domains/domains.controller';
import { DomainsService } from '../src/domains/domains.service';
import { createTestApp } from './helpers/create-test-app';
import {
  MOCK_DOMAIN,
  MOCK_VERIFIED_DOMAIN,
  MOCK_USER,
} from './helpers/mock-data';

describe('Domains (e2e)', () => {
  let app: INestApplication;
  let unauthApp: INestApplication;
  let mockDomainsService: Record<string, jest.Mock>;

  beforeAll(async () => {
    mockDomainsService = {
      create: jest.fn().mockResolvedValue(MOCK_DOMAIN),
      findAll: jest.fn().mockResolvedValue([MOCK_DOMAIN]),
      findOne: jest.fn().mockResolvedValue(MOCK_DOMAIN),
      verify: jest.fn().mockResolvedValue(MOCK_VERIFIED_DOMAIN),
      delete: jest.fn().mockResolvedValue(undefined),
    };

    ({ app } = await createTestApp({
      controllers: [DomainsController],
      providers: [{ provide: DomainsService, useValue: mockDomainsService }],
    }));

    ({ app: unauthApp } = await createTestApp({
      controllers: [DomainsController],
      providers: [{ provide: DomainsService, useValue: mockDomainsService }],
      guardMode: 'reject',
    }));
  });

  afterAll(async () => {
    await app.close();
    await unauthApp.close();
  });

  // ─── Authentication ───────────────────────────────────────────────────────
  describe('Authentication', () => {
    it('GET /domains returns 401 without auth', () =>
      request(unauthApp.getHttpServer()).get('/domains').expect(401));

    it('POST /domains returns 401 without auth', () =>
      request(unauthApp.getHttpServer())
        .post('/domains')
        .send({ hostname: 'example.com' })
        .expect(401));

    it('GET /domains/:id returns 401 without auth', () =>
      request(unauthApp.getHttpServer())
        .get('/domains/domain-uuid-1')
        .expect(401));

    it('POST /domains/:id/verify returns 401 without auth', () =>
      request(unauthApp.getHttpServer())
        .post('/domains/domain-uuid-1/verify')
        .expect(401));

    it('DELETE /domains/:id returns 401 without auth', () =>
      request(unauthApp.getHttpServer())
        .delete('/domains/domain-uuid-1')
        .expect(401));
  });

  // ─── POST /domains ────────────────────────────────────────────────────────
  describe('POST /domains', () => {
    it('returns 201 with domain data for valid hostname', () =>
      request(app.getHttpServer())
        .post('/domains')
        .send({ hostname: 'example.com' })
        .expect(201)
        .expect((res) => {
          expect(res.body).toMatchObject({
            id: MOCK_DOMAIN.id,
            hostname: 'example.com',
            isVerified: false,
            verificationCode: expect.any(String),
          });
          expect(mockDomainsService.create).toHaveBeenCalledWith(
            MOCK_USER.userId,
            { hostname: 'example.com' },
          );
        }));
  });

  // ─── GET /domains ─────────────────────────────────────────────────────────
  describe('GET /domains', () => {
    it('returns 200 with array of domains', () =>
      request(app.getHttpServer())
        .get('/domains')
        .expect(200)
        .expect((res) => {
          expect(Array.isArray(res.body)).toBe(true);
          expect(res.body).toHaveLength(1);
        }));

    it('returns 200 with empty array when no domains', async () => {
      mockDomainsService.findAll.mockResolvedValueOnce([]);

      await request(app.getHttpServer())
        .get('/domains')
        .expect(200)
        .expect((res) => {
          expect(res.body).toEqual([]);
        });
    });
  });

  // ─── GET /domains/:id ────────────────────────────────────────────────────
  describe('GET /domains/:id', () => {
    it('returns 200 with domain details', () =>
      request(app.getHttpServer())
        .get('/domains/domain-uuid-1')
        .expect(200)
        .expect((res) => {
          expect(res.body.hostname).toBe('example.com');
        }));

    it('returns 404 when domain not found', async () => {
      mockDomainsService.findOne.mockRejectedValueOnce(
        new NotFoundException('Domain #missing not found'),
      );

      await request(app.getHttpServer()).get('/domains/missing').expect(404);
    });
  });

  // ─── POST /domains/:id/verify ────────────────────────────────────────────
  describe('POST /domains/:id/verify', () => {
    it('returns 201 with verified domain', () =>
      request(app.getHttpServer())
        .post('/domains/domain-uuid-1/verify')
        .expect(201)
        .expect((res) => {
          expect(res.body.isVerified).toBe(true);
        }));

    it('returns 404 when domain not found', async () => {
      mockDomainsService.verify.mockRejectedValueOnce(
        new NotFoundException('Domain #missing not found'),
      );

      await request(app.getHttpServer())
        .post('/domains/missing/verify')
        .expect(404);
    });
  });

  // ─── DELETE /domains/:id ──────────────────────────────────────────────────
  describe('DELETE /domains/:id', () => {
    it('returns 200 when domain deleted', () =>
      request(app.getHttpServer())
        .delete('/domains/domain-uuid-1')
        .expect(200));

    it('returns 404 when domain not found', async () => {
      mockDomainsService.delete.mockRejectedValueOnce(
        new NotFoundException('Domain #missing not found'),
      );

      await request(app.getHttpServer()).delete('/domains/missing').expect(404);
    });
  });

  // ─── Input validation ────────────────────────────────────────────────────
  describe('Input validation', () => {
    it('POST /domains returns 400 when hostname is empty', () =>
      request(app.getHttpServer())
        .post('/domains')
        .send({ hostname: '' })
        .expect(400));

    it('POST /domains returns 400 when hostname is missing', () =>
      request(app.getHttpServer()).post('/domains').send({}).expect(400));

    it('POST /domains strips unknown properties', async () => {
      await request(app.getHttpServer())
        .post('/domains')
        .send({ hostname: 'example.com', malicious: 'field' })
        .expect(201);

      // Service should only receive { hostname } due to whitelist: true
      expect(mockDomainsService.create).toHaveBeenCalledWith(MOCK_USER.userId, {
        hostname: 'example.com',
      });
    });
  });
});
