import {
  ForbiddenException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeviceAuthService,
  formatUserCode,
  generateUserCode,
  normalizeUserCode,
} from './device-auth.service';
import type { AuthService } from '../auth.service';

/** In-memory stand-in for the ioredis calls the service makes. */
class FakeRedis {
  store = new Map<string, { value: string; expiresAt: number }>();
  now = 0;

  private live(key: string) {
    const e = this.store.get(key);
    if (e && e.expiresAt <= this.now) {
      this.store.delete(key);
      return undefined;
    }
    return e;
  }

  async set(key: string, value: string, ...args: (string | number)[]) {
    const existing = this.live(key);
    if (args.includes('NX') && existing) return null;
    if (args.includes('XX') && !existing) return null;
    let expiresAt = Infinity;
    const ex = args.indexOf('EX');
    if (ex >= 0) expiresAt = this.now + Number(args[ex + 1]) * 1000;
    if (args.includes('KEEPTTL') && existing) expiresAt = existing.expiresAt;
    this.store.set(key, { value, expiresAt });
    return 'OK';
  }

  async get(key: string) {
    return this.live(key)?.value ?? null;
  }

  async getdel(key: string) {
    const v = this.live(key)?.value ?? null;
    this.store.delete(key);
    return v;
  }

  async del(key: string) {
    return this.store.delete(key) ? 1 : 0;
  }

  disconnect() {}
}

