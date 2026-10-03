import {
  ExecutionContext,
  ForbiddenException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtOrApiKeyGuard } from './jwt-or-api-key.guard';
import { MetricsService } from '../../metrics/metrics.service';

describe('JwtOrApiKeyGuard', () => {
  let guard: JwtOrApiKeyGuard;

  const mockMetricsService = {
    authTotal: { inc: jest.fn() },
  } as unknown as MetricsService;

  const mockContext = {
    switchToHttp: () => ({
      getRequest: () => ({ url: '/test-endpoint', headers: {} }),
      getResponse: () => ({}),
    }),
    getHandler: () => jest.fn(),
    getClass: () => jest.fn(),
    getArgs: () => [],
    getArgByIndex: () => undefined,
    switchToRpc: () => ({}) as any,
    switchToWs: () => ({}) as any,
    getType: () => 'http' as const,
  } as unknown as ExecutionContext;

  beforeEach(() => {
    jest.restoreAllMocks();
    guard = new JwtOrApiKeyGuard(mockMetricsService, new Reflector());
  });

  // ─── canActivate ──────────────────────────────────────────────────────────
  describe('canActivate', () => {
    it('returns true when parent canActivate succeeds', async () => {
      jest
        .spyOn(Object.getPrototypeOf(JwtOrApiKeyGuard.prototype), 'canActivate')
        .mockResolvedValue(true);

      const result = await guard.canActivate(mockContext);
      expect(result).toBe(true);
    });

    it('re-throws error when parent canActivate fails', async () => {
      const error = new UnauthorizedException('Unauthorized');
      jest
        .spyOn(Object.getPrototypeOf(JwtOrApiKeyGuard.prototype), 'canActivate')
        .mockRejectedValue(error);
      jest.spyOn(Logger, 'error').mockImplementation();

      await expect(guard.canActivate(mockContext)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('logs error via Logger.error when parent throws', async () => {
      const error = new UnauthorizedException('Unauthorized');
      jest
        .spyOn(Object.getPrototypeOf(JwtOrApiKeyGuard.prototype), 'canActivate')
        .mockRejectedValue(error);
      const logSpy = jest.spyOn(Logger, 'error').mockImplementation();

      await expect(guard.canActivate(mockContext)).rejects.toThrow();
      expect(logSpy).toHaveBeenCalledWith('Authentication guard failed', error);
    });
  });

  // ─── @SessionOnly ─────────────────────────────────────────────────────────
  describe('session-only routes', () => {
    const contextFor = (user: object, sessionOnly: boolean) => {
      const handler = () => undefined;
      if (sessionOnly) Reflect.defineMetadata('sessionOnly', true, handler);
      return {
        ...mockContext,
        switchToHttp: () => ({
          getRequest: () => ({
            url: '/auth/api-keys',
            method: 'POST',
            headers: {},
            user,
          }),
          getResponse: () => ({}),
        }),
        getHandler: () => handler,
        getClass: () => class {},
      } as unknown as ExecutionContext;
    };

    beforeEach(() => {
      jest
        .spyOn(Object.getPrototypeOf(JwtOrApiKeyGuard.prototype), 'canActivate')
        .mockResolvedValue(true);
      jest.spyOn(Logger, 'warn').mockImplementation();
      (mockMetricsService.authTotal.inc as jest.Mock).mockClear();
    });

    it('rejects an API key with 403', async () => {
      await expect(
        guard.canActivate(contextFor({ userId: 'u1', apiKeyId: 'k1' }, true)),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows a dashboard session', async () => {
      await expect(
        guard.canActivate(contextFor({ userId: 'u1' }, true)),
      ).resolves.toBe(true);
    });

    it('allows an API key on routes without the decorator', async () => {
      await expect(
        guard.canActivate(contextFor({ userId: 'u1', apiKeyId: 'k1' }, false)),
      ).resolves.toBe(true);
    });

    it('records the auth method from the authenticated user', async () => {
      await guard.canActivate(
        contextFor({ userId: 'u1', apiKeyId: 'k1' }, false),
      );
      expect(mockMetricsService.authTotal.inc).toHaveBeenCalledWith({
        method: 'api-key',
        status: 'success',
      });
    });
  });

  // ─── handleRequest ────────────────────────────────────────────────────────
  describe('handleRequest', () => {
    it('returns user when no error and user present', () => {
      const user = { userId: 'u1' };
      jest
        .spyOn(
          Object.getPrototypeOf(JwtOrApiKeyGuard.prototype),
          'handleRequest',
        )
        .mockReturnValue(user);

      const result = guard.handleRequest(null, user, null, mockContext);
      expect(result).toEqual(user);
    });

    it('logs warning when err is truthy', () => {
      const warnSpy = jest.spyOn(Logger, 'warn').mockImplementation();
      jest
        .spyOn(
          Object.getPrototypeOf(JwtOrApiKeyGuard.prototype),
          'handleRequest',
        )
        .mockImplementation(() => {
          throw new UnauthorizedException();
        });

      expect(() =>
        guard.handleRequest(new Error('fail'), null, null, mockContext),
      ).toThrow();
      expect(warnSpy).toHaveBeenCalledWith(
        'Authentication failed for /test-endpoint',
      );
    });

    it('logs warning when user is falsy', () => {
      const warnSpy = jest.spyOn(Logger, 'warn').mockImplementation();
      jest
        .spyOn(
          Object.getPrototypeOf(JwtOrApiKeyGuard.prototype),
          'handleRequest',
        )
        .mockImplementation(() => {
          throw new UnauthorizedException();
        });

      expect(() =>
        guard.handleRequest(null, null, null, mockContext),
      ).toThrow();
      expect(warnSpy).toHaveBeenCalledWith(
        'Authentication failed for /test-endpoint',
      );
    });
  });
});
