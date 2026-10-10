import { Reflector } from '@nestjs/core';
import { TierAwareThrottlerGuard } from './tier-aware-throttler.guard';
import { RateLimitCategory } from '../interfaces/rate-limit-category.enum';
import {
  RATE_LIMIT_TIERS,
  DEFAULT_TIER,
} from '../config/rate-limit-tiers.config';
import {
  ApiKeyUserResolverService,
  API_KEY_USER_CACHE_TTL_MS,
} from '../../auth/services/api-key-user-resolver.service';

describe('TierAwareThrottlerGuard', () => {
  let guard: TierAwareThrottlerGuard;
  let mockTierResolver: { resolve: jest.Mock };
  let mockReflector: Reflector;
  let mockStorageService: any;
  let parentHandleRequest: jest.SpyInstance;
  // Stands in for the hashed-key database lookup in AuthService
  let findApiKeyOwner: jest.Mock;
  let isLockedOut: jest.Mock;

  beforeEach(() => {
    mockTierResolver = { resolve: jest.fn() };
    mockReflector = new Reflector();
    mockStorageService = {};
    findApiKeyOwner = jest.fn().mockResolvedValue(null);
    isLockedOut = jest.fn().mockResolvedValue(false);
    const apiKeyUserResolver = new ApiKeyUserResolverService(
      { findApiKeyOwner } as any,
      { isLockedOut } as any,
    );

    guard = new TierAwareThrottlerGuard(
      { throttlers: [{ ttl: 60000, limit: 10 }] } as any,
      mockStorageService,
      mockReflector,
      mockTierResolver,
      apiKeyUserResolver,
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

    it('should fall back to IP for unknown API key tokens', async () => {
      const req = {
        headers: { authorization: 'Bearer kk_abc123' },
        ip: '5.6.7.8',
      };

      const tracker = await (guard as any).getTracker(req);

      expect(tracker).toBe('5.6.7.8');
    });

    it('ignores the spoofable ips array and keys on req.ip', async () => {
      // req.ips[0] is the leftmost X-Forwarded-For entry, which a client
      // can forge; req.ip resolves through the trusted proxy chain.
      const req = { headers: {}, ips: ['10.0.0.1', '10.0.0.2'], ip: '1.2.3.4' };

      const tracker = await (guard as any).getTracker(req);

      expect(tracker).toBe('1.2.3.4');
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

  describe('public routes', () => {
    const forged = Buffer.from(JSON.stringify({ sub: 'forged-123' })).toString(
      'base64',
    );
    const req = {
      method: 'POST',
      headers: { authorization: `Bearer x.${forged}.y` },
      ip: '1.2.3.4',
    };
    const context = {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => ({}),
      }),
      getHandler: () => () => {},
      getClass: () => class {},
    } as any;

    beforeEach(() => {
      jest
        .spyOn(mockReflector, 'getAllAndOverride')
        .mockReturnValue(RateLimitCategory.PUBLIC);
    });

    it('keys on IP even when a bearer token is sent', async () => {
      const tracker = await (guard as any).getTracker(req, context);

      expect(tracker).toBe('1.2.3.4');
    });

    it('does not resolve a tier from an unverified token', async () => {
      await (guard as any).handleRequest({ context });

      expect(mockTierResolver.resolve).not.toHaveBeenCalled();
      const expectedLimits =
        RATE_LIMIT_TIERS[DEFAULT_TIER][RateLimitCategory.PUBLIC];
      expect(parentHandleRequest).toHaveBeenCalledWith(
        expect.objectContaining({ limit: expectedLimits.limit }),
      );
    });

    it('still keys authenticated routes by user', async () => {
      jest
        .spyOn(mockReflector, 'getAllAndOverride')
        .mockReturnValue(RateLimitCategory.AUTHENTICATED_WRITE);

      const tracker = await (guard as any).getTracker(req, context);

      expect(tracker).toBe('user:forged-123');
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

  describe('API key requests', () => {
    const STARTER_KEY = 'kk_starter0123456789';
    const FREE_KEY = 'kk_free0123456789';

    function apiKeyContext(
      token: string,
      category = RateLimitCategory.AUTHENTICATED_READ,
      ip = '5.6.7.8',
    ) {
      const req = {
        method: 'GET',
        headers: { authorization: `Bearer ${token}` },
        ip,
      };
      jest.spyOn(mockReflector, 'getAllAndOverride').mockReturnValue(category);
      const context = {
        switchToHttp: () => ({
          getRequest: () => req,
          getResponse: () => ({}),
        }),
        getHandler: () => () => {},
        getClass: () => class {},
      } as any;
      return { req, context };
    }

    beforeEach(() => {
      findApiKeyOwner.mockImplementation((key: string) => {
        if (key === STARTER_KEY) {
          return Promise.resolve({
            userId: 'user-starter',
            expiresAt: null,
            allowedIps: null,
          });
        }
        if (key === FREE_KEY) {
          return Promise.resolve({
            userId: 'user-free',
            expiresAt: null,
            allowedIps: null,
          });
        }
        return Promise.resolve(null);
      });
      mockTierResolver.resolve.mockImplementation((userId: string) =>
        Promise.resolve(userId === 'user-starter' ? 'starter' : 'free'),
      );
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('applies the starter limit and tracks by user for a starter key', async () => {
      const { req, context } = apiKeyContext(STARTER_KEY);

      await (guard as any).handleRequest({ context });

      expect(mockTierResolver.resolve).toHaveBeenCalledWith('user-starter');
      expect(parentHandleRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          limit:
            RATE_LIMIT_TIERS['starter'][RateLimitCategory.AUTHENTICATED_READ]
              .limit,
        }),
      );
      expect(await (guard as any).getTracker(req, context)).toBe(
        'user:user-starter',
      );
    });

    it('applies the free limit for a free user key', async () => {
      const { req, context } = apiKeyContext(FREE_KEY);

      await (guard as any).handleRequest({ context });

      expect(parentHandleRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          limit:
            RATE_LIMIT_TIERS['free'][RateLimitCategory.AUTHENTICATED_READ]
              .limit,
        }),
      );
      expect(await (guard as any).getTracker(req, context)).toBe(
        'user:user-free',
      );
    });

    it('falls back to IP and the default tier for an unknown key', async () => {
      const { req, context } = apiKeyContext('kk_unknown');

      await (guard as any).handleRequest({ context });

      expect(mockTierResolver.resolve).not.toHaveBeenCalled();
      expect(parentHandleRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          limit:
            RATE_LIMIT_TIERS[DEFAULT_TIER][RateLimitCategory.AUTHENTICATED_READ]
              .limit,
        }),
      );
      expect(await (guard as any).getTracker(req, context)).toBe('5.6.7.8');
    });

    it('falls back to IP when the lookup fails', async () => {
      findApiKeyOwner.mockRejectedValue(new Error('DB down'));
      const { req, context } = apiKeyContext(STARTER_KEY);

      expect(await (guard as any).getTracker(req, context)).toBe('5.6.7.8');
    });

    it('falls back to IP for a key used outside its IP allowlist', async () => {
      findApiKeyOwner.mockResolvedValue({
        userId: 'user-starter',
        expiresAt: null,
        allowedIps: ['10.0.0.0/8'],
      });
      const allowed = apiKeyContext(STARTER_KEY, undefined, '10.1.2.3');
      expect(
        await (guard as any).getTracker(allowed.req, allowed.context),
      ).toBe('user:user-starter');

      const denied = apiKeyContext(STARTER_KEY, undefined, '5.6.7.8');
      expect(await (guard as any).getTracker(denied.req, denied.context)).toBe(
        '5.6.7.8',
      );
    });

    it('does no lookup while the client IP is locked out', async () => {
      isLockedOut.mockResolvedValue(true);
      const { req, context } = apiKeyContext(STARTER_KEY);

      expect(await (guard as any).getTracker(req, context)).toBe('5.6.7.8');
      expect(findApiKeyOwner).not.toHaveBeenCalled();
    });

    it('keeps service keys on IP tracking without a lookup', async () => {
      const { req, context } = apiKeyContext('kk_svc_abc123');

      await (guard as any).handleRequest({ context });

      expect(findApiKeyOwner).not.toHaveBeenCalled();
      expect(mockTierResolver.resolve).not.toHaveBeenCalled();
      expect(await (guard as any).getTracker(req, context)).toBe('5.6.7.8');
    });

    it('never resolves a key on public routes', async () => {
      const { req, context } = apiKeyContext(
        STARTER_KEY,
        RateLimitCategory.PUBLIC,
      );

      await (guard as any).handleRequest({ context });

      expect(findApiKeyOwner).not.toHaveBeenCalled();
      expect(parentHandleRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: RATE_LIMIT_TIERS[DEFAULT_TIER][RateLimitCategory.PUBLIC].limit,
        }),
      );
      expect(await (guard as any).getTracker(req, context)).toBe('5.6.7.8');
    });

    it('keeps strict public routes on IP tracking at the lower limit', async () => {
      const { req, context } = apiKeyContext(
        STARTER_KEY,
        RateLimitCategory.PUBLIC_STRICT,
      );

      await (guard as any).handleRequest({ context });

      expect(findApiKeyOwner).not.toHaveBeenCalled();
      const strict =
        RATE_LIMIT_TIERS[DEFAULT_TIER][RateLimitCategory.PUBLIC_STRICT];
      expect(strict.limit).toBeLessThan(
        RATE_LIMIT_TIERS[DEFAULT_TIER][RateLimitCategory.PUBLIC].limit,
      );
      expect(parentHandleRequest).toHaveBeenCalledWith(
        expect.objectContaining({ limit: strict.limit, ttl: strict.ttl }),
      );
      expect(await (guard as any).getTracker(req, context)).toBe('5.6.7.8');
    });

    it('looks a key up once per request', async () => {
      const { req, context } = apiKeyContext(STARTER_KEY);

      await (guard as any).handleRequest({ context });
      await (guard as any).getTracker(req, context);

      expect(findApiKeyOwner).toHaveBeenCalledTimes(1);
    });

    it('reuses the lookup across requests within the TTL', async () => {
      jest.useFakeTimers({ now: Date.now() });

      const first = apiKeyContext(STARTER_KEY);
      await (guard as any).handleRequest({ context: first.context });
      const second = apiKeyContext(STARTER_KEY);
      await (guard as any).handleRequest({ context: second.context });
      expect(findApiKeyOwner).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(API_KEY_USER_CACHE_TTL_MS + 1);
      const third = apiKeyContext(STARTER_KEY);
      await (guard as any).handleRequest({ context: third.context });
      expect(findApiKeyOwner).toHaveBeenCalledTimes(2);
    });

    it('drops a cached key once the key itself expires', async () => {
      jest.useFakeTimers({ now: Date.now() });
      findApiKeyOwner.mockResolvedValue({
        userId: 'user-starter',
        expiresAt: new Date(Date.now() + 5_000),
        allowedIps: null,
      });

      const first = apiKeyContext(STARTER_KEY);
      await (guard as any).getTracker(first.req, first.context);

      jest.advanceTimersByTime(5_001);
      findApiKeyOwner.mockResolvedValue(null);
      const second = apiKeyContext(STARTER_KEY);
      expect(await (guard as any).getTracker(second.req, second.context)).toBe(
        '5.6.7.8',
      );
      expect(findApiKeyOwner).toHaveBeenCalledTimes(2);
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
