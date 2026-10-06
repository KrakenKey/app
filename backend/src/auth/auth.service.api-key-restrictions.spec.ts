import { scryptSync } from 'crypto';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AuthService } from './auth.service';

const HMAC_SECRET = 'test-hmac-secret';
const hash = (raw: string) => scryptSync(raw, HMAC_SECRET, 64).toString('hex');

describe('AuthService API key scopes and restrictions', () => {
  let service: AuthService;
  let keyRepo: Record<string, jest.Mock>;
  let domainRepo: { find: jest.Mock };
  let certRepo: { find: jest.Mock };

  beforeEach(() => {
    keyRepo = {
      create: jest.fn((v) => ({ id: 'new-key', ...v })),
      save: jest.fn((v) => Promise.resolve(v)),
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      count: jest.fn().mockResolvedValue(0),
    };
    domainRepo = { find: jest.fn().mockResolvedValue([]) };
    certRepo = { find: jest.fn().mockResolvedValue([]) };
    const config = { get: jest.fn(() => HMAC_SECRET) };
    const billing = {
      resolveUserTier: jest.fn().mockResolvedValue('team'),
      getResourceCountUserIds: jest.fn().mockResolvedValue(['u1', 'u2']),
    };
    service = new AuthService(
      config as any,
      keyRepo as any,
      {} as any,
      {} as any,
      domainRepo as any,
      certRepo as any,
      billing as any,
      {} as any,
      { shouldNotifyExpiredKeyUse: jest.fn() } as any,
    );
  });

  describe('createApiKey', () => {
    it('creates a full-access key when no restrictions are given', async () => {
      const res = await service.createApiKey('u1', 'ci');
      expect(res).toMatchObject({
        scopes: null,
        allowedDomainIds: null,
        allowedCertIds: null,
        allowedIps: null,
      });
      expect(keyRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ scopes: null, allowedIps: null }),
      );
    });

    it('stores scopes, domains, certs and IPs, de-duplicated', async () => {
      domainRepo.find.mockResolvedValue([{ id: 'd1' }]);
      certRepo.find.mockResolvedValue([{ id: 7 }]);
      const res = await service.createApiKey('u1', 'renew', undefined, {
        scopes: ['certs:read', 'certs:renew', 'certs:read'],
        allowedDomainIds: ['d1', 'd1'],
        allowedCertIds: [7],
        allowedIps: [' 203.0.113.10 ', '2001:db8::/48'],
      });
      expect(res).toMatchObject({
        scopes: ['certs:read', 'certs:renew'],
        allowedDomainIds: ['d1'],
        allowedCertIds: [7],
        allowedIps: ['203.0.113.10', '2001:db8::/48'],
      });
    });

    it('rejects an invalid IP or CIDR before creating anything', async () => {
      await expect(
        service.createApiKey('u1', 'bad', undefined, {
          allowedIps: ['203.0.113.0/40', 'example.com'],
        }),
      ).rejects.toThrow(
        new BadRequestException(
          'Invalid IP address or CIDR range: 203.0.113.0/40, example.com',
        ),
      );
      expect(keyRepo.save).not.toHaveBeenCalled();
    });

    it('rejects domain ids outside the account and its organization', async () => {
      domainRepo.find.mockResolvedValue([{ id: 'd1' }]);
      await expect(
        service.createApiKey('u1', 'x', undefined, {
          allowedDomainIds: ['d1', 'someone-elses'],
        }),
      ).rejects.toThrow('Unknown domain id(s): someone-elses');
      const where = domainRepo.find.mock.calls[0][0].where;
      expect(where.userId._value).toEqual(['u1', 'u2']);
      expect(keyRepo.save).not.toHaveBeenCalled();
    });

    it('rejects certificate ids outside the account', async () => {
      certRepo.find.mockResolvedValue([]);
      await expect(
        service.createApiKey('u1', 'x', undefined, { allowedCertIds: [99] }),
      ).rejects.toThrow('Unknown certificate id(s): 99');
    });
  });

  describe('validateApiKey with an IP allowlist', () => {
    const raw = 'kk_' + 'a'.repeat(48);
    const record = () => ({
      id: 'key-1',
      hash: hash(raw),
      user: { id: 'u1' },
      allowedIps: ['203.0.113.0/24'],
      lastUsedAt: null,
      lastUsedIp: null,
    });

    it('accepts the key from an allowed address', async () => {
      keyRepo.findOne.mockResolvedValue(record());
      await expect(
        service.validateApiKey(raw, { ip: '203.0.113.9' }),
      ).resolves.toMatchObject({ id: 'key-1' });
      expect(keyRepo.update).toHaveBeenCalled();
    });

    it('refuses it from elsewhere with 403 and does not record the use', async () => {
      keyRepo.findOne.mockResolvedValue(record());
      await expect(
        service.validateApiKey(raw, { ip: '198.51.100.1' }),
      ).rejects.toThrow(ForbiddenException);
      expect(keyRepo.update).not.toHaveBeenCalled();
    });

    it('refuses it when the caller address is unknown', async () => {
      keyRepo.findOne.mockResolvedValue(record());
      await expect(service.validateApiKey(raw, {})).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('leaves keys without an allowlist alone', async () => {
      keyRepo.findOne.mockResolvedValue({ ...record(), allowedIps: null });
      await expect(
        service.validateApiKey(raw, { ip: '198.51.100.1' }),
      ).resolves.toMatchObject({ id: 'key-1' });
    });
  });
});

describe('AuthService short-lived keys', () => {
  it('creates an ephemeral key with source, expiry and limits, outside the plan count', async () => {
    const keyRepo = {
      create: jest.fn((v) => ({ id: 'eph', ...v })),
      save: jest.fn((v) => Promise.resolve(v)),
    };
    const service = new AuthService(
      { get: jest.fn(() => 'secret') } as any,
      keyRepo as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    const before = Date.now();
    const res = await service.createEphemeralApiKey(
      'u1',
      'GitHub OIDC: o/r',
      'github-oidc',
      900,
      {
        scopes: ['certs:read'],
        allowedDomainIds: null,
        allowedCertIds: [3],
      },
    );
    expect(res.apiKey).toMatch(/^kk_[0-9a-f]{48}$/);
    expect(res.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 900_000);
    expect(keyRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'github-oidc',
        scopes: ['certs:read'],
        allowedCertIds: [3],
        allowedIps: null,
      }),
    );
  });

  it('does not email about an expired short-lived key', async () => {
    const keyRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 'eph',
        source: 'github-oidc',
        expiresAt: new Date(Date.now() - 1000),
        user: { id: 'u1' },
      }),
    };
    const security = { shouldNotifyExpiredKeyUse: jest.fn() };
    const service = new AuthService(
      { get: jest.fn(() => 'secret') } as any,
      keyRepo as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      security as any,
    );
    await expect(
      service.validateApiKey('kk_x', { ip: '1.2.3.4' }),
    ).resolves.toBeNull();
    expect(security.shouldNotifyExpiredKeyUse).not.toHaveBeenCalled();
  });
});