describe('DeviceAuthService', () => {
  let service: DeviceAuthService;
  let redis: FakeRedis;
  let authService: { createApiKey: jest.Mock; assertApiKeyLimit: jest.Mock };

  const config = {
    get: jest.fn((key: string, def?: string) =>
      key === 'KK_APP_DOMAIN' ? 'app.example.com' : def,
    ),
  } as unknown as ConfigService;

  beforeEach(() => {
    authService = {
      createApiKey: jest
        .fn()
        .mockResolvedValue({ apiKey: 'kk_secret', id: 'key-1', name: 'n' }),
      assertApiKeyLimit: jest.fn().mockResolvedValue(undefined),
    };
    service = new DeviceAuthService(
      config,
      authService as unknown as AuthService,
    );
    (service as any).redis.disconnect();
    redis = new FakeRedis();
    (service as any).redis = redis;
  });

  const advance = (seconds: number) => {
    redis.now += seconds * 1000;
  };

  async function start(clientName = 'build-01') {
    return service.createDeviceCode(clientName, '203.0.113.7');
  }

  describe('createDeviceCode', () => {
    it('returns codes, URIs and timing', async () => {
      const res = await start();
      expect(res.deviceCode).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(res.userCode).toMatch(
        /^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/,
      );
      expect(res.verificationUri).toBe('https://app.example.com/device');
      expect(res.verificationUriComplete).toBe(
        `https://app.example.com/device?code=${res.userCode}`,
      );
      expect(res).toMatchObject({ expiresIn: 600, interval: 5 });
    });

    it('stores only a hash of the device code', async () => {
      const res = await start();
      const keys = [...redis.store.keys()].join(' ');
      expect(keys).not.toContain(res.deviceCode);
    });

    it('fails closed when Redis is down', async () => {
      (service as any).redis = {
        set: jest.fn().mockRejectedValue(new Error('down')),
      };
      await expect(start()).rejects.toThrow(ServiceUnavailableException);
    });
  });

  describe('full flow', () => {
    it('creates the key when the CLI collects it and delivers it once', async () => {
      const { deviceCode, userCode } = await start();

      expect(await service.pollToken(deviceCode)).toEqual({
        status: 'pending',
      });

      const info = await service.getRequest(userCode.toLowerCase());
      expect(info).toMatchObject({
        userCode,
        clientName: 'build-01',
        ip: '203.0.113.7',
      });

      await service.approve(userCode, 'user-1');
      expect(authService.assertApiKeyLimit).toHaveBeenCalledWith('user-1');
      // Approval stores who approved, never a key.
      expect(authService.createApiKey).not.toHaveBeenCalled();
      expect(JSON.stringify([...redis.store.values()])).not.toContain('kk_');

      advance(5);
      expect(await service.pollToken(deviceCode)).toEqual({
        status: 'approved',
        apiKey: 'kk_secret',
        id: 'key-1',
        name: 'n',
      });
      expect(authService.createApiKey).toHaveBeenCalledTimes(1);
      expect(authService.createApiKey).toHaveBeenCalledWith(
        'user-1',
        'CLI login: build-01',
      );

      advance(5);
      expect(await service.pollToken(deviceCode)).toEqual({
        status: 'expired',
      });
      expect(authService.createApiKey).toHaveBeenCalledTimes(1);
      expect(JSON.stringify([...redis.store.values()])).not.toContain('kk_');
    });

    it('reports denied once and then expired', async () => {
      const { deviceCode, userCode } = await start();
      await service.deny(userCode);
      expect(await service.pollToken(deviceCode)).toEqual({ status: 'denied' });
      advance(5);
      expect(await service.pollToken(deviceCode)).toEqual({
        status: 'expired',
      });
      expect(authService.createApiKey).not.toHaveBeenCalled();
    });

    it('asks the CLI to slow down when it polls faster than the interval', async () => {
      const { deviceCode } = await start();
      expect(await service.pollToken(deviceCode)).toEqual({
        status: 'pending',
      });
      expect(await service.pollToken(deviceCode)).toEqual({
        status: 'slow_down',
      });
      advance(5);
      expect(await service.pollToken(deviceCode)).toEqual({
        status: 'pending',
      });
    });

    it('expires after the TTL', async () => {
      const { deviceCode, userCode } = await start();
      advance(601);
      expect(await service.pollToken(deviceCode)).toEqual({
        status: 'expired',
      });
      await expect(service.approve(userCode, 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('surfaces a plan limit hit after approval to the CLI', async () => {
      const { deviceCode, userCode } = await start();
      await service.approve(userCode, 'user-1');
      authService.createApiKey.mockRejectedValueOnce(
        new HttpException('API key limit reached', 402),
      );
      await expect(service.pollToken(deviceCode)).rejects.toThrow(
        'API key limit reached',
      );
      advance(5);
      expect(await service.pollToken(deviceCode)).toEqual({
        status: 'expired',
      });
    });

    it('returns expired for an unknown device code', async () => {
      expect(await service.pollToken('nope')).toEqual({ status: 'expired' });
    });
  });

  describe('approve', () => {
    it('cannot approve the same request twice', async () => {
      const { userCode } = await start();
      await service.approve(userCode, 'user-1');
      await expect(service.approve(userCode, 'user-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(authService.assertApiKeyLimit).toHaveBeenCalledTimes(1);
    });

    it('blocks a concurrent second approval', async () => {
      const { userCode } = await start();
      let release!: () => void;
      authService.assertApiKeyLimit.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            release = () => resolve();
          }),
      );
      const first = service.approve(userCode, 'user-1');
      await new Promise((r) => setImmediate(r));
      await expect(service.approve(userCode, 'user-1')).rejects.toThrow(
        ForbiddenException,
      );
      release();
      await first;
      expect(authService.assertApiKeyLimit).toHaveBeenCalledTimes(1);
    });

    it('shows a plan limit on the approval page and allows a retry', async () => {
      const { userCode } = await start();
      authService.assertApiKeyLimit.mockRejectedValueOnce(
        new HttpException('API key limit reached', 402),
      );
      await expect(service.approve(userCode, 'user-1')).rejects.toThrow(
        'API key limit reached',
      );
      await expect(service.approve(userCode, 'user-1')).resolves.toBeDefined();
    });

    it('rejects malformed and unknown user codes', async () => {
      await expect(service.approve('nope', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.approve('BCDF-GHJK', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('onModuleInit', () => {
    it('connects eagerly so the first request does not fail', async () => {
      const connect = jest.fn().mockResolvedValue(undefined);
      (service as any).redis = { connect };
      await service.onModuleInit();
      expect(connect).toHaveBeenCalled();
    });

    it('does not throw when Redis is down at startup', async () => {
      (service as any).redis = {
        connect: jest.fn().mockRejectedValue(new Error('down')),
      };
      await expect(service.onModuleInit()).resolves.toBeUndefined();
    });
  });

  describe('user codes', () => {
    it('generates 8 characters from the RFC 8628 alphabet', () => {
      for (let i = 0; i < 50; i++) {
        expect(generateUserCode()).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{8}$/);
      }
    });

    it('normalizes case and separators and rejects anything else', () => {
      expect(normalizeUserCode(' bcdf-ghjk ')).toBe('BCDFGHJK');
      expect(normalizeUserCode('BCDF GHJK')).toBe('BCDFGHJK');
      expect(normalizeUserCode('ABCD-EFGH')).toBe('');
      expect(normalizeUserCode('BCDF-GHJ')).toBe('');
    });

    it('formats as XXXX-XXXX', () => {
      expect(formatUserCode('BCDFGHJK')).toBe('BCDF-GHJK');
    });
  });
});
