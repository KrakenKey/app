import { Reflector } from '@nestjs/core';
import { TierAwareThrottlerGuard } from './tier-aware-throttler.guard';
import { RateLimitCategory } from '../interfaces/rate-limit-category.enum';
import {
  RATE_LIMIT_TIERS,
  DEFAULT_TIER,
} from '../config/rate-limit-tiers.config';

describe('TierAwareThrottlerGuard', () => {
  let guard: TierAwareThrottlerGuard;
  let mockTierResolver: { resolve: jest.Mock };
  let mockReflector: Reflector;
  let mockStorageService: any;
  let parentHandleRequest: jest.SpyInstance;

  beforeEach(() => {
    mockTierResolver = { resolve: jest.fn() };
    mockReflector = new Reflector();
    mockStorageService = {};

    guard = new TierAwareThrottlerGuard(
      { throttlers: [{ ttl: 60000, limit: 10 }] } as any,
      mockStorageService,
      mockReflector,
      mockTierResolver,
    );

    // Spy on parent handleRequest to avoid actual throttle logic
    parentHandleRequest = jest
      .spyOn(
        Object.getPrototypeOf(TierAwareThrottlerGuard.prototype),
        'handleRequest',
      )
      .mockResolvedValue(true);
  });

  afterEach(() => {
    parentHandleRequest.mockRestore();
  });

  describe('getTracker', () => {
    it('should return user tracker when JWT is present', async () => {
      const payload = Buffer.from(JSON.stringify({ sub: 'user-123' })).toString(
        'base64',
      );
      const req = {
        headers: { authorization: `Bearer header.${payload}.sig` },
      };

      const tracker = await (guard as any).getTracker(req);

      expect(tracker).toBe('user:user-123');
    });

    it('should return user tracker when req.user is populated', async () => {
      const req = {
        user: { userId: 'user-456' },
        headers: {},
      };

      const tracker = await (guard as any).getTracker(req);

      expect(tracker).toBe('user:user-456');
    });

    it('should fall back to IP when no auth header', async () => {
      const req = { headers: {}, ip: '1.2.3.4' };

      const tracker = await (guard as any).getTracker(req);

      expect(tracker).toBe('1.2.3.4');
    });

    it('should fall back to IP for API key tokens', async () => {
      const req = {
        headers: { authorization: 'Bearer kk_abc123' },
        ip: '5.6.7.8',
      };

      const tracker = await (guard as any).getTracker(req);

      expect(tracker).toBe('5.6.7.8');
    });

    it('should use first forwarded IP when ips array exists', async () => {
      const req = { headers: {}, ips: ['10.0.0.1', '10.0.0.2'], ip: '1.2.3.4' };

      const tracker = await (guard as any).getTracker(req);

      expect(tracker).toBe('10.0.0.1');
    });

    it('should fall back to IP on malformed JWT', async () => {
      const req = {
        headers: { authorization: 'Bearer not.valid-base64.token' },
        ip: '9.9.9.9',
      };

      const tracker = await (guard as any).getTracker(req);

      expect(tracker).toBe('9.9.9.9');
    });
  });

  describe('handleRequest', () => {
    function createContext(method = 'GET') {
      return {
        switchToHttp: () => ({
          getRequest: () => ({
            method,
            headers: {},
            ip: '1.2.3.4',
          }),
          getResponse: () => ({}),
        }),
        getHandler: () => () => {},
        getClass: () => class {},
      } as any;
    }

    it('should use free tier limits when no user is identified', async () => {
      jest
        .spyOn(mockReflector, 'getAllAndOverride')
        .mockReturnValue(RateLimitCategory.PUBLIC);

      await (guard as any).handleRequest({ context: createContext() });

      const expectedLimits =
        RATE_LIMIT_TIERS[DEFAULT_TIER][RateLimitCategory.PUBLIC];
      expect(parentHandleRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: expectedLimits.limit,
          ttl: expectedLimits.ttl,
        }),
      );
    });

    it('should resolve tier for authenticated user', async () => {
      const payload = Buffer.from(JSON.stringify({ sub: 'user-pro' })).toString(
        'base64',
      );
      const context = {
        switchToHttp: () => ({
          getRequest: () => ({
            method: 'POST',
            headers: { authorization: `Bearer h.${payload}.s` },
            ip: '1.2.3.4',
          }),
          getResponse: () => ({}),
        }),
        getHandler: () => () => {},
        getClass: () => class {},
      } as any;

      jest
        .spyOn(mockReflector, 'getAllAndOverride')
        .mockReturnValue(RateLimitCategory.AUTHENTICATED_WRITE);
      mockTierResolver.resolve.mockResolvedValue('business');

      await (guard as any).handleRequest({ context });

      const expectedLimits =
        RATE_LIMIT_TIERS['business'][RateLimitCategory.AUTHENTICATED_WRITE];
      expect(parentHandleRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: expectedLimits.limit,
          ttl: expectedLimits.ttl,
        }),
      );
    });

    it('should default to free tier if tier resolution fails', async () => {
      const payload = Buffer.from(JSON.stringify({ sub: 'user-err' })).toString(
        'base64',
      );
      const context = {
        switchToHttp: () => ({
          getRequest: () => ({
            method: 'GET',
            headers: { authorization: `Bearer h.${payload}.s` },
            ip: '1.2.3.4',
          }),
          getResponse: () => ({}),
        }),
        getHandler: () => () => {},
        getClass: () => class {},
      } as any;

      jest
        .spyOn(mockReflector, 'getAllAndOverride')
        .mockReturnValue(RateLimitCategory.AUTHENTICATED_READ);
      mockTierResolver.resolve.mockRejectedValue(new Error('DB down'));

      await (guard as any).handleRequest({ context });

      const expectedLimits =
        RATE_LIMIT_TIERS[DEFAULT_TIER][RateLimitCategory.AUTHENTICATED_READ];
      expect(parentHandleRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: expectedLimits.limit,
        }),
      );
    });
  });

  describe('resolveCategory', () => {
    it('should return decorator category when set', () => {
      jest
        .spyOn(mockReflector, 'getAllAndOverride')
        .mockReturnValue(RateLimitCategory.EXPENSIVE);

      const context = {
        getHandler: () => () => {},
        getClass: () => class {},
        switchToHttp: () => ({ getRequest: () => ({}) }),
      } as any;

      const result = (guard as any).resolveCategory(context);

      expect(result).toBe(RateLimitCategory.EXPENSIVE);
    });

    it('should infer READ for GET requests when no decorator', () => {
      jest.spyOn(mockReflector, 'getAllAndOverride').mockReturnValue(undefined);

      const context = {
        getHandler: () => () => {},
        getClass: () => class {},
        switchToHttp: () => ({ getRequest: () => ({ method: 'GET' }) }),
      } as any;

      const result = (guard as any).resolveCategory(context);

      expect(result).toBe(RateLimitCategory.AUTHENTICATED_READ);
    });

    it('should infer WRITE for POST requests when no decorator', () => {
      jest.spyOn(mockReflector, 'getAllAndOverride').mockReturnValue(undefined);

      const context = {
        getHandler: () => () => {},
        getClass: () => class {},
        switchToHttp: () => ({ getRequest: () => ({ method: 'POST' }) }),
      } as any;

      const result = (guard as any).resolveCategory(context);

      expect(result).toBe(RateLimitCategory.AUTHENTICATED_WRITE);
    });
  });
});
