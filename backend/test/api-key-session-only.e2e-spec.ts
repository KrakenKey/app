import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import request from 'supertest';
import { AuthController } from '../src/auth/auth.controller';
import { AuthService } from '../src/auth/auth.service';
import { ApiKeySecurityService } from '../src/auth/services/api-key-security.service';
import { DeviceAuthService } from '../src/auth/services/device-auth.service';
import { ApiKeyStrategy } from '../src/auth/strategies/api-key.strategy';
import { JwtStrategy } from '../src/auth/strategies/jwt.strategy';
import { ADMIN_GROUP } from '../src/auth/guards/admin.guard';
import { MetricsService } from '../src/metrics/metrics.service';
import { UsersController } from '../src/users/users.controller';
import { UsersService } from '../src/users/users.service';
import { AccountDeletionService } from '../src/users/services/account-deletion.service';
import { createTestApp } from './helpers/create-test-app';
import { MOCK_USER } from './helpers/mock-data';

// Real passport strategies and JwtOrApiKeyGuard, so an actual `Bearer kk_`
// header goes through the same path as in production. The key belongs to
// an admin, to show admin rights don't carry over to keys either.
describe('API keys on session-only routes (e2e)', () => {
  let app: INestApplication;
  const KEY = 'Bearer kk_test_key';

  const authService = {
    validateApiKey: jest.fn().mockResolvedValue({
      id: 'key-1',
      user: { id: MOCK_USER.userId, groups: [ADMIN_GROUP] },
    }),
    listApiKeys: jest.fn().mockResolvedValue([]),
    createApiKey: jest.fn(),
    revokeApiKey: jest.fn(),
    getFullProfile: jest.fn().mockResolvedValue({ id: MOCK_USER.userId }),
  };
  const usersService = {
    findAll: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue({ id: MOCK_USER.userId }),
    update: jest.fn(),
  };
  const accountDeletion = { deleteAccount: jest.fn() };
  const deviceAuth = { approve: jest.fn(), deny: jest.fn() };

  beforeAll(async () => {
    ({ app } = await createTestApp({
      controllers: [AuthController, UsersController],
      imports: [PassportModule],
      guardMode: 'none',
      providers: [
        ApiKeyStrategy,
        JwtStrategy,
        { provide: AuthService, useValue: authService },
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
        { provide: UsersService, useValue: usersService },
        { provide: AccountDeletionService, useValue: accountDeletion },
        { provide: DeviceAuthService, useValue: deviceAuth },
      ],
    }));
  });

  afterAll(() => app.close());

  it('still serves normal routes to a key', async () => {
    await request(app.getHttpServer())
      .get('/auth/profile')
      .set('Authorization', KEY)
      .expect(200);
    await request(app.getHttpServer())
      .get('/auth/api-keys')
      .set('Authorization', KEY)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/users/${MOCK_USER.userId}`)
      .set('Authorization', KEY)
      .expect(200);
  });

  it('refuses to create a key', async () => {
    await request(app.getHttpServer())
      .post('/auth/api-keys')
      .set('Authorization', KEY)
      .send({ name: 'replacement' })
      .expect(403);
    expect(authService.createApiKey).not.toHaveBeenCalled();
  });

  // Device login mints a key on approval, so a key approving one would be
  // the same escalation by another route.
  it('refuses to approve a CLI device login', async () => {
    await request(app.getHttpServer())
      .post('/auth/device/approve')
      .set('Authorization', KEY)
      .send({ userCode: 'BCDF-GHJK' })
      .expect(403);
    expect(deviceAuth.approve).not.toHaveBeenCalled();
  });

  it('refuses to delete a key', async () => {
    await request(app.getHttpServer())
      .delete('/auth/api-keys/key-2')
      .set('Authorization', KEY)
      .expect(403);
    expect(authService.revokeApiKey).not.toHaveBeenCalled();
  });

  it('refuses to change the account email', async () => {
    await request(app.getHttpServer())
      .patch(`/users/${MOCK_USER.userId}`)
      .set('Authorization', KEY)
      .send({ email: 'attacker@example.com' })
      .expect(403);
    expect(usersService.update).not.toHaveBeenCalled();
  });

  it('refuses to delete the account', async () => {
    await request(app.getHttpServer())
      .delete(`/users/${MOCK_USER.userId}`)
      .set('Authorization', KEY)
      .expect(403);
    expect(accountDeletion.deleteAccount).not.toHaveBeenCalled();
  });

  it("doesn't give an admin's key admin rights", async () => {
    await request(app.getHttpServer())
      .get('/users')
      .set('Authorization', KEY)
      .expect(403);
    await request(app.getHttpServer())
      .get('/users/someone-else')
      .set('Authorization', KEY)
      .expect(403);
  });

  it('still rejects an invalid key with 401', async () => {
    authService.validateApiKey.mockResolvedValueOnce(null);
    await request(app.getHttpServer())
      .get('/auth/profile')
      .set('Authorization', 'Bearer kk_wrong')
      .expect(401);
  });
});
