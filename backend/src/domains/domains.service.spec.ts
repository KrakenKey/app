import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { DomainsService } from './domains.service';
import { Domain } from './entities/domain.entity';
import { MetricsService } from '../metrics/metrics.service';

// Mock dns/promises
const mockResolveTxt = jest.fn();
jest.mock('dns/promises', () => ({
  resolveTxt: (...args: any[]) => mockResolveTxt(...args),
}));

// Mock crypto.randomBytes to return deterministic value
jest.mock('crypto', () => {
  const actual = jest.requireActual('crypto');
  return {
    ...actual,
    randomBytes: jest
      .fn()
      .mockReturnValue(Buffer.from('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4', 'hex')),
  };
});

describe('DomainsService', () => {
  let service: DomainsService;
  let mockRepository: Record<string, jest.Mock>;

  const userId = 'user-123';
  const mockDomain: Domain = {
    id: 'domain-uuid-1',
    hostname: 'example.com',
    verificationCode: 'krakenkey-site-verification=abc123',
    isVerified: false,
    userId,
    owner: {} as any,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    mockRepository = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      delete: jest.fn(),
      update: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DomainsService,
        {
          provide: getRepositoryToken(Domain),
          useValue: mockRepository,
        },
        {
          provide: MetricsService,
          useValue: { domainsVerifiedTotal: { inc: jest.fn() } },
        },
      ],
    }).compile();

    service = module.get<DomainsService>(DomainsService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ─── create ─────────────────────────────────────────────────────────────
  describe('create', () => {
    it('returns existing domain when user already has it', async () => {
      mockRepository.findOne.mockResolvedValue(mockDomain);

      const result = await service.create(userId, { hostname: 'example.com' });

      expect(result).toEqual(mockDomain);
      expect(mockRepository.create).not.toHaveBeenCalled();
    });

    it('creates new domain with verification code when not existing', async () => {
      mockRepository.findOne.mockResolvedValue(null);
      const newDomain = { ...mockDomain };
      mockRepository.create.mockReturnValue(newDomain);
      mockRepository.save.mockResolvedValue(newDomain);

      const result = await service.create(userId, { hostname: 'example.com' });

      expect(mockRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          hostname: 'example.com',
          userId,
          isVerified: false,
        }),
      );
      expect(mockRepository.save).toHaveBeenCalled();
      expect(result).toEqual(newDomain);
    });

    it('generates verification code with krakenkey-site-verification= prefix', async () => {
      mockRepository.findOne.mockResolvedValue(null);
      mockRepository.create.mockReturnValue(mockDomain);
      mockRepository.save.mockResolvedValue(mockDomain);

      await service.create(userId, { hostname: 'example.com' });

      const createArg = mockRepository.create.mock.calls[0][0];
      expect(createArg.verificationCode).toMatch(
        /^krakenkey-site-verification=/,
      );
    });
  });

  // ─── findAll ────────────────────────────────────────────────────────────
  describe('findAll', () => {
    it('returns all domains for user', async () => {
      mockRepository.find.mockResolvedValue([mockDomain]);

      const result = await service.findAll(userId);

      expect(result).toEqual([mockDomain]);
      expect(mockRepository.find).toHaveBeenCalledWith({
        where: { userId },
      });
    });

    it('returns empty array when none', async () => {
      mockRepository.find.mockResolvedValue([]);
      expect(await service.findAll(userId)).toEqual([]);
    });
  });

  // ─── findAllVerified ──────────────────────────────────────────────────
  describe('findAllVerified', () => {
    it('returns only verified domains', async () => {
      const verified = { ...mockDomain, isVerified: true };
      mockRepository.find.mockResolvedValue([verified]);

      const result = await service.findAllVerified(userId);

      expect(result).toEqual([verified]);
      expect(mockRepository.find).toHaveBeenCalledWith({
        where: { userId, isVerified: true },
      });
    });
  });

  // ─── findOne ──────────────────────────────────────────────────────────
  describe('findOne', () => {
    it('returns domain when found', async () => {
      mockRepository.findOne.mockResolvedValue(mockDomain);

      const result = await service.findOne('domain-uuid-1', userId);

      expect(result).toEqual(mockDomain);
    });

    it('throws NotFoundException when not found', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      await expect(service.findOne('nonexistent', userId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── verify ───────────────────────────────────────────────────────────
  describe('verify', () => {
    it('skips DNS lookup and returns immediately when already verified', async () => {
      const verified = { ...mockDomain, isVerified: true };
      mockRepository.findOne.mockResolvedValue(verified);

      const result = await service.verify(userId, 'domain-uuid-1');

      expect(result).toEqual(verified);
      expect(mockResolveTxt).not.toHaveBeenCalled();
    });

    it('marks domain as verified when TXT record found', async () => {
      mockRepository.findOne.mockResolvedValue({ ...mockDomain });
      mockResolveTxt.mockResolvedValue([[mockDomain.verificationCode]]);
      mockRepository.save.mockResolvedValue({
        ...mockDomain,
        isVerified: true,
      });

      const result = await service.verify(userId, 'domain-uuid-1');

      expect(result.isVerified).toBe(true);
      expect(mockRepository.save).toHaveBeenCalled();
    });

    it('handles chunked TXT records (joined)', async () => {
      const code = mockDomain.verificationCode;
      // DNS splits long TXT records into 255-char chunks
      const chunk1 = code.substring(0, 20);
      const chunk2 = code.substring(20);
      mockRepository.findOne.mockResolvedValue({ ...mockDomain });
      mockResolveTxt.mockResolvedValue([[chunk1, chunk2]]);
      mockRepository.save.mockResolvedValue({
        ...mockDomain,
        isVerified: true,
      });

      const result = await service.verify(userId, 'domain-uuid-1');

      expect(result.isVerified).toBe(true);
    });

    it('throws BadRequestException when verification record not found', async () => {
      mockRepository.findOne.mockResolvedValue({ ...mockDomain });
      mockResolveTxt.mockResolvedValue([['unrelated-record']]);

      await expect(service.verify(userId, 'domain-uuid-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when DNS lookup fails', async () => {
      mockRepository.findOne.mockResolvedValue({ ...mockDomain });
      mockResolveTxt.mockRejectedValue(new Error('ENOTFOUND'));

      await expect(service.verify(userId, 'domain-uuid-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ─── checkVerificationRecord ──────────────────────────────────────────
  describe('checkVerificationRecord', () => {
    it('returns true when TXT record present', async () => {
      mockResolveTxt.mockResolvedValue([[mockDomain.verificationCode]]);

      expect(await service.checkVerificationRecord(mockDomain)).toBe(true);
    });

    it('returns false when TXT record missing', async () => {
      mockResolveTxt.mockResolvedValue([['unrelated']]);

      expect(await service.checkVerificationRecord(mockDomain)).toBe(false);
    });

    it('returns false on DNS error', async () => {
      mockResolveTxt.mockRejectedValue(new Error('SERVFAIL'));

      expect(await service.checkVerificationRecord(mockDomain)).toBe(false);
    });
  });

  // ─── delete ───────────────────────────────────────────────────────────
  describe('delete', () => {
    it('succeeds when domain exists', async () => {
      mockRepository.delete.mockResolvedValue({ affected: 1 });

      await expect(
        service.delete(userId, 'domain-uuid-1'),
      ).resolves.toBeUndefined();
    });

    it('throws NotFoundException when not found', async () => {
      mockRepository.delete.mockResolvedValue({ affected: 0 });

      await expect(service.delete(userId, 'nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
