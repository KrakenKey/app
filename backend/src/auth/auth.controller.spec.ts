import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let controller: AuthController;
  let mockAuthService: Record<string, jest.Mock>;

  const userId = 'user-123';
  const mockReq = { user: { userId } } as any;

  beforeEach(async () => {
    mockAuthService = {
      getLoginRedirect: jest.fn(),
      getRegisterRedirect: jest.fn(),
      handleCallback: jest.fn(),
      createApiKey: jest.fn(),
      listApiKeys: jest.fn(),
      deleteApiKey: jest.fn(),
      getFullProfile: jest.fn(),
      updateProfile: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: mockAuthService,
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('register', () => {
    it('delegates to authService.getRegisterRedirect()', () => {
      const redirect = {
        url: 'https://auth.example.com/enrollment',
        statusCode: 302,
      };
      mockAuthService.getRegisterRedirect.mockReturnValue(redirect);

      expect(controller.register()).toEqual(redirect);
      expect(mockAuthService.getRegisterRedirect).toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('delegates to authService.getLoginRedirect()', () => {
      const redirect = {
        url: 'https://auth.example.com/authorize',
        statusCode: 302,
      };
      mockAuthService.getLoginRedirect.mockReturnValue(redirect);

      expect(controller.login()).toEqual(redirect);
      expect(mockAuthService.getLoginRedirect).toHaveBeenCalled();
    });
  });

  describe('callback', () => {
    it('passes code to authService.handleCallback()', async () => {
      const tokens = { access_token: 'at', token_type: 'Bearer' };
      mockAuthService.handleCallback.mockResolvedValue(tokens);

      const result = await controller.callback('auth-code');

      expect(mockAuthService.handleCallback).toHaveBeenCalledWith('auth-code');
      expect(result).toEqual(tokens);
    });
  });

  describe('getProfile', () => {
    it('delegates to authService.getFullProfile()', async () => {
      const profile = {
        id: 'u1',
        username: 'alice',
        resourceCounts: { domains: 0, certificates: 0, apiKeys: 0 },
      };
      mockAuthService.getFullProfile.mockResolvedValue(profile);
      const req = { user: { userId: 'u1' } } as any;

      const result = await controller.getProfile(req);

      expect(mockAuthService.getFullProfile).toHaveBeenCalledWith('u1');
      expect(result).toEqual(profile);
    });
  });

  describe('listApiKeys', () => {
    it('passes userId to authService.listApiKeys()', async () => {
      const keys = [{ id: 'k1', name: 'key1' }];
      mockAuthService.listApiKeys.mockResolvedValue(keys);

      const result = await controller.listApiKeys(mockReq);

      expect(mockAuthService.listApiKeys).toHaveBeenCalledWith(userId);
      expect(result).toEqual(keys);
    });
  });

  describe('createApiKey', () => {
    it('passes userId, name, expiresAt to authService.createApiKey()', async () => {
      const response = { apiKey: 'kk_abc', id: 'k1', name: 'my-key' };
      mockAuthService.createApiKey.mockResolvedValue(response);

      const dto = { name: 'my-key', expiresAt: '2027-01-01T00:00:00.000Z' };
      const result = await controller.createApiKey(mockReq, dto as any);

      expect(mockAuthService.createApiKey).toHaveBeenCalledWith(
        userId,
        'my-key',
        '2027-01-01T00:00:00.000Z',
      );
      expect(result).toEqual(response);
    });
  });

  describe('deleteApiKey', () => {
    it('passes userId, id to authService.deleteApiKey()', async () => {
      mockAuthService.deleteApiKey.mockResolvedValue(undefined);

      const result = await controller.deleteApiKey(mockReq, 'key-uuid');

      expect(mockAuthService.deleteApiKey).toHaveBeenCalledWith(
        userId,
        'key-uuid',
      );
      expect(result).toEqual({ message: 'API key deleted' });
    });
  });
});
