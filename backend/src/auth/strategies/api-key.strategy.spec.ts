import { HttpException, UnauthorizedException } from '@nestjs/common';
import { ApiKeyStrategy } from './api-key.strategy';

describe('ApiKeyStrategy', () => {
  let strategy: ApiKeyStrategy;
  let mockAuthService: Record<string, jest.Mock>;
  let mockSecurity: Record<string, jest.Mock>;

  beforeEach(() => {
    mockAuthService = {
      validateApiKey: jest.fn(),
    };
    mockSecurity = {
      isLockedOut: jest.fn().mockResolvedValue(false),
      recordFailure: jest.fn().mockResolvedValue(undefined),
    };
    strategy = new ApiKeyStrategy(mockAuthService as any, mockSecurity as any);
  });

  describe('validate', () => {
    it('returns user info when API key is valid', async () => {
      const record = { id: 'key-1', user: { id: 'user-1' } };
      mockAuthService.validateApiKey.mockResolvedValue(record);

      const req = {
        ip: '10.0.0.1',
        headers: { authorization: 'Bearer kk_abc123' },
      } as any;

      const result = await strategy.validate(req);
      expect(result).toEqual({ userId: 'user-1', apiKeyId: 'key-1' });
      expect(mockAuthService.validateApiKey).toHaveBeenCalledWith('kk_abc123', {
        ip: '10.0.0.1',
      });
      expect(mockSecurity.recordFailure).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException and records failure when API key is invalid', async () => {
      mockAuthService.validateApiKey.mockResolvedValue(null);

      const req = {
        ip: '10.0.0.1',
        headers: { authorization: 'Bearer kk_invalid' },
      } as any;

      await expect(strategy.validate(req)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockSecurity.recordFailure).toHaveBeenCalledWith('10.0.0.1');
    });

    it('rejects locked-out IPs with 429 before any validation work', async () => {
      mockSecurity.isLockedOut.mockResolvedValue(true);

      const req = {
        ip: '10.0.0.9',
        headers: { authorization: 'Bearer kk_whatever' },
      } as any;

      const err = await strategy.validate(req).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(429);
      expect(mockAuthService.validateApiKey).not.toHaveBeenCalled();
      expect(mockSecurity.recordFailure).not.toHaveBeenCalled();
    });

    it('returns null when no authorization header', async () => {
      const req = { headers: {} } as any;
      expect(await strategy.validate(req)).toBeNull();
      expect(mockSecurity.isLockedOut).not.toHaveBeenCalled();
    });

    it('returns null when authorization is not a kk_ token', async () => {
      const req = {
        headers: { authorization: 'Bearer eyJhbGciOiJSUzI1NiJ9.payload.sig' },
      } as any;

      expect(await strategy.validate(req)).toBeNull();
      expect(mockAuthService.validateApiKey).not.toHaveBeenCalled();
    });
  });
});
