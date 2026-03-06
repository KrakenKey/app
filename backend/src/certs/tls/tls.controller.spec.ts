import { Test, TestingModule } from '@nestjs/testing';
import { TlsController } from './tls.controller';
import { TlsService } from './tls.service';

describe('TlsController', () => {
  let controller: TlsController;
  let mockService: Record<string, jest.Mock>;

  const userId = 'user-123';
  const mockReq = { user: { userId } } as any;

  beforeEach(async () => {
    mockService = {
      findAll: jest.fn(),
      findOne: jest.fn(),
      getDetails: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      renew: jest.fn(),
      retry: jest.fn(),
      revoke: jest.fn(),
      remove: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TlsController],
      providers: [
        {
          provide: TlsService,
          useValue: mockService,
        },
      ],
    }).compile();

    controller = module.get<TlsController>(TlsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('findAll', () => {
    it('passes userId to service.findAll()', () => {
      const certs = [{ id: 1, status: 'issued' }];
      mockService.findAll.mockReturnValue(certs);

      expect(controller.findAll(mockReq)).toEqual(certs);
      expect(mockService.findAll).toHaveBeenCalledWith(userId);
    });
  });

  describe('create', () => {
    it('passes userId and dto to service.create()', () => {
      const dto = {
        csrPem:
          '-----BEGIN CERTIFICATE REQUEST-----\nfoo\n-----END CERTIFICATE REQUEST-----',
      };
      mockService.create.mockReturnValue({ id: 1, status: 'pending' });

      expect(controller.create(mockReq, dto as any)).toEqual({
        id: 1,
        status: 'pending',
      });
      expect(mockService.create).toHaveBeenCalledWith(userId, dto);
    });
  });

  describe('getDetails', () => {
    it('passes numeric id and userId to service.getDetails()', () => {
      const details = {
        serialNumber: '03A1',
        issuer: 'CN=R3',
        subject: 'CN=example.com',
        validFrom: '2025-06-15T00:00:00.000Z',
        validTo: '2026-06-15T00:00:00.000Z',
        keyType: 'RSA',
        keySize: 2048,
        fingerprint: 'AB:CD',
      };
      mockService.getDetails.mockReturnValue(details);

      expect(controller.getDetails(mockReq, '42')).toEqual(details);
      expect(mockService.getDetails).toHaveBeenCalledWith(42, userId);
    });
  });

  describe('findOne', () => {
    it('passes numeric id and userId to service.findOne()', () => {
      const cert = { id: 42, status: 'issued' };
      mockService.findOne.mockReturnValue(cert);

      expect(controller.findOne(mockReq, '42')).toEqual(cert);
      expect(mockService.findOne).toHaveBeenCalledWith(42, userId);
    });
  });

  describe('update', () => {
    it('passes numeric id, userId, and dto to service.update()', () => {
      const dto = { autoRenew: true };
      mockService.update.mockReturnValue({ id: 1 });

      controller.update(mockReq, '1', dto as any);

      expect(mockService.update).toHaveBeenCalledWith(1, userId, dto);
    });
  });

  describe('revoke', () => {
    it('passes numeric id, userId, and reason to service.revoke()', () => {
      const dto = { reason: 4 };
      mockService.revoke.mockReturnValue({ id: 1, status: 'revoked' });

      expect(controller.revoke(mockReq, '1', dto as any)).toEqual({
        id: 1,
        status: 'revoked',
      });
      expect(mockService.revoke).toHaveBeenCalledWith(1, userId, 4);
    });
  });

  describe('remove', () => {
    it('passes numeric id and userId to service.remove()', () => {
      mockService.remove.mockReturnValue({ id: 1 });

      controller.remove(mockReq, '1');

      expect(mockService.remove).toHaveBeenCalledWith(1, userId);
    });
  });

  describe('renew', () => {
    it('passes numeric id and userId to service.renew()', () => {
      mockService.renew.mockReturnValue({ id: 1, status: 'renewing' });

      expect(controller.renew(mockReq, '1')).toEqual({
        id: 1,
        status: 'renewing',
      });
      expect(mockService.renew).toHaveBeenCalledWith(1, userId);
    });
  });

  describe('retry', () => {
    it('passes numeric id and userId to service.retry()', () => {
      mockService.retry.mockReturnValue({ id: 1, status: 'pending' });

      expect(controller.retry(mockReq, '1')).toEqual({
        id: 1,
        status: 'pending',
      });
      expect(mockService.retry).toHaveBeenCalledWith(1, userId);
    });
  });
});
