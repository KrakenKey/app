import { ConfigService } from '@nestjs/config';
import { ApiKeySecurityService } from './api-key-security.service';

describe('ApiKeySecurityService', () => {
  let service: ApiKeySecurityService;
  let mockRedis: Record<string, jest.Mock>;

  const configService = {
    get: jest.fn((key: string, def?: string) => def),
  } as unknown as ConfigService;

  beforeEach(() => {
    service = new ApiKeySecurityService(configService);
    mockRedis = {
      exists: jest.fn().mockResolvedValue(0),
      incr: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
      set: jest.fn().mockResolvedValue('OK'),
      disconnect: jest.fn(),
    };
    // Replace the lazy-connecting real client with a mock.
    (service as any).redis.disconnect();
    (service as any).redis = mockRedis;
  });

  describe('isLockedOut', () => {
    it('returns false when no lock exists', async () => {
      expect(await service.isLockedOut('1.2.3.4')).toBe(false);
      expect(mockRedis.exists).toHaveBeenCalledWith('lock:1.2.3.4');
    });

    it('returns true when a lock exists', async () => {
      mockRedis.exists.mockResolvedValue(1);
      expect(await service.isLockedOut('1.2.3.4')).toBe(true);
    });

    it('returns false for empty IP without touching Redis', async () => {
      expect(await service.isLockedOut('')).toBe(false);
      expect(mockRedis.exists).not.toHaveBeenCalled();
    });

    it('fails open on Redis errors', async () => {
      mockRedis.exists.mockRejectedValue(new Error('down'));
      expect(await service.isLockedOut('1.2.3.4')).toBe(false);
    });
  });

  describe('recordFailure', () => {
    it('increments the counter and sets the window on first failure', async () => {
      await service.recordFailure('1.2.3.4');
      expect(mockRedis.incr).toHaveBeenCalledWith('fail:1.2.3.4');
      expect(mockRedis.expire).toHaveBeenCalledWith('fail:1.2.3.4', 900);
      expect(mockRedis.set).not.toHaveBeenCalled();
    });

    it('does not re-arm the window on subsequent failures', async () => {
      mockRedis.incr.mockResolvedValue(5);
      await service.recordFailure('1.2.3.4');
      expect(mockRedis.expire).not.toHaveBeenCalled();
    });

    it('activates a lockout at the threshold', async () => {
      mockRedis.incr.mockResolvedValue(10);
      await service.recordFailure('1.2.3.4');
      expect(mockRedis.set).toHaveBeenCalledWith(
        'lock:1.2.3.4',
        '1',
        'EX',
        900,
        'NX',
      );
    });

    it('swallows Redis errors (fail open)', async () => {
      mockRedis.incr.mockRejectedValue(new Error('down'));
      await expect(service.recordFailure('1.2.3.4')).resolves.toBeUndefined();
    });
  });

  describe('shouldNotifyExpiredKeyUse', () => {
    it('returns true on first use within the dedup window', async () => {
      expect(await service.shouldNotifyExpiredKeyUse('key-1')).toBe(true);
      expect(mockRedis.set).toHaveBeenCalledWith(
        'expired-notice:key-1',
        '1',
        'EX',
        86_400,
        'NX',
      );
    });

    it('returns false when already notified', async () => {
      mockRedis.set.mockResolvedValue(null);
      expect(await service.shouldNotifyExpiredKeyUse('key-1')).toBe(false);
    });

    it('fails closed (no notification) on Redis errors', async () => {
      mockRedis.set.mockRejectedValue(new Error('down'));
      expect(await service.shouldNotifyExpiredKeyUse('key-1')).toBe(false);
    });
  });
});
