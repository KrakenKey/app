import { UnauthorizedException } from '@nestjs/common';
import { ApiKeyStrategy } from './api-key.strategy';

describe('ApiKeyStrategy', () => {
  let strategy: ApiKeyStrategy;
  let mockAuthService: Record<string, jest.Mock>;

  beforeEach(() => {
    mockAuthService = {
      validateApiKey: jest.fn(),
    };
    strategy = new ApiKeyStrategy(mockAuthService as any);
  });

  describe('validate', () => {
    it('returns user info when API key is valid', async () => {
      const record = { id: 'key-1', user: { id: 'user-1' } };
      mockAuthService.validateApiKey.mockResolvedValue(record);

      const req = {
        headers: { authorization: 'Bearer kk_abc123' },
      } as any;

      const result = await strategy.validate(req);
      expect(result).toEqual({ userId: 'user-1', apiKeyId: 'key-1' });
      expect(mockAuthService.validateApiKey).toHaveBeenCalledWith('kk_abc123');
    });

    it('throws UnauthorizedException when API key is invalid', async () => {
      mockAuthService.validateApiKey.mockResolvedValue(null);

      const req = {
        headers: { authorization: 'Bearer kk_invalid' },
      } as any;

      await expect(strategy.validate(req)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('returns null when no authorization header', async () => {
      const req = { headers: {} } as any;
      expect(await strategy.validate(req)).toBeNull();
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
