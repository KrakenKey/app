import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
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
import { ConnectorDeployment } from '../src/connectors/entities/connector-deployment.entity';
import { ConnectorReportsService } from '../src/connectors/connector-reports.service';
import { TlsCrt } from '../src/certs/tls/entities/tls-crt.entity';
import { User } from '../src/users/entities/user.entity';
import { AlertsService } from '../src/notifications/channels/alerts.service';
import { EmailService } from '../src/notifications/email.service';
import { MetricsService } from '../src/metrics/metrics.service';
import { createTestApp } from './helpers/create-test-app';
import {
  FakeAuthService,
  FakeConnectorRepo,
  FakeDeploymentRepo,
  fixedRepo,
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
  {
    id: 7,
    userId: MOCK_USER.userId,
    status: 'issued',
    parsedCsr: csr('web.labxp.io'),
  },
  {
    id: 8,
    userId: MOCK_USER.userId,
    status: 'issued',
    parsedCsr: csr('example.com'),
  },
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
  let deployments: FakeDeploymentRepo;
  let auth: FakeAuthService;
  const alerts = { emit: jest.fn().mockResolvedValue(1) };
  const email = {
    sendDeployFailed: jest.fn().mockResolvedValue(undefined),
    sendConnectorStale: jest.fn().mockResolvedValue(undefined),
  };

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
    deployments = new FakeDeploymentRepo();
    auth = new FakeAuthService({ certIds: [7, 8], domainIds: [DOMAIN_ID] });
    const nonces = new FakeNonceStore();
    const owner = { id: MOCK_USER.userId, role: null, ...MOCK_USER };
    const shared = [
      ConnectorsService,
      ConnectorReportsService,
      { provide: getRepositoryToken(Connector), useValue: repo },
      {
        provide: getRepositoryToken(ConnectorDeployment),
        useValue: deployments,
      },
      { provide: getRepositoryToken(TlsCrt), useValue: fixedRepo(CERTS) },
      { provide: getRepositoryToken(User), useValue: fixedRepo([owner]) },
      {
        // Transactions for reports; plain getRepository for RoleGuard
        provide: DataSource,
        useValue: {
          transaction: (cb: (m: unknown) => unknown) =>
            cb({
              getRepository: (e: unknown) =>
                e === Connector ? repo : deployments,
            }),
          getRepository: () => ({ findOne: async () => owner }),
        },
      },
      { provide: AuthService, useValue: auth },
      { provide: ConnectorNonceStore, useValue: nonces },
      { provide: AlertsService, useValue: alerts },
      { provide: EmailService, useValue: email },
      {
        provide: BillingService,
        useValue: {
          resolveUserTier: jest.fn().mockResolvedValue('free'),
          getResourceCountUserIds: jest
            .fn()
            .mockResolvedValue([MOCK_USER.userId]),
        },
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
      enrollmentToken: string;
    };
  }

  async function enrolled(body: Record<string, unknown> = BODY) {
    const { connector, enrollmentToken } = await createConnector(body);
    const key = connectorKey();
    await anon()
      .post('/connectors/enroll')
      .send({
        token: enrollmentToken,
        publicKey: key.publicB64,
        version: '0.2.0',
        os: 'linux',
        arch: 'amd64',
      })
      .expect(200);
    return { id: connector.id, key };
  }

  const enrollBody = (token: string, publicKey = connectorKey().publicB64) => ({
    token,
    publicKey,
    version: '0.2.0',
    os: 'linux',
    arch: 'amd64',
  });

  describe('dashboard', () => {
    it('creates a connector and shows the token once', async () => {
      const { connector, enrollmentToken } = await createConnector();
      expect(enrollmentToken).toMatch(/^kkce_[A-Za-z0-9_-]{43}$/);
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
      expect(JSON.stringify(list.body)).not.toContain(enrollmentToken);
      expect(list.body.map((c: { id: string }) => c.id)).toContain(
        connector.id,
      );
      const one = await session()
        .get(`/connectors/${connector.id}`)
        .expect(200);
      expect(one.body).not.toHaveProperty('enrollmentTokenHash');
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

  describe('enrollment', () => {
    it('enrolls once; the token is single use', async () => {
      const { connector, enrollmentToken } = await createConnector();
      const res = await anon()
        .post('/connectors/enroll')
        .send(enrollBody(enrollmentToken))
        .expect(200);
      expect(res.body).toEqual({ connectorId: connector.id, name: 'web-01' });

      const again = await anon()
        .post('/connectors/enroll')
        .send(enrollBody(enrollmentToken))
        .expect(401);
      expect(again.body.message).toBe('Invalid enrollment token');

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

    it('lets only one of two simultaneous enrollments win', async () => {
      const { enrollmentToken } = await createConnector();
      const results = await Promise.all(
        [1, 2, 3].map(() =>
          anon().post('/connectors/enroll').send(enrollBody(enrollmentToken)),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([200, 401, 401]);
    });

    it('refuses an expired token', async () => {
      const { connector, enrollmentToken } = await createConnector();
      repo.rows.find((r) => r.id === connector.id)!.enrollmentTokenExpiresAt =
        new Date(Date.now() - 1000);
      await anon()
        .post('/connectors/enroll')
        .send(enrollBody(enrollmentToken))
        .expect(401);
    });

    it('refuses unknown, malformed and revoked-connector tokens alike', async () => {
      const { connector, enrollmentToken } = await createConnector();
      await session().delete(`/connectors/${connector.id}`).expect(204);
      for (const token of [
        enrollmentToken,
        `kkce_${'A'.repeat(43)}`,
        'kk_not_an_enrollment_token',
      ]) {
        const res = await anon()
          .post('/connectors/enroll')
          .send(enrollBody(token))
          .expect(401);
        expect(res.body.message).toBe('Invalid enrollment token');
      }
    });

    it('replaces the token until the connector enrolls, then 409s', async () => {
      const { connector, enrollmentToken: first } = await createConnector();
      const res = await session()
        .post(`/connectors/${connector.id}/enrollment-token`)
        .expect(201);
      const second = res.body.enrollmentToken as string;
      expect(second).not.toBe(first);
      await anon()
        .post('/connectors/enroll')
        .send(enrollBody(first))
        .expect(401);
      await anon()
        .post('/connectors/enroll')
        .send(enrollBody(second))
        .expect(200);
      await session()
        .post(`/connectors/${connector.id}/enrollment-token`)
        .expect(409);
    });

    it('400s a malformed public key without using up the token', async () => {
      const { enrollmentToken } = await createConnector();
      for (const publicKey of [
        'AAAA',
        Buffer.alloc(32, 1).toString('base64url'),
        Buffer.alloc(33, 1).toString('base64'),
      ]) {
        await anon()
          .post('/connectors/enroll')
          .send(enrollBody(enrollmentToken, publicKey))
          .expect(400);
      }
      await anon()
        .post('/connectors/enroll')
        .send(enrollBody(enrollmentToken))
        .expect(200);
    });

    it('validates the agent details', async () => {
      const { enrollmentToken } = await createConnector();
      await anon()
        .post('/connectors/enroll')
        .send({ ...enrollBody(enrollmentToken), os: 'linux\nx' })
        .expect(400);
      await anon()
        .post('/connectors/enroll')
        .send({ ...enrollBody(enrollmentToken), version: 'v'.repeat(65) })
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

  describe('status reports', () => {
    let id: string;
    let bearer: string;

    const target = (label: string, state: string, over = {}) => ({
      label,
      state,
      updatedAt: '2026-10-10T14:00:00Z',
      ...over,
    });
    const report = (certificates: unknown[], auth = bearer) =>
      anon()
        .post('/connectors/report')
        .set('Authorization', auth)
        .send({ version: '0.3.0', os: 'linux', arch: 'arm64', certificates });

    beforeAll(async () => {
      const e = await enrolled({ ...BODY, allowedCertIds: [7] });
      id = e.id;
      const res = await anon()
        .post('/connectors/token')
        .send(tokenRequest(e.key, id));
      bearer = `Bearer ${res.body.apiKey}`;
    });
    beforeEach(() => {
      alerts.emit.mockClear();
      email.sendDeployFailed.mockClear();
    });

    it('stores targets and shows them on the connector and the certificate', async () => {
      await report([
        {
          certificateId: 7,
          targets: [
            target('nginx-main', 'verified', { serial: '04AB' }),
            target('haproxy', 'staged'),
          ],
        },
      ]).expect(200);

      const one = await session().get(`/connectors/${id}`).expect(200);
      expect(one.body).toMatchObject({ version: '0.3.0', arch: 'arm64' });
      expect(one.body.deployments).toEqual([
        expect.objectContaining({ label: 'haproxy', state: 'staged' }),
        {
          connectorId: id,
          connectorName: 'web-01',
          certificateId: 7,
          label: 'nginx-main',
          state: 'verified',
          serial: '04ab',
          error: null,
          updatedAt: '2026-10-10T14:00:00.000Z',
          reportedAt: expect.any(String),
        },
      ]);

      const byCert = await session()
        .get('/connectors/deployments?certificateId=7')
        .expect(200);
      expect(
        byCert.body
          .filter((d: { connectorId: string }) => d.connectorId === id)
          .map((d: { label: string }) => d.label),
      ).toEqual(['haproxy', 'nginx-main']);
      await session().get('/connectors/deployments').expect(400);
      await session()
        .get('/connectors/deployments?certificateId=abc')
        .expect(400);
    });

    it('drops targets the connector stops listing for a certificate', async () => {
      await report([
        { certificateId: 7, targets: [target('nginx-main', 'verified')] },
      ]).expect(200);
      const one = await session().get(`/connectors/${id}`).expect(200);
      expect(
        one.body.deployments.map((d: { label: string }) => d.label),
      ).toEqual(['nginx-main']);
    });

    it('alerts once when a target starts failing', async () => {
      const failing = [
        {
          certificateId: 7,
          targets: [
            target('nginx-main', 'failed', { error: 'reload\nfailed' }),
          ],
        },
      ];
      await report(failing).expect(200);
      await report(failing).expect(200);
      expect(alerts.emit).toHaveBeenCalledTimes(1);
      expect(alerts.emit).toHaveBeenCalledWith(
        MOCK_USER.userId,
        'deploy.failed',
        expect.objectContaining({
          details: expect.objectContaining({
            connectorName: 'web-01',
            clientLabel: 'Acme',
            certificateId: 7,
            label: 'nginx-main',
            state: 'failed',
            error: 'reload failed',
          }),
        }),
      );
      expect(email.sendDeployFailed).toHaveBeenCalledTimes(1);

      await report([
        { certificateId: 7, targets: [target('nginx-main', 'verified')] },
      ]).expect(200);
      await report([
        { certificateId: 7, targets: [target('nginx-main', 'rolled_back')] },
      ]).expect(200);
      expect(alerts.emit).toHaveBeenCalledTimes(2);
    });

    it('skips certificates outside the connector restrictions and stores the rest', async () => {
      const res = await report([
        {
          certificateId: 7,
          targets: [
            target('nginx-main', 'verified', {
              updatedAt: '2026-10-10T15:00:00.123Z',
            }),
          ],
        },
        { certificateId: 8, targets: [target('x', 'verified')] },
        { certificateId: 999, targets: [] },
      ]).expect(200);
      expect(res.body).toEqual({
        accepted: 1,
        rejectedCertificateIds: [8, 999],
      });
      expect(deployments.rows.some((d) => d.certificateId === 8)).toBe(false);
      const one = await session().get(`/connectors/${id}`).expect(200);
      expect(one.body.deployments).toEqual([
        expect.objectContaining({
          certificateId: 7,
          label: 'nginx-main',
          updatedAt: '2026-10-10T15:00:00.123Z',
        }),
      ]);
    });

    it('only accepts keys issued to a connector', async () => {
      auth.addKey('kk_regular_full_key', MOCK_USER.userId);
      const res = await report([], 'Bearer kk_regular_full_key').expect(403);
      expect(res.body.message).toBe(
        'Only a key issued to a connector can send connector reports.',
      );
      auth.addKey('kk_regular_scoped_key', MOCK_USER.userId, {
        scopes: ['account:read'],
      });
      await report([], 'Bearer kk_regular_scoped_key').expect(403);
      await anon().post('/connectors/report').send({}).expect(401);
    });

    it.each([
      [
        'a bad label',
        [{ certificateId: 7, targets: [target('a b', 'verified')] }],
      ],
      [
        'an unknown state',
        [{ certificateId: 7, targets: [target('a', 'done')] }],
      ],
      [
        'a non-hex serial',
        [
          {
            certificateId: 7,
            targets: [target('a', 'verified', { serial: 'zz' })],
          },
        ],
      ],
      [
        'a long error',
        [
          {
            certificateId: 7,
            targets: [target('a', 'failed', { error: 'e'.repeat(201) })],
          },
        ],
      ],
      [
        'a bad updatedAt',
        [
          {
            certificateId: 7,
            targets: [target('a', 'verified', { updatedAt: 'yesterday' })],
          },
        ],
      ],
      [
        'too many targets',
        [
          {
            certificateId: 7,
            targets: Array.from({ length: 51 }, (_, i) =>
              target(`t${i}`, 'verified'),
            ),
          },
        ],
      ],
      [
        'a duplicate label',
        [
          {
            certificateId: 7,
            targets: [target('a', 'verified'), target('a', 'failed')],
          },
        ],
      ],
      [
        'a duplicate certificate',
        [
          { certificateId: 7, targets: [] },
          { certificateId: 7, targets: [] },
        ],
      ],
      [
        'a non-numeric certificate id',
        [{ certificateId: 'seven', targets: [] }],
      ],
    ])('400s %s', async (_, certificates) => {
      await report(certificates as unknown[]).expect(400);
    });

    it('stops accepting reports once the connector is revoked', async () => {
      await session().delete(`/connectors/${id}`).expect(204);
      await report([]).expect(401);
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
          .post(`/connectors/${connector.id}/enrollment-token`)
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
