import {
  ExecutionContext,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtOrApiKeyGuard } from './jwt-or-api-key.guard';

describe('JwtOrApiKeyGuard', () => {
  let guard: JwtOrApiKeyGuard;

  const mockContext = {
    switchToHttp: () => ({
      getRequest: () => ({ url: '/test-endpoint' }),
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
    guard = new JwtOrApiKeyGuard();
    jest.restoreAllMocks();
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
