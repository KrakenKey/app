import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ProbesService } from './probes.service';
import { Probe } from './entities/probe.entity';
import { ProbeScanResult } from './entities/probe-scan-result.entity';
import { Endpoint } from '../endpoints/entities/endpoint.entity';
import { EndpointHostedRegion } from '../endpoints/entities/endpoint-hosted-region.entity';
import { EndpointProbeAssignment } from '../endpoints/entities/endpoint-probe-assignment.entity';
import { AlertsService } from '../notifications/channels/alerts.service';
import { scanFailureReason } from './scan-failure';

describe('ProbesService', () => {
  let service: ProbesService;
  let probeRepo: Record<string, jest.Mock>;
  let scanResultRepo: Record<string, jest.Mock>;
  let endpointRepo: Record<string, jest.Mock>;
  let alerts: { emit: jest.Mock };

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

    alerts = { emit: jest.fn().mockResolvedValue(1) };

    scanResultRepo = {
      findOne: jest.fn().mockResolvedValue(null),
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
        { provide: AlertsService, useValue: alerts },
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

    it('rejects hosted mode from a user key', async () => {
      probeRepo.findOne.mockResolvedValue(null);

      await expect(
        service.registerProbe({ ...dto, mode: 'hosted' }, connectedUser),
      ).rejects.toThrow(ForbiddenException);
      expect(probeRepo.save).not.toHaveBeenCalled();
    });

    it("rejects re-registering another user's probe", async () => {
      probeRepo.findOne.mockResolvedValue({ ...mockProbe, userId: 'user-999' });

      await expect(service.registerProbe(dto, connectedUser)).rejects.toThrow(
        ForbiddenException,
      );
      expect(probeRepo.save).not.toHaveBeenCalled();
    });

    it('rejects a user claiming a hosted probe ID', async () => {
      probeRepo.findOne.mockResolvedValue({
        ...mockProbe,
        mode: 'hosted',
        userId: null,
      });

      await expect(service.registerProbe(dto, connectedUser)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('lets a service key reclaim a probe row and clears its owner', async () => {
      probeRepo.findOne.mockResolvedValue({ ...mockProbe, mode: 'hosted' });

      const result = await service.registerProbe(
        { ...dto, mode: 'hosted' },
        serviceKeyUser,
      );

      expect(result.userId).toBeNull();
      expect(result.mode).toBe('hosted');
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

    describe('endpoint.scan_failed alerts', () => {
      const failing = {
        ...dto,
        results: [
          {
            endpoint: { host: 'example.com', port: 443 },
            connection: { success: false, error: 'connection refused' },
          },
        ],
      };
      const healthyRow = {
        connectionSuccess: true,
        certTrusted: true,
        certChainComplete: true,
        certDaysUntilExpiry: 40,
      };
      const failingRow = { connectionSuccess: false };

      beforeEach(() => {
        probeRepo.findOne.mockResolvedValue({ ...mockProbe });
        endpointRepo.findOne.mockResolvedValue(mockEndpoint);
      });

      it('emits when a healthy endpoint starts failing', async () => {
        scanResultRepo.findOne.mockResolvedValue(healthyRow);

        await service.submitReport(failing, connectedUser);

        expect(scanResultRepo.findOne).toHaveBeenCalledWith({
          where: { endpointId: 'ep-1', probeId: 'probe-1' },
          order: { scannedAt: 'DESC' },
        });
        expect(alerts.emit).toHaveBeenCalledTimes(1);
        expect(alerts.emit).toHaveBeenCalledWith(
          'user-123',
          'endpoint.scan_failed',
          expect.objectContaining({
            subject: 'example.com:443',
            resource: { type: 'endpoint', id: 'ep-1' },
            details: expect.objectContaining({
              reason: 'Connection failed: connection refused',
            }),
          }),
        );
      });

      it('emits on the first scan when it fails', async () => {
        scanResultRepo.findOne.mockResolvedValue(null);
        await service.submitReport(failing, connectedUser);
        expect(alerts.emit).toHaveBeenCalledTimes(1);
      });

      it('does not emit again while the endpoint keeps failing', async () => {
        scanResultRepo.findOne.mockResolvedValue(failingRow);
        await service.submitReport(failing, connectedUser);
        expect(alerts.emit).not.toHaveBeenCalled();
      });

      it('does not emit for a healthy scan', async () => {
        scanResultRepo.findOne.mockResolvedValue(failingRow);
        await service.submitReport(dto, connectedUser);
        expect(alerts.emit).not.toHaveBeenCalled();
        expect(scanResultRepo.findOne).not.toHaveBeenCalled();
      });

      it('treats an expired certificate as failing', async () => {
        scanResultRepo.findOne.mockResolvedValue(healthyRow);
        await service.submitReport(
          {
            ...dto,
            results: [
              {
                endpoint: { host: 'example.com', port: 443 },
                connection: { success: true },
                certificate: { daysUntilExpiry: -2, trusted: true },
              },
            ],
          },
          connectedUser,
        );
        expect(alerts.emit).toHaveBeenCalledWith(
          'user-123',
          'endpoint.scan_failed',
          expect.objectContaining({
            details: expect.objectContaining({
              reason: 'Certificate has expired',
            }),
          }),
        );
      });

      it('still accepts the report when the previous-scan lookup fails', async () => {
        scanResultRepo.findOne.mockRejectedValue(new Error('db down'));
        await expect(
          service.submitReport(failing, connectedUser),
        ).resolves.toEqual({ accepted: 1 });
        expect(alerts.emit).not.toHaveBeenCalled();
      });
    });

    it('should skip results with no matching endpoint for connected probe', async () => {
      probeRepo.findOne.mockResolvedValue({ ...mockProbe });
      endpointRepo.findOne.mockResolvedValue(null);

      const result = await service.submitReport(dto, connectedUser);

      expect(result.accepted).toBe(0);
    });

    it('rejects hosted-mode reports from a user key', async () => {
      probeRepo.findOne.mockResolvedValue({ ...mockProbe });

      await expect(
        service.submitReport({ ...dto, mode: 'hosted' }, connectedUser),
      ).rejects.toThrow(ForbiddenException);
      expect(scanResultRepo.save).not.toHaveBeenCalled();
      expect(endpointRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('accepts hosted reports from a service key even if the row has a stale owner', async () => {
      probeRepo.findOne.mockResolvedValue({ ...mockProbe, mode: 'hosted' });

      await expect(
        service.submitReport({ ...dto, mode: 'hosted' }, serviceKeyUser),
      ).resolves.toEqual({ accepted: 0 });
    });

    it("rejects reports for another user's probe", async () => {
      probeRepo.findOne.mockResolvedValue({ ...mockProbe, userId: 'user-999' });

      await expect(service.submitReport(dto, connectedUser)).rejects.toThrow(
        ForbiddenException,
      );
      expect(scanResultRepo.save).not.toHaveBeenCalled();
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
        userId: null,
      });

      const result = await service.getConfig('probe-1', serviceKeyUser);

      expect(result.endpoints).toEqual([]);
      expect(endpointRepo.createQueryBuilder).toHaveBeenCalled();
    });

    it("rejects fetching config for another user's probe", async () => {
      probeRepo.findOne.mockResolvedValue({ ...mockProbe, userId: 'user-999' });

      await expect(service.getConfig('probe-1', connectedUser)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});

describe('scanFailureReason', () => {
  it('is null for a healthy scan', () => {
    expect(
      scanFailureReason({
        connectionSuccess: true,
        certTrusted: true,
        certChainComplete: true,
        certDaysUntilExpiry: 10,
      }),
    ).toBeNull();
  });

  it('flags connection errors, expiry and chain problems', () => {
    expect(scanFailureReason({ connectionSuccess: false })).toBe(
      'Connection failed',
    );
    expect(
      scanFailureReason({
        connectionSuccess: true,
        certNotAfter: new Date('2020-01-01'),
        scannedAt: new Date('2021-01-01'),
      }),
    ).toBe('Certificate has expired');
    expect(
      scanFailureReason({ connectionSuccess: true, certChainComplete: false }),
    ).toBe('Certificate chain is incomplete');
    expect(
      scanFailureReason({ connectionSuccess: true, certTrusted: false }),
    ).toBe('Certificate chain is not trusted');
  });
});
