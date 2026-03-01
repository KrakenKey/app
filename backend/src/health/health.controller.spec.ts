import { Test, TestingModule } from '@nestjs/testing';
import { HealthCheckService, TypeOrmHealthIndicator } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { RedisHealthIndicator } from './redis.health';
import { AuthentikHealthIndicator } from './authentik.health';

describe('HealthController', () => {
  let controller: HealthController;
  let mockHealthCheckService: { check: jest.Mock };
  let mockDb: { pingCheck: jest.Mock };
  let mockRedis: { isHealthy: jest.Mock };
  let mockAuthentik: { isHealthy: jest.Mock };

  beforeEach(async () => {
    mockHealthCheckService = { check: jest.fn() };
    mockDb = { pingCheck: jest.fn() };
    mockRedis = { isHealthy: jest.fn() };
    mockAuthentik = { isHealthy: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthCheckService, useValue: mockHealthCheckService },
        { provide: TypeOrmHealthIndicator, useValue: mockDb },
        { provide: RedisHealthIndicator, useValue: mockRedis },
        { provide: AuthentikHealthIndicator, useValue: mockAuthentik },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  // ---------------------------------------------------------------------------
  // GET /health  (liveness)
  // ---------------------------------------------------------------------------
  describe('health()', () => {
    it('returns status ok', () => {
      expect(controller.health().status).toBe('ok');
    });

    it('returns an ISO 8601 timestamp', () => {
      const { timestamp } = controller.health();
      // Round-trip: parsing and re-serialising should yield the same string
      expect(new Date(timestamp).toISOString()).toBe(timestamp);
    });

    it('returns a version string', () => {
      expect(typeof controller.health().version).toBe('string');
    });

    it('returns NODE_ENV as environment', () => {
      const original = process.env.NODE_ENV;
      process.env.NODE_ENV = 'test';
      expect(controller.health().environment).toBe('test');
      process.env.NODE_ENV = original;
    });
  });

  // ---------------------------------------------------------------------------
  // GET /health/readiness  (readiness)
  // ---------------------------------------------------------------------------
  describe('readiness()', () => {
    it('delegates to HealthCheckService', async () => {
      const mockResult = { status: 'ok', info: {}, error: {}, details: {} };
      mockHealthCheckService.check.mockResolvedValue(mockResult);

      const result = await controller.readiness();

      expect(mockHealthCheckService.check).toHaveBeenCalledTimes(1);
      expect(result).toBe(mockResult);
    });

    it('passes three indicator functions to check()', async () => {
      mockHealthCheckService.check.mockResolvedValue({ status: 'ok' });

      await controller.readiness();

      const [fns] = mockHealthCheckService.check.mock.calls[0] as [Array<() => unknown>];
      expect(fns).toHaveLength(3);
      fns.forEach((fn) => expect(typeof fn).toBe('function'));
    });

    it('calls db.pingCheck("db"), redis.isHealthy("redis"), authentik.isHealthy("auth")', async () => {
      mockDb.pingCheck.mockResolvedValue({ db: { status: 'up' } });
      mockRedis.isHealthy.mockResolvedValue({ redis: { status: 'up' } });
      mockAuthentik.isHealthy.mockResolvedValue({ auth: { status: 'up' } });

      // Execute the lazy indicator functions so we can assert the keys
      mockHealthCheckService.check.mockImplementation(
        async (fns: Array<() => Promise<unknown>>) => {
          for (const fn of fns) await fn();
          return { status: 'ok' };
        },
      );

      await controller.readiness();

      expect(mockDb.pingCheck).toHaveBeenCalledWith('db');
      expect(mockRedis.isHealthy).toHaveBeenCalledWith('redis');
      expect(mockAuthentik.isHealthy).toHaveBeenCalledWith('auth');
    });
  });
});
