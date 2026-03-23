import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

function mockRes(): Record<string, jest.Mock> {
  return {
    cookie: jest.fn(),
    redirect: jest.fn(),
    clearCookie: jest.fn(),
  };
}

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
    it('sets oauth_state cookie and redirects', () => {
      const redirect = {
        url: 'https://auth.example.com/enrollment',
        state: 'random-state-abc',
        statusCode: 302,
      };
      mockAuthService.getRegisterRedirect.mockReturnValue(redirect);
      const res = mockRes();

      controller.register(res as any);

      expect(mockAuthService.getRegisterRedirect).toHaveBeenCalled();
      expect(res.cookie).toHaveBeenCalledWith(
        'oauth_state',
        'random-state-abc',
        expect.objectContaining({
          httpOnly: true,
          sameSite: 'lax',
          secure: true,
        }),
      );
      expect(res.redirect).toHaveBeenCalledWith(302, redirect.url);
    });
  });

  describe('login', () => {
    it('sets oauth_state cookie and redirects', () => {
      const redirect = {
        url: 'https://auth.example.com/authorize',
        state: 'random-state-xyz',
        statusCode: 302,
      };
      mockAuthService.getLoginRedirect.mockReturnValue(redirect);
      const res = mockRes();

      controller.login(res as any);

      expect(mockAuthService.getLoginRedirect).toHaveBeenCalled();
      expect(res.cookie).toHaveBeenCalledWith(
        'oauth_state',
        'random-state-xyz',
        expect.objectContaining({
          httpOnly: true,
          sameSite: 'lax',
          secure: true,
        }),
      );
      expect(res.redirect).toHaveBeenCalledWith(302, redirect.url);
    });
  });

  describe('callback', () => {
    it('passes code, state, and cookie state to authService.handleCallback()', async () => {
      const tokens = { access_token: 'at', token_type: 'Bearer' };
      mockAuthService.handleCallback.mockResolvedValue(tokens);
      const req = { cookies: { oauth_state: 'state-123' } } as any;
      const res = mockRes();

      const result = await controller.callback(
        'auth-code',
        'state-123',
        req,
        res as any,
      );

      expect(res.clearCookie).toHaveBeenCalledWith('oauth_state', {
        path: '/auth/callback',
      });
      expect(mockAuthService.handleCallback).toHaveBeenCalledWith(
        'auth-code',
        'state-123',
        'state-123',
      );
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
