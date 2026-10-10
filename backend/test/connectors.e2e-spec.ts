import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { AuthService } from '../src/auth/auth.service';
import { ApiKeySecurityService } from '../src/auth/services/api-key-security.service';
import { ApiKeyStrategy } from '../src/auth/strategies/api-key.strategy';
import { JwtStrategy } from '../src/auth/strategies/jwt.strategy';
import { BillingService } from '../src/billing/billing.service';
import { TlsController } from '../src/certs/tls/tls.controller';
import { TlsService } from '../src/certs/tls/tls.service';
import { ConnectorNonceStore } from '../src/connectors/connector-nonce.store';
import { ConnectorsController } from '../src/connectors/connectors.controller';
import { ConnectorsService } from '../src/connectors/connectors.service';
import { Connector } from '../src/connectors/entities/connector.entity';
import { MetricsService } from '../src/metrics/metrics.service';
import { createTestApp } from './helpers/create-test-app';
import {
  FakeAuthService,
  FakeConnectorRepo,
  FakeNonceStore,
  connectorKey,
  newNonce,
  rfc3339,
  rotateRequest,
  tokenRequest,
} from './helpers/connector-fakes';
import { MOCK_USER } from './helpers/mock-data';

const DOMAIN_ID = '11111111-1111-4111-8111-111111111111';
const UNKNOWN_ID = '3f1c2b9e-9999-4999-8999-999999999999';

function csr(name: string) {
  return {
    subject: [{ name: 'commonName', shortName: 'CN', value: name }],
    attributes: [],
    publicKey: { keyType: 'ECDSA', bitLength: 256 },
    extensions: [
      { name: 'subjectAltName', altNames: [{ type: 2, value: name }] },
    ],
  };
}
const CERTS = [
  { id: 7, status: 'issued', parsedCsr: csr('web.labxp.io') },
  { id: 8, status: 'issued', parsedCsr: csr('example.com') },
];

/**
 * Runs the real ConnectorsService, controller, DTO validation, passport
 * strategies and JwtOrApiKeyGuard over in-memory stores. Two apps share
 * the stores: `dashboard` stands in for a signed-in session (guard
 * replaced by a pass-through), `api` uses the real guard, so keys the
 * connector gets can be tried against real routes.
 */
