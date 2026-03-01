/**
 * Sprint 8.1 Certificate Lifecycle E2E Tests
 *
 * Tests complete certificate lifecycle flows through the HTTP API:
 *   submit CSR (pending) → issued → revoke → revoked → delete
 *   submit CSR (pending) → failed → retry → pending → issued → renew → renewing
 *
 * Also covers CSR validation rejections and status guard enforcement.
 *
 * Services are mocked at the TlsService boundary. Mock return values are
 * updated between steps to simulate realistic state progression.
 */
import {
  INestApplication,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import request from 'supertest';
import { TlsController } from '../src/certs/tls/tls.controller';
import { TlsService } from '../src/certs/tls/tls.service';
import { createTestApp } from './helpers/create-test-app';
import {
  MOCK_CSR_PEM,
  MOCK_TLS_CERT,
  MOCK_ISSUED_CERT,
  MOCK_FAILED_CERT,
  MOCK_REVOKED_CERT,
  MOCK_USER,
} from './helpers/mock-data';

describe('Certificate Lifecycle (e2e)', () => {
  let app: INestApplication;
  let mockTlsService: Record<string, jest.Mock>;

  beforeAll(async () => {
    mockTlsService = {
      create: jest.fn().mockResolvedValue({ id: 1, status: 'pending' }),
      findAll: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(MOCK_TLS_CERT),
      update: jest.fn().mockResolvedValue(MOCK_TLS_CERT),
      remove: jest.fn().mockResolvedValue({ id: 1 }),
      revoke: jest.fn().mockResolvedValue({ id: 1, status: 'revoked' }),
      renew: jest.fn().mockResolvedValue({ id: 1, status: 'renewing' }),
      retry: jest.fn().mockResolvedValue({ id: 1, status: 'pending' }),
    };

    ({ app } = await createTestApp({
      controllers: [TlsController],
      providers: [{ provide: TlsService, useValue: mockTlsService }],
    }));
  });

  afterAll(async () => {
    await app.close();
  });

  // ─── Lifecycle: submit → issued → revoke → delete ─────────────────────────
  describe('Lifecycle: submit → issued → revoke → delete', () => {
    it('Step 1: POST /certs/tls — cert created with pending status', async () => {
      mockTlsService.create.mockResolvedValueOnce({ id: 10, status: 'pending' });

      const res = await request(app.getHttpServer())
        .post('/certs/tls')
        .send({ csrPem: MOCK_CSR_PEM })
        .expect(201);

      expect(res.body).toMatchObject({ id: 10, status: 'pending' });
    });

    it('Step 2: GET /certs/tls/:id — cert still pending', async () => {
      mockTlsService.findOne.mockResolvedValueOnce({
        ...MOCK_TLS_CERT,
        id: 10,
      });

      const res = await request(app.getHttpServer())
        .get('/certs/tls/10')
        .expect(200);

      expect(res.body.status).toBe('pending');
      expect(res.body.crtPem).toBeNull();
    });

    it('Step 3: GET /certs/tls/:id — cert now issued', async () => {
      mockTlsService.findOne.mockResolvedValueOnce({
        ...MOCK_ISSUED_CERT,
        id: 10,
      });

      const res = await request(app.getHttpServer())
        .get('/certs/tls/10')
        .expect(200);

      expect(res.body.status).toBe('issued');
      expect(res.body.crtPem).toMatch(/^-----BEGIN CERTIFICATE-----/);
      expect(res.body.expiresAt).toBeDefined();
    });

    it('Step 4: POST /certs/tls/:id/revoke — cert revoked', async () => {
      mockTlsService.revoke.mockResolvedValueOnce({
        id: 10,
        status: 'revoked',
      });

      const res = await request(app.getHttpServer())
        .post('/certs/tls/10/revoke')
        .send({ reason: 4 })
        .expect(201);

      expect(res.body).toMatchObject({ id: 10, status: 'revoked' });
    });

    it('Step 5: GET /certs/tls/:id — confirm cert is revoked', async () => {
      mockTlsService.findOne.mockResolvedValueOnce({
        ...MOCK_REVOKED_CERT,
        id: 10,
      });

      const res = await request(app.getHttpServer())
        .get('/certs/tls/10')
        .expect(200);

      expect(res.body.status).toBe('revoked');
      expect(res.body.revokedAt).toBeDefined();
    });

    it('Step 6: DELETE /certs/tls/:id — cert deleted', async () => {
      mockTlsService.remove.mockResolvedValueOnce({ id: 10 });

      const res = await request(app.getHttpServer())
        .delete('/certs/tls/10')
        .expect(200);

      expect(res.body).toMatchObject({ id: 10 });
    });
  });

  // ─── Lifecycle: submit → failed → retry → issued → renew ──────────────────
  describe('Lifecycle: submit → failed → retry → issued → renew', () => {
    it('Step 1: POST /certs/tls — cert created', async () => {
      mockTlsService.create.mockResolvedValueOnce({ id: 20, status: 'pending' });

      const res = await request(app.getHttpServer())
        .post('/certs/tls')
        .send({ csrPem: MOCK_CSR_PEM })
        .expect(201);

      expect(res.body).toMatchObject({ id: 20, status: 'pending' });
    });

    it('Step 2: GET /certs/tls/:id — cert failed', async () => {
      mockTlsService.findOne.mockResolvedValueOnce({
        ...MOCK_FAILED_CERT,
        id: 20,
      });

      const res = await request(app.getHttpServer())
        .get('/certs/tls/20')
        .expect(200);

      expect(res.body.status).toBe('failed');
    });

    it('Step 3: POST /certs/tls/:id/retry — back to pending', async () => {
      mockTlsService.retry.mockResolvedValueOnce({ id: 20, status: 'pending' });

      const res = await request(app.getHttpServer())
        .post('/certs/tls/20/retry')
        .expect(201);

      expect(res.body).toMatchObject({ id: 20, status: 'pending' });
    });

    it('Step 4: GET /certs/tls/:id — cert issued after retry', async () => {
      mockTlsService.findOne.mockResolvedValueOnce({
        ...MOCK_ISSUED_CERT,
        id: 20,
      });

      const res = await request(app.getHttpServer())
        .get('/certs/tls/20')
        .expect(200);

      expect(res.body.status).toBe('issued');
      expect(res.body.crtPem).not.toBeNull();
    });

    it('Step 5: POST /certs/tls/:id/renew — cert renewing', async () => {
      mockTlsService.renew.mockResolvedValueOnce({
        id: 20,
        status: 'renewing',
      });

      const res = await request(app.getHttpServer())
        .post('/certs/tls/20/renew')
        .expect(201);

      expect(res.body).toMatchObject({ id: 20, status: 'renewing' });
    });

    it('Step 6: GET /certs/tls/:id — cert re-issued after renewal', async () => {
      mockTlsService.findOne.mockResolvedValueOnce({
        ...MOCK_ISSUED_CERT,
        id: 20,
      });

      const res = await request(app.getHttpServer())
        .get('/certs/tls/20')
        .expect(200);

      expect(res.body.status).toBe('issued');
    });
  });

  // ─── CSR validation rejections ─────────────────────────────────────────────
  describe('CSR validation rejections', () => {
    it('rejects CSR with unauthorized domains', async () => {
      mockTlsService.create.mockRejectedValueOnce(
        new BadRequestException(
          'CSR contains unauthorized domains: evil.com',
        ),
      );

      const res = await request(app.getHttpServer())
        .post('/certs/tls')
        .send({ csrPem: MOCK_CSR_PEM })
        .expect(400);

      expect(res.body.message).toContain('unauthorized domains');
    });

    it('rejects CSR with weak RSA key (<2048 bits)', async () => {
      mockTlsService.create.mockRejectedValueOnce(
        new BadRequestException('RSA key must be at least 2048 bits'),
      );

      const res = await request(app.getHttpServer())
        .post('/certs/tls')
        .send({ csrPem: MOCK_CSR_PEM })
        .expect(400);

      expect(res.body.message).toContain('2048');
    });

    it('rejects CSR with unsupported EC curve (P-521)', async () => {
      mockTlsService.create.mockRejectedValueOnce(
        new BadRequestException(
          'Unsupported ECDSA curve. Supported curves: P-256, P-384',
        ),
      );

      const res = await request(app.getHttpServer())
        .post('/certs/tls')
        .send({ csrPem: MOCK_CSR_PEM })
        .expect(400);

      expect(res.body.message).toContain('Unsupported ECDSA curve');
    });
  });

  // ─── Status guard enforcement ──────────────────────────────────────────────
  describe('Status guard enforcement', () => {
    it('cannot revoke a pending cert', async () => {
      mockTlsService.revoke.mockRejectedValueOnce(
        new BadRequestException(
          "Certificate must be in 'issued' state to revoke. Current status: pending",
        ),
      );

      await request(app.getHttpServer())
        .post('/certs/tls/1/revoke')
        .send({})
        .expect(400);
    });

    it('cannot renew a failed cert', async () => {
      mockTlsService.renew.mockRejectedValueOnce(
        new BadRequestException(
          "Certificate must be in 'issued' state to renew. Current status: failed",
        ),
      );

      await request(app.getHttpServer())
        .post('/certs/tls/1/renew')
        .expect(400);
    });

    it('cannot retry an issued cert', async () => {
      mockTlsService.retry.mockRejectedValueOnce(
        new BadRequestException(
          "Certificate must be in 'failed' state to retry. Current status: issued",
        ),
      );

      await request(app.getHttpServer())
        .post('/certs/tls/1/retry')
        .expect(400);
    });

    it('cannot delete an issued cert', async () => {
      mockTlsService.remove.mockRejectedValueOnce(
        new BadRequestException(
          'Only failed or revoked certificates can be deleted. Current status: issued',
        ),
      );

      await request(app.getHttpServer())
        .delete('/certs/tls/1')
        .expect(400);
    });
  });
});
