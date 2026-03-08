import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { TlsService } from './tls.service';
import { CsrUtilService } from './util/csr-util.service';
import { CertUtilService } from './util/cert-util.service';
import { DomainsService } from '../../domains/domains.service';
import { AcmeIssuerStrategy } from './strategies/acme-issuer.strategy';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TlsCrt } from './entities/tls-crt.entity';
import { getQueueToken } from '@nestjs/bullmq';
import type { ParsedCsr } from '@krakenkey/shared';
import { EmailService } from '../../notifications/email.service';

describe('TlsService', () => {
  let service: TlsService;
  let csrUtilService: CsrUtilService;
  let certUtilService: CertUtilService;
  let domainsService: DomainsService;
  let mockAcme: Record<string, jest.Mock>;
  let mockRepository: any;
  let mockQueue: any;

  const userId = 'user123';

  beforeEach(async () => {
    mockRepository = {
      save: jest.fn().mockResolvedValue({ id: 1, status: 'pending' }),
      create: jest.fn().mockReturnValue({}),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      findOneBy: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    mockQueue = {
      add: jest.fn().mockResolvedValue({}),
    };

    mockAcme = {
      issue: jest.fn(),
      revoke: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TlsService,
        {
          provide: CsrUtilService,
          useValue: {
            validateAndParse: jest.fn().mockReturnValue({
              raw: 'pem-data',
              parsed: {},
              domains: ['example.com'],
              publicKeyLength: 2048,
            }),
            isAuthorized: jest.fn(),
          },
        },
        {
          provide: DomainsService,
          useValue: {
            findAllVerified: jest.fn().mockResolvedValue([
              { hostname: 'example.com', isVerified: true },
              { hostname: 'www.example.com', isVerified: true },
            ]),
          },
        },
        {
          provide: CertUtilService,
          useValue: {
            getDetails: jest.fn().mockReturnValue({
              serialNumber: '03A1B2C3D4E5F6',
              issuer: "C=US, O=Let's Encrypt, CN=R3",
              subject: 'CN=example.com',
              validFrom: '2025-06-15T00:00:00.000Z',
              validTo: '2026-06-15T00:00:00.000Z',
              keyType: 'RSA',
              keySize: 2048,
              fingerprint: 'AB:CD:EF:01:23:45:67:89',
            }),
          },
        },
        {
          provide: AcmeIssuerStrategy,
          useValue: mockAcme,
        },
        {
          provide: getRepositoryToken(TlsCrt),
          useValue: mockRepository,
        },
        {
          provide: getQueueToken('tlsCertIssuance'),
          useValue: mockQueue,
        },
        {
          provide: EmailService,
          useValue: {
            sendCertIssued: jest.fn(),
            sendCertRenewed: jest.fn(),
            sendCertExpiryWarning: jest.fn(),
            sendCertFailed: jest.fn(),
            sendCertRevoked: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<TlsService>(TlsService);
    csrUtilService = module.get<CsrUtilService>(CsrUtilService);
    certUtilService = module.get<CertUtilService>(CertUtilService);
    domainsService = module.get<DomainsService>(DomainsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ─── findAll ──────────────────────────────────────────────────────────
  describe('findAll', () => {
    it('returns certs for user', async () => {
      const certs = [{ id: 1 }, { id: 2 }];
      mockRepository.find.mockResolvedValue(certs);

      expect(await service.findAll(userId)).toEqual(certs);
      expect(mockRepository.find).toHaveBeenCalledWith({
        where: { userId },
      });
    });
  });

  // ─── create ───────────────────────────────────────────────────────────
  describe('create', () => {
    const createDto = { csrPem: 'valid-csr-pem' };

    it('should successfully create certificate when domain is authorized', async () => {
      jest.spyOn(csrUtilService, 'validateAndParse').mockReturnValue({
        raw: 'pem-data',
        parsed: {} as ParsedCsr,
        domains: ['example.com'],
        publicKeyLength: 2048,
      });
      jest
        .spyOn(domainsService, 'findAllVerified')
        .mockResolvedValue([
          { id: 1, hostname: 'example.com', isVerified: true, userId } as any,
        ]);
      jest.spyOn(csrUtilService, 'isAuthorized').mockReturnValue(undefined);

      const result = await service.create(userId, createDto);

      expect(result).toEqual({ id: 1, status: 'pending' });
      expect(domainsService.findAllVerified).toHaveBeenCalledWith(userId);
      expect(csrUtilService.isAuthorized).toHaveBeenCalledWith(
        ['example.com'],
        ['example.com'],
      );
      expect(mockRepository.save).toHaveBeenCalledWith({
        rawCsr: 'pem-data',
        parsedCsr: {},
        status: 'pending',
        userId,
      });
      expect(mockQueue.add).toHaveBeenCalledWith(
        'tlsCertIssuance',
        { certId: 1 },
        { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
      );
    });

    it('should throw error when user has no verified domains', async () => {
      jest.spyOn(domainsService, 'findAllVerified').mockResolvedValue([]);

      await expect(service.create(userId, createDto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.create(userId, createDto)).rejects.toThrow(
        /No verified domains found/,
      );
    });

    it('should throw error when CSR contains unauthorized domain', async () => {
      jest.spyOn(csrUtilService, 'validateAndParse').mockReturnValue({
        raw: 'pem-data',
        parsed: {} as ParsedCsr,
        domains: ['example.com', 'unauthorized.com'],
        publicKeyLength: 2048,
      });
      jest
        .spyOn(domainsService, 'findAllVerified')
        .mockResolvedValue([
          { id: 1, hostname: 'example.com', isVerified: true, userId } as any,
        ]);
      jest.spyOn(csrUtilService, 'isAuthorized').mockImplementation(() => {
        throw new BadRequestException(
          'Domain unauthorized.com is not verified',
        );
      });

      await expect(service.create(userId, createDto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.create(userId, createDto)).rejects.toThrow(
        /not verified/,
      );
    });

    it('should allow CSR with multiple authorized domains', async () => {
      jest.spyOn(csrUtilService, 'validateAndParse').mockReturnValue({
        raw: 'pem-data',
        parsed: {} as ParsedCsr,
        domains: ['example.com', 'www.example.com', 'api.example.com'],
        publicKeyLength: 2048,
      });
      jest.spyOn(domainsService, 'findAllVerified').mockResolvedValue([
        { id: 1, hostname: 'example.com', isVerified: true, userId } as any,
        {
          id: 2,
          hostname: 'www.example.com',
          isVerified: true,
          userId,
        } as any,
        {
          id: 3,
          hostname: 'api.example.com',
          isVerified: true,
          userId,
        } as any,
      ]);
      jest.spyOn(csrUtilService, 'isAuthorized').mockReturnValue(undefined);

      const result = await service.create(userId, createDto);

      expect(result).toEqual({ id: 1, status: 'pending' });
      expect(csrUtilService.isAuthorized).toHaveBeenCalledWith(
        ['example.com', 'www.example.com', 'api.example.com'],
        ['example.com', 'www.example.com', 'api.example.com'],
      );
    });

    it('should accept ECDSA CSRs with correct bit length', async () => {
      jest.spyOn(csrUtilService, 'validateAndParse').mockReturnValue({
        raw: 'pem-data',
        parsed: {} as ParsedCsr,
        domains: ['example.com'],
        publicKeyLength: 384, // ECDSA P-384
      });
      jest
        .spyOn(domainsService, 'findAllVerified')
        .mockResolvedValue([
          { id: 1, hostname: 'example.com', isVerified: true, userId } as any,
        ]);
      jest.spyOn(csrUtilService, 'isAuthorized').mockReturnValue(undefined);

      const result = await service.create(userId, createDto);
      expect(result).toEqual({ id: 1, status: 'pending' });
    });
  });

  // ─── findOne ──────────────────────────────────────────────────────────
  describe('findOne', () => {
    it('returns cert when found', async () => {
      const cert = { id: 1, userId, status: 'issued' };
      mockRepository.findOneBy.mockResolvedValue(cert);

      expect(await service.findOne(1, userId)).toEqual(cert);
      expect(mockRepository.findOneBy).toHaveBeenCalledWith({ id: 1, userId });
    });

    it('throws NotFoundException when not found', async () => {
      mockRepository.findOneBy.mockResolvedValue(null);

      await expect(service.findOne(999, userId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── getDetails ─────────────────────────────────────────────────────────
  describe('getDetails', () => {
    const issuedCert = {
      id: 1,
      userId,
      status: 'issued',
      crtPem: '-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----',
    };

    it('returns parsed details for issued cert', async () => {
      mockRepository.findOneBy.mockResolvedValue({ ...issuedCert });

      const result = await service.getDetails(1, userId);

      expect(result).toEqual({
        serialNumber: '03A1B2C3D4E5F6',
        issuer: "C=US, O=Let's Encrypt, CN=R3",
        subject: 'CN=example.com',
        validFrom: '2025-06-15T00:00:00.000Z',
        validTo: '2026-06-15T00:00:00.000Z',
        keyType: 'RSA',
        keySize: 2048,
        fingerprint: 'AB:CD:EF:01:23:45:67:89',
      });
      expect(certUtilService.getDetails).toHaveBeenCalledWith(
        issuedCert.crtPem,
      );
    });

    it('throws BadRequestException when crtPem is null', async () => {
      mockRepository.findOneBy.mockResolvedValue({
        ...issuedCert,
        crtPem: null,
      });

      await expect(service.getDetails(1, userId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws NotFoundException when cert not found', async () => {
      mockRepository.findOneBy.mockResolvedValue(null);

      await expect(service.getDetails(999, userId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── update ───────────────────────────────────────────────────────────
  describe('update', () => {
    it('updates and returns the cert', async () => {
      const cert = { id: 1, userId, status: 'issued' };
      mockRepository.findOneBy.mockResolvedValue(cert);

      const result = await service.update(1, userId, {
        autoRenew: false,
      } as any);

      expect(mockRepository.update).toHaveBeenCalledWith(1, {
        autoRenew: false,
        status: undefined,
      });
      expect(result).toEqual(cert);
    });
  });

  // ─── revoke ───────────────────────────────────────────────────────────
  describe('revoke', () => {
    const issuedCert = {
      id: 1,
      userId,
      status: 'issued',
      crtPem: '-----BEGIN CERTIFICATE-----\nfoo\n-----END CERTIFICATE-----',
    };

    it('revokes an issued cert successfully', async () => {
      mockRepository.findOne.mockResolvedValue({ ...issuedCert });

      const result = await service.revoke(1, userId, 4);

      expect(mockRepository.update).toHaveBeenCalledWith(1, {
        status: 'revoking',
      });
      expect(mockAcme.revoke).toHaveBeenCalledWith(issuedCert.crtPem, 4);
      expect(mockRepository.update).toHaveBeenCalledWith(1, {
        status: 'revoked',
        revocationReason: 4,
        revokedAt: expect.any(Date),
      });
      expect(result).toEqual({ id: 1, status: 'revoked' });
    });

    it('defaults revocation reason to 0 when not provided', async () => {
      mockRepository.findOne.mockResolvedValue({ ...issuedCert });

      await service.revoke(1, userId);

      expect(mockRepository.update).toHaveBeenCalledWith(1, {
        status: 'revoked',
        revocationReason: 0,
        revokedAt: expect.any(Date),
      });
    });

    it('throws BadRequestException when cert is not issued', async () => {
      mockRepository.findOne.mockResolvedValue({
        ...issuedCert,
        status: 'pending',
      });

      await expect(service.revoke(1, userId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when cert has no PEM data', async () => {
      mockRepository.findOne.mockResolvedValue({
        ...issuedCert,
        crtPem: null,
      });

      await expect(service.revoke(1, userId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('reverts to issued and throws InternalServerErrorException on ACME failure', async () => {
      mockRepository.findOne.mockResolvedValue({ ...issuedCert });
      mockAcme.revoke.mockRejectedValue(new Error('ACME error'));

      await expect(service.revoke(1, userId)).rejects.toThrow(
        InternalServerErrorException,
      );
      expect(mockRepository.update).toHaveBeenCalledWith(1, {
        status: 'issued',
      });
    });
  });

  // ─── remove ───────────────────────────────────────────────────────────
  describe('remove', () => {
    it('deletes a failed cert', async () => {
      mockRepository.findOneBy.mockResolvedValue({
        id: 1,
        userId,
        status: 'failed',
      });

      const result = await service.remove(1, userId);

      expect(mockRepository.delete).toHaveBeenCalledWith(1);
      expect(result).toEqual({ id: 1 });
    });

    it('deletes a revoked cert', async () => {
      mockRepository.findOneBy.mockResolvedValue({
        id: 1,
        userId,
        status: 'revoked',
      });

      const result = await service.remove(1, userId);
      expect(result).toEqual({ id: 1 });
    });

    it('throws BadRequestException when cert is not failed or revoked', async () => {
      mockRepository.findOneBy.mockResolvedValue({
        id: 1,
        userId,
        status: 'issued',
      });

      await expect(service.remove(1, userId)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ─── renew ────────────────────────────────────────────────────────────
  describe('renew', () => {
    const issuedCert = {
      id: 1,
      userId,
      status: 'issued',
      rawCsr: 'pem-csr-data',
    };

    it('queues renewal for an issued cert', async () => {
      mockRepository.findOneBy.mockResolvedValue({ ...issuedCert });

      const result = await service.renew(1, userId);

      expect(mockRepository.update).toHaveBeenCalledWith(1, {
        status: 'renewing',
      });
      expect(mockQueue.add).toHaveBeenCalledWith(
        'tlsCertRenewal',
        { certId: 1 },
        { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
      );
      expect(result).toEqual({ id: 1, status: 'renewing' });
    });

    it('throws BadRequestException when cert is not issued', async () => {
      mockRepository.findOneBy.mockResolvedValue({
        ...issuedCert,
        status: 'failed',
      });

      await expect(service.renew(1, userId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when CSR data is missing', async () => {
      mockRepository.findOneBy.mockResolvedValue({
        ...issuedCert,
        rawCsr: null,
      });

      await expect(service.renew(1, userId)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ─── retry ────────────────────────────────────────────────────────────
  describe('retry', () => {
    const failedCert = {
      id: 1,
      userId,
      status: 'failed',
      rawCsr: 'pem-csr-data',
    };

    it('queues retry for a failed cert', async () => {
      mockRepository.findOneBy.mockResolvedValue({ ...failedCert });

      const result = await service.retry(1, userId);

      expect(mockRepository.update).toHaveBeenCalledWith(1, {
        status: 'pending',
      });
      expect(mockQueue.add).toHaveBeenCalledWith(
        'tlsCertIssuance',
        { certId: 1 },
        { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
      );
      expect(result).toEqual({ id: 1, status: 'pending' });
    });

    it('throws BadRequestException when cert is not failed', async () => {
      mockRepository.findOneBy.mockResolvedValue({
        ...failedCert,
        status: 'issued',
      });

      await expect(service.retry(1, userId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when CSR data is missing', async () => {
      mockRepository.findOneBy.mockResolvedValue({
        ...failedCert,
        rawCsr: null,
      });

      await expect(service.retry(1, userId)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ─── Internal methods ─────────────────────────────────────────────────
  describe('findOneInternal', () => {
    it('finds cert by id without userId check', async () => {
      const cert = { id: 1, status: 'issued' };
      mockRepository.findOne.mockResolvedValue(cert);

      expect(await service.findOneInternal(1)).toEqual(cert);
      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { id: 1 },
        relations: undefined,
      });
    });

    it('accepts relations option', async () => {
      const cert = { id: 1, status: 'issued', user: { id: 'u1' } };
      mockRepository.findOne.mockResolvedValue(cert);

      expect(
        await service.findOneInternal(1, { relations: ['user'] }),
      ).toEqual(cert);
      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { id: 1 },
        relations: ['user'],
      });
    });
  });

  describe('updateInternal', () => {
    it('updates and returns cert without userId check', async () => {
      const cert = { id: 1, status: 'issuing' };
      mockRepository.findOne.mockResolvedValue(cert);

      const result = await service.updateInternal(
        1,
        { crtPem: 'cert-pem' },
        'issuing' as any,
      );

      expect(mockRepository.update).toHaveBeenCalledWith(1, {
        crtPem: 'cert-pem',
        status: 'issuing',
      });
      expect(result).toEqual(cert);
    });
  });

  describe('renewInternal', () => {
    it('queues renewal for an issued cert', async () => {
      const cert = {
        id: 1,
        status: 'issued',
        rawCsr: 'pem',
        renewalCount: 0,
      };
      mockRepository.findOne.mockResolvedValue(cert);

      await service.renewInternal(1);

      expect(mockRepository.update).toHaveBeenCalledWith(1, {
        status: 'renewing',
        renewalCount: 1,
        lastRenewalAttemptAt: expect.any(Date),
      });
      expect(mockQueue.add).toHaveBeenCalledWith(
        'tlsCertRenewal',
        { certId: 1 },
        { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
      );
    });

    it('silently skips non-issued certs', async () => {
      mockRepository.findOne.mockResolvedValue({
        id: 1,
        status: 'pending',
        rawCsr: 'pem',
      });

      await service.renewInternal(1);

      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('silently skips certs without CSR', async () => {
      mockRepository.findOne.mockResolvedValue({
        id: 1,
        status: 'issued',
        rawCsr: null,
      });

      await service.renewInternal(1);

      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('silently skips when cert not found', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      await service.renewInternal(1);

      expect(mockQueue.add).not.toHaveBeenCalled();
    });
  });
});
