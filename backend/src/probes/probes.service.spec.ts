import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { ProbesService } from './probes.service';
import { Probe } from './entities/probe.entity';
import { ProbeScanResult } from './entities/probe-scan-result.entity';
import { Endpoint } from '../endpoints/entities/endpoint.entity';
import { EndpointHostedRegion } from '../endpoints/entities/endpoint-hosted-region.entity';
import { EndpointProbeAssignment } from '../endpoints/entities/endpoint-probe-assignment.entity';

describe('ProbesService', () => {
  let service: ProbesService;
  let probeRepo: Record<string, jest.Mock>;
  let scanResultRepo: Record<string, jest.Mock>;
  let endpointRepo: Record<string, jest.Mock>;

  const serviceKeyUser = { isServiceKey: true, serviceKeyId: 'svc-1' };
  const connectedUser = { userId: 'user-123' };

  const mockProbe: Probe = {
    id: 'probe-1',
    name: 'test-probe',
    version: '0.1.0',
    mode: 'connected',
    region: 'us-east-1',
    os: 'linux',
    arch: 'amd64',
    status: 'active',
    userId: 'user-123',
    lastSeenAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Probe;

  const mockEndpoint = {
    id: 'ep-1',
    userId: 'user-123',
    host: 'example.com',
    port: 443,
    isActive: true,
    hostedRegions: [],
    probeAssignments: [],
    owner: {} as any,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Endpoint;

  beforeEach(async () => {
    probeRepo = {
      findOne: jest.fn(),
      create: jest.fn((dto) => ({ ...dto })),
      save: jest.fn((entity) => Promise.resolve(entity)),
    };

    scanResultRepo = {
      create: jest.fn((dto) => ({ id: 'sr-1', ...dto })),
      save: jest.fn((entities) => Promise.resolve(entities)),
    };

    endpointRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue({
        innerJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
        getMany: jest.fn().mockResolvedValue([]),
        getOne: jest.fn().mockResolvedValue(null),
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProbesService,
        { provide: getRepositoryToken(Probe), useValue: probeRepo },
        {
          provide: getRepositoryToken(ProbeScanResult),
          useValue: scanResultRepo,
        },
        { provide: getRepositoryToken(Endpoint), useValue: endpointRepo },
        {
          provide: getRepositoryToken(EndpointHostedRegion),
          useValue: {},
        },
        {
          provide: getRepositoryToken(EndpointProbeAssignment),
          useValue: {},
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('60m') },
        },
      ],
    }).compile();

    service = module.get<ProbesService>(ProbesService);
  });

  describe('registerProbe', () => {
    const dto = {
      probeId: 'probe-1',
      name: 'test',
      version: '0.1.0',
      mode: 'connected' as const,
      os: 'linux',
      arch: 'amd64',
    };

    it('should create a new probe for connected user', async () => {
      probeRepo.findOne.mockResolvedValue(null);

      const result = await service.registerProbe(dto, connectedUser);

      expect(result.userId).toBe('user-123');
      expect(probeRepo.create).toHaveBeenCalled();
    });

    it('should update existing probe', async () => {
      probeRepo.findOne.mockResolvedValue({ ...mockProbe });

      const result = await service.registerProbe(dto, connectedUser);

      expect(result.status).toBe('active');
      expect(probeRepo.save).toHaveBeenCalled();
    });

    it('should not set userId for service key auth', async () => {
      probeRepo.findOne.mockResolvedValue(null);

      const result = await service.registerProbe(
        { ...dto, mode: 'hosted' },
        serviceKeyUser,
      );

      expect(result.userId).toBeUndefined();
    });
  });

  describe('submitReport', () => {
    const dto = {
      probeId: 'probe-1',
      mode: 'connected',
      region: 'us-east-1',
      timestamp: new Date().toISOString(),
      results: [
        {
          endpoint: { host: 'example.com', port: 443 },
          connection: { success: true, latencyMs: 42 },
          certificate: { subject: 'CN=example.com', daysUntilExpiry: 90 },
        },
      ],
    };

    it('should throw when probe not registered', async () => {
      probeRepo.findOne.mockResolvedValue(null);

      await expect(service.submitReport(dto, connectedUser)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should accept report and match endpoint for connected probe', async () => {
      probeRepo.findOne.mockResolvedValue({ ...mockProbe });
      endpointRepo.findOne.mockResolvedValue(mockEndpoint);

      const result = await service.submitReport(dto, connectedUser);

      expect(result.accepted).toBe(1);
      expect(scanResultRepo.save).toHaveBeenCalled();
    });

    it('should skip results with no matching endpoint for connected probe', async () => {
      probeRepo.findOne.mockResolvedValue({ ...mockProbe });
      endpointRepo.findOne.mockResolvedValue(null);

      const result = await service.submitReport(dto, connectedUser);

      expect(result.accepted).toBe(0);
    });
  });

  describe('getConfig', () => {
    it('should throw when probe not found', async () => {
      probeRepo.findOne.mockResolvedValue(null);

      await expect(
        service.getConfig('nonexistent', connectedUser),
      ).rejects.toThrow(NotFoundException);
    });

    it('should return assigned endpoints for connected probe', async () => {
      probeRepo.findOne.mockResolvedValue(mockProbe);
      // getConnectedEndpoints now uses createQueryBuilder with getMany
      endpointRepo
        .createQueryBuilder()
        .getMany.mockResolvedValue([mockEndpoint]);

      const result = await service.getConfig('probe-1', connectedUser);

      expect(result.endpoints).toHaveLength(1);
      expect(result.endpoints[0].host).toBe('example.com');
      expect(result.interval).toBe('60m');
    });

    it('should query hosted endpoints for service key auth', async () => {
      probeRepo.findOne.mockResolvedValue({
        ...mockProbe,
        mode: 'hosted',
        region: 'us-east-1',
      });

      const result = await service.getConfig('probe-1', serviceKeyUser);

      expect(result.endpoints).toEqual([]);
      expect(endpointRepo.createQueryBuilder).toHaveBeenCalled();
    });
  });
});
