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
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MAX_REPORT_RESULTS, SubmitReportDto } from './dto/submit-report.dto';

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

    // findOne stands for "the previous result": the DISTINCT ON query
    // returns it for every endpoint asked about
    scanResultRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((dto) => ({ id: 'sr-1', ...dto })),
      save: jest.fn((entities) => Promise.resolve(entities)),
    };
    scanResultRepo.createQueryBuilder = jest.fn(() => {
      let ids: string[] = [];
      const qb = {
        distinctOn: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn((_sql: string, params: { endpointIds: string[] }) => {
          ids = params.endpointIds;
          return qb;
        }),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn(async () => {
          const row = await scanResultRepo.findOne();
          return row ? ids.map((endpointId) => ({ ...row, endpointId })) : [];
        }),
      };
      return qb;
    });

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
        // Connected matching goes through the probe assignment join
        getOne: jest.fn(() => endpointRepo.findOne()),
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

        // The previous result is the last one received from this probe
        const qb = scanResultRepo.createQueryBuilder.mock.results[0].value;
        expect(qb.distinctOn).toHaveBeenCalledWith(['r.endpointId']);
        expect(qb.where).toHaveBeenCalledWith('r.probeId = :probeId', {
          probeId: 'probe-1',
        });
        expect(qb.addOrderBy).toHaveBeenCalledWith('r.createdAt', 'DESC');
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

      it('counts at most one result per endpoint in a report', async () => {
        const res = await service.submitReport(
          { ...dto, results: [dto.results[0], dto.results[0]] },
          connectedUser,
        );
        expect(res).toEqual({ accepted: 1, tooSoon: 1 });
        expect(scanResultRepo.save.mock.calls[0][0]).toHaveLength(1);
      });

      it('ignores results for endpoints not assigned to the connected probe', async () => {
        endpointRepo.findOne.mockResolvedValue(null);
        const res = await service.submitReport(dto, connectedUser);
        expect(res).toEqual({ accepted: 0, tooSoon: 0 });
        const qb = endpointRepo.createQueryBuilder();
        expect(qb.innerJoin).toHaveBeenCalledWith(
          expect.anything(),
          'epa',
          'epa."endpointId" = e.id',
        );
        expect(qb.andWhere).toHaveBeenCalledWith('epa."probeId" = :probeId', {
          probeId: 'probe-1',
        });
      });

      it('never stores a scan time later than when the result arrived', async () => {
        const future = new Date(Date.now() + 86_400_000).toISOString();
        await service.submitReport(
          { ...dto, timestamp: future },
          connectedUser,
        );
        const saved = scanResultRepo.save.mock.calls[0][0][0];
        expect(saved.scannedAt.getTime()).toBeLessThanOrEqual(Date.now());
      });

      it('ties hosted results to the region the probe registered with', async () => {
        probeRepo.findOne.mockResolvedValue({
          ...mockProbe,
          mode: 'hosted',
          region: 'eu-west-1',
          userId: null,
        });
        const qb = endpointRepo.createQueryBuilder();
        qb.getMany.mockResolvedValue([]);
        await service.submitReport(
          { ...dto, mode: 'hosted', region: 'us-east-1' },
          serviceKeyUser,
        );
        expect(qb.andWhere).toHaveBeenCalledWith('ehr.region = :region', {
          region: 'eu-west-1',
        });
      });

      it('takes no hosted results from a probe registered as connected', async () => {
        probeRepo.findOne.mockResolvedValue({ ...mockProbe, userId: null });
        const res = await service.submitReport(
          { ...dto, mode: 'hosted' },
          serviceKeyUser,
        );
        expect(res).toEqual({ accepted: 0, tooSoon: 0 });
        expect(scanResultRepo.save).not.toHaveBeenCalled();
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

    it('returns when each endpoint was last scanned by this probe, and scanNow only until it is', async () => {
      probeRepo.findOne.mockResolvedValue({
        ...mockProbe,
        mode: 'hosted',
        userId: null,
      });
      const lastScan = new Date(Date.now() - 10 * 60_000);
      scanResultRepo.findOne.mockResolvedValue({ createdAt: lastScan });
      const row = (id: string, requestedMinutesAgo: number | null) => ({
        id,
        host: `${id}.example.com`,
        port: 443,
        sni: `${id}.example.com`,
        userId: 'u1',
        lastScanRequestedAt:
          requestedMinutesAgo === null
            ? null
            : new Date(Date.now() - requestedMinutesAgo * 60_000),
      });
      endpointRepo.createQueryBuilder().getRawMany.mockResolvedValue([
        row('a', null), // never requested
        row('b', 2), // requested after the last scan
        row('c', 20), // requested before the last scan
        row('d', 9), // after the last scan, but more than 5 minutes ago
      ]);

      const result = await service.getConfig('probe-1', serviceKeyUser);

      for (const e of result.endpoints) {
        expect(e.lastScanAt).toBe(lastScan.toISOString());
      }
      expect(result.endpoints.map((e) => !!e.scanNow)).toEqual([
        false,
        true,
        false,
        false,
      ]);
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

describe('SubmitReportDto', () => {
  it(`takes at most ${MAX_REPORT_RESULTS} results`, async () => {
    const result = {
      endpoint: { host: 'example.com', port: 443 },
      connection: { success: true },
    };
    const body = (n: number) =>
      plainToInstance(SubmitReportDto, {
        probeId: 'p',
        mode: 'connected',
        timestamp: new Date().toISOString(),
        results: Array.from({ length: n }, () => result),
      });
    expect(await validate(body(MAX_REPORT_RESULTS))).toHaveLength(0);
    const errors = await validate(body(MAX_REPORT_RESULTS + 1));
    expect(errors.map((e) => e.property)).toContain('results');
  });
});
