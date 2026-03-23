import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AuthGuard } from '@nestjs/passport/dist/auth.guard';
import { AuthController } from '../src/auth/auth.controller';
import { AuthService } from '../src/auth/auth.service';
import { createTestApp } from './helpers/create-test-app';
import { MOCK_USER } from './helpers/mock-data';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let unauthApp: INestApplication;
  let mockAuthService: Record<string, jest.Mock>;

  beforeAll(async () => {
    mockAuthService = {
      getRegisterRedirect: jest.fn().mockReturnValue({
        url: 'https://auth.example.com/if/flow/enrollment/',
        state: 'mock-state-register',
        statusCode: 302,
      }),
      getLoginRedirect: jest.fn().mockReturnValue({
        url: 'https://auth.example.com/application/o/authorize/',
        state: 'mock-state-login',
        statusCode: 302,
      }),
      handleCallback: jest.fn().mockResolvedValue({
        access_token: 'at_mock',
        id_token: 'id_mock',
        token_type: 'Bearer',
        expires_in: 3600,
      }),
      createApiKey: jest.fn().mockResolvedValue({
        apiKey: 'kk_abc123',
        id: 'key-uuid-1',
        name: 'my-key',
      }),
      getFullProfile: jest.fn().mockResolvedValue({
        id: MOCK_USER.userId,
        username: MOCK_USER.username,
        email: MOCK_USER.email,
        groups: [],
        displayName: null,
        createdAt: '2025-01-01T00:00:00.000Z',
        resourceCounts: { domains: 0, certificates: 0, apiKeys: 0 },
      }),
      updateProfile: jest.fn(),
    };

    // Authenticated app — guards overridden
    ({ app } = await createTestApp({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: mockAuthService }],
      extraGuards: [AuthGuard('jwt')],
    }));

    // Unauthenticated app — guards always reject with 401
    ({ app: unauthApp } = await createTestApp({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: mockAuthService }],
      guardMode: 'reject',
      extraGuards: [AuthGuard('jwt')],
    }));
  });

  afterAll(async () => {
    await app.close();
    await unauthApp.close();
  });

  // ─── GET /auth/register ───────────────────────────────────────────────────
  describe('GET /auth/register', () => {
    it('returns 302 redirect to Authentik enrollment and sets oauth_state cookie', () =>
      request(app.getHttpServer())
        .get('/auth/register')
        .expect(302)
        .expect((res) => {
          expect(res.headers.location).toContain('auth.example.com');
          const cookies = res.headers['set-cookie'] as unknown as string[];
          const stateCookie = cookies?.find((c: string) =>
            c.startsWith('oauth_state='),
          );
          expect(stateCookie).toBeDefined();
          expect(stateCookie).toContain('HttpOnly');
          expect(stateCookie).toContain('mock-state-register');
        }));
  });

  // ─── GET /auth/login ─────────────────────────────────────────────────────
  describe('GET /auth/login', () => {
    it('returns 302 redirect to Authentik login and sets oauth_state cookie', () =>
      request(app.getHttpServer())
        .get('/auth/login')
        .expect(302)
        .expect((res) => {
          expect(res.headers.location).toContain('auth.example.com');
          const cookies = res.headers['set-cookie'] as unknown as string[];
          const stateCookie = cookies?.find((c: string) =>
            c.startsWith('oauth_state='),
          );
          expect(stateCookie).toBeDefined();
          expect(stateCookie).toContain('HttpOnly');
          expect(stateCookie).toContain('mock-state-login');
        }));
  });

  // ─── GET /auth/callback ──────────────────────────────────────────────────
  describe('GET /auth/callback', () => {
    it('returns 200 with token data when code and state are valid', () =>
      request(app.getHttpServer())
        .get('/auth/callback')
        .set('Cookie', 'oauth_state=valid-state')
        .query({ code: 'valid-code', state: 'valid-state' })
        .expect(200)
        .expect((res) => {
          expect(res.body).toMatchObject({
            access_token: 'at_mock',
            token_type: 'Bearer',
          });
          expect(mockAuthService.handleCallback).toHaveBeenCalledWith(
            'valid-code',
            'valid-state',
            'valid-state',
          );
        }));

    it('returns 500 when code exchange fails', async () => {
      mockAuthService.handleCallback.mockRejectedValueOnce(
        new Error('Failed to exchange code'),
      );

      await request(app.getHttpServer())
        .get('/auth/callback')
        .set('Cookie', 'oauth_state=some-state')
        .query({ code: 'bad-code', state: 'some-state' })
        .expect(500);
    });
  });

  // ─── GET /auth/profile ───────────────────────────────────────────────────
  describe('GET /auth/profile', () => {
    it('returns 200 with user data when authenticated', () =>
      request(app.getHttpServer())
        .get('/auth/profile')
        .expect(200)
        .expect((res) => {
          expect(res.body).toMatchObject({
            id: MOCK_USER.userId,
            username: MOCK_USER.username,
            email: MOCK_USER.email,
          });
          expect(res.body.resourceCounts).toBeDefined();
        }));

    it('returns 401 when no auth token provided', () =>
      request(unauthApp.getHttpServer()).get('/auth/profile').expect(401));
  });

  // ─── POST /auth/api-keys ────────────────────────────────────────────────
  describe('POST /auth/api-keys', () => {
    it('returns 201 with API key when authenticated', () =>
      request(app.getHttpServer())
        .post('/auth/api-keys')
        .send({ name: 'my-key' })
        .expect(201)
        .expect((res) => {
          expect(res.body).toMatchObject({
            apiKey: expect.stringContaining('kk_'),
            id: expect.any(String),
            name: 'my-key',
          });
        }));

    it('passes default name when name is not provided', async () => {
      await request(app.getHttpServer())
        .post('/auth/api-keys')
        .send({})
        .expect(201);

      expect(mockAuthService.createApiKey).toHaveBeenCalledWith(
        MOCK_USER.userId,
        'default',
        undefined,
      );
    });

    it('returns 401 when no auth token provided', () =>
      request(unauthApp.getHttpServer())
        .post('/auth/api-keys')
        .send({ name: 'test' })
        .expect(401));
  });
});
