import {
  BadRequestException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { REPORT_HOST_LIMITS } from '@krakenkey/shared';
import { ReportsService, hashShareToken } from './reports.service';
import { Report } from './entities/report.entity';
import { ReportHost } from './entities/report-host.entity';
import { classifyScan } from './report-classifier';
import { PLAN_LIMITS } from '../billing/constants/plan-limits';

const USER = 'user-1';
const DAY = 24 * 60 * 60 * 1000;

function makeReport(over: Partial<Report> = {}): Report {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    userId: USER,
    owner: {} as never,
    name: 'Clients',
    status: 'complete',
    hostCount: 2,
    shareTokenHash: null,
    shareCreatedAt: null,
    shareExpiresAt: null,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    startedAt: new Date('2026-10-01T00:00:01Z'),
    completedAt: new Date('2026-10-01T00:01:00Z'),
    expiresAt: new Date(Date.now() + 80 * DAY),
    hosts: [],
    ...over,
  };
}

function hostRow(host: string, position: number, scanned = true): ReportHost {
  const result = scanned
    ? classifyScan(host, 443, {
        endpoint: { host, port: 443, sni: host },
        connection: { success: true, tlsVersion: 'TLS 1.3' },
        certificate: {
          sans: ['a.example.com'],
          issuer: "CN=R11,O=Let's Encrypt,C=US",
          notAfter: new Date(Date.now() + 50 * DAY).toISOString(),
          trusted: true,
          chainDepth: 2,
        },
        scannedAt: new Date().toISOString(),
      })
    : null;
  return {
    id: `row-${position}`,
    reportId: makeReport().id,
    report: {} as never,
    position,
    host,
    port: 443,
    status: result ? 'complete' : 'pending',
    severity: result?.severity ?? null,
    result,
    scannedAt: result ? new Date() : null,
  };
}

