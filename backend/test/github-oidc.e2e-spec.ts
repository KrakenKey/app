import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import request from 'supertest';
import { AuthService } from '../src/auth/auth.service';
import { ApiKeySecurityService } from '../src/auth/services/api-key-security.service';
import { ApiKeyStrategy } from '../src/auth/strategies/api-key.strategy';
import { JwtStrategy } from '../src/auth/strategies/jwt.strategy';
import { MetricsService } from '../src/metrics/metrics.service';
import { GithubOidcController } from '../src/auth/oidc/github-oidc.controller';
import { GithubOidcService } from '../src/auth/oidc/github-oidc.service';
import { createTestApp } from './helpers/create-test-app';
import { MOCK_USER } from './helpers/mock-data';

// Real passport strategies and guard; the OIDC service is mocked.
describe('GitHub OIDC routes (e2e)', () => {
  let app: INestApplication;
  const KEY = 'Bearer kk_test_key';
  const authService = { validateApiKey: jest.fn() };
  const oidc = {
    exchange: jest.fn().mockResolvedValue({
      apiKey: 'kk_short',
      expiresAt: '2026-10-06T00:15:00.000Z',
      trustId: 't1',
      scopes: null,
    }),
    list: jest.fn().mockResolvedValue([]),
    create: jest.fn(),
    remove: jest.fn(),
  };
  const asKey = (fields: Record<string, unknown> = {}) =>
    authService.validateApiKey.mockResolvedValue({
      id: 'key-1',
      user: { id: MOCK_USER.userId, groups: [] },
      ...fields,
    });

  beforeAll(async () => {
    ({ app } = await createTestApp({
      controllers: [GithubOidcController],
      imports: [PassportModule],
      guardMode: 'none',
      providers: [
        ApiKeyStrategy,
        JwtStrategy,
        { provide: AuthService, useValue: authService },
        { provide: GithubOidcService, useValue: oidc },
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

  it('exchanges a token without any other credentials', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/github-oidc')
      .send({ token: 'header.payload.sig' })
      .expect(200);
    expect(res.body.apiKey).toBe('kk_short');
    expect(oidc.exchange).toHaveBeenCalledWith(
      'header.payload.sig',
      undefined,
      expect.anything(),
    );
  });

  it('validates the exchange body', async () => {
    await request(app.getHttpServer())
      .post('/auth/github-oidc')
      .send({ token: '' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/auth/github-oidc')
      .send({ token: 'x', trustId: 'not-a-uuid' })
      .expect(400);
    expect(oidc.exchange).not.toHaveBeenCalled();
  });

  it('refuses to create or delete trust policies with an API key', async () => {
    asKey();
    await request(app.getHttpServer())
      .post('/auth/github-oidc/trusts')
      .set('Authorization', KEY)
      .send({ name: 'x', repository: 'octo/site' })
      .expect(403);
    await request(app.getHttpServer())
      .delete('/auth/github-oidc/trusts/3f1c2b9e-1111-4111-8111-111111111111')
      .set('Authorization', KEY)
      .expect(403);
    expect(oidc.create).not.toHaveBeenCalled();
    expect(oidc.remove).not.toHaveBeenCalled();
  });

  it('lists trust policies for a key with account:read only', async () => {
    asKey({ scopes: ['account:read'] });
    await request(app.getHttpServer())
      .get('/auth/github-oidc/trusts')
      .set('Authorization', KEY)
      .expect(200);
    asKey({ scopes: ['certs:read'] });
    await request(app.getHttpServer())
      .get('/auth/github-oidc/trusts')
      .set('Authorization', KEY)
      .expect(403);
  });
});
