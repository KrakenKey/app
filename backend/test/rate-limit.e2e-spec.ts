import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { TierAwareThrottlerGuard } from '../src/throttler/guards/tier-aware-throttler.guard';
import { TIER_RESOLVER } from '../src/throttler/interfaces/tier-resolver.interface';
import { TlsController } from '../src/certs/tls/tls.controller';
import { TlsService } from '../src/certs/tls/tls.service';
import { JwtOrApiKeyGuard } from '../src/auth/guards/jwt-or-api-key.guard';

describe('Rate Limiting (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        // In-memory storage (no Redis needed for tests).
        // The default throttler config here is overridden by TierAwareThrottlerGuard
        // which resolves per-category limits from RATE_LIMIT_TIERS.
        ThrottlerModule.forRoot({
          throttlers: [{ name: 'default', ttl: 60_000, limit: 30 }],
        }),
      ],
      controllers: [TlsController],
      providers: [
        {
          provide: APP_GUARD,
          useClass: TierAwareThrottlerGuard,
        },
        {
          provide: TIER_RESOLVER,
          useValue: { resolve: async () => 'free' },
        },
        {
          provide: TlsService,
          useValue: {
            create: jest.fn().mockResolvedValue({ id: 1, status: 'pending' }),
            findAll: jest.fn().mockResolvedValue([]),
            findOne: jest.fn().mockResolvedValue({}),
            update: jest.fn().mockResolvedValue({}),
            remove: jest.fn().mockResolvedValue({}),
            revoke: jest.fn().mockResolvedValue({}),
            renew: jest.fn().mockResolvedValue({}),
            retry: jest.fn().mockResolvedValue({}),
          },
        },
      ],
    })
      .overrideGuard(JwtOrApiKeyGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const req = context.switchToHttp().getRequest();
          req.user = { userId: 'test-user-123' };
          return true;
        },
      })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /certs/tls should return 429 after exceeding EXPENSIVE rate limit', async () => {
    const server = app.getHttpServer();
    const body = {
      csrPem:
        '-----BEGIN CERTIFICATE REQUEST-----\ntest\n-----END CERTIFICATE REQUEST-----',
    };

    // Fake JWT so the throttler tracks by user ID (sub claim).
    // The guard decodes the payload without verification for tracking purposes.
    const payload = Buffer.from(
      JSON.stringify({ sub: 'test-user-123' }),
    ).toString('base64url');
    const fakeJwt = `eyJhbGciOiJSUzI1NiJ9.${payload}.fake`;

    // Free tier EXPENSIVE limit: 5 requests per hour.
    // First 5 requests should succeed (HTTP 201).
    for (let i = 0; i < 5; i++) {
      const res = await request(server)
        .post('/certs/tls')
        .set('Authorization', `Bearer ${fakeJwt}`)
        .send(body);
      expect(res.status).toBe(201);
    }

    // 6th request should be throttled (HTTP 429).
    const res = await request(server)
      .post('/certs/tls')
      .set('Authorization', `Bearer ${fakeJwt}`)
      .send(body);
    expect(res.status).toBe(429);
  });
});
