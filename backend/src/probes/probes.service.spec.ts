import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ProbesService } from './probes.service';
import { Probe } from './entities/probe.entity';
import { ProbeScanResult } from './entities/probe-scan-result.entity';
import { Endpoint } from '../endpoints/entities/endpoint.entity';
import { EndpointHostedRegion } from '../endpoints/entities/endpoint-hosted-region.entity';
import { EndpointProbeAssignment } from '../endpoints/entities/endpoint-probe-assignment.entity';
import { AlertsService } from '../notifications/channels/alerts.service';
import { scanFailureReason } from './scan-failure';
import { BillingService } from '../billing/billing.service';

describe('ProbesService', () => {
  let service: ProbesService;
  let probeRepo: Record<string, jest.Mock>;
  let scanResultRepo: Record<string, jest.Mock>;
  let endpointRepo: Record<string, jest.Mock>;
  let alerts: { emit: jest.Mock };
  let billing: { resolveTiers: jest.Mock };
  let tiers: Record<string, string>;

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
    tiers = {};
    billing = {
      resolveTiers: jest.fn(async (ids: string[]) => {
        const map = new Map<string, string>();
        for (const id of ids) map.set(id, tiers[id] ?? 'free');
        return map;
      }),
    };

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
        { provide: AlertsService, useValue: alerts },
        { provide: BillingService, useValue: billing },
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
        ).resolves.toEqual({ accepted: 1, tooSoon: 0 });
        expect(alerts.emit).not.toHaveBeenCalled();
      });
    });

    describe('scan interval', () => {
      const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

      beforeEach(() => {
        probeRepo.findOne.mockResolvedValue({ ...mockProbe });
        endpointRepo.findOne.mockResolvedValue(mockEndpoint);
      });

      it.each([
        ['free', 50, 0],
        ['free', 60, 1],
        ['pro', 12, 0],
        ['pro', 15, 1],
        ['business', 0.5, 0],
        ['business', 1, 1],
      ])(
        'on %s, a connected result %s minutes after the last is accepted %i time(s)',
        async (plan, after, accepted) => {
          tiers['user-123'] = plan;
          scanResultRepo.findOne.mockResolvedValue({
            connectionSuccess: true,
            certTrusted: true,
            certChainComplete: true,
            certDaysUntilExpiry: 40,
            createdAt: minutesAgo(after),
          });

          const res = await service.submitReport(dto, connectedUser);

          expect(res).toEqual({ accepted, tooSoon: 1 - accepted });
          if (!accepted) expect(scanResultRepo.save).not.toHaveBeenCalled();
        },
      );

      it('accepts a result that is a little early (probe timers)', async () => {
        scanResultRepo.findOne.mockResolvedValue({
          connectionSuccess: true,
          createdAt: minutesAgo(55),
        });
        await expect(service.submitReport(dto, connectedUser)).resolves.toEqual(
          { accepted: 1, tooSoon: 0 },
        );
      });

      it('accepts an early result after an on-demand scan request', async () => {
        endpointRepo.findOne.mockResolvedValue({
          ...mockEndpoint,
          lastScanRequestedAt: minutesAgo(1),
        });
        scanResultRepo.findOne.mockResolvedValue({
          connectionSuccess: true,
          createdAt: minutesAgo(5),
        });
        await expect(service.submitReport(dto, connectedUser)).resolves.toEqual(
          { accepted: 1, tooSoon: 0 },
        );
      });

      it('uses the hosted interval for hosted results', async () => {
        probeRepo.findOne.mockResolvedValue({
          ...mockProbe,
          mode: 'hosted',
          userId: null,
        });
        endpointRepo.createQueryBuilder().getMany.mockResolvedValue([
          { ...mockEndpoint, id: 'ep-pro', userId: 'u-pro' },
          { ...mockEndpoint, id: 'ep-biz', userId: 'u-biz' },
        ]);
        tiers = { 'u-pro': 'pro', 'u-biz': 'business' };
        // 10 minutes since the last scan: Business (5m) is due, Pro (30m) isn't
        scanResultRepo.findOne.mockResolvedValue({
          connectionSuccess: true,
          createdAt: minutesAgo(10),
        });

        const res = await service.submitReport(
          { ...dto, mode: 'hosted' },
          serviceKeyUser,
        );

        expect(res).toEqual({ accepted: 1, tooSoon: 1 });
        expect(scanResultRepo.save.mock.calls[0][0]).toEqual([
          expect.objectContaining({ endpointId: 'ep-biz' }),
        ]);
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
      ).resolves.toEqual({ accepted: 0, tooSoon: 0 });
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

    it('gives each connected endpoint the owner plan minimum interval', async () => {
      probeRepo.findOne.mockResolvedValue(mockProbe);
      tiers['user-123'] = 'pro';
      endpointRepo
        .createQueryBuilder()
        .getMany.mockResolvedValue([mockEndpoint]);

      const result = await service.getConfig('probe-1', connectedUser);

      expect(result.endpoints[0].interval).toBe('15m');
      expect(result.interval).toBe('15m');
    });

    it('gives each hosted endpoint its owner plan interval, shortest on top', async () => {
      probeRepo.findOne.mockResolvedValue({
        ...mockProbe,
        mode: 'hosted',
        region: 'us-east-1',
        userId: null,
      });
      tiers = { 'u-free': 'free', 'u-pro': 'pro', 'u-biz': 'business' };
      endpointRepo.createQueryBuilder().getRawMany.mockResolvedValue(
        ['u-free', 'u-pro', 'u-biz', 'u-ent'].map((userId) => ({
          host: `${userId}.example.com`,
          port: 443,
          sni: `${userId}.example.com`,
          userId,
          lastScanRequestedAt: null,
        })),
      );
      tiers['u-ent'] = 'enterprise';

      const result = await service.getConfig('probe-1', serviceKeyUser);

      expect(result.endpoints.map((e) => [e.userId, e.interval])).toEqual([
        ['u-free', '60m'],
        ['u-pro', '30m'],
        ['u-biz', '5m'],
        ['u-ent', '1m'],
      ]);
      expect(result.interval).toBe('1m');
      // One lookup for every owner, not one per endpoint
      expect(billing.resolveTiers).toHaveBeenCalledTimes(1);
    });

    it('answers 60m with no endpoints', async () => {
      probeRepo.findOne.mockResolvedValue({
        ...mockProbe,
        mode: 'hosted',
        userId: null,
      });
      const result = await service.getConfig('probe-1', serviceKeyUser);
      expect(result).toEqual({ endpoints: [], interval: '60m' });
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
