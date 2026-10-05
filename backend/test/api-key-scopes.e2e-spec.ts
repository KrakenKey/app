import { ForbiddenException, INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import request from 'supertest';
import { API_KEY_PRESETS } from '@krakenkey/shared';
import { AuthService } from '../src/auth/auth.service';
import { ApiKeySecurityService } from '../src/auth/services/api-key-security.service';
import { ApiKeyStrategy } from '../src/auth/strategies/api-key.strategy';
import { JwtStrategy } from '../src/auth/strategies/jwt.strategy';
import { MetricsService } from '../src/metrics/metrics.service';
import { TlsController } from '../src/certs/tls/tls.controller';
import { TlsService } from '../src/certs/tls/tls.service';
import { DomainsController } from '../src/domains/domains.controller';
import { DomainsService } from '../src/domains/domains.service';
import { createTestApp } from './helpers/create-test-app';
import { MOCK_CSR_PEM, MOCK_USER } from './helpers/mock-data';

// Real passport strategies, JwtOrApiKeyGuard and controllers; only the
// services are mocked. Each test picks the key record validateApiKey
// returns, so the same `Bearer kk_` header acts as different keys.
const KEY = 'Bearer kk_test_key';

function csr(...names: string[]) {
  return {
    subject: [{ name: 'commonName', shortName: 'CN', value: names[0] }],
    attributes: [],
    publicKey: { keyType: 'ECDSA', bitLength: 256 },
    extensions: [
      {
        name: 'subjectAltName',
        altNames: names.map((value) => ({ type: 2, value })),
      },
    ],
  };
}

const LAB_CERT = { id: 1, status: 'issued', parsedCsr: csr('labxp.io') };
const OTHER_CERT = { id: 2, status: 'issued', parsedCsr: csr('example.com') };
const DOMAINS = [
  { id: '11111111-1111-4111-8111-111111111111', hostname: 'labxp.io' },
  { id: '22222222-2222-4222-8222-222222222222', hostname: 'example.com' },
];

describe('Scoped API keys (e2e)', () => {
  let app: INestApplication;

  const authService = { validateApiKey: jest.fn() };
  const tlsService = {
    findAll: jest.fn().mockResolvedValue([LAB_CERT, OTHER_CERT]),
    findOne: jest.fn((id: number) =>
      Promise.resolve(id === 1 ? LAB_CERT : OTHER_CERT),
    ),
    getChain: jest.fn().mockResolvedValue({ chain: [] }),
    renew: jest.fn().mockResolvedValue({ id: 1, status: 'renewing' }),
    revoke: jest.fn().mockResolvedValue({ id: 1, status: 'revoking' }),
    remove: jest.fn().mockResolvedValue({ id: 1 }),
    create: jest.fn().mockResolvedValue({ id: 3, status: 'pending' }),
  };
  const domainsService = {
    findAll: jest.fn().mockResolvedValue(DOMAINS),
    findOne: jest.fn((id: string) =>
      Promise.resolve(DOMAINS.find((d) => d.id === id)),
    ),
    create: jest.fn().mockResolvedValue(DOMAINS[0]),
    delete: jest.fn(),
  };

  const asKey = (fields: Record<string, unknown>) =>
    authService.validateApiKey.mockResolvedValue({
      id: 'key-1',
      user: { id: MOCK_USER.userId, groups: [] },
      ...fields,
    });

  beforeAll(async () => {
    ({ app } = await createTestApp({
      controllers: [TlsController, DomainsController],
      imports: [PassportModule],
      guardMode: 'none',
      keyAccessDomains: DOMAINS,
      providers: [
        ApiKeyStrategy,
        JwtStrategy,
        { provide: AuthService, useValue: authService },
        { provide: TlsService, useValue: tlsService },
        { provide: DomainsService, useValue: domainsService },
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

  describe('key created before scopes (all fields absent)', () => {
    beforeEach(() => asKey({}));

    it('keeps full access', async () => {
      await request(server())
        .get('/certs/tls')
        .set('Authorization', KEY)
        .expect(200);
      await request(server())
        .post('/certs/tls/2/revoke')
        .set('Authorization', KEY)
        .send({})
        .expect(201);
      expect(tlsService.revoke).toHaveBeenCalled();
    });
  });

  describe('cert-renewal preset', () => {
    beforeEach(() => asKey({ scopes: API_KEY_PRESETS['cert-renewal'] }));

    it('can list, show, download the chain and renew', async () => {
      await request(server())
        .get('/certs/tls')
        .set('Authorization', KEY)
        .expect(200);
      await request(server())
        .get('/certs/tls/1')
        .set('Authorization', KEY)
        .expect(200);
      await request(server())
        .get('/certs/tls/1/chain')
        .set('Authorization', KEY)
        .expect(200);
      await request(server())
        .post('/certs/tls/1/renew')
        .set('Authorization', KEY)
        .expect(201);
    });

    it('gets 403 on revoke, delete and domain changes', async () => {
      const res = await request(server())
        .post('/certs/tls/1/revoke')
        .set('Authorization', KEY)
        .send({})
        .expect(403);
      expect(res.body.message).toBe(
        'This API key needs the certs:revoke scope for this request.',
      );
      await request(server())
        .delete('/certs/tls/1')
        .set('Authorization', KEY)
        .expect(403);
      await request(server())
        .post('/domains')
        .set('Authorization', KEY)
        .send({ hostname: 'new.example.org' })
        .expect(403);
      await request(server())
        .delete(`/domains/${DOMAINS[0].id}`)
        .set('Authorization', KEY)
        .expect(403);
      expect(tlsService.revoke).not.toHaveBeenCalled();
      expect(tlsService.remove).not.toHaveBeenCalled();
      expect(domainsService.create).not.toHaveBeenCalled();
      expect(domainsService.delete).not.toHaveBeenCalled();
    });
  });

  describe('key limited to labxp.io', () => {
    beforeEach(() => asKey({ allowedDomainIds: [DOMAINS[0].id] }));

    it('lists only certificates and domains under it', async () => {
      const certs = await request(server())
        .get('/certs/tls')
        .set('Authorization', KEY)
        .expect(200);
      expect(certs.body.map((c: { id: number }) => c.id)).toEqual([1]);
      const domains = await request(server())
        .get('/domains')
        .set('Authorization', KEY)
        .expect(200);
      expect(domains.body.map((d: { id: string }) => d.id)).toEqual([
        DOMAINS[0].id,
      ]);
    });

    it('gets 404 for another domain or its certificates', async () => {
      await request(server())
        .get('/certs/tls/2')
        .set('Authorization', KEY)
        .expect(404);
      await request(server())
        .post('/certs/tls/2/renew')
        .set('Authorization', KEY)
        .expect(404);
      await request(server())
        .get(`/domains/${DOMAINS[1].id}`)
        .set('Authorization', KEY)
        .expect(404);
      expect(tlsService.renew).not.toHaveBeenCalled();
    });

    it('passes the allowed hostnames to issuance', async () => {
      await request(server())
        .post('/certs/tls')
        .set('Authorization', KEY)
        .send({ csrPem: MOCK_CSR_PEM })
        .expect(201);
      expect(tlsService.create).toHaveBeenCalledWith(
        MOCK_USER.userId,
        expect.anything(),
        { restrictToHostnames: ['labxp.io'] },
      );
    });
  });

  describe('key limited to certificate #1', () => {
    beforeEach(() => asKey({ allowedCertIds: [1] }));

    it('sees #1 only and cannot request new certificates', async () => {
      await request(server())
        .get('/certs/tls/1')
        .set('Authorization', KEY)
        .expect(200);
      await request(server())
        .get('/certs/tls/2')
        .set('Authorization', KEY)
        .expect(404);
      await request(server())
        .post('/certs/tls')
        .set('Authorization', KEY)
        .send({ csrPem: MOCK_CSR_PEM })
        .expect(403);
      expect(tlsService.create).not.toHaveBeenCalled();
    });
  });

  it('returns the IP allowlist refusal as 403, not 401', async () => {
    authService.validateApiKey.mockRejectedValueOnce(
      new ForbiddenException(
        'This API key cannot be used from this IP address.',
      ),
    );
    const res = await request(server())
      .get('/certs/tls')
      .set('Authorization', KEY)
      .expect(403);
    expect(res.body.message).toBe(
      'This API key cannot be used from this IP address.',
    );
  });
});
