import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, HttpException } from '@nestjs/common';
import { EndpointsService } from './endpoints.service';
import { Endpoint } from './entities/endpoint.entity';
import { EndpointHostedRegion } from './entities/endpoint-hosted-region.entity';
import { EndpointProbeAssignment } from './entities/endpoint-probe-assignment.entity';
import { ProbeScanResult } from '../probes/entities/probe-scan-result.entity';
import { Probe } from '../probes/entities/probe.entity';
import { User } from '../users/entities/user.entity';
import { BillingService } from '../billing/billing.service';

describe('EndpointsService', () => {
  let service: EndpointsService;
  let endpointRepo: Record<string, jest.Mock>;
  let hostedRegionRepo: Record<string, jest.Mock>;
  let scanResultRepo: Record<string, jest.Mock>;
  let billingService: Record<string, jest.Mock>;

  const userId = 'user-123';
  const mockEndpoint: Endpoint = {
    id: 'ep-uuid-1',
    userId,
    host: 'example.com',
    port: 443,
    sni: undefined,
    label: undefined,
    isActive: true,
    hostedRegions: [],
    probeAssignments: [],
    owner: {} as any,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    endpointRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn((dto) => ({ ...mockEndpoint, ...dto })),
      save: jest.fn((entity) => Promise.resolve(entity)),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      count: jest.fn().mockResolvedValue(0),
      createQueryBuilder: jest.fn().mockReturnValue({
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(0),
      }),
    };

    hostedRegionRepo = {
      findOne: jest.fn(),
      create: jest.fn((dto) => ({
        id: 'ehr-uuid-1',
        ...dto,
        createdAt: new Date(),
      })),
      save: jest.fn((entity) => Promise.resolve(entity)),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn().mockReturnValue({
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(0),
      }),
    };

    scanResultRepo = {
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
      createQueryBuilder: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        setParameters: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      }),
    };

    billingService = {
      resolveUserTier: jest.fn().mockResolvedValue('free'),
      getResourceCountUserIds: jest
        .fn()
        .mockImplementation((uid: string) => Promise.resolve([uid])),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EndpointsService,
        {
          provide: getRepositoryToken(Endpoint),
          useValue: endpointRepo,
        },
        {
          provide: getRepositoryToken(EndpointHostedRegion),
          useValue: hostedRegionRepo,
        },
        {
          provide: getRepositoryToken(EndpointProbeAssignment),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn((dto: any) => ({
              id: 'epa-uuid-1',
              ...dto,
              createdAt: new Date(),
            })),
            save: jest.fn((entity: any) => Promise.resolve(entity)),
            delete: jest.fn().mockResolvedValue({ affected: 1 }),
          },
        },
        {
          provide: getRepositoryToken(ProbeScanResult),
          useValue: scanResultRepo,
        },
        {
          provide: getRepositoryToken(Probe),
          useValue: {
            find: jest.fn().mockResolvedValue([]),
            findOne: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(User),
          useValue: {
            findOne: jest.fn().mockResolvedValue(null),
            find: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: BillingService,
          useValue: billingService,
        },
      ],
    }).compile();

    service = module.get<EndpointsService>(EndpointsService);
  });

  describe('create', () => {
    it('should create a new endpoint', async () => {
      // First call: duplicate check (null = not found)
      // Second call: findOne re-fetch after save (returns saved endpoint)
      endpointRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockEndpoint);
      endpointRepo.count.mockResolvedValue(0);

      const result = await service.create(userId, {
        host: 'example.com',
      });

      expect(result.host).toBe('example.com');
      expect(endpointRepo.create).toHaveBeenCalled();
      expect(endpointRepo.save).toHaveBeenCalled();
    });

    it('should return existing endpoint on duplicate', async () => {
      endpointRepo.findOne.mockResolvedValue(mockEndpoint);

      const result = await service.create(userId, {
        host: 'example.com',
      });

      expect(result).toEqual(mockEndpoint);
      expect(endpointRepo.create).not.toHaveBeenCalled();
    });

    it('should reject when plan limit is reached', async () => {
      endpointRepo.findOne.mockResolvedValue(null);
      endpointRepo.count.mockResolvedValue(3); // free tier limit

      await expect(
        service.create(userId, { host: 'new.example.com' }),
      ).rejects.toThrow(HttpException);
    });

    it('should allow creation when under limit', async () => {
      endpointRepo.findOne
        .mockResolvedValueOnce(null) // duplicate check
        .mockResolvedValueOnce({ ...mockEndpoint, host: 'new.example.com' }); // re-fetch
      endpointRepo.count.mockResolvedValue(2); // under free limit of 3

      const result = await service.create(userId, {
        host: 'new.example.com',
      });

      expect(result.host).toBe('new.example.com');
    });
  });

  describe('findAll', () => {
    it('should return all endpoints for user', async () => {
      endpointRepo.find.mockResolvedValue([mockEndpoint]);

      const result = await service.findAll(userId);

      expect(result).toEqual([mockEndpoint]);
      expect(endpointRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId },
          relations: [
            'hostedRegions',
            'probeAssignments',
            'probeAssignments.probe',
          ],
        }),
      );
    });
  });

  describe('findOne', () => {
    it('should return endpoint by id', async () => {
      endpointRepo.findOne.mockResolvedValue(mockEndpoint);

      const result = await service.findOne('ep-uuid-1', userId);

      expect(result).toEqual(mockEndpoint);
    });

    it('should throw NotFoundException when not found', async () => {
      endpointRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne('nonexistent', userId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('should update an endpoint', async () => {
      endpointRepo.findOne.mockResolvedValue({ ...mockEndpoint });
      endpointRepo.save.mockImplementation((e) => Promise.resolve(e));

      const result = await service.update('ep-uuid-1', userId, {
        label: 'New Label',
      });

      expect(result.label).toBe('New Label');
    });
  });

  describe('delete', () => {
    it('should delete an endpoint', async () => {
      endpointRepo.findOne.mockResolvedValue(mockEndpoint);

      await expect(service.delete('ep-uuid-1', userId)).resolves.not.toThrow();
      expect(endpointRepo.delete).toHaveBeenCalledWith('ep-uuid-1');
    });
  });

  describe('addHostedRegion', () => {
    it('should reject for free tier users', async () => {
      endpointRepo.findOne.mockResolvedValue(mockEndpoint);

      await expect(
        service.addHostedRegion('ep-uuid-1', userId, 'us-east-1'),
      ).rejects.toThrow(HttpException);
    });

    it('should allow for team tier users', async () => {
      endpointRepo.findOne.mockResolvedValue(mockEndpoint);
      billingService.resolveUserTier.mockResolvedValue('team');
      hostedRegionRepo.findOne.mockResolvedValue(null);

      const result = await service.addHostedRegion(
        'ep-uuid-1',
        userId,
        'us-east-1',
      );

      expect(result.region).toBe('us-east-1');
    });

    it('should return existing region on duplicate', async () => {
      endpointRepo.findOne.mockResolvedValue(mockEndpoint);
      billingService.resolveUserTier.mockResolvedValue('team');
      const existingRegion = {
        id: 'ehr-1',
        endpointId: 'ep-uuid-1',
        region: 'us-east-1',
        createdAt: new Date(),
      };
      hostedRegionRepo.findOne.mockResolvedValue(existingRegion);

      const result = await service.addHostedRegion(
        'ep-uuid-1',
        userId,
        'us-east-1',
      );

      expect(result).toEqual(existingRegion);
      expect(hostedRegionRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('removeHostedRegion', () => {
    it('should remove a hosted region', async () => {
      endpointRepo.findOne.mockResolvedValue(mockEndpoint);

      await expect(
        service.removeHostedRegion('ep-uuid-1', userId, 'us-east-1'),
      ).resolves.not.toThrow();
    });

    it('should throw when region not found', async () => {
      endpointRepo.findOne.mockResolvedValue(mockEndpoint);
      hostedRegionRepo.delete.mockResolvedValue({ affected: 0 });

      await expect(
        service.removeHostedRegion('ep-uuid-1', userId, 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getResults', () => {
    it('should return paginated scan results', async () => {
      endpointRepo.findOne.mockResolvedValue(mockEndpoint);
      scanResultRepo.findAndCount.mockResolvedValue([[], 0]);

      const result = await service.getResults('ep-uuid-1', userId, 1, 20);

      expect(result).toEqual({ data: [], total: 0 });
    });
  });
});
