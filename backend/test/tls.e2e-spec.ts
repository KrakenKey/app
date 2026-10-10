import {
  INestApplication,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import request from 'supertest';
import { TlsController } from '../src/certs/tls/tls.controller';
import { TlsService } from '../src/certs/tls/tls.service';
import { createTestApp } from './helpers/create-test-app';
import {
  MOCK_CSR_PEM,
  MOCK_TLS_CERT,
  MOCK_ISSUED_CERT,
  MOCK_USER,
} from './helpers/mock-data';

describe('TLS Certificates (e2e)', () => {
  let app: INestApplication;
  let unauthApp: INestApplication;
  let mockTlsService: Record<string, jest.Mock>;

  beforeAll(async () => {
    mockTlsService = {
      create: jest.fn().mockResolvedValue(MOCK_TLS_CERT),
      findAll: jest.fn().mockResolvedValue([MOCK_TLS_CERT]),
      findOne: jest.fn().mockResolvedValue(MOCK_TLS_CERT),
      update: jest
        .fn()
        .mockResolvedValue({ ...MOCK_TLS_CERT, parsedCsr: { updated: true } }),
      remove: jest.fn().mockResolvedValue({ id: 1 }),
      revoke: jest.fn().mockResolvedValue({ id: 1, status: 'revoked' }),
      renew: jest
        .fn()
        .mockResolvedValue({ ...MOCK_ISSUED_CERT, status: 'renewing' }),
      retry: jest
        .fn()
        .mockResolvedValue({ ...MOCK_TLS_CERT, status: 'pending' }),
      toResponses: jest.fn((certs: object[]) =>
        Promise.resolve(certs.map((c) => ({ ...c, renewAfter: null }))),
      ),
      toResponse: jest.fn((cert: object) =>
        Promise.resolve({ ...cert, renewAfter: null }),
      ),
    };

    ({ app } = await createTestApp({
      controllers: [TlsController],
      providers: [{ provide: TlsService, useValue: mockTlsService }],
    }));

    ({ app: unauthApp } = await createTestApp({
      controllers: [TlsController],
      providers: [{ provide: TlsService, useValue: mockTlsService }],
      guardMode: 'reject',
    }));
  });

  afterAll(async () => {
    await app.close();
    await unauthApp.close();
  });

  // ─── Authentication ───────────────────────────────────────────────────────
  describe('Authentication', () => {
    it('GET /certs/tls returns 401 without auth', () =>
      request(unauthApp.getHttpServer()).get('/certs/tls').expect(401));

    it('POST /certs/tls returns 401 without auth', () =>
      request(unauthApp.getHttpServer())
        .post('/certs/tls')
        .send({ csrPem: MOCK_CSR_PEM })
        .expect(401));

    it('GET /certs/tls/:id returns 401 without auth', () =>
      request(unauthApp.getHttpServer()).get('/certs/tls/1').expect(401));

    it('PATCH /certs/tls/:id returns 401 without auth', () =>
      request(unauthApp.getHttpServer())
        .patch('/certs/tls/1')
        .send({})
        .expect(401));

    it('DELETE /certs/tls/:id returns 401 without auth', () =>
      request(unauthApp.getHttpServer()).delete('/certs/tls/1').expect(401));

    it('POST /certs/tls/:id/renew returns 401 without auth', () =>
      request(unauthApp.getHttpServer())
        .post('/certs/tls/1/renew')
        .expect(401));

    it('POST /certs/tls/:id/retry returns 401 without auth', () =>
      request(unauthApp.getHttpServer())
        .post('/certs/tls/1/retry')
        .expect(401));

    it('POST /certs/tls/:id/revoke returns 401 without auth', () =>
      request(unauthApp.getHttpServer())
        .post('/certs/tls/1/revoke')
        .send({})
        .expect(401));
  });

  // ─── POST /certs/tls ─────────────────────────────────────────────────────
  describe('POST /certs/tls', () => {
    it('returns 201 with pending cert', () =>
      request(app.getHttpServer())
        .post('/certs/tls')
        .send({ csrPem: MOCK_CSR_PEM })
        .expect(201)
        .expect((res) => {
          expect(res.body).toMatchObject({
            id: 1,
            status: 'pending',
          });
          expect(mockTlsService.create).toHaveBeenCalledWith(
            MOCK_USER.userId,
            { csrPem: MOCK_CSR_PEM },
            { restrictToHostnames: undefined },
          );
        }));

    it('passes names and managedBy through for a pending certificate', async () => {
      mockTlsService.create.mockResolvedValueOnce({
        id: 7,
        status: 'awaiting_csr',
      });

      const res = await request(app.getHttpServer())
        .post('/certs/tls')
        .send({
          names: ['example.com', '*.example.com'],
          managedBy: 'connector',
        })
        .expect(201);

      expect(res.body).toEqual({ id: 7, status: 'awaiting_csr' });
      expect(mockTlsService.create).toHaveBeenLastCalledWith(
        MOCK_USER.userId,
        { names: ['example.com', '*.example.com'], managedBy: 'connector' },
        { restrictToHostnames: undefined },
      );
    });

    it('returns 400 for names that are not DNS names', async () => {
      mockTlsService.create.mockClear();
      const res = await request(app.getHttpServer())
        .post('/certs/tls')
        .send({ names: ['example.com', '10.0.0.1'], managedBy: 'connector' })
        .expect(400);

      expect(res.body.message).toContain(
        'each name must be a DNS name, optionally starting with "*."',
      );
      expect(mockTlsService.create).not.toHaveBeenCalled();
    });

    it('returns 400 for an empty names list', async () => {
      mockTlsService.create.mockClear();
      await request(app.getHttpServer())
        .post('/certs/tls')
        .send({ names: [], managedBy: 'connector' })
        .expect(400);
      expect(mockTlsService.create).not.toHaveBeenCalled();
    });

    it('returns 400 when both or neither of csrPem and names are sent', async () => {
      mockTlsService.create.mockClear();
      const both = await request(app.getHttpServer())
        .post('/certs/tls')
        .send({
          csrPem: MOCK_CSR_PEM,
          names: ['example.com'],
          managedBy: 'connector',
        })
        .expect(400);
      expect(both.body.message).toContain(
        'Send either csrPem or names, not both',
      );

      const neither = await request(app.getHttpServer())
        .post('/certs/tls')
        .send({ managedBy: 'connector' })
        .expect(400);
      expect(neither.body.message).toContain('csrPem or names is required');
      expect(mockTlsService.create).not.toHaveBeenCalled();
    });

    it("returns 400 for names without managedBy: 'connector'", async () => {
      mockTlsService.create.mockClear();
      const res = await request(app.getHttpServer())
        .post('/certs/tls')
        .send({ names: ['example.com'] })
        .expect(400);
      expect(res.body.message).toContain(
        "managedBy must be 'connector' when names is given",
      );
      expect(mockTlsService.create).not.toHaveBeenCalled();
    });
  });

  // ─── GET /certs/tls ──────────────────────────────────────────────────────
  describe('GET /certs/tls', () => {
    it('returns 200 with array of certificates', () =>
      request(app.getHttpServer())
        .get('/certs/tls')
        .expect(200)
        .expect((res) => {
          expect(Array.isArray(res.body)).toBe(true);
          expect(res.body).toHaveLength(1);
        }));

    it('returns 200 with empty array when no certs', async () => {
      mockTlsService.findAll.mockResolvedValueOnce([]);

      await request(app.getHttpServer())
        .get('/certs/tls')
        .expect(200)
        .expect((res) => {
          expect(res.body).toEqual([]);
        });
    });
  });

  // ─── GET /certs/tls/:id ──────────────────────────────────────────────────
  describe('GET /certs/tls/:id', () => {
    it('returns 200 with certificate details', () =>
      request(app.getHttpServer())
        .get('/certs/tls/1')
        .expect(200)
        .expect((res) => {
          expect(res.body.id).toBe(1);
          expect(res.body.status).toBe('pending');
        }));

    it('returns an awaiting_csr cert with its requested names', async () => {
      const createdAt = '2026-10-01T12:00:00.000Z';
      mockTlsService.findOne.mockResolvedValueOnce({
        id: 7,
        status: 'awaiting_csr',
        parsedCsr: null,
        requestedNames: ['example.com'],
        managedBy: 'connector',
        autoRenew: false,
        createdAt,
      });
      mockTlsService.toResponse.mockImplementationOnce((cert: object) =>
        Promise.resolve({ ...cert, renewAfter: createdAt }),
      );

      const res = await request(app.getHttpServer())
        .get('/certs/tls/7')
        .expect(200);
      expect(res.body).toMatchObject({
        status: 'awaiting_csr',
        parsedCsr: null,
        requestedNames: ['example.com'],
        renewAfter: createdAt,
      });
    });

    it('returns 404 when cert not found', async () => {
      mockTlsService.findOne.mockRejectedValueOnce(
        new NotFoundException('Certificate #999 not found'),
      );

      await request(app.getHttpServer()).get('/certs/tls/999').expect(404);
    });
  });

  // ─── PATCH /certs/tls/:id ────────────────────────────────────────────────
  describe('PATCH /certs/tls/:id', () => {
    it('returns 200 with updated certificate', () =>
      request(app.getHttpServer())
        .patch('/certs/tls/1')
        .send({})
        .expect(200)
        .expect((_res) => {
          expect(mockTlsService.update).toHaveBeenCalledWith(
            1,
            MOCK_USER.userId,
            {},
          );
        }));

    it('accepts managedBy: connector and returns renewAfter', async () => {
      const res = await request(app.getHttpServer())
        .patch('/certs/tls/1')
        .send({ managedBy: 'connector' })
        .expect(200);

      expect(mockTlsService.update).toHaveBeenLastCalledWith(
        1,
        MOCK_USER.userId,
        { managedBy: 'connector' },
      );
      expect(res.body).toHaveProperty('renewAfter');
    });

    it('accepts managedBy: null to hand renewal back to KrakenKey', async () => {
      await request(app.getHttpServer())
        .patch('/certs/tls/1')
        .send({ managedBy: null })
        .expect(200);

      expect(mockTlsService.update).toHaveBeenLastCalledWith(
        1,
        MOCK_USER.userId,
        { managedBy: null },
      );
    });

    it('strips csrPem so it never reaches the service', async () => {
      mockTlsService.update.mockClear();
      await request(app.getHttpServer())
        .patch('/certs/tls/1')
        .send({ csrPem: MOCK_CSR_PEM, autoRenew: false })
        .expect(200);

      expect(mockTlsService.update).toHaveBeenCalledWith(1, MOCK_USER.userId, {
        autoRenew: false,
      });
      const dto = mockTlsService.update.mock.calls[0][2] as object;
      expect(dto).not.toHaveProperty('csrPem');
    });

    it('returns 400 for any other managedBy value', async () => {
      mockTlsService.update.mockClear();
      const res = await request(app.getHttpServer())
        .patch('/certs/tls/1')
        .send({ managedBy: 'server' })
        .expect(400);

      expect(res.body.message).toContain(
        "managedBy must be 'connector' or null",
      );
      expect(mockTlsService.update).not.toHaveBeenCalled();
    });
  });

  // ─── POST /certs/tls/:id/revoke ──────────────────────────────────────────
  describe('POST /certs/tls/:id/revoke', () => {
    it('returns 201 with revoked status', () =>
      request(app.getHttpServer())
        .post('/certs/tls/1/revoke')
        .send({})
        .expect(201)
        .expect((res) => {
          expect(res.body).toMatchObject({ id: 1, status: 'revoked' });
          expect(mockTlsService.revoke).toHaveBeenCalledWith(
            1,
            MOCK_USER.userId,
            undefined,
          );
        }));

    it('returns 201 with optional reason code', async () => {
      await request(app.getHttpServer())
        .post('/certs/tls/1/revoke')
        .send({ reason: 4 })
        .expect(201);

      expect(mockTlsService.revoke).toHaveBeenCalledWith(
        1,
        MOCK_USER.userId,
        4,
      );
    });

    it('returns 400 when cert not in issued state', async () => {
      mockTlsService.revoke.mockRejectedValueOnce(
        new BadRequestException(
          "Certificate must be in 'issued' state to revoke",
        ),
      );

      await request(app.getHttpServer())
        .post('/certs/tls/1/revoke')
        .send({})
        .expect(400);
    });

    it('returns 404 when cert not found', async () => {
      mockTlsService.revoke.mockRejectedValueOnce(
        new NotFoundException('Certificate #999 not found'),
      );

      await request(app.getHttpServer())
        .post('/certs/tls/999/revoke')
        .send({})
        .expect(404);
    });
  });

  // ─── DELETE /certs/tls/:id ────────────────────────────────────────────────
  describe('DELETE /certs/tls/:id', () => {
    it('returns 200 when cert deleted', () =>
      request(app.getHttpServer()).delete('/certs/tls/1').expect(200));

    it('returns 404 when cert not found', async () => {
      mockTlsService.remove.mockRejectedValueOnce(
        new NotFoundException('Certificate #999 not found'),
      );

      await request(app.getHttpServer()).delete('/certs/tls/999').expect(404);
    });

    it('returns 400 when cert not in deletable state', async () => {
      mockTlsService.remove.mockRejectedValueOnce(
        new BadRequestException(
          'Only failed or revoked certificates can be deleted',
        ),
      );

      await request(app.getHttpServer()).delete('/certs/tls/1').expect(400);
    });
  });

  // ─── POST /certs/tls/:id/renew ───────────────────────────────────────────
  describe('POST /certs/tls/:id/renew', () => {
    it('returns 201 with renewing status', () =>
      request(app.getHttpServer())
        .post('/certs/tls/1/renew')
        .expect(201)
        .expect((res) => {
          expect(res.body.status).toBe('renewing');
        }));

    it('returns 200 and passes ifDue when the renewal is skipped', async () => {
      const skipped = {
        id: 1,
        status: 'issued',
        skipped: true,
        reason: 'not_due',
        expiresAt: '2026-12-01T00:00:00.000Z',
        renewalWindowDays: 30,
      };
      mockTlsService.renew.mockResolvedValueOnce(skipped);

      const res = await request(app.getHttpServer())
        .post('/certs/tls/1/renew?ifDue=true')
        .expect(200);

      expect(res.body).toEqual(skipped);
      expect(mockTlsService.renew).toHaveBeenLastCalledWith(
        1,
        expect.any(String),
        { ifDue: true },
      );
    });

    it('passes a new CSR from the body to the service', async () => {
      await request(app.getHttpServer())
        .post('/certs/tls/1/renew?ifDue=true')
        .send({ csrPem: MOCK_CSR_PEM })
        .expect(201);

      expect(mockTlsService.renew).toHaveBeenLastCalledWith(
        1,
        MOCK_USER.userId,
        { ifDue: true, csrPem: MOCK_CSR_PEM },
      );
    });

    it('returns 400 for a body CSR that is not PEM', async () => {
      mockTlsService.renew.mockClear();
      await request(app.getHttpServer())
        .post('/certs/tls/1/renew')
        .send({ csrPem: 'not a csr' })
        .expect(400);

      expect(mockTlsService.renew).not.toHaveBeenCalled();
    });

    it('returns 201 with pending when a CSR completes an awaiting_csr cert', async () => {
      mockTlsService.renew.mockResolvedValueOnce({
        id: 7,
        status: 'pending',
        skipped: false,
      });

      const res = await request(app.getHttpServer())
        .post('/certs/tls/7/renew?ifDue=true')
        .send({ csrPem: MOCK_CSR_PEM })
        .expect(201);

      expect(res.body).toEqual({ id: 7, status: 'pending', skipped: false });
    });

    it('returns 400 for an awaiting_csr cert without a CSR', async () => {
      mockTlsService.renew.mockRejectedValueOnce(
        new BadRequestException('This certificate is waiting for a CSR'),
      );

      const res = await request(app.getHttpServer())
        .post('/certs/tls/7/renew')
        .expect(400);
      expect(res.body.message).toBe('This certificate is waiting for a CSR');
    });

    it('returns 400 when cert not in issued state', async () => {
      mockTlsService.renew.mockRejectedValueOnce(
        new BadRequestException('Certificate is not in issued state'),
      );

      await request(app.getHttpServer()).post('/certs/tls/1/renew').expect(400);
    });

    it('returns 404 when cert not found', async () => {
      mockTlsService.renew.mockRejectedValueOnce(
        new NotFoundException('Certificate #999 not found'),
      );

      await request(app.getHttpServer())
        .post('/certs/tls/999/renew')
        .expect(404);
    });
  });

  // ─── POST /certs/tls/:id/retry ───────────────────────────────────────────
  describe('POST /certs/tls/:id/retry', () => {
    it('returns 201 with pending status', () =>
      request(app.getHttpServer())
        .post('/certs/tls/1/retry')
        .expect(201)
        .expect((res) => {
          expect(res.body.status).toBe('pending');
        }));

    it('returns 400 when cert not in failed state', async () => {
      mockTlsService.retry.mockRejectedValueOnce(
        new BadRequestException('Certificate is not in failed state'),
      );

      await request(app.getHttpServer()).post('/certs/tls/1/retry').expect(400);
    });
  });

  // ─── Input validation ────────────────────────────────────────────────────
  describe('Input validation', () => {
    it('POST /certs/tls returns 400 when csrPem is missing', () =>
      request(app.getHttpServer()).post('/certs/tls').send({}).expect(400));

    it('POST /certs/tls returns 400 when csrPem is empty', () =>
      request(app.getHttpServer())
        .post('/certs/tls')
        .send({ csrPem: '' })
        .expect(400));

    it('POST /certs/tls returns 400 when csrPem is not valid PEM format', () =>
      request(app.getHttpServer())
        .post('/certs/tls')
        .send({ csrPem: 'not a PEM string' })
        .expect(400)
        .expect((res) => {
          const messages = Array.isArray(res.body.message)
            ? res.body.message
            : [res.body.message];
          expect(
            messages.some((m: string) => m.includes('valid PEM format')),
          ).toBe(true);
        }));

    it('POST /certs/tls/:id/revoke returns 400 when reason < 0', () =>
      request(app.getHttpServer())
        .post('/certs/tls/1/revoke')
        .send({ reason: -1 })
        .expect(400));

    it('POST /certs/tls/:id/revoke returns 400 when reason > 10', () =>
      request(app.getHttpServer())
        .post('/certs/tls/1/revoke')
        .send({ reason: 11 })
        .expect(400));

    it('POST /certs/tls returns 400 when csrPem exceeds 10,000 characters', () => {
      const longPem =
        '-----BEGIN CERTIFICATE REQUEST-----\n' +
        'A'.repeat(10000) +
        '\n-----END CERTIFICATE REQUEST-----';

      return request(app.getHttpServer())
        .post('/certs/tls')
        .send({ csrPem: longPem })
        .expect(400)
        .expect((res) => {
          const messages = Array.isArray(res.body.message)
            ? res.body.message
            : [res.body.message];
          expect(messages.some((m: string) => m.includes('10,000'))).toBe(true);
        });
    });
  });
});
