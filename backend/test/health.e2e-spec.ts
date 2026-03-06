import { INestApplication, ServiceUnavailableException } from '@nestjs/common';
import request from 'supertest';
import { HealthCheckService, TypeOrmHealthIndicator } from '@nestjs/terminus';
import { HealthController } from '../src/health/health.controller';
import { RedisHealthIndicator } from '../src/health/redis.health';
import { AuthentikHealthIndicator } from '../src/health/authentik.health';
import { createTestApp } from './helpers/create-test-app';

describe('Health (e2e)', () => {
  let app: INestApplication;
  let mockHealthCheckService: { check: jest.Mock };

  beforeAll(async () => {
    mockHealthCheckService = {
      check: jest.fn().mockResolvedValue({
        status: 'ok',
        info: {
          db: { status: 'up' },
          redis: { status: 'up' },
          auth: { status: 'up' },
        },
        error: {},
        details: {},
      }),
    };

    ({ app } = await createTestApp({
      controllers: [HealthController],
      providers: [
        { provide: HealthCheckService, useValue: mockHealthCheckService },
        { provide: TypeOrmHealthIndicator, useValue: { pingCheck: jest.fn() } },
        { provide: RedisHealthIndicator, useValue: { isHealthy: jest.fn() } },
        {
          provide: AuthentikHealthIndicator,
          useValue: { isHealthy: jest.fn() },
        },
      ],
      guardMode: 'none', // health endpoints are public, no guard to override
    }));
  });

  afterAll(() => app.close());

  // ─── GET /health (liveness) ───────────────────────────────────────────────
  describe('GET /health', () => {
    it('returns 200 with status ok', () =>
      request(app.getHttpServer())
        .get('/health')
        .expect(200)
        .expect((res) => {
          expect(res.body).toMatchObject({
            status: 'ok',
            version: expect.any(String),
            environment: expect.anything(),
          });
        }));

    it('returns a valid ISO 8601 timestamp', () =>
      request(app.getHttpServer())
        .get('/health')
        .expect(200)
        .expect((res) => {
          const { timestamp } = res.body;
          expect(new Date(timestamp).toISOString()).toBe(timestamp);
        }));
  });

  // ─── GET /health/readiness ────────────────────────────────────────────────
  describe('GET /health/readiness', () => {
    it('returns 200 when all indicators are healthy', () =>
      request(app.getHttpServer())
        .get('/health/readiness')
        .expect(200)
        .expect((res) => {
          expect(res.body.status).toBe('ok');
        }));

    it('returns 503 when a dependency is unhealthy', async () => {
      mockHealthCheckService.check.mockRejectedValueOnce(
        new ServiceUnavailableException({
          status: 'error',
          error: { db: { status: 'down', message: 'Connection refused' } },
        }),
      );

      await request(app.getHttpServer()).get('/health/readiness').expect(503);
    });
  });
});
