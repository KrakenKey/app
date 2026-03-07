import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { NotFoundException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { UserApiKey } from './entities/user-api-key.entity';
import { User } from '../users/entities/user.entity';
import { Domain } from '../domains/entities/domain.entity';
import { TlsCrt } from '../certs/tls/entities/tls-crt.entity';

const CONFIG: Record<string, string> = {
  KK_AUTHENTIK_DOMAIN: 'auth.example.com',
  KK_AUTHENTIK_ENROLLMENT_SLUG: 'krakenkey-enrollment',
  KK_AUTHENTIK_CLIENT_ID: 'krakenkey-backend',
  KK_AUTHENTIK_CLIENT_SECRET: 's3cr3t',
  KK_AUTHENTIK_REDIRECT_URI: 'https://api.example.com/auth/callback',
};

/** Build a fake JWT with a real base64 payload so handleCallback can decode it. */
const buildIdToken = (payload: object) =>
  `header.${Buffer.from(JSON.stringify(payload)).toString('base64')}.sig`;

describe('AuthService', () => {
  let service: AuthService;
  let mockUserApiKeyRepo: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    find: jest.Mock;
    delete: jest.Mock;
  };
  let mockUserRepo: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };

  beforeEach(async () => {
    mockUserApiKeyRepo = {
      create: jest.fn(),
      save: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn(),
      delete: jest.fn(),
    };
    mockUserRepo = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, def?: string) => CONFIG[key] ?? def),
          },
        },
        {
          provide: getRepositoryToken(UserApiKey),
          useValue: mockUserApiKeyRepo,
        },
        { provide: getRepositoryToken(User), useValue: mockUserRepo },
        { provide: getRepositoryToken(Domain), useValue: { count: jest.fn() } },
        { provide: getRepositoryToken(TlsCrt), useValue: { count: jest.fn() } },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  // ---------------------------------------------------------------------------
  // getLoginRedirect
  // ---------------------------------------------------------------------------
  describe('getLoginRedirect', () => {
    it('returns a 302 statusCode', () => {
      expect(service.getLoginRedirect().statusCode).toBe(302);
    });

    it('URL targets the configured Authentik domain', () => {
      const { url } = service.getLoginRedirect();
      expect(url).toContain('auth.example.com');
    });

    it('URL includes required OAuth2 query params', () => {
      const parsed = new URL(service.getLoginRedirect().url);
      expect(parsed.searchParams.get('client_id')).toBe('krakenkey-backend');
      expect(parsed.searchParams.get('redirect_uri')).toBe(
        'https://api.example.com/auth/callback',
      );
      expect(parsed.searchParams.get('response_type')).toBe('code');
      expect(parsed.searchParams.get('scope')).toContain('openid');
    });
  });

  // ---------------------------------------------------------------------------
  // getRegisterRedirect
  // ---------------------------------------------------------------------------
  describe('getRegisterRedirect', () => {
    it('returns a 302 statusCode', () => {
      expect(service.getRegisterRedirect().statusCode).toBe(302);
    });

    it('URL points to the enrollment flow slug', () => {
      const { url } = service.getRegisterRedirect();
      expect(url).toContain('/if/flow/krakenkey-enrollment/');
    });

    it('URL encodes the OAuth authorize path in the next param', () => {
      const { url } = service.getRegisterRedirect();
      const next = decodeURIComponent(url.split('next=')[1]);
      expect(next).toContain('/application/o/authorize/');
      expect(next).toContain('client_id=krakenkey-backend');
    });
  });

  // ---------------------------------------------------------------------------
  // handleCallback
  // ---------------------------------------------------------------------------
  describe('handleCallback', () => {
    it('POSTs the auth code to the Authentik token endpoint', async () => {
      const tokens = {
        access_token: 'at',
        token_type: 'Bearer',
        expires_in: 3600,
      };
      global.fetch = jest
        .fn()
        .mockResolvedValue({ ok: true, json: async () => tokens });

      await service.handleCallback('auth-code-abc');

      const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [
        string,
        RequestInit,
      ];
      expect(url).toContain('auth.example.com');
      expect(url).toContain('/application/o/token/');
      expect(init.body!.toString()).toContain('code=auth-code-abc');
    });

    it('returns the tokens from Authentik', async () => {
      const tokens = {
        access_token: 'at',
        token_type: 'Bearer',
        expires_in: 3600,
      };
      global.fetch = jest
        .fn()
        .mockResolvedValue({ ok: true, json: async () => tokens });

      const result = await service.handleCallback('code');
      expect(result).toEqual(tokens);
    });

    it('provisions a new user when id_token is present and user does not exist', async () => {
      const payload = {
        sub: 'sub-123',
        preferred_username: 'alice',
        email: 'alice@example.com',
        groups: ['users'],
      };
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'at',
          id_token: buildIdToken(payload),
        }),
      });
      mockUserRepo.findOne.mockResolvedValue(null);
      const newUser = {
        id: payload.sub,
        username: payload.preferred_username,
        email: payload.email,
      };
      mockUserRepo.create.mockReturnValue(newUser);
      mockUserRepo.save.mockResolvedValue(newUser);

      await service.handleCallback('code');

      expect(mockUserRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'sub-123',
          username: 'alice',
          email: 'alice@example.com',
        }),
      );
      expect(mockUserRepo.save).toHaveBeenCalled();
    });

    it('skips user creation when the user already exists', async () => {
      const payload = {
        sub: 'sub-123',
        preferred_username: 'alice',
        email: 'alice@example.com',
      };
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'at',
          id_token: buildIdToken(payload),
        }),
      });
      mockUserRepo.findOne.mockResolvedValue({ id: 'sub-123' });

      await service.handleCallback('code');

      expect(mockUserRepo.create).not.toHaveBeenCalled();
      expect(mockUserRepo.save).not.toHaveBeenCalled();
    });

    it('skips user provisioning when no id_token is returned', async () => {
      const tokens = {
        access_token: 'at',
        token_type: 'Bearer',
        expires_in: 3600,
      };
      global.fetch = jest
        .fn()
        .mockResolvedValue({ ok: true, json: async () => tokens });

      const result = await service.handleCallback('code');

      expect(result).toEqual(tokens);
      expect(mockUserRepo.findOne).not.toHaveBeenCalled();
    });

    it('throws when Authentik returns a non-ok response', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        text: async () => 'invalid_grant',
      });

      await expect(service.handleCallback('bad-code')).rejects.toThrow(
        'Failed to exchange code for token',
      );
    });
  });

  // ---------------------------------------------------------------------------
  // createApiKey
  // ---------------------------------------------------------------------------
  describe('createApiKey', () => {
    it('returns a raw key with the kk_ prefix', async () => {
      const mockKey = { id: 'uuid-1', name: 'My Key', hash: 'h' };
      mockUserApiKeyRepo.create.mockReturnValue(mockKey);
      mockUserApiKeyRepo.save.mockResolvedValue(mockKey);

      const result = await service.createApiKey('user-1', 'My Key');
      expect(result.apiKey).toMatch(/^kk_/);
    });

    it('stores the SHA-256 hash, not the raw key', async () => {
      let capturedHash = '';
      mockUserApiKeyRepo.create.mockImplementation(
        ({ hash }: { hash: string }) => {
          capturedHash = hash;
          return { id: 'uuid-1', name: 'k', hash };
        },
      );
      mockUserApiKeyRepo.save.mockResolvedValue({});

      const result = await service.createApiKey('user-1', 'k');
      const expectedHash = createHash('sha256')
        .update(result.apiKey)
        .digest('hex');
      expect(capturedHash).toBe(expectedHash);
    });

    it('does not include the hash in the returned object', async () => {
      const mockKey = { id: 'uuid-1', name: 'k', hash: 'stored-hash' };
      mockUserApiKeyRepo.create.mockReturnValue(mockKey);
      mockUserApiKeyRepo.save.mockResolvedValue(mockKey);

      const result = await service.createApiKey('user-1', 'k');
      expect((result as unknown as { hash?: string }).hash).toBeUndefined();
    });

    it('returns the id and name from the saved entity', async () => {
      const mockKey = { id: 'uuid-abc', name: 'prod-key', hash: 'h' };
      mockUserApiKeyRepo.create.mockReturnValue(mockKey);
      mockUserApiKeyRepo.save.mockResolvedValue(mockKey);

      const result = await service.createApiKey('user-1', 'prod-key');
      expect(result.id).toBe('uuid-abc');
      expect(result.name).toBe('prod-key');
    });
  });

  // ---------------------------------------------------------------------------
  // validateApiKey
  // ---------------------------------------------------------------------------
  describe('validateApiKey', () => {
    it('looks up the SHA-256 hash of the raw key', async () => {
      mockUserApiKeyRepo.findOne.mockResolvedValue(null);
      const rawKey = 'kk_test_raw_key';

      await service.validateApiKey(rawKey);

      const expectedHash = createHash('sha256').update(rawKey).digest('hex');
      expect(mockUserApiKeyRepo.findOne).toHaveBeenCalledWith({
        where: { hash: expectedHash },
        relations: ['user'],
      });
    });

    it('returns the record when the hash matches', async () => {
      const record = { id: 'key-1', hash: 'h', user: { id: 'user-1' } };
      mockUserApiKeyRepo.findOne.mockResolvedValue(record);

      expect(await service.validateApiKey('kk_raw')).toBe(record);
    });

    it('returns null when no matching key is found', async () => {
      mockUserApiKeyRepo.findOne.mockResolvedValue(null);

      expect(await service.validateApiKey('kk_nonexistent')).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // createApiKey with expiresAt
  // ---------------------------------------------------------------------------
  describe('createApiKey with expiresAt', () => {
    it('stores expiresAt when provided', async () => {
      const mockKey = { id: 'uuid-1', name: 'k', hash: 'h' };
      mockUserApiKeyRepo.create.mockReturnValue(mockKey);
      mockUserApiKeyRepo.save.mockResolvedValue(mockKey);

      await service.createApiKey('user-1', 'k', '2027-01-01T00:00:00.000Z');

      expect(mockUserApiKeyRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          expiresAt: new Date('2027-01-01T00:00:00.000Z'),
        }),
      );
    });

    it('does not set expiresAt when not provided', async () => {
      const mockKey = { id: 'uuid-1', name: 'k', hash: 'h' };
      mockUserApiKeyRepo.create.mockReturnValue(mockKey);
      mockUserApiKeyRepo.save.mockResolvedValue(mockKey);

      await service.createApiKey('user-1', 'k');

      const createArg = mockUserApiKeyRepo.create.mock.calls[0][0];
      expect(createArg).not.toHaveProperty('expiresAt');
    });
  });

  // ---------------------------------------------------------------------------
  // listApiKeys
  // ---------------------------------------------------------------------------
  describe('listApiKeys', () => {
    it('returns keys for the specified user with ISO string dates', async () => {
      const keys = [
        {
          id: 'k1',
          name: 'key1',
          createdAt: new Date('2026-01-01'),
          expiresAt: null,
        },
        {
          id: 'k2',
          name: 'key2',
          createdAt: new Date('2026-02-01'),
          expiresAt: new Date('2027-01-01'),
        },
      ];
      mockUserApiKeyRepo.find.mockResolvedValue(keys);

      const result = await service.listApiKeys('user-1');

      expect(mockUserApiKeyRepo.find).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        order: { createdAt: 'DESC' },
        select: ['id', 'name', 'createdAt', 'expiresAt'],
      });
      expect(result).toEqual([
        {
          id: 'k1',
          name: 'key1',
          createdAt: '2026-01-01T00:00:00.000Z',
          expiresAt: null,
        },
        {
          id: 'k2',
          name: 'key2',
          createdAt: '2026-02-01T00:00:00.000Z',
          expiresAt: '2027-01-01T00:00:00.000Z',
        },
      ]);
    });

    it('returns empty array when user has no keys', async () => {
      mockUserApiKeyRepo.find.mockResolvedValue([]);
      const result = await service.listApiKeys('user-1');
      expect(result).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // deleteApiKey
  // ---------------------------------------------------------------------------
  describe('deleteApiKey', () => {
    it('deletes the key when it exists and belongs to the user', async () => {
      mockUserApiKeyRepo.delete.mockResolvedValue({ affected: 1 });
      await expect(
        service.deleteApiKey('user-1', 'key-1'),
      ).resolves.toBeUndefined();
      expect(mockUserApiKeyRepo.delete).toHaveBeenCalledWith({
        id: 'key-1',
        userId: 'user-1',
      });
    });

    it('throws NotFoundException when key does not exist', async () => {
      mockUserApiKeyRepo.delete.mockResolvedValue({ affected: 0 });
      await expect(
        service.deleteApiKey('user-1', 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when key belongs to another user', async () => {
      mockUserApiKeyRepo.delete.mockResolvedValue({ affected: 0 });
      await expect(
        service.deleteApiKey('user-2', 'key-of-user-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
