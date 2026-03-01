jest.mock('ioredis');

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HealthIndicatorService } from '@nestjs/terminus';
import Redis from 'ioredis';
import { RedisHealthIndicator } from './redis.health';

const MockRedis = Redis as jest.MockedClass<typeof Redis>;

describe('RedisHealthIndicator', () => {
  let indicator: RedisHealthIndicator;

  beforeEach(async () => {
    MockRedis.prototype.connect = jest.fn().mockResolvedValue(undefined);
    MockRedis.prototype.ping = jest.fn().mockResolvedValue('PONG');
    MockRedis.prototype.disconnect = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisHealthIndicator,
        HealthIndicatorService,
        {
          provide: ConfigService,
          useValue: {
            // Return defaults so new Redis(...) uses localhost:6379
            get: jest.fn((_key: string, def?: string) => def),
          },
        },
      ],
    }).compile();

    indicator = module.get<RedisHealthIndicator>(RedisHealthIndicator);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns up when Redis responds to ping', async () => {
    const result = await indicator.isHealthy('redis');
    expect(result['redis'].status).toBe('up');
  });

  it('returns down when Redis connection fails', async () => {
    MockRedis.prototype.connect = jest
      .fn()
      .mockRejectedValue(new Error('Connection refused'));

    const result = await indicator.isHealthy('redis');
    expect(result['redis'].status).toBe('down');
  });

  it('returns down when ping fails after connecting', async () => {
    MockRedis.prototype.ping = jest
      .fn()
      .mockRejectedValue(new Error('NOAUTH Authentication required'));

    const result = await indicator.isHealthy('redis');
    expect(result['redis'].status).toBe('down');
  });

  it('always calls disconnect even when an error occurs', async () => {
    MockRedis.prototype.connect = jest
      .fn()
      .mockRejectedValue(new Error('fail'));

    await indicator.isHealthy('redis');

    expect(MockRedis.prototype.disconnect).toHaveBeenCalled();
  });

  it('includes the error message in the down result', async () => {
    MockRedis.prototype.connect = jest
      .fn()
      .mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await indicator.isHealthy('redis');
    expect((result['redis'] as { message?: string }).message).toContain('ECONNREFUSED');
  });
});