describe('Connectors (e2e)', () => {
  let dashboard: INestApplication;
  let api: INestApplication;
  let repo: FakeConnectorRepo;
  let auth: FakeAuthService;

  const tlsService = {
    findAll: jest.fn().mockResolvedValue(CERTS),
    findOne: jest.fn((id: number) =>
      Promise.resolve(CERTS.find((c) => c.id === id)),
    ),
    create: jest.fn().mockResolvedValue({ id: 9, status: 'pending' }),
    revoke: jest.fn().mockResolvedValue({ id: 7, status: 'revoking' }),
    renew: jest.fn().mockResolvedValue({ id: 7, status: 'renewing' }),
    toResponses: jest.fn((certs: unknown[]) => Promise.resolve(certs)),
    toResponse: jest.fn((cert: unknown) => Promise.resolve(cert)),
  };

  beforeAll(async () => {
    repo = new FakeConnectorRepo();
    auth = new FakeAuthService({ certIds: [7, 8], domainIds: [DOMAIN_ID] });
    const nonces = new FakeNonceStore();
    const shared = [
      ConnectorsService,
      { provide: getRepositoryToken(Connector), useValue: repo },
      { provide: AuthService, useValue: auth },
      { provide: ConnectorNonceStore, useValue: nonces },
      {
        provide: BillingService,
        useValue: { resolveUserTier: jest.fn().mockResolvedValue('free') },
      },
    ];

    ({ app: dashboard } = await createTestApp({
      controllers: [ConnectorsController],
      providers: shared,
    }));

    ({ app: api } = await createTestApp({
      controllers: [ConnectorsController, TlsController],
      imports: [PassportModule],
      guardMode: 'none',
      keyAccessDomains: [{ id: DOMAIN_ID, hostname: 'labxp.io' }],
      providers: [
        ...shared,
        ApiKeyStrategy,
        JwtStrategy,
        { provide: TlsService, useValue: tlsService },
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

  afterAll(async () => {
    await dashboard.close();
    await api.close();
  });

  const session = () => request(dashboard.getHttpServer());
  const anon = () => request(api.getHttpServer());

  const BODY = {
    name: 'web-01',
    clientLabel: 'Acme',
    scopes: ['certs:read', 'certs:renew'],
    allowedCertIds: [7],
  };

  async function createConnector(body: Record<string, unknown> = BODY) {
    const res = await session().post('/connectors').send(body).expect(201);
    return res.body as {
      connector: { id: string; name: string };
      enrolmentToken: string;
    };
  }

  async function enrolled(body: Record<string, unknown> = BODY) {
    const { connector, enrolmentToken } = await createConnector(body);
    const key = connectorKey();
    await anon()
      .post('/connectors/enrol')
      .send({
        token: enrolmentToken,
        publicKey: key.publicB64,
        version: '0.2.0',
        os: 'linux',
        arch: 'amd64',
      })
      .expect(200);
    return { id: connector.id, key };
  }

  const enrolBody = (token: string, publicKey = connectorKey().publicB64) => ({
    token,
    publicKey,
    version: '0.2.0',
    os: 'linux',
    arch: 'amd64',
  });

  describe('dashboard', () => {
    it('creates a connector and shows the token once', async () => {
      const { connector, enrolmentToken } = await createConnector();
      expect(enrolmentToken).toMatch(/^kkce_[A-Za-z0-9_-]{43}$/);
      expect(connector).toMatchObject({
        name: 'web-01',
        clientLabel: 'Acme',
        scopes: ['certs:read', 'certs:renew'],
        allowedCertIds: [7],
        allowedDomainIds: null,
        enrolledAt: null,
        revokedAt: null,
        lastSeenAt: null,
      });
      const list = await session().get('/connectors').expect(200);
      expect(JSON.stringify(list.body)).not.toContain(enrolmentToken);
      expect(list.body.map((c: { id: string }) => c.id)).toContain(
        connector.id,
      );
      const one = await session()
        .get(`/connectors/${connector.id}`)
        .expect(200);
      expect(one.body).not.toHaveProperty('enrolmentTokenHash');
    });

    it.each([
      ['no restriction', { allowedCertIds: undefined }],
      ['empty restrictions', { allowedCertIds: [], allowedDomainIds: [] }],
      ['no certs:read', { scopes: ['certs:renew'] }],
      [
        'a scope connectors cannot have',
        { scopes: ['certs:read', 'certs:issue'] },
      ],
      ['no scopes', { scopes: [] }],
      ['a long name', { name: 'x'.repeat(65) }],
      ['an empty name', { name: '' }],
      ['a foreign certificate', { allowedCertIds: [99] }],
      [
        'a bad domain id',
        { allowedCertIds: undefined, allowedDomainIds: ['x'] },
      ],
    ])('refuses %s with 400', async (_, over) => {
      await session()
        .post('/connectors')
        .send({ ...BODY, ...over })
        .expect(400);
    });

    it('accepts a domain restriction alone', async () => {
      const { connector } = await createConnector({
        name: 'dom',
        scopes: ['certs:read'],
        allowedDomainIds: [DOMAIN_ID],
      });
      expect(connector).toMatchObject({
        allowedCertIds: null,
        allowedDomainIds: [DOMAIN_ID],
      });
    });

    it('renames, clears the client label, and 404s unknown ids', async () => {
      const { connector } = await createConnector();
      const res = await session()
        .patch(`/connectors/${connector.id}`)
        .send({ name: 'web-02', clientLabel: null })
        .expect(200);
      expect(res.body).toMatchObject({ name: 'web-02', clientLabel: null });
      await session()
        .patch(`/connectors/${connector.id}`)
        .send({ name: null })
        .expect(400);
      await session().get(`/connectors/${UNKNOWN_ID}`).expect(404);
      await session().get('/connectors/not-a-uuid').expect(400);
    });

    it('caps active connectors at 50, counting only unrevoked ones', async () => {
      repo.rows = [];
      for (let i = 0; i < 50; i++) await createConnector();
      const res = await session().post('/connectors').send(BODY).expect(402);
      expect(res.body.message).toBe('Connector limit reached');
      await session().delete(`/connectors/${repo.rows[0].id}`).expect(204);
      await createConnector();
      repo.rows = [];
    });
  });

  describe('enrolment', () => {
    it('enrols once; the token is single use', async () => {
      const { connector, enrolmentToken } = await createConnector();
      const res = await anon()
        .post('/connectors/enrol')
        .send(enrolBody(enrolmentToken))
        .expect(200);
      expect(res.body).toEqual({ connectorId: connector.id, name: 'web-01' });

      const again = await anon()
        .post('/connectors/enrol')
        .send(enrolBody(enrolmentToken))
        .expect(401);
      expect(again.body.message).toBe('Invalid enrolment token');

      const shown = await session()
        .get(`/connectors/${connector.id}`)
        .expect(200);
      expect(shown.body).toMatchObject({
        version: '0.2.0',
        os: 'linux',
        arch: 'amd64',
      });
      expect(shown.body.enrolledAt).toEqual(expect.any(String));
      expect(shown.body.lastSeenAt).toEqual(expect.any(String));
    });

    it('lets only one of two simultaneous enrolments win', async () => {
      const { enrolmentToken } = await createConnector();
      const results = await Promise.all(
        [1, 2, 3].map(() =>
          anon().post('/connectors/enrol').send(enrolBody(enrolmentToken)),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([200, 401, 401]);
    });

    it('refuses an expired token', async () => {
      const { connector, enrolmentToken } = await createConnector();
      repo.rows.find((r) => r.id === connector.id)!.enrolmentTokenExpiresAt =
        new Date(Date.now() - 1000);
      await anon()
        .post('/connectors/enrol')
        .send(enrolBody(enrolmentToken))
        .expect(401);
    });

    it('refuses unknown, malformed and revoked-connector tokens alike', async () => {
      const { connector, enrolmentToken } = await createConnector();
      await session().delete(`/connectors/${connector.id}`).expect(204);
      for (const token of [
        enrolmentToken,
        `kkce_${'A'.repeat(43)}`,
        'kk_not_an_enrolment_token',
      ]) {
        const res = await anon()
          .post('/connectors/enrol')
          .send(enrolBody(token))
          .expect(401);
        expect(res.body.message).toBe('Invalid enrolment token');
      }
    });

    it('replaces the token until the connector enrols, then 409s', async () => {
      const { connector, enrolmentToken: first } = await createConnector();
      const res = await session()
        .post(`/connectors/${connector.id}/enrolment-token`)
        .expect(201);
      const second = res.body.enrolmentToken as string;
      expect(second).not.toBe(first);
      await anon().post('/connectors/enrol').send(enrolBody(first)).expect(401);
      await anon()
        .post('/connectors/enrol')
        .send(enrolBody(second))
        .expect(200);
      await session()
        .post(`/connectors/${connector.id}/enrolment-token`)
        .expect(409);
    });

    it('400s a malformed public key without using up the token', async () => {
      const { enrolmentToken } = await createConnector();
      for (const publicKey of [
        'AAAA',
        Buffer.alloc(32, 1).toString('base64url'),
        Buffer.alloc(33, 1).toString('base64'),
      ]) {
        await anon()
          .post('/connectors/enrol')
          .send(enrolBody(enrolmentToken, publicKey))
          .expect(400);
      }
      await anon()
        .post('/connectors/enrol')
        .send(enrolBody(enrolmentToken))
        .expect(200);
    });

    it('validates the agent details', async () => {
      const { enrolmentToken } = await createConnector();
      await anon()
        .post('/connectors/enrol')
        .send({ ...enrolBody(enrolmentToken), os: 'linux\nx' })
        .expect(400);
      await anon()
        .post('/connectors/enrol')
        .send({ ...enrolBody(enrolmentToken), version: 'v'.repeat(65) })
        .expect(400);
    });
  });

  describe('key exchange', () => {
    const refused = async (body: Record<string, unknown>) => {
      const res = await anon().post('/connectors/token').send(body).expect(401);
      expect(res.body.message).toBe('Invalid connector credentials');
    };

    it('issues a one-hour key for a signed request', async () => {
      const { id, key } = await enrolled();
      const res = await anon()
        .post('/connectors/token')
        .send(tokenRequest(key, id))
        .expect(200);
      expect(res.body.apiKey).toMatch(/^kk_/);
      const ttl = Date.parse(res.body.expiresAt) - Date.now();
      expect(ttl).toBeGreaterThan(3590_000);
      expect(ttl).toBeLessThanOrEqual(3600_000);
      const stored = auth.keys.get(res.body.apiKey)!;
      expect(stored).toMatchObject({
        source: 'connector',
        connectorId: id,
        scopes: ['certs:read', 'certs:renew'],
        allowedCertIds: [7],
        allowedDomainIds: null,
      });
    });

    it('refuses a replayed nonce', async () => {
      const { id, key } = await enrolled();
      const body = tokenRequest(key, id);
      await anon().post('/connectors/token').send(body).expect(200);
      await refused(body);
      // Same nonce, fresh signature: still refused
      await refused(tokenRequest(key, id, { nonce: body.nonce }));
    });

    it('refuses timestamps more than 300 seconds off', async () => {
      const { id, key } = await enrolled();
      await refused(tokenRequest(key, id, { timestamp: rfc3339(-305) }));
      await refused(tokenRequest(key, id, { timestamp: rfc3339(305) }));
      await anon()
        .post('/connectors/token')
        .send(tokenRequest(key, id, { timestamp: rfc3339(-280) }))
        .expect(200);
    });

    it('refuses bad signatures', async () => {
      const { id, key } = await enrolled();
      await refused(tokenRequest(connectorKey(), id));
      await refused(tokenRequest(key, id, { signedId: UNKNOWN_ID }));
      const body = tokenRequest(key, id);
      await refused({ ...body, nonce: newNonce() });
      await refused({ ...body, timestamp: rfc3339(-60) });
    });

    it('refuses unknown and unenrolled connectors', async () => {
      const key = connectorKey();
      await refused(tokenRequest(key, UNKNOWN_ID));
      const { connector } = await createConnector();
      await refused(tokenRequest(key, connector.id));
    });

    it('400s malformed fields', async () => {
      const { id, key } = await enrolled();
      const body = tokenRequest(key, id);
      for (const over of [
        { connectorId: 'nope' },
        { timestamp: new Date().toISOString() },
        { nonce: 'short' },
        { nonce: 'x'.repeat(65) },
        { nonce: `${newNonce()}=` },
        { signature: 'AAAA' },
      ]) {
        await anon()
          .post('/connectors/token')
          .send({ ...body, ...over })
          .expect(400);
      }
    });
  });

  describe('key rotation', () => {
    it('switches to the new key, signed by the current one', async () => {
      const { id, key } = await enrolled();
      const next = connectorKey();
      await anon()
        .post('/connectors/rotate')
        .send(rotateRequest(next, id, next.publicB64))
        .expect(401);
      await anon()
        .post('/connectors/rotate')
        .send(rotateRequest(key, id, next.publicB64))
        .expect(204);
      await anon()
        .post('/connectors/token')
        .send(tokenRequest(key, id))
        .expect(401);
      await anon()
        .post('/connectors/token')
        .send(tokenRequest(next, id))
        .expect(200);
    });

    it('does not accept a token signature as a rotation', async () => {
      const { id, key } = await enrolled();
      const body = tokenRequest(key, id);
      await anon()
        .post('/connectors/rotate')
        .send({ ...body, newPublicKey: connectorKey().publicB64 })
        .expect(401);
    });
  });

  describe('revocation', () => {
    it('stops live keys, key exchange and rotation, and stays listed', async () => {
      const { id, key } = await enrolled();
      const res = await anon()
        .post('/connectors/token')
        .send(tokenRequest(key, id))
        .expect(200);
      const bearer = `Bearer ${res.body.apiKey}`;
      await anon().get('/certs/tls/7').set('Authorization', bearer).expect(200);

      await session().delete(`/connectors/${id}`).expect(204);

      await anon().get('/certs/tls/7').set('Authorization', bearer).expect(401);
      await anon()
        .post('/connectors/token')
        .send(tokenRequest(key, id))
        .expect(401);
      await anon()
        .post('/connectors/rotate')
        .send(rotateRequest(key, id, connectorKey().publicB64))
        .expect(401);
      const shown = await session().get(`/connectors/${id}`).expect(200);
      expect(shown.body.revokedAt).toEqual(expect.any(String));
      // Revoking again is fine
      await session().delete(`/connectors/${id}`).expect(204);
      await session().delete(`/connectors/${UNKNOWN_ID}`).expect(404);
    });
  });

  describe('issued keys under the existing guards', () => {
    let bearer: string;

    beforeAll(async () => {
      const { id, key } = await enrolled();
      const res = await anon()
        .post('/connectors/token')
        .send(tokenRequest(key, id));
      bearer = `Bearer ${res.body.apiKey}`;
    });

    it('sees only its certificates', async () => {
      await anon().get('/certs/tls/7').set('Authorization', bearer).expect(200);
      await anon().get('/certs/tls/8').set('Authorization', bearer).expect(404);
      const list = await anon()
        .get('/certs/tls')
        .set('Authorization', bearer)
        .expect(200);
      expect(list.body.map((c: { id: number }) => c.id)).toEqual([7]);
    });

    it('cannot issue, revoke or manage connectors', async () => {
      await anon()
        .post('/certs/tls/7/revoke')
        .set('Authorization', bearer)
        .send({})
        .expect(403);
      await anon().get('/connectors').set('Authorization', bearer).expect(403);
      await anon()
        .post('/connectors')
        .set('Authorization', bearer)
        .send(BODY)
        .expect(403);
    });
  });

  describe('dashboard routes with an API key', () => {
    const KEY = 'kk_dashboard_made_key';

    beforeAll(() => {
      auth.addKey(KEY, MOCK_USER.userId, { scopes: ['account:read'] });
    });

    it('can list and read with account:read', async () => {
      const { connector } = await createConnector();
      await anon()
        .get('/connectors')
        .set('Authorization', `Bearer ${KEY}`)
        .expect(200);
      await anon()
        .get(`/connectors/${connector.id}`)
        .set('Authorization', `Bearer ${KEY}`)
        .expect(200);
    });

    it('cannot create, change, re-issue tokens or revoke (session only)', async () => {
      const { connector } = await createConnector();
      const full = 'kk_full_access_key';
      auth.addKey(full, MOCK_USER.userId);
      for (const bearer of [KEY, full]) {
        const h = { Authorization: `Bearer ${bearer}` };
        await anon().post('/connectors').set(h).send(BODY).expect(403);
        await anon()
          .patch(`/connectors/${connector.id}`)
          .set(h)
          .send({ name: 'x' })
          .expect(403);
        await anon()
          .post(`/connectors/${connector.id}/enrolment-token`)
          .set(h)
          .expect(403);
        await anon().delete(`/connectors/${connector.id}`).set(h).expect(403);
      }
      const shown = await session()
        .get(`/connectors/${connector.id}`)
        .expect(200);
      expect(shown.body).toMatchObject({ name: 'web-01', revokedAt: null });
    });

    it('needs a credential at all', async () => {
      await anon().get('/connectors').expect(401);
      await anon().post('/connectors').send(BODY).expect(401);
    });
  });
});
