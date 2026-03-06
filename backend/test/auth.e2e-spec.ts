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
        statusCode: 302,
      }),
      getLoginRedirect: jest.fn().mockReturnValue({
        url: 'https://auth.example.com/application/o/authorize/',
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
    it('returns 302 redirect to Authentik enrollment', () =>
      request(app.getHttpServer())
        .get('/auth/register')
        .expect(302)
        .expect((res) => {
          expect(res.headers.location).toContain('auth.example.com');
        }));
  });

  // ─── GET /auth/login ─────────────────────────────────────────────────────
  describe('GET /auth/login', () => {
    it('returns 302 redirect to Authentik login', () =>
      request(app.getHttpServer())
        .get('/auth/login')
        .expect(302)
        .expect((res) => {
          expect(res.headers.location).toContain('auth.example.com');
        }));
  });

  // ─── GET /auth/callback ──────────────────────────────────────────────────
  describe('GET /auth/callback', () => {
    it('returns 200 with token data when code is valid', () =>
      request(app.getHttpServer())
        .get('/auth/callback')
        .query({ code: 'valid-code' })
        .expect(200)
        .expect((res) => {
          expect(res.body).toMatchObject({
            access_token: 'at_mock',
            token_type: 'Bearer',
          });
          expect(mockAuthService.handleCallback).toHaveBeenCalledWith(
            'valid-code',
          );
        }));

    it('returns 500 when code exchange fails', async () => {
      mockAuthService.handleCallback.mockRejectedValueOnce(
        new Error('Failed to exchange code'),
      );

      await request(app.getHttpServer())
        .get('/auth/callback')
        .query({ code: 'bad-code' })
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
            userId: MOCK_USER.userId,
          });
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
