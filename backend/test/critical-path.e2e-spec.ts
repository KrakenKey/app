/**
 * Sprint 5.1 Critical Path E2E Test
 *
 * Simulates the full user journey from the acceptance criteria:
 *   register account → add domain → verify domain → submit CSR → wait for cert → download cert
 *
 * Auth is simulated via the guard override (represents "register account").
 * Services are mocked, but mock return values are updated between steps to
 * simulate realistic state progression.
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DomainsController } from '../src/domains/domains.controller';
import { DomainsService } from '../src/domains/domains.service';
import { TlsController } from '../src/certs/tls/tls.controller';
import { TlsService } from '../src/certs/tls/tls.service';
import { createTestApp } from './helpers/create-test-app';
import {
  MOCK_DOMAIN,
  MOCK_VERIFIED_DOMAIN,
  MOCK_CSR_PEM,
  MOCK_TLS_CERT,
  MOCK_ISSUED_CERT,
  MOCK_USER,
} from './helpers/mock-data';

describe('Sprint 5.1 Critical Path (e2e)', () => {
  let app: INestApplication;
  let mockDomainsService: Record<string, jest.Mock>;
  let mockTlsService: Record<string, jest.Mock>;

  beforeAll(async () => {
    mockDomainsService = {
      create: jest.fn().mockResolvedValue(MOCK_DOMAIN),
      findAll: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(MOCK_DOMAIN),
      verify: jest.fn().mockResolvedValue(MOCK_VERIFIED_DOMAIN),
      delete: jest.fn().mockResolvedValue(undefined),
    };

    mockTlsService = {
      create: jest.fn().mockResolvedValue(MOCK_TLS_CERT),
      findAll: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(MOCK_TLS_CERT),
      update: jest.fn().mockResolvedValue(MOCK_TLS_CERT),
      remove: jest.fn().mockResolvedValue('removed'),
      renew: jest.fn().mockResolvedValue(MOCK_TLS_CERT),
      retry: jest.fn().mockResolvedValue(MOCK_TLS_CERT),
    };

    ({ app } = await createTestApp({
      controllers: [DomainsController, TlsController],
      providers: [
        { provide: DomainsService, useValue: mockDomainsService },
        { provide: TlsService, useValue: mockTlsService },
      ],
    }));
  });

  afterAll(() => app.close());

  // The tests below run in declaration order via Jest's default behaviour.
  // Each step builds on the previous one.

  it('Step 1: POST /domains — register a domain', async () => {
    const res = await request(app.getHttpServer())
      .post('/domains')
      .send({ hostname: 'example.com' })
      .expect(201);

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
  });

  it('Step 2: GET /domains/:id — confirm domain registered (unverified)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/domains/${MOCK_DOMAIN.id}`)
      .expect(200);

    expect(res.body.isVerified).toBe(false);
    expect(res.body.verificationCode).toBeDefined();
  });

  it('Step 3: POST /domains/:id/verify — verify domain ownership', async () => {
    const res = await request(app.getHttpServer())
      .post(`/domains/${MOCK_DOMAIN.id}/verify`)
      .expect(201);

    expect(res.body.isVerified).toBe(true);
  });

  it('Step 4: POST /certs/tls — submit CSR for certificate', async () => {
    const res = await request(app.getHttpServer())
      .post('/certs/tls')
      .send({ csrPem: MOCK_CSR_PEM })
      .expect(201);

    expect(res.body).toMatchObject({
      id: MOCK_TLS_CERT.id,
      status: 'pending',
    });
  });

  it('Step 5: GET /certs/tls/:id — check cert status (still pending)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/certs/tls/${MOCK_TLS_CERT.id}`)
      .expect(200);

    expect(res.body.status).toBe('pending');
    expect(res.body.crtPem).toBeNull();
  });

  it('Step 6: GET /certs/tls/:id — cert is now issued', async () => {
    // Simulate background job completing: update mock to return issued cert
    mockTlsService.findOne.mockResolvedValueOnce(MOCK_ISSUED_CERT);

    const res = await request(app.getHttpServer())
      .get(`/certs/tls/${MOCK_TLS_CERT.id}`)
      .expect(200);

    expect(res.body.status).toBe('issued');
    expect(res.body.crtPem).not.toBeNull();
  });

  it('Step 7: GET /certs/tls/:id — download certificate PEM', async () => {
    mockTlsService.findOne.mockResolvedValueOnce(MOCK_ISSUED_CERT);

    const res = await request(app.getHttpServer())
      .get(`/certs/tls/${MOCK_TLS_CERT.id}`)
      .expect(200);

    expect(res.body.crtPem).toMatch(/^-----BEGIN CERTIFICATE-----/);
  });
});
