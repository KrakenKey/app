import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { AccountDeletionService } from './account-deletion.service';
import { User } from '../entities/user.entity';
import { TlsCrt } from '../../certs/tls/entities/tls-crt.entity';
import { Domain } from '../../domains/entities/domain.entity';
import { UserApiKey } from '../../auth/entities/user-api-key.entity';
import { Feedback } from '../../feedback/entities/feedback.entity';
import { AcmeIssuerStrategy } from '../../certs/tls/strategies/acme-issuer.strategy';

describe('AccountDeletionService', () => {
  let service: AccountDeletionService;
  let mockUsersRepo: Record<string, jest.Mock>;
  let mockTlsCrtRepo: Record<string, jest.Mock>;
  let mockDomainsRepo: Record<string, jest.Mock>;
  let mockApiKeysRepo: Record<string, jest.Mock>;
  let mockFeedbackRepo: Record<string, jest.Mock>;
  let mockAcmeIssuer: Record<string, jest.Mock>;

  const userId = 'user-to-delete';

  beforeEach(async () => {
    mockUsersRepo = { findOneBy: jest.fn(), delete: jest.fn() };
    mockTlsCrtRepo = { find: jest.fn(), delete: jest.fn() };
    mockDomainsRepo = { delete: jest.fn() };
    mockApiKeysRepo = { delete: jest.fn() };
    mockFeedbackRepo = { update: jest.fn() };
    mockAcmeIssuer = { revoke: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountDeletionService,
        { provide: getRepositoryToken(User), useValue: mockUsersRepo },
        { provide: getRepositoryToken(TlsCrt), useValue: mockTlsCrtRepo },
        { provide: getRepositoryToken(Domain), useValue: mockDomainsRepo },
        { provide: getRepositoryToken(UserApiKey), useValue: mockApiKeysRepo },
        { provide: getRepositoryToken(Feedback), useValue: mockFeedbackRepo },
        { provide: AcmeIssuerStrategy, useValue: mockAcmeIssuer },
      ],
    }).compile();

    service = module.get<AccountDeletionService>(AccountDeletionService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('deleteAccount', () => {
    it('should throw NotFoundException if user not found', async () => {
      mockUsersRepo.findOneBy.mockResolvedValue(null);

      await expect(service.deleteAccount(userId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should revoke issued certs and delete all user data', async () => {
      mockUsersRepo.findOneBy.mockResolvedValue({ id: userId });
      mockTlsCrtRepo.find.mockResolvedValue([
        { id: 'cert-1', crtPem: 'PEM1' },
        { id: 'cert-2', crtPem: 'PEM2' },
      ]);
      mockAcmeIssuer.revoke.mockResolvedValue(undefined);

      const result = await service.deleteAccount(userId);

      expect(mockAcmeIssuer.revoke).toHaveBeenCalledTimes(2);
      expect(mockAcmeIssuer.revoke).toHaveBeenCalledWith('PEM1', 1);
      expect(mockAcmeIssuer.revoke).toHaveBeenCalledWith('PEM2', 1);
      expect(mockTlsCrtRepo.delete).toHaveBeenCalledWith({ userId });
      expect(mockDomainsRepo.delete).toHaveBeenCalledWith({ userId });
      expect(mockFeedbackRepo.update).toHaveBeenCalledWith(
        { userId },
        { userId: null },
      );
      expect(mockApiKeysRepo.delete).toHaveBeenCalledWith({ userId });
      expect(mockUsersRepo.delete).toHaveBeenCalledWith(userId);
      expect(result).toEqual({ deleted: true, certsRevoked: 2 });
    });

    it('should skip certs without crtPem', async () => {
      mockUsersRepo.findOneBy.mockResolvedValue({ id: userId });
      mockTlsCrtRepo.find.mockResolvedValue([{ id: 'cert-1', crtPem: null }]);

      const result = await service.deleteAccount(userId);

      expect(mockAcmeIssuer.revoke).not.toHaveBeenCalled();
      expect(result).toEqual({ deleted: true, certsRevoked: 0 });
    });

    it('should continue deletion if cert revocation fails', async () => {
      mockUsersRepo.findOneBy.mockResolvedValue({ id: userId });
      mockTlsCrtRepo.find.mockResolvedValue([
        { id: 'cert-1', crtPem: 'PEM1' },
        { id: 'cert-2', crtPem: 'PEM2' },
      ]);
      mockAcmeIssuer.revoke
        .mockRejectedValueOnce(new Error('ACME down'))
        .mockResolvedValueOnce(undefined);

      const result = await service.deleteAccount(userId);

      expect(mockAcmeIssuer.revoke).toHaveBeenCalledTimes(2);
      expect(mockUsersRepo.delete).toHaveBeenCalledWith(userId);
      expect(result).toEqual({ deleted: true, certsRevoked: 1 });
    });

    it('should handle user with no issued certs', async () => {
      mockUsersRepo.findOneBy.mockResolvedValue({ id: userId });
      mockTlsCrtRepo.find.mockResolvedValue([]);

      const result = await service.deleteAccount(userId);

      expect(mockAcmeIssuer.revoke).not.toHaveBeenCalled();
      expect(mockUsersRepo.delete).toHaveBeenCalledWith(userId);
      expect(result).toEqual({ deleted: true, certsRevoked: 0 });
    });
  });
});
