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
        select: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
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

  describe('assignProbes', () => {
    it("rejects assigning probes to an endpoint the caller can't access", async () => {
      endpointRepo.findOne.mockResolvedValue(null);
      const probeRepo = service['probeRepo'] as unknown as {
        find: jest.Mock;
      };

      await expect(
        service.assignProbes('someone-elses-ep', userId, ['probe-1']),
      ).rejects.toThrow(NotFoundException);
      expect(probeRepo.find).not.toHaveBeenCalled();
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
    it('allows one hosted endpoint on the free plan', async () => {
      endpointRepo.findOne.mockResolvedValue(mockEndpoint);
      hostedRegionRepo.findOne.mockResolvedValue(null);

      await expect(
        service.addHostedRegion('ep-uuid-1', userId, 'us-east-1'),
      ).resolves.toMatchObject({ region: 'us-east-1' });
    });

    it('should allow for business plan users', async () => {
      endpointRepo.findOne.mockResolvedValue(mockEndpoint);
      billingService.resolveUserTier.mockResolvedValue('business');
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
      billingService.resolveUserTier.mockResolvedValue('business');
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

  describe('addHostedRegion plan limits', () => {
    // In-memory account state: endpoint id -> assigned regions.
    let state: Map<string, string[]>;

    const addEndpoint = (id: string, regions: string[] = []) =>
      state.set(id, [...regions]);

    beforeEach(() => {
      state = new Map();
      billingService.resolveUserTier.mockResolvedValue('free');

      endpointRepo.findOne.mockImplementation(
        ({ where }: { where: { id: string } }) =>
          Promise.resolve(
            state.has(where.id)
              ? {
                  ...mockEndpoint,
                  id: where.id,
                  hostedRegions: state
                    .get(where.id)!
                    .map((region) => ({ endpointId: where.id, region })),
                }
              : null,
          ),
      );
      // Endpoints with at least one hosted region
      endpointRepo.createQueryBuilder.mockImplementation(() => ({
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getCount: jest.fn(() =>
          Promise.resolve([...state.values()].filter((r) => r.length).length),
        ),
      }));
      // Distinct regions in use
      hostedRegionRepo.createQueryBuilder.mockImplementation(() => ({
        select: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getRawMany: jest.fn(() =>
          Promise.resolve(
            [...new Set([...state.values()].flat())].map((region) => ({
              region,
            })),
          ),
        ),
      }));
      hostedRegionRepo.findOne.mockImplementation(
        ({ where }: { where: { endpointId: string; region: string } }) =>
          Promise.resolve(
            state.get(where.endpointId)?.includes(where.region)
              ? { endpointId: where.endpointId, region: where.region }
              : null,
          ),
      );
      hostedRegionRepo.save.mockImplementation(
        (entity: { endpointId: string; region: string }) => {
          state.get(entity.endpointId)!.push(entity.region);
          return Promise.resolve(entity);
        },
      );
    });

    const limitError = async (p: Promise<unknown>) => {
      const err = await p.then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(HttpException);
      return (err as HttpException).getResponse() as Record<string, unknown>;
    };

    describe('free (1 region, 1 hosted endpoint)', () => {
      it('allows one hosted endpoint', async () => {
        addEndpoint('ep-1');
        await expect(
          service.addHostedRegion('ep-1', userId, 'us-east-1'),
        ).resolves.toMatchObject({ region: 'us-east-1' });
      });

      it('refuses a second distinct region with the distinct count', async () => {
        addEndpoint('ep-1', ['us-east-1']);

        const body = await limitError(
          service.addHostedRegion('ep-1', userId, 'eu-west-1'),
        );
        expect(body).toMatchObject({
          message: 'Hosted region limit reached',
          code: 'plan_limit_exceeded',
          limit: 1,
          current: 1,
          plan: 'free',
        });
        expect(hostedRegionRepo.save).not.toHaveBeenCalled();
      });

      it('refuses a second hosted endpoint even in an in-use region', async () => {
        addEndpoint('ep-1', ['us-east-1']);
        addEndpoint('ep-2');

        const body = await limitError(
          service.addHostedRegion('ep-2', userId, 'us-east-1'),
        );
        expect(body).toMatchObject({
          message: 'Hosted endpoint limit reached',
          code: 'plan_limit_exceeded',
          limit: 1,
          current: 1,
          plan: 'free',
        });
      });
    });

    describe('pro (every region, 25 hosted endpoints)', () => {
      beforeEach(() => {
        billingService.resolveUserTier.mockResolvedValue('pro');
      });

      it('allows any number of distinct regions', async () => {
        addEndpoint('ep-1', ['us-east-1', 'eu-west-1', 'ap-southeast-1']);

        await expect(
          service.addHostedRegion('ep-1', userId, 'us-west-2'),
        ).resolves.toMatchObject({ region: 'us-west-2' });
        // No distinct-region count is needed when regions are unlimited
        expect(hostedRegionRepo.createQueryBuilder).not.toHaveBeenCalled();
      });

      it('allows 25 endpoints in the same region', async () => {
        for (let i = 1; i <= 25; i++) {
          addEndpoint(`ep-${i}`);
          await expect(
            service.addHostedRegion(`ep-${i}`, userId, 'us-east-1'),
          ).resolves.toMatchObject({ region: 'us-east-1' });
        }
        expect(hostedRegionRepo.save).toHaveBeenCalledTimes(25);
      });

      it('refuses a 26th hosted endpoint', async () => {
        for (let i = 1; i <= 25; i++) addEndpoint(`ep-${i}`, ['us-east-1']);
        addEndpoint('ep-26');

        const body = await limitError(
          service.addHostedRegion('ep-26', userId, 'us-east-1'),
        );
        expect(body).toMatchObject({
          message: 'Hosted endpoint limit reached',
          code: 'plan_limit_exceeded',
          limit: 25,
          current: 25,
          plan: 'pro',
        });
      });

      it('does not count a second region on an existing hosted endpoint as a new hosted endpoint', async () => {
        for (let i = 1; i <= 25; i++) addEndpoint(`ep-${i}`, ['us-east-1']);

        await expect(
          service.addHostedRegion('ep-25', userId, 'eu-west-1'),
        ).resolves.toMatchObject({ region: 'eu-west-1' });
      });
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
