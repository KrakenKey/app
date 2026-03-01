import { Test, TestingModule } from '@nestjs/testing';
import { DomainsController } from './domains.controller';
import { DomainsService } from './domains.service';

describe('DomainsController', () => {
  let controller: DomainsController;
  let mockService: Record<string, jest.Mock>;

  const userId = 'user-123';
  const mockReq = { user: { userId } } as any;

  beforeEach(async () => {
    mockService = {
      create: jest.fn(),
      findAll: jest.fn(),
      findOne: jest.fn(),
      verify: jest.fn(),
      delete: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DomainsController],
      providers: [
        {
          provide: DomainsService,
          useValue: mockService,
        },
      ],
    }).compile();

    controller = module.get<DomainsController>(DomainsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('passes userId and dto to domainsService.create()', () => {
      const dto = { hostname: 'example.com' };
      const domain = { id: 'd1', hostname: 'example.com' };
      mockService.create.mockReturnValue(domain);

      expect(controller.create(mockReq, dto as any)).toEqual(domain);
      expect(mockService.create).toHaveBeenCalledWith(userId, dto);
    });
  });

  describe('findAll', () => {
    it('passes userId to domainsService.findAll()', () => {
      const domains = [{ id: 'd1' }];
      mockService.findAll.mockReturnValue(domains);

      expect(controller.findAll(mockReq)).toEqual(domains);
      expect(mockService.findAll).toHaveBeenCalledWith(userId);
    });
  });

  describe('findOne', () => {
    it('passes id and userId to domainsService.findOne()', () => {
      const domain = { id: 'd1', hostname: 'example.com' };
      mockService.findOne.mockReturnValue(domain);

      expect(controller.findOne(mockReq, 'd1')).toEqual(domain);
      expect(mockService.findOne).toHaveBeenCalledWith('d1', userId);
    });
  });

  describe('verify', () => {
    it('passes userId and id to domainsService.verify()', () => {
      const domain = { id: 'd1', isVerified: true };
      mockService.verify.mockReturnValue(domain);

      expect(controller.verify(mockReq, 'd1')).toEqual(domain);
      expect(mockService.verify).toHaveBeenCalledWith(userId, 'd1');
    });
  });

  describe('remove', () => {
    it('passes userId and id to domainsService.delete()', () => {
      mockService.delete.mockReturnValue(undefined);

      controller.remove(mockReq, 'd1');

      expect(mockService.delete).toHaveBeenCalledWith(userId, 'd1');
    });
  });
});