describe('ReportsService', () => {
  let service: ReportsService;
  let reportRepo: {
    manager: unknown;
    findOne: jest.Mock;
    find: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  let hostRepo: { find: jest.Mock; createQueryBuilder?: jest.Mock };
  let queue: { add: jest.Mock; remove: jest.Mock };
  let billing: { resolveUserTier: jest.Mock };
  let saved: { report?: Report; hosts?: ReportHost[] };

  beforeEach(() => {
    saved = {};
    const em = {
      create: (_cls: unknown, data: object) => ({ ...data }),
      save: jest.fn((entity: unknown) => {
        if (Array.isArray(entity)) {
          saved.hosts = entity.map((h, i) => ({ ...h, id: `row-${i}` }));
          return Promise.resolve(saved.hosts);
        }
        saved.report = makeReport({
          ...(entity as Partial<Report>),
          id: '22222222-2222-4222-8222-222222222222',
          createdAt: new Date(),
          startedAt: null,
          completedAt: null,
        });
        return Promise.resolve(saved.report);
      }),
    };
    reportRepo = {
      manager: { transaction: (fn: (e: typeof em) => unknown) => fn(em) },
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    hostRepo = { find: jest.fn().mockResolvedValue([]) };
    queue = {
      add: jest.fn().mockResolvedValue({}),
      remove: jest.fn().mockResolvedValue(1),
    };
    billing = { resolveUserTier: jest.fn().mockResolvedValue('free') };
    service = new ReportsService(
      reportRepo as never,
      hostRepo as never,
      queue as never,
      billing as never,
      { get: (_k: string, d: string) => d } as never,
    );
  });

  const hosts = (n: number) =>
    Array.from({ length: n }, (_, i) => `h${i}.example.com`);

  describe('create', () => {
    it('stores a pending report and queues one job for it', async () => {
      const res = await service.create(USER, {
        name: '  Clients  ',
        hosts: ['a.example.com', 'A.example.com', '', 'b.example.com:8443'],
      });
      expect(res.status).toBe('pending');
      expect(res.name).toBe('Clients');
      expect(res.hostCount).toBe(2);
      expect(res.hosts.map((h) => `${h.host}:${h.port}`)).toEqual([
        'a.example.com:443',
        'b.example.com:8443',
      ]);
      expect(res.hosts.every((h) => h.status === 'pending')).toBe(true);
      expect(saved.report?.userId).toBe(USER);
      expect(saved.report!.expiresAt.getTime()).toBeGreaterThan(
        Date.now() + 89 * DAY,
      );
      expect(queue.add).toHaveBeenCalledWith(
        'scanReport',
        { reportId: saved.report!.id },
        expect.objectContaining({ jobId: saved.report!.id }),
      );
    });

    it('rejects invalid and private hosts with every reason', async () => {
      const err = await service
        .create(USER, { hosts: ['ok.example.com', '192.168.1.1', 'localhost'] })
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as BadRequestException).getResponse()).toMatchObject({
        message: [
          '"192.168.1.1": private IP addresses are not allowed',
          '"localhost": not a fully qualified domain name',
        ],
      });
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('rejects a list with only blank lines', async () => {
      await expect(service.create(USER, { hosts: ['', ' '] })).rejects.toThrow(
        'Add at least one hostname',
      );
    });

    it('allows 25 hosts on the free plan', async () => {
      await expect(
        service.create(USER, { hosts: hosts(25) }),
      ).resolves.toBeDefined();
    });

    it('refuses 26 hosts on the free plan with plan_limit_exceeded', async () => {
      const err = await service
        .create(USER, { hosts: hosts(26) })
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(403);
      expect((err as HttpException).getResponse()).toEqual({
        message: expect.stringContaining('25 hosts'),
        code: 'plan_limit_exceeded',
        limit: 25,
        current: 26,
        plan: 'free',
      });
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('counts hosts after dedupe', async () => {
      await expect(
        service.create(USER, { hosts: [...hosts(25), ...hosts(25)] }),
      ).resolves.toBeDefined();
    });

    it.each(['starter', 'team', 'business', 'enterprise'])(
      'allows 250 hosts on %s',
      async (plan) => {
        billing.resolveUserTier.mockResolvedValue(plan);
        await expect(
          service.create(USER, { hosts: hosts(250) }),
        ).resolves.toBeDefined();
        await expect(
          service.create(USER, { hosts: hosts(251) }),
        ).rejects.toMatchObject({ status: 403 });
      },
    );

    it('keeps plan limits in sync with the shared constant', () => {
      for (const [plan, limits] of Object.entries(PLAN_LIMITS)) {
        expect(limits.reportHosts).toBe(
          REPORT_HOST_LIMITS[plan as keyof typeof REPORT_HOST_LIMITS],
        );
      }
      expect(PLAN_LIMITS.free.reportHosts).toBe(25);
      expect(PLAN_LIMITS.starter.reportHosts).toBe(250);
    });
  });

  describe('ownership', () => {
    it('returns 404 for a report owned by someone else', async () => {
      reportRepo.findOne.mockResolvedValue(null);
      await expect(service.findOne('id', 'other-user')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(reportRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'id', userId: 'other-user' },
      });
      await expect(service.remove('id', 'other-user')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(
        service.createShare('id', 'other-user'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(reportRepo.update).not.toHaveBeenCalled();
      expect(reportRepo.delete).not.toHaveBeenCalled();
    });

    it('returns a sorted report with summary for the owner', async () => {
      reportRepo.findOne.mockResolvedValue(makeReport());
      hostRepo.find.mockResolvedValue([
        hostRow('a.example.com', 0),
        hostRow('b.example.com', 1),
        hostRow('c.example.com', 2, false),
      ]);
      const res = await service.findOne(makeReport().id, USER);
      expect(res.hosts.map((h) => h.host)).toEqual([
        'b.example.com', // not covered: critical
        'a.example.com',
        'c.example.com', // pending
      ]);
      expect(res.completedCount).toBe(2);
      expect(res.summary.counts).toEqual({
        critical: 1,
        warning: 0,
        notice: 0,
        ok: 1,
      });
    });

    it('deletes the report and drops its queued job', async () => {
      reportRepo.findOne.mockResolvedValue(makeReport());
      await service.remove(makeReport().id, USER);
      expect(reportRepo.delete).toHaveBeenCalledWith({ id: makeReport().id });
      expect(queue.remove).toHaveBeenCalledWith(makeReport().id);
    });
  });

  describe('findAll', () => {
    it('adds per-severity counts to each report', async () => {
      const r = makeReport();
      reportRepo.find.mockResolvedValue([r]);
      const qb = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        addGroupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          { reportId: r.id, severity: 'critical', count: '2' },
          { reportId: r.id, severity: 'ok', count: '5' },
          { reportId: r.id, severity: null, count: '3' },
        ]),
      };
      hostRepo.createQueryBuilder = jest.fn().mockReturnValue(qb);
      const [item] = await service.findAll(USER);
      expect(item.counts).toEqual({
        critical: 2,
        warning: 0,
        notice: 0,
        ok: 5,
      });
      expect(item.completedCount).toBe(7);
      expect(reportRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: USER },
          order: { createdAt: 'DESC' },
        }),
      );
    });
  });

  describe('share links', () => {
    it('creates a 32-byte base64url token, stores only its hash, expires in 30 days', async () => {
      reportRepo.findOne.mockResolvedValue(makeReport());
      const res = await service.createShare(makeReport().id, USER);

      expect(res.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(res.token, 'base64url')).toHaveLength(32);
      expect(res.url).toBe(`https://app.krakenkey.io/r/${res.token}`);
      const expires = new Date(res.expiresAt).getTime();
      expect(expires).toBeGreaterThan(Date.now() + 29.9 * DAY);
      expect(expires).toBeLessThanOrEqual(Date.now() + 30 * DAY);

      const [, update] = reportRepo.update.mock.calls[0];
      expect(update.shareTokenHash).toBe(hashShareToken(res.token));
      expect(update.shareTokenHash).not.toContain(res.token);
      expect(update.shareExpiresAt.toISOString()).toBe(res.expiresAt);
    });

    it('issues a different token each time (replacing the old one)', async () => {
      reportRepo.findOne.mockResolvedValue(makeReport());
      const a = await service.createShare(makeReport().id, USER);
      const b = await service.createShare(makeReport().id, USER);
      expect(a.token).not.toBe(b.token);
    });

    it('revokes by clearing the hash and expiry', async () => {
      reportRepo.findOne.mockResolvedValue(makeReport());
      await service.revokeShare(makeReport().id, USER);
      expect(reportRepo.update).toHaveBeenCalledWith(makeReport().id, {
        shareTokenHash: null,
        shareCreatedAt: null,
        shareExpiresAt: null,
      });
    });

    const TOKEN = 'a'.repeat(43);

    it('serves a valid token without ids or owner details', async () => {
      reportRepo.findOne.mockResolvedValue(
        makeReport({
          shareTokenHash: hashShareToken(TOKEN),
          shareExpiresAt: new Date(Date.now() + DAY),
        }),
      );
      hostRepo.find.mockResolvedValue([hostRow('a.example.com', 0)]);

      const res = await service.findShared(TOKEN);

      expect(reportRepo.findOne).toHaveBeenCalledWith({
        where: { shareTokenHash: hashShareToken(TOKEN) },
      });
      expect(Object.keys(res).sort()).toEqual([
        'completedAt',
        'completedCount',
        'createdAt',
        'hostCount',
        'hosts',
        'name',
        'shareExpiresAt',
        'status',
        'summary',
      ]);
      const body = JSON.stringify(res);
      expect(body).not.toContain(USER);
      expect(body).not.toContain(makeReport().id);
      expect(body).not.toContain('row-0');
      expect(body).not.toContain(hashShareToken(TOKEN));
    });

    it('404s for an expired link', async () => {
      reportRepo.findOne.mockResolvedValue(
        makeReport({
          shareTokenHash: hashShareToken(TOKEN),
          shareExpiresAt: new Date(Date.now() - 1000),
        }),
      );
      await expect(service.findShared(TOKEN)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('404s for a revoked or unknown link', async () => {
      reportRepo.findOne.mockResolvedValue(null);
      await expect(service.findShared(TOKEN)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('404s for a malformed token without querying', async () => {
      await expect(service.findShared('short')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(
        service.findShared(`${'a'.repeat(42)}!`),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(reportRepo.findOne).not.toHaveBeenCalled();
    });

    it('lists only a live link on the owner view', async () => {
      reportRepo.findOne.mockResolvedValue(
        makeReport({ shareExpiresAt: new Date(Date.now() - 1000) }),
      );
      expect((await service.findOne(makeReport().id, USER)).share).toBeNull();
    });
  });

  describe('CSV export', () => {
    it('exports the owner report', async () => {
      reportRepo.findOne.mockResolvedValue(makeReport());
      hostRepo.find.mockResolvedValue([hostRow('a.example.com', 0)]);
      const file = await service.exportCsv(makeReport().id, USER);
      expect(file.filename).toBe('clients-2026-10-01.csv');
      expect(file.data.split('\r\n')[1]).toMatch(/^a\.example\.com,443,ok,/);
    });

    it('exports a shared report and 404s on a bad token', async () => {
      const token = 'b'.repeat(43);
      reportRepo.findOne.mockResolvedValue(
        makeReport({
          shareTokenHash: hashShareToken(token),
          shareExpiresAt: new Date(Date.now() + DAY),
        }),
      );
      hostRepo.find.mockResolvedValue([hostRow('a.example.com', 0)]);
      await expect(service.exportSharedCsv(token)).resolves.toMatchObject({
        filename: 'clients-2026-10-01.csv',
      });
      reportRepo.findOne.mockResolvedValue(null);
      await expect(service.exportSharedCsv(token)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('purgeExpired', () => {
    it('deletes old reports and clears expired links', async () => {
      reportRepo.delete.mockResolvedValue({ affected: 3 });
      reportRepo.update.mockResolvedValue({ affected: 1 });
      await expect(service.purgeExpired()).resolves.toEqual({
        reports: 3,
        shares: 1,
      });
      expect(reportRepo.delete.mock.calls[0][0]).toHaveProperty('expiresAt');
      expect(reportRepo.update.mock.calls[0][1]).toEqual({
        shareTokenHash: null,
        shareCreatedAt: null,
        shareExpiresAt: null,
      });
    });
  });
});
