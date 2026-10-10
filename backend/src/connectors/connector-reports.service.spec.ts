import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConnectorReportsService } from './connector-reports.service';
import { Connector } from './entities/connector.entity';
import { ConnectorDeployment } from './entities/connector-deployment.entity';

const CID = '3f1c2b9e-1111-4111-8111-111111111111';

function cert(id: number, cn = `host${id}.example.com`) {
  return {
    id,
    userId: 'u1',
    parsedCsr: {
      subject: [{ name: 'commonName', shortName: 'CN', value: cn }],
      extensions: [],
    },
  };
}

describe('ConnectorReportsService', () => {
  let connector: Record<string, any> | null;
  let stored: Record<string, any>[];
  let certs: ReturnType<typeof cert>[];
  let connectorRepo: Record<string, jest.Mock>;
  let deploymentRepo: Record<string, jest.Mock>;
  let txConnectorRepo: Record<string, jest.Mock>;
  let txDeploymentRepo: Record<string, jest.Mock>;
  let keyAccess: { canUseCert: jest.Mock };
  let alerts: { emit: jest.Mock };
  let email: { sendDeployFailed: jest.Mock; sendConnectorStale: jest.Mock };
  let userRepo: { findOne: jest.Mock };
  let qb: Record<string, jest.Mock>;
  let svc: ConnectorReportsService;

  const user = (
    apiKey: Record<string, unknown> | undefined = {
      id: 'k1',
      scopes: ['certs:read'],
      allowedCertIds: [7, 8],
      allowedDomainIds: null,
      connectorId: CID,
    },
  ) => ({ userId: 'u1', apiKey }) as any;

  const target = (label: string, state: string, over = {}) => ({
    label,
    state,
    updatedAt: '2026-10-10T14:00:00Z',
    ...over,
  });
  const body = (...certificates: { certificateId: number; targets: any[] }[]) =>
    ({ version: '0.3.0', os: 'linux', arch: 'arm64', certificates }) as any;

  beforeEach(() => {
    connector = {
      id: CID,
      userId: 'u1',
      name: 'web-01',
      clientLabel: 'Acme',
      revokedAt: null,
    };
    stored = [];
    certs = [cert(7), cert(8)];
    txConnectorRepo = {
      findOne: jest.fn(async () => connector),
      update: jest.fn(),
    };
    txDeploymentRepo = {
      find: jest.fn(async () => stored.map((d) => ({ ...d }))),
      delete: jest.fn(),
      upsert: jest.fn(),
    };
    qb = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      returning: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ raw: [] }),
    };
    connectorRepo = {
      find: jest.fn().mockResolvedValue([]),
      createQueryBuilder: jest.fn(() => qb),
    };
    deploymentRepo = { find: jest.fn().mockResolvedValue([]) };
    const dataSource = {
      transaction: jest.fn(async (cb: (m: unknown) => unknown) =>
        cb({
          getRepository: (e: unknown) =>
            e === Connector ? txConnectorRepo : txDeploymentRepo,
        }),
      ),
    };
    keyAccess = { canUseCert: jest.fn().mockResolvedValue(true) };
    alerts = { emit: jest.fn().mockResolvedValue(1) };
    email = {
      sendDeployFailed: jest.fn().mockResolvedValue(undefined),
      sendConnectorStale: jest.fn().mockResolvedValue(undefined),
    };
    userRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 'u1',
        username: 'luke',
        email: 'l@example.com',
      }),
    };
    svc = new ConnectorReportsService(
      dataSource as any,
      connectorRepo as any,
      deploymentRepo as any,
      { find: jest.fn(async () => certs) } as any,
      userRepo as any,
      {
        getResourceCountUserIds: jest.fn().mockResolvedValue(['u1']),
      } as any,
      keyAccess as any,
      alerts as any,
      email as any,
    );
  });

  describe('report', () => {
    it('refuses keys not issued to a connector', async () => {
      await expect(
        svc.report(user({ id: 'k', scopes: null }), body()),
      ).rejects.toThrow(ForbiddenException);
      // A dashboard session has no apiKey at all
      await expect(svc.report({ userId: 'u1' }, body())).rejects.toThrow(
        'Only a key issued to a connector can send connector reports.',
      );
    });

    it('stores targets, lowercases serials and updates the connector', async () => {
      await svc.report(
        user(),
        body({
          certificateId: 7,
          targets: [
            target('nginx', 'verified', { serial: '04ABCDEF' }),
            target('haproxy', 'staged'),
          ],
        }),
      );
      const rows = txDeploymentRepo.upsert.mock.calls[0][0];
      expect(rows).toEqual([
        expect.objectContaining({
          connectorId: CID,
          certificateId: 7,
          label: 'nginx',
          state: 'verified',
          serial: '04abcdef',
          error: null,
          updatedAt: new Date('2026-10-10T14:00:00Z'),
          reportedAt: expect.any(Date),
        }),
        expect.objectContaining({ label: 'haproxy', state: 'staged' }),
      ]);
      expect(txDeploymentRepo.upsert.mock.calls[0][1]).toEqual([
        'connectorId',
        'certificateId',
        'label',
      ]);
      expect(txConnectorRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
      );
      expect(txConnectorRepo.update).toHaveBeenCalledWith(CID, {
        lastSeenAt: expect.any(Date),
        staleAlertedAt: null,
        version: '0.3.0',
        os: 'linux',
        arch: 'arm64',
      });
      expect(txDeploymentRepo.delete).not.toHaveBeenCalled();
      expect(alerts.emit).not.toHaveBeenCalled();
    });

    it('removes targets a certificate no longer lists, and leaves other certificates alone', async () => {
      stored = [
        { certificateId: 7, label: 'nginx', state: 'verified' },
        { certificateId: 7, label: 'old', state: 'verified' },
      ];
      await svc.report(
        user(),
        body({ certificateId: 7, targets: [target('nginx', 'verified')] }),
      );
      expect(txDeploymentRepo.find).toHaveBeenCalledWith({
        where: { connectorId: CID, certificateId: expect.anything() },
      });
      expect(txDeploymentRepo.delete).toHaveBeenCalledWith([
        { connectorId: CID, certificateId: 7, label: 'old' },
      ]);
    });

    it('an empty target list removes every target of that certificate', async () => {
      stored = [{ certificateId: 7, label: 'nginx', state: 'verified' }];
      await svc.report(user(), body({ certificateId: 7, targets: [] }));
      expect(txDeploymentRepo.delete).toHaveBeenCalledWith([
        { connectorId: CID, certificateId: 7, label: 'nginx' },
      ]);
      expect(txDeploymentRepo.upsert).not.toHaveBeenCalled();
    });

    it('refuses duplicates', async () => {
      await expect(
        svc.report(
          user(),
          body(
            { certificateId: 7, targets: [] },
            { certificateId: 7, targets: [] },
          ),
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        svc.report(
          user(),
          body({
            certificateId: 7,
            targets: [target('a', 'staged'), target('a', 'verified')],
          }),
        ),
      ).rejects.toThrow(
        'Target "a" is listed more than once for certificate 7',
      );
    });

    it('skips certificates that are foreign or outside the restrictions and stores the rest', async () => {
      certs = [cert(7), cert(8)];
      keyAccess.canUseCert.mockImplementation(
        async (_u: unknown, c: { id: number }) => c.id === 7,
      );
      stored = [{ certificateId: 7, label: 'gone', state: 'verified' }];
      await expect(
        svc.report(
          user(),
          body(
            { certificateId: 7, targets: [target('a', 'failed')] },
            { certificateId: 8, targets: [target('b', 'failed')] },
            { certificateId: 99, targets: [target('c', 'failed')] },
          ),
        ),
      ).resolves.toEqual({ accepted: 1, rejectedCertificateIds: [8, 99] });
      expect(txDeploymentRepo.find).toHaveBeenCalledWith({
        where: {
          connectorId: CID,
          certificateId: expect.objectContaining({ _value: [7] }),
        },
      });
      const rows = txDeploymentRepo.upsert.mock.calls[0][0];
      expect(
        rows.map((r: { certificateId: number }) => r.certificateId),
      ).toEqual([7]);
      expect(alerts.emit).toHaveBeenCalledTimes(1);
      expect(txConnectorRepo.update).toHaveBeenCalled();
    });

    it('stores nothing but still checks in when every certificate is rejected', async () => {
      certs = [];
      await expect(
        svc.report(user(), body({ certificateId: 99, targets: [] })),
      ).resolves.toEqual({ accepted: 0, rejectedCertificateIds: [99] });
      expect(txDeploymentRepo.find).not.toHaveBeenCalled();
      expect(txDeploymentRepo.upsert).not.toHaveBeenCalled();
      expect(txConnectorRepo.update).toHaveBeenCalled();
    });

    it('refuses a revoked connector', async () => {
      connector = { ...connector, revokedAt: new Date() };
      await expect(svc.report(user(), body())).rejects.toThrow(
        'This connector has been revoked.',
      );
    });

    it('alerts when a target enters failed or rolled_back, not on repeats', async () => {
      stored = [
        { certificateId: 7, label: 'was-ok', state: 'verified' },
        { certificateId: 7, label: 'still-failed', state: 'failed' },
        { certificateId: 7, label: 'failed-then-rolled', state: 'failed' },
      ];
      await svc.report(
        user(),
        body({
          certificateId: 7,
          targets: [
            target('was-ok', 'failed', {
              error: 'reload_failed',
              serial: 'AB',
            }),
            target('still-failed', 'failed'),
            target('failed-then-rolled', 'rolled_back'),
            target('new-rolled', 'rolled_back'),
            target('new-ok', 'verified'),
          ],
        }),
      );
      expect(alerts.emit).toHaveBeenCalledTimes(2);
      expect(alerts.emit).toHaveBeenCalledWith('u1', 'deploy.failed', {
        subject: 'host7.example.com on web-01/was-ok',
        resource: { type: 'certificate', id: 7 },
        details: {
          connectorId: CID,
          connectorName: 'web-01',
          clientLabel: 'Acme',
          certificateId: 7,
          label: 'was-ok',
          state: 'failed',
          error: 'reload_failed',
          serial: 'ab',
        },
      });
      expect(alerts.emit).toHaveBeenCalledWith(
        'u1',
        'deploy.failed',
        expect.objectContaining({
          details: expect.objectContaining({
            label: 'new-rolled',
            state: 'rolled_back',
          }),
        }),
      );
      expect(email.sendDeployFailed).toHaveBeenCalledTimes(1);
      expect(email.sendDeployFailed).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u1',
          email: 'l@example.com',
          connectorName: 'web-01',
          clientLabel: 'Acme',
          total: 2,
          failures: [
            expect.objectContaining({
              certificateId: 7,
              commonName: 'host7.example.com',
              label: 'was-ok',
            }),
            expect.objectContaining({ label: 'new-rolled' }),
          ],
        }),
      );
    });

    it('alerts again once a target has recovered and failed again', async () => {
      stored = [{ certificateId: 7, label: 'a', state: 'verified' }];
      await svc.report(
        user(),
        body({ certificateId: 7, targets: [target('a', 'failed')] }),
      );
      stored = [{ certificateId: 7, label: 'a', state: 'failed' }];
      await svc.report(
        user(),
        body({ certificateId: 7, targets: [target('a', 'failed')] }),
      );
      stored = [{ certificateId: 7, label: 'a', state: 'activated' }];
      await svc.report(
        user(),
        body({ certificateId: 7, targets: [target('a', 'failed')] }),
      );
      expect(alerts.emit).toHaveBeenCalledTimes(2);
    });

    it('caps channel alerts per report and emails one summary', async () => {
      const targets = Array.from({ length: 30 }, (_, i) =>
        target(`t${i}`, 'failed'),
      );
      await svc.report(user(), body({ certificateId: 7, targets }));
      expect(alerts.emit).toHaveBeenCalledTimes(20);
      expect(email.sendDeployFailed).toHaveBeenCalledTimes(1);
      const ctx = email.sendDeployFailed.mock.calls[0][0];
      expect(ctx.total).toBe(30);
      expect(ctx.failures).toHaveLength(10);
    });

    it('does not fail the report when the email fails', async () => {
      email.sendDeployFailed.mockRejectedValue(new Error('smtp down'));
      await expect(
        svc.report(
          user(),
          body({ certificateId: 7, targets: [target('a', 'failed')] }),
        ),
      ).resolves.toEqual({ accepted: 1, rejectedCertificateIds: [] });
    });

    it('accepts an empty report as a check-in', async () => {
      await expect(svc.report(user(), body())).resolves.toEqual({
        accepted: 0,
        rejectedCertificateIds: [],
      });
      expect(txConnectorRepo.update).toHaveBeenCalled();
      expect(txDeploymentRepo.find).not.toHaveBeenCalled();
    });
  });

  describe('reads', () => {
    it("lists a certificate's deployments across the user's active connectors", async () => {
      connectorRepo.find.mockResolvedValue([
        { id: CID, name: 'web-01' },
        { id: 'c2', name: 'web-02' },
      ]);
      const d: Partial<ConnectorDeployment> = {
        connectorId: 'c2',
        certificateId: 7,
        label: 'nginx',
        state: 'verified',
        serial: 'ab',
        error: null,
        updatedAt: new Date('2026-10-10T14:00:00Z'),
        reportedAt: new Date('2026-10-10T14:01:00Z'),
      };
      deploymentRepo.find.mockResolvedValue([d]);
      await expect(svc.forCertificate('u1', 7)).resolves.toEqual([
        {
          connectorId: 'c2',
          connectorName: 'web-02',
          certificateId: 7,
          label: 'nginx',
          state: 'verified',
          serial: 'ab',
          error: null,
          updatedAt: '2026-10-10T14:00:00.000Z',
          reportedAt: '2026-10-10T14:01:00.000Z',
        },
      ]);
      expect(connectorRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'u1', revokedAt: expect.anything() },
        }),
      );
    });

    it('returns nothing without connectors', async () => {
      await expect(svc.forCertificate('u1', 7)).resolves.toEqual([]);
      expect(deploymentRepo.find).not.toHaveBeenCalled();
    });
  });

  describe('alertStaleConnectors', () => {
    const lastSeen = new Date(Date.now() - 30 * 3600_000);

    it('claims stale connectors in one update and alerts each once', async () => {
      qb.execute.mockResolvedValue({
        raw: [
          {
            id: 'c1',
            userId: 'u1',
            name: 'web-01',
            clientLabel: null,
            lastSeenAt: lastSeen,
            version: '0.2.0',
          },
          {
            id: 'c2',
            userId: 'u1',
            name: 'web-02',
            clientLabel: 'Acme',
            lastSeenAt: lastSeen,
            version: '0.2.0',
          },
          {
            id: 'c3',
            userId: 'u2',
            name: 'db-01',
            clientLabel: null,
            lastSeenAt: lastSeen,
            version: null,
          },
        ],
      });
      await expect(svc.alertStaleConnectors()).resolves.toBe(3);

      const conditions = qb.andWhere.mock.calls.map((c) => c[0]);
      expect(qb.where).toHaveBeenCalledWith('"enrolledAt" IS NOT NULL');
      expect(conditions).toEqual([
        '"revokedAt" IS NULL',
        '"staleAlertedAt" IS NULL',
        '"lastSeenAt" < :cutoff',
      ]);
      const cutoff = qb.andWhere.mock.calls[2][1].cutoff as Date;
      expect(Date.now() - cutoff.getTime()).toBeGreaterThanOrEqual(
        24 * 3600_000,
      );
      expect(qb.set).toHaveBeenCalledWith({ staleAlertedAt: expect.any(Date) });

      expect(alerts.emit).toHaveBeenCalledTimes(3);
      expect(alerts.emit).toHaveBeenCalledWith('u1', 'connector.stale', {
        subject: 'web-01',
        resource: { type: 'connector', id: 'c1' },
        details: {
          connectorId: 'c1',
          connectorName: 'web-01',
          clientLabel: null,
          lastSeenAt: lastSeen.toISOString(),
          version: '0.2.0',
        },
      });
      // One email per user
      expect(email.sendConnectorStale).toHaveBeenCalledTimes(2);
      expect(email.sendConnectorStale.mock.calls[0][0].connectors).toHaveLength(
        2,
      );
    });

    it('does nothing when no connector is stale', async () => {
      await expect(svc.alertStaleConnectors()).resolves.toBe(0);
      expect(alerts.emit).not.toHaveBeenCalled();
      expect(email.sendConnectorStale).not.toHaveBeenCalled();
    });
  });
});
