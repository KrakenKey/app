/**
 * Renewal claims and the renewal queue (past the concurrent pending limit),
 * run against an in-memory tls_crt table instead of call-by-call mocks, so
 * concurrent callers really race for the same rows.
 */
import {
  ConflictException,
  HttpException,
  InternalServerErrorException,
} from '@nestjs/common';
import { FindOperator } from 'typeorm';
import type { ParsedCsr, RenewTlsCertResponse } from '@krakenkey/shared';
import {
  MAX_RECOVERIES,
  QUEUE_ADD_TIMEOUT_MS,
  STUCK_AFTER_MS,
  TlsService,
} from './tls.service';
import { RenewalQueueService } from './services/renewal-queue.service';
import { CertIssuerConsumer } from './processors/tls-crt-issuer.processor';
import { RENEWAL_RETRY_BACKOFF_MS } from './util/renewal-window';

type Row = Record<string, any> & { id: number };
type Where = Record<string, unknown> | Record<string, unknown>[];

/** Lets other pending promises run, as a database round trip would. */
const roundTrip = () => new Promise((resolve) => setImmediate(resolve));

function matchValue(value: unknown, cond: unknown): boolean {
  if (cond instanceof FindOperator) {
    switch (cond.type) {
      case 'in':
        return (cond.value as unknown[]).includes(value);
      case 'isNull':
        return value === null || value === undefined;
      case 'not':
        return !matchValue(value, cond.child);
      case 'moreThanOrEqual':
        return (value as number) >= (cond.value as number);
      case 'lessThan':
        return value != null && (value as number) < (cond.value as number);
      default:
        throw new Error(`Fake table: unsupported operator ${cond.type}`);
    }
  }
  if (cond instanceof Date) {
    return value instanceof Date && value.getTime() === cond.getTime();
  }
  return value === cond;
}

function matches(row: Row, where: Where = {}): boolean {
  if (Array.isArray(where)) return where.some((w) => matches(row, w));
  return Object.entries(where).every(([k, cond]) => matchValue(row[k], cond));
}

/**
 * The subset of Repository<TlsCrt> that TlsService uses. Each conditional
 * update applies to the rows matching at that moment, like one UPDATE
 * statement. Transactions run one at a time (standing in for the
 * per-account advisory lock) and roll back on error.
 */
class FakeCertTable {
  rows = new Map<number, Row>();
  private nextId = 1;
  private txQueue: Promise<unknown> = Promise.resolve();

  insert(row: Partial<Row>): Row {
    const full: Row = {
      id: this.nextId++,
      status: 'issued',
      rawCsr: 'stored-csr',
      parsedCsr: null,
      managedBy: null,
      autoRenew: true,
      renewalCount: 0,
      renewalQueuedAt: null,
      inFlightSince: null,
      recoveryCount: 0,
      crtPem: null,
      expiresAt: null,
      createdAt: new Date(),
      ...row,
    };
    this.rows.set(full.id, full);
    return full;
  }

  row(id: number): Row {
    return this.rows.get(id)!;
  }

  async findOne({ where }: { where: Where }) {
    await roundTrip();
    const row = [...this.rows.values()].find((r) => matches(r, where));
    return row ? { ...row } : null;
  }

  findOneBy(where: Where) {
    return this.findOne({ where });
  }

  async count({ where }: { where: Where }) {
    await roundTrip();
    return [...this.rows.values()].filter((r) => matches(r, where)).length;
  }

  async find({
    where,
    order,
    take,
  }: {
    where: Where;
    order?: Record<string, 'ASC' | 'DESC'>;
    take?: number;
  }) {
    await roundTrip();
    let found = [...this.rows.values()].filter((r) => matches(r, where));
    for (const [key, dir] of Object.entries(order ?? {}).reverse()) {
      const sign = dir === 'DESC' ? -1 : 1;
      found = [...found].sort((a, b) =>
        a[key] < b[key] ? -sign : a[key] > b[key] ? sign : 0,
      );
    }
    return found.slice(0, take ?? found.length).map((r) => ({ ...r }));
  }

  async update(criteria: number | Where, changes: Record<string, unknown>) {
    await roundTrip();
    const where = typeof criteria === 'number' ? { id: criteria } : criteria;
    const hit = [...this.rows.values()].filter((r) => matches(r, where));
    for (const row of hit) {
      for (const [key, value] of Object.entries(changes)) {
        if (typeof value === 'function') {
          // Only the `"col" + n` expressions TlsService uses
          const m = /^"(\w+)" \+ (\d+)$/.exec((value as () => string)());
          if (!m) throw new Error(`Fake table: unsupported SQL ${value}`);
          row[key] = row[m[1]] + Number(m[2]);
        } else {
          row[key] = value;
        }
      }
    }
    return { affected: hit.length };
  }

  async save(entity: Partial<Row>) {
    await roundTrip();
    return { ...this.insert(entity) };
  }

  manager = {
    transaction: <T>(run: (m: unknown) => Promise<T>): Promise<T> => {
      const result = this.txQueue.then(async () => {
        const snapshot = new Map(
          [...this.rows].map(([id, r]) => [id, { ...r }]),
        );
        try {
          return await run({
            query: () => Promise.resolve([]),
            getRepository: () => this,
          });
        } catch (err) {
          this.rows = snapshot;
          throw err;
        }
      });
      this.txQueue = result.catch(() => undefined);
      return result;
    },
  };
}

/** BullMQ stand-in: records jobs and, like BullMQ, ignores a repeated jobId. */
type FakeJob = {
  name: string;
  data: { certId: number; inFlightSince?: number };
  opts: any;
  state?: string;
};

class FakeQueue {
  jobs: FakeJob[] = [];
  down = false;
  /** When set, addBulk never answers (Redis hanging). */
  hang = false;

  add(name: string, data: FakeJob['data'], opts: unknown) {
    this.jobs.push({ name, data, opts, state: 'waiting' });
    return Promise.resolve({});
  }

  addBulkCalls = 0;

  addBulk(list: FakeJob[]) {
    this.addBulkCalls++;
    if (this.hang) return new Promise<never>(() => undefined);
    if (this.down) return Promise.reject(new Error('Connection is closed.'));
    for (const job of list) {
      if (!this.jobs.some((j) => j.opts?.jobId === job.opts.jobId)) {
        this.jobs.push({ ...job, state: 'waiting' });
      }
    }
    return Promise.resolve([]);
  }

  getJobs(states: string[]) {
    if (this.down) return Promise.reject(new Error('Connection is closed.'));
    return Promise.resolve(
      this.jobs.filter((j) => states.includes(j.state ?? 'waiting')),
    );
  }

  /** Marks every job for this certificate finished. */
  finish(certId: number) {
    for (const j of this.jobs)
      if (j.data.certId === certId) j.state = 'completed';
  }

  renewals() {
    return this.jobs
      .filter((j) => j.name === 'tlsCertRenewal')
      .map((j) => j.data.certId);
  }
}

const parsedFor = (names: string[]) =>
  ({
    subject: [{ name: 'commonName', shortName: 'CN', value: names[0] }],
    attributes: [],
    publicKey: { keyType: 'ECDSA', bitLength: 256 },
    extensions: [
      {
        name: 'subjectAltName',
        altNames: names.map((value) => ({ type: 2, value })),
      },
    ],
  }) as unknown as ParsedCsr;

describe('Renewal claims and queue', () => {
  let table: FakeCertTable;
  let queue: FakeQueue;
  let service: TlsService;
  let plans: Record<string, string>;
  let orgs: Record<string, string[]>;
  let csrUtil: { validateAndParse: jest.Mock; isAuthorized: jest.Mock };
  let acme: { revoke: jest.Mock };
  let alerts: { emit: jest.Mock };
  let email: {
    sendCertRevoked: jest.Mock;
    sendCertFailed: jest.Mock;
    sendCertRenewalFailed: jest.Mock;
  };
  let metrics: { certIssuanceTotal: { inc: jest.Mock } };

  beforeEach(() => {
    table = new FakeCertTable();
    queue = new FakeQueue();
    plans = {};
    orgs = {};
    csrUtil = {
      validateAndParse: jest.fn().mockResolvedValue({
        raw: 'new-csr',
        parsed: parsedFor(['example.com']),
        domains: ['example.com'],
        publicKeyLength: 256,
      }),
      isAuthorized: jest.fn(),
    };
    acme = { revoke: jest.fn().mockResolvedValue(undefined) };
    alerts = { emit: jest.fn().mockResolvedValue(0) };
    email = {
      sendCertRevoked: jest.fn().mockResolvedValue(undefined),
      sendCertFailed: jest.fn().mockResolvedValue(undefined),
      sendCertRenewalFailed: jest.fn().mockResolvedValue(undefined),
    };
    metrics = { certIssuanceTotal: { inc: jest.fn() } };
    const billing = {
      resolveUserTier: jest.fn((id: string) =>
        Promise.resolve(plans[id] ?? 'free'),
      ),
      getResourceCountUserIds: jest.fn((id: string) =>
        Promise.resolve(orgs[id] ?? [id]),
      ),
    };
    service = new TlsService(
      table as any,
      {
        findOne: ({ where }: { where: { id: string } }) =>
          Promise.resolve(
            where.id === 'u1'
              ? { id: 'u1', username: 'one', email: 'one@example.com' }
              : null,
          ),
      } as any,
      queue as any,
      csrUtil as any,
      {
        getChainInfo: (crt: string, chain: string | null) => ({
          leafCert: { subject: crt },
          fullChainPem: `${crt}\n${chain ?? ''}`,
        }),
      } as any,
      {
        findAllVerified: () => Promise.resolve([{ hostname: 'example.com' }]),
      } as any,
      acme as any,
      email as any,
      billing as any,
      alerts as any,
      metrics as any,
    );
  });

  /** What the worker does when a job ends: final status, then refill. */
  const finishJob = async (id: number, status = 'issued') => {
    queue.finish(id);
    await table.update(id, {
      status,
      renewalQueuedAt: null,
      inFlightSince: null,
    });
    await service.startQueuedRenewalsSafely(table.row(id).userId);
  };

  const issued = (userId = 'u1', extra: Partial<Row> = {}) =>
    table.insert({ userId, status: 'issued', ...extra }).id;

  describe('claims', () => {
    it('two processes auto-renewing one certificate queue one renewal and one ACME order', async () => {
      const id = issued();

      await Promise.all([service.renewInternal(id), service.renewInternal(id)]);

      expect(queue.renewals()).toEqual([id]);
      expect(table.row(id)).toMatchObject({
        status: 'renewing',
        renewalCount: 1,
        renewalQueuedAt: null,
      });
    });

    it('two renew requests for one certificate: one starts, the other gets 409', async () => {
      const id = issued();

      const results = await Promise.allSettled([
        service.renew(id, 'u1'),
        service.renew(id, 'u1'),
      ]);

      const ok = results.filter((r) => r.status === 'fulfilled');
      const failed = results.filter((r) => r.status === 'rejected');
      expect(ok).toHaveLength(1);
      expect(failed).toHaveLength(1);
      expect(failed[0].reason).toBeInstanceOf(ConflictException);
      expect(queue.renewals()).toEqual([id]);
    });

    it('an auto-renewal racing a renew request queues one renewal', async () => {
      const id = issued();

      await Promise.allSettled([
        service.renewInternal(id),
        service.renew(id, 'u1'),
      ]);

      expect(queue.renewals()).toEqual([id]);
    });

    it('starting the same queued renewals from two places adds each job once', async () => {
      plans.u1 = 'free';
      const [a, b] = [issued(), issued()];
      await table.update(a, {
        status: 'renewing',
        renewalQueuedAt: new Date(),
      });
      await table.update(b, {
        status: 'renewing',
        renewalQueuedAt: new Date(),
      });

      await Promise.all([
        service.startQueuedRenewals('u1'),
        service.startQueuedRenewals('u1'),
      ]);

      expect(queue.renewals().sort()).toEqual([a, b]);
    });
  });

  describe('past the concurrent pending limit', () => {
    it('queues renewals instead of refusing them, and starts them oldest first as slots free up', async () => {
      // Free plan: 2 concurrent pending
      const ids = [1, 2, 3, 4, 5].map(() => issued());

      const responses: RenewTlsCertResponse[] = [];
      for (const id of ids) responses.push(await service.renew(id, 'u1'));

      expect(responses.map((r) => r.queued)).toEqual([
        false,
        false,
        true,
        true,
        true,
      ]);
      for (const r of responses) {
        expect(r).toMatchObject({ status: 'renewing', skipped: false });
      }
      expect(queue.renewals()).toEqual([ids[0], ids[1]]);
      expect(table.row(ids[2]).renewalQueuedAt).toBeInstanceOf(Date);

      await finishJob(ids[0]);
      expect(queue.renewals()).toEqual(ids.slice(0, 3));
      expect(table.row(ids[2]).renewalQueuedAt).toBeNull();

      // A failed renewal frees its slot too
      await finishJob(ids[1], 'failed');
      expect(queue.renewals()).toEqual(ids.slice(0, 4));

      await finishJob(ids[2]);
      await finishJob(ids[3]);
      expect(queue.renewals()).toEqual(ids);
      await finishJob(ids[4]);
      expect([...table.rows.values()].map((r) => r.status)).toEqual([
        'issued',
        'failed',
        'issued',
        'issued',
        'issued',
      ]);
    });

    it('auto-renewals of many certificates start up to the limit and queue the rest', async () => {
      plans.u1 = 'starter'; // 5 concurrent pending
      const ids = Array.from({ length: 8 }, () => issued());

      for (const id of ids) await service.renewInternal(id);

      expect(queue.renewals()).toEqual(ids.slice(0, 5));
      expect(
        [...table.rows.values()].filter((r) => r.renewalQueuedAt).length,
      ).toBe(3);
    });

    it('counts new requests in flight against the same slots', async () => {
      table.insert({ userId: 'u1', status: 'pending' });
      table.insert({ userId: 'u1', status: 'issuing' });
      const id = issued();

      const res = await service.renew(id, 'u1');

      expect(res.queued).toBe(true);
      expect(queue.renewals()).toEqual([]);
    });

    it("pools an organization's certificates, like the limit itself", async () => {
      orgs.u1 = orgs.u2 = ['u1', 'u2'];
      table.insert({ userId: 'u1', status: 'pending' });
      table.insert({ userId: 'u1', status: 'pending' });
      const id = issued('u2');

      expect((await service.renew(id, 'u2')).queued).toBe(true);
    });

    it('starts everything at once on a plan without a pending limit', async () => {
      plans.u1 = 'enterprise';
      const ids = Array.from({ length: 6 }, () => issued());

      for (const id of ids) {
        expect((await service.renew(id, 'u1')).queued).toBe(false);
      }
      expect(queue.renewals()).toEqual(ids);
    });

    it('a queued renewal does not hold a slot for new requests', async () => {
      // Two renewals running, one waiting
      table.insert({ userId: 'u1', status: 'renewing' });
      const running = table.insert({ userId: 'u1', status: 'renewing' }).id;
      table.insert({
        userId: 'u1',
        status: 'renewing',
        renewalQueuedAt: new Date(),
      });

      await expect(
        service.create('u1', { csrPem: 'csr' }),
      ).rejects.toMatchObject({ status: 402 });

      // One running renewal finishes; the waiting one is not started yet
      await table.update(running, { status: 'issued' });
      await expect(service.create('u1', { csrPem: 'csr' })).resolves.toEqual(
        expect.objectContaining({ status: 'pending' }),
      );
    });

    it('keeps a connector renewal with a new CSR queued with that CSR', async () => {
      table.insert({ userId: 'u1', status: 'pending' });
      table.insert({ userId: 'u1', status: 'pending' });
      const id = issued('u1', {
        managedBy: 'connector',
        parsedCsr: parsedFor(['example.com']),
      });

      const res = await service.renew(id, 'u1', { csrPem: 'new-pem' });

      expect(res).toEqual({
        id,
        status: 'renewing',
        skipped: false,
        queued: true,
      });
      expect(table.row(id)).toMatchObject({
        rawCsr: 'new-csr',
        status: 'renewing',
      });
      expect(table.row(id).renewalQueuedAt).toBeInstanceOf(Date);
    });

    it('still refuses completing an awaiting_csr certificate (a new certificate)', async () => {
      table.insert({ userId: 'u1', status: 'pending' });
      table.insert({ userId: 'u1', status: 'pending' });
      const id = table.insert({
        userId: 'u1',
        status: 'awaiting_csr',
        rawCsr: null,
        requestedNames: ['example.com'],
        managedBy: 'connector',
      }).id;

      const err = await service
        .renew(id, 'u1', { csrPem: 'pem' })
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(402);
      expect(table.row(id).status).toBe('awaiting_csr');
    });
  });

  describe('when the queue is unreachable', () => {
    it('keeps the renewal queued and the sweep starts it later', async () => {
      const id = issued();
      queue.down = true;

      const res = await service.renew(id, 'u1');

      expect(res).toMatchObject({ status: 'renewing', queued: true });
      // The start was rolled back, so it is still waiting
      expect(table.row(id).renewalQueuedAt).toBeInstanceOf(Date);
      expect(queue.renewals()).toEqual([]);

      queue.down = false;
      await new RenewalQueueService(service).startQueuedRenewals();

      expect(queue.renewals()).toEqual([id]);
      expect(table.row(id).renewalQueuedAt).toBeNull();
    });

    it('the sweep leaves accounts without free slots alone', async () => {
      table.insert({ userId: 'u1', status: 'pending' });
      table.insert({ userId: 'u1', status: 'issuing' });
      const id = table.insert({
        userId: 'u1',
        status: 'renewing',
        renewalQueuedAt: new Date(),
      }).id;

      await new RenewalQueueService(service).startQueuedRenewals();

      expect(queue.renewals()).toEqual([]);
      expect(table.row(id).renewalQueuedAt).toBeInstanceOf(Date);
    });
  });

  describe('status codes and the queued flag', () => {
    const queuedRow = () =>
      table.insert({
        userId: 'u1',
        status: 'renewing',
        renewalQueuedAt: new Date(),
      }).id;

    it('renewing a certificate that is already renewing is a 409', async () => {
      const id = queuedRow();
      await expect(service.renew(id, 'u1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('ifDue on a renewing certificate is a skip with reason in_progress', async () => {
      const waiting = queuedRow();
      const running = table.insert({ userId: 'u1', status: 'renewing' }).id;

      await expect(
        service.renew(waiting, 'u1', { ifDue: true }),
      ).resolves.toEqual({
        id: waiting,
        status: 'renewing',
        skipped: true,
        reason: 'in_progress',
        queued: true,
      });
      await expect(
        service.renew(running, 'u1', { ifDue: true }),
      ).resolves.toMatchObject({ skipped: true, queued: false });
    });

    it('reports queued: false when another caller started the renewal meanwhile', async () => {
      const id = issued();
      // The start runs, but as if a job finishing elsewhere had done it
      const start = service.startQueuedRenewals.bind(service);
      jest
        .spyOn(service, 'startQueuedRenewalsSafely')
        .mockImplementation(async (uid: string) => {
          await start(uid);
          return [];
        });

      const res = await service.renew(id, 'u1');

      expect(res.queued).toBe(false);
      expect(queue.renewals()).toEqual([id]);
    });
  });

  describe('revoking a certificate whose renewal is waiting', () => {
    const fullAccount = () => {
      table.insert({ userId: 'u1', status: 'pending' });
      table.insert({ userId: 'u1', status: 'pending' });
    };

    it('drops the waiting renewal and revokes the current certificate', async () => {
      fullAccount();
      const id = issued('u1', { crtPem: 'leaf-pem' });
      expect((await service.renew(id, 'u1')).queued).toBe(true);

      await expect(service.revoke(id, 'u1', 4)).resolves.toEqual({
        id,
        status: 'revoked',
      });

      expect(acme.revoke).toHaveBeenCalledWith('leaf-pem', 4);
      expect(table.row(id)).toMatchObject({
        status: 'revoked',
        renewalQueuedAt: null,
      });
      // Nothing left to start once a slot frees
      await finishJob(1);
      expect(queue.renewals()).toEqual([]);
    });

    it('keeps the renewal queued, at its place, when the CA refuses the revocation', async () => {
      fullAccount();
      const id = issued('u1', { crtPem: 'leaf-pem' });
      await service.renew(id, 'u1');
      const queuedAt = table.row(id).renewalQueuedAt;
      acme.revoke.mockRejectedValue(new Error('CA unavailable'));

      await expect(service.revoke(id, 'u1')).rejects.toBeInstanceOf(
        InternalServerErrorException,
      );

      expect(table.row(id)).toMatchObject({
        status: 'renewing',
        renewalQueuedAt: queuedAt,
        crtPem: 'leaf-pem',
      });
      await finishJob(1);
      expect(queue.renewals()).toEqual([id]);
    });

    it('still refuses a renewal that has started', async () => {
      const id = issued('u1', { crtPem: 'leaf-pem' });
      await service.renew(id, 'u1');

      await expect(service.revoke(id, 'u1')).rejects.toThrow(
        "Certificate must be in 'issued' state to revoke",
      );
    });

    it('a revoke racing the start of the same renewal: exactly one wins', async () => {
      fullAccount();
      const id = issued('u1', { crtPem: 'leaf-pem' });
      await service.renew(id, 'u1');
      await table.update(1, { status: 'issued' }); // a slot frees

      const [start, revoke] = await Promise.allSettled([
        service.startQueuedRenewals('u1'),
        service.revoke(id, 'u1'),
      ]);

      const started = start.status === 'fulfilled' && start.value.includes(id);
      const revoked = revoke.status === 'fulfilled';
      expect(started).not.toBe(revoked);
      if (revoked) {
        expect(queue.renewals()).toEqual([]);
        expect(table.row(id).status).toBe('revoked');
      } else {
        expect((revoke as PromiseRejectedResult).reason).toBeInstanceOf(
          ConflictException,
        );
        expect(queue.renewals()).toEqual([id]);
      }
    });

    it('revoking an issued certificate twice at once revokes it once', async () => {
      const id = issued('u1', { crtPem: 'leaf-pem' });

      const results = await Promise.allSettled([
        service.revoke(id, 'u1'),
        service.revoke(id, 'u1'),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(acme.revoke).toHaveBeenCalledTimes(1);
    });
  });

  describe('when Redis hangs', () => {
    beforeEach(() => {
      // The fake table's round trips use setImmediate; only fake timeouts
      jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
    });
    afterEach(() => jest.useRealTimers());

    it('gives up after QUEUE_ADD_TIMEOUT_MS, rolls back, and leaves the renewal queued', async () => {
      const id = issued();
      queue.hang = true;

      const res = service.renew(id, 'u1');
      // Let the request reach Redis (real round trips), then let time pass
      while (queue.addBulkCalls === 0) await roundTrip();
      await jest.advanceTimersByTimeAsync(QUEUE_ADD_TIMEOUT_MS + 1);

      await expect(res).resolves.toMatchObject({ queued: true });
      expect(table.row(id)).toMatchObject({
        status: 'renewing',
        inFlightSince: null,
      });
      expect(table.row(id).renewalQueuedAt).toBeInstanceOf(Date);
    });
  });

  describe('jobs act only on the request they were queued for', () => {
    it('starts a renewal job whose token matches', async () => {
      const id = issued();
      await service.renewInternal(id);
      const token = queue.jobs[0].data.inFlightSince;

      await expect(
        service.beginProcessing(id, {
          renewal: true,
          token,
          status: 'renewing' as any,
        }),
      ).resolves.toBe(true);
    });

    it('drops a job whose token is stale, or whose renewal is still waiting', async () => {
      const id = issued();
      await service.renewInternal(id);
      const token = queue.jobs[0].data.inFlightSince!;

      await expect(
        service.beginProcessing(id, {
          renewal: true,
          token: token - 1,
          status: 'renewing' as any,
        }),
      ).resolves.toBe(false);

      const waiting = table.insert({
        userId: 'u2',
        status: 'renewing',
        renewalQueuedAt: new Date(),
      }).id;
      await expect(
        service.beginProcessing(waiting, {
          renewal: true,
          status: 'renewing' as any,
        }),
      ).resolves.toBe(false);
    });

    it('drops an issuance job for a certificate that already failed', async () => {
      const id = table.insert({ userId: 'u1', status: 'failed' }).id;
      await expect(
        service.beginProcessing(id, {
          renewal: false,
          status: 'issuing' as any,
        }),
      ).resolves.toBe(false);
    });
  });

  describe('recovering requests whose job was lost', () => {
    const later = (ms: number) => new Date(Date.now() + ms);
    const old = () => new Date(Date.now() - STUCK_AFTER_MS - 60_000);

    it('marks a lost new request failed with a reason, so it can be retried', async () => {
      const id = table.insert({
        userId: 'u1',
        status: 'pending',
        inFlightSince: old(),
      }).id;

      expect(await service.recoverStuck()).toEqual([id]);

      expect(table.row(id)).toMatchObject({
        status: 'failed',
        inFlightSince: null,
      });
      expect(table.row(id).failureReason).toMatch(/interrupted.*retry/i);
      expect(alerts.emit).toHaveBeenCalledWith(
        'u1',
        'cert.failed',
        expect.objectContaining({ resource: { type: 'certificate', id } }),
      );
      // Same email and metric as a failure inside the job
      expect(email.sendCertFailed).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u1',
          email: 'one@example.com',
          certId: id,
          errorMessage: expect.stringMatching(/interrupted/),
        }),
      );
      expect(metrics.certIssuanceTotal.inc).toHaveBeenCalledWith({
        status: 'failed',
      });
    });

    it(`stops re-queuing a renewal that keeps losing its job after ${MAX_RECOVERIES} recoveries`, async () => {
      const id = table.insert({
        userId: 'u1',
        status: 'renewing',
        crtPem: null,
        inFlightSince: old(),
      }).id;
      const loseJobAgain = async () => {
        queue.finish(id); // the worker crashed: its job is gone
        await table.update(id, { inFlightSince: old() });
        // Real restarts are 30 minutes apart; keep each start's token unique
        await new Promise((resolve) => setTimeout(resolve, 3));
      };

      for (let i = 1; i < MAX_RECOVERIES; i++) {
        await service.recoverStuck();
        expect(table.row(id)).toMatchObject({
          status: 'renewing',
          recoveryCount: i,
        });
        expect(queue.renewals()).toHaveLength(i); // re-queued and started
        await loseJobAgain();
      }
      await service.recoverStuck();

      expect(table.row(id)).toMatchObject({
        status: 'failed',
        recoveryCount: MAX_RECOVERIES,
      });
      expect(table.row(id).failureReason).toMatch(
        new RegExp(`interrupted ${MAX_RECOVERIES} times`),
      );
      expect(queue.renewals()).toHaveLength(MAX_RECOVERIES - 1);
      expect(email.sendCertFailed).toHaveBeenCalledTimes(1);
      expect(alerts.emit).toHaveBeenCalledWith(
        'u1',
        'cert.failed',
        expect.anything(),
      );
    });

    it('queues a lost renewal again, keeping its current certificate meanwhile', async () => {
      const id = table.insert({
        userId: 'u1',
        status: 'renewing',
        crtPem: 'old-leaf',
        chainPem: 'old-chain',
        expiresAt: later(20 * 86_400_000),
        inFlightSince: old(),
      }).id;

      expect(await service.recoverStuck()).toEqual([id]);

      expect(table.row(id)).toMatchObject({
        status: 'renewing',
        crtPem: 'old-leaf',
        chainPem: 'old-chain',
        recoveryCount: 1,
      });
      expect(queue.renewals()).toEqual([id]);
      expect(email.sendCertRenewalFailed).not.toHaveBeenCalled();
    });

    it(`keeps a still valid certificate when a renewal is stopped after ${MAX_RECOVERIES} recoveries`, async () => {
      const expiresAt = later(20 * 86_400_000);
      const id = table.insert({
        userId: 'u1',
        status: 'renewing',
        crtPem: 'old-leaf',
        chainPem: 'old-chain',
        expiresAt,
        recoveryCount: MAX_RECOVERIES - 1,
        inFlightSince: old(),
      }).id;

      await service.recoverStuck();

      expect(table.row(id)).toMatchObject({
        status: 'issued',
        crtPem: 'old-leaf',
        chainPem: 'old-chain',
        expiresAt,
        inFlightSince: null,
        renewalFailedAt: expect.any(Date),
      });
      expect(table.row(id).failureReason).toMatch(
        new RegExp(`interrupted ${MAX_RECOVERIES} times.*renew`, 'i'),
      );
      expect(email.sendCertRenewalFailed).toHaveBeenCalledWith(
        expect.objectContaining({ certId: id, expiresAt }),
      );
      expect(email.sendCertFailed).not.toHaveBeenCalled();
      expect(alerts.emit).toHaveBeenCalledWith(
        'u1',
        'cert.failed',
        expect.objectContaining({
          details: expect.objectContaining({
            renewal: true,
            currentCertificateExpiresAt: expiresAt.toISOString(),
          }),
        }),
      );
      expect(queue.renewals()).toEqual([]);
    });

    it('marks a stopped renewal failed when its certificate has expired', async () => {
      const id = table.insert({
        userId: 'u1',
        status: 'renewing',
        crtPem: 'old-leaf',
        chainPem: 'old-chain',
        expiresAt: new Date(Date.now() - 60_000),
        recoveryCount: MAX_RECOVERIES - 1,
        inFlightSince: old(),
      }).id;

      await service.recoverStuck();

      expect(table.row(id)).toMatchObject({
        status: 'failed',
        crtPem: null,
        chainPem: null,
      });
      expect(email.sendCertFailed).toHaveBeenCalledTimes(1);
    });

    it('queues a lost renewal again when an older release cleared its certificate, and starts it', async () => {
      const id = table.insert({
        userId: 'u1',
        status: 'renewing',
        crtPem: null,
        inFlightSince: old(),
      }).id;

      await service.recoverStuck();

      expect(table.row(id).status).toBe('renewing');
      expect(queue.renewals()).toEqual([id]);
      expect(table.row(id).inFlightSince).toBeInstanceOf(Date);
    });

    it('leaves a request alone while BullMQ still has a job for it', async () => {
      const id = table.insert({
        userId: 'u1',
        status: 'pending',
        inFlightSince: old(),
      }).id;
      await queue.add('tlsCertIssuance', { certId: id }, {});

      expect(await service.recoverStuck()).toEqual([]);
      expect(table.row(id).status).toBe('pending');
    });

    it('leaves recent requests alone', async () => {
      table.insert({
        userId: 'u1',
        status: 'issuing',
        inFlightSince: new Date(),
      });
      expect(await service.recoverStuck()).toEqual([]);
    });

    it('times rows with no inFlightSince from the first sweep that sees them', async () => {
      // A row stuck since before this release
      const id = table.insert({
        userId: 'u1',
        status: 'renewing',
        crtPem: 'x',
      }).id;

      expect(await service.recoverStuck()).toEqual([]);
      expect(table.row(id).inFlightSince).toBeInstanceOf(Date);

      expect(await service.recoverStuck(later(STUCK_AFTER_MS + 1000))).toEqual([
        id,
      ]);
      expect(table.row(id)).toMatchObject({ status: 'renewing', crtPem: 'x' });
      expect(queue.renewals()).toEqual([id]);
    });

    it('does nothing when it cannot list BullMQ jobs', async () => {
      table.insert({ userId: 'u1', status: 'pending', inFlightSince: old() });
      queue.down = true;
      expect(await service.recoverStuck()).toEqual([]);
    });

    it('frees the slots so waiting renewals start', async () => {
      // Two renewals stuck from before (they hold both free-plan slots)
      const a = table.insert({ userId: 'u1', status: 'renewing', crtPem: 'a' });
      table.insert({ userId: 'u1', status: 'renewing', crtPem: 'b' });
      const waiting = issued();
      expect((await service.renew(waiting, 'u1')).queued).toBe(true);

      await service.recoverStuck();
      expect(queue.renewals()).toEqual([]);
      await new RenewalQueueService(service).startQueuedRenewals();
      expect(queue.renewals()).toEqual([]); // timed from now, not yet stale

      // Both go back in the queue, behind the renewal that was waiting
      await service.recoverStuck(later(STUCK_AFTER_MS + 1000));
      expect(queue.renewals()).toEqual([waiting, a.id]);
    });

    it("cleans up after a final job failure that couldn't record itself", async () => {
      const id = issued();
      await service.renewInternal(id);
      const token = queue.jobs[0].data.inFlightSince;
      await new Promise((resolve) => setTimeout(resolve, 5)); // a new token

      await service.recoverAfterFailedJob(id, token! + 1, 'db down');
      expect(table.row(id).renewalQueuedAt).toBeNull(); // wrong token: untouched

      await service.recoverAfterFailedJob(id, token, 'db down');
      // Queued again and, with a free slot, started again
      expect(queue.renewals()).toEqual([id, id]);
    });

    it('ignores a failed job whose certificate already recorded the failure', async () => {
      const id = table.insert({ userId: 'u1', status: 'failed' }).id;
      await service.recoverAfterFailedJob(id, undefined, 'boom');
      expect(table.row(id).status).toBe('failed');
      expect(alerts.emit).not.toHaveBeenCalled();
    });
  });
  describe('a renewal that fails while the certificate is still valid', () => {
    const DAY = 86_400_000;
    const inDays = (n: number) => new Date(Date.now() + n * DAY);
    let worker: CertIssuerConsumer;
    let acmeIssue: jest.Mock;

    beforeEach(() => {
      acmeIssue = jest.fn();
      worker = new CertIssuerConsumer(
        service,
        { issue: acmeIssue } as any,
        {} as any,
        { formatPem: (pem: string) => pem } as any,
        {
          splitChain: (full: string) => ({
            leaf: full.split('|')[0],
            intermediates: full.split('|')[1] ?? null,
          }),
          getExpirationDate: () => inDays(90),
        } as any,
        metrics as any,
        {
          sendCertRenewed: jest.fn().mockResolvedValue(undefined),
          sendCertFailed: email.sendCertFailed,
          sendCertRenewalFailed: email.sendCertRenewalFailed,
        } as any,
        { findOneBy: jest.fn(), save: jest.fn() } as any,
        alerts as any,
      );
    });

    const PEM =
      '-----BEGIN CERTIFICATE REQUEST-----x-----END CERTIFICATE REQUEST-----';
    const current = (extra: Partial<Row> = {}) =>
      table.insert({
        userId: 'u1',
        status: 'issued',
        rawCsr: PEM,
        crtPem: 'old-leaf',
        chainPem: 'old-chain',
        expiresAt: inDays(20),
        ...extra,
      }).id;

    /** Runs the renewal job the queue holds for `id` to its final attempt. */
    const runFinalAttempt = (id: number) => {
      const job = queue.jobs.filter((j) => j.data.certId === id).pop()!;
      queue.finish(id);
      return worker
        .process({
          name: job.name,
          data: job.data,
          attemptsMade: 2,
          opts: { attempts: 3 },
        } as any)
        .catch(() => undefined);
    };

    it('keeps the previous certificate readable, and a successful renewal replaces it', async () => {
      const id = current();
      const expiresAt = table.row(id).expiresAt;
      await service.renewInternal(id);
      // While the renewal runs, the current certificate stays readable
      expect(table.row(id)).toMatchObject({
        status: 'renewing',
        crtPem: 'old-leaf',
      });

      acmeIssue.mockRejectedValue(new Error('DNS propagation timeout'));
      await runFinalAttempt(id);

      const cert = await service.findOne(id, 'u1');
      expect(cert).toMatchObject({
        status: 'issued',
        crtPem: 'old-leaf',
        chainPem: 'old-chain',
        expiresAt,
        failureReason: 'DNS propagation timeout',
        renewalFailedAt: expect.any(Date),
        inFlightSince: null,
      });
      await expect(service.getChain(id, 'u1')).resolves.toMatchObject({
        fullChainPem: 'old-leaf\nold-chain',
      });
      expect(email.sendCertRenewalFailed).toHaveBeenCalledTimes(1);

      // Renewing again clears the failure; success replaces the certificate
      await service.renew(id, 'u1');
      expect(table.row(id)).toMatchObject({
        status: 'renewing',
        renewalFailedAt: null,
        failureReason: null,
        crtPem: 'old-leaf',
      });
      acmeIssue.mockResolvedValue('new-leaf|new-chain');
      await runFinalAttempt(id);
      expect(table.row(id)).toMatchObject({
        status: 'issued',
        crtPem: 'new-leaf',
        chainPem: 'new-chain',
        renewalFailedAt: null,
        failureReason: null,
      });
    });

    it('a stale job cannot overwrite the result of the job that replaced it', async () => {
      const id = current();
      await service.renew(id, 'u1');
      const stale = queue.jobs.find((j) => j.data.certId === id)!;

      // The first job starts, then hangs at the CA
      let failStale!: (err: Error) => void;
      acmeIssue.mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            failStale = reject;
          }),
      );
      const staleRun = worker
        .process({
          name: stale.name,
          data: stale.data,
          attemptsMade: 2,
          opts: { attempts: 3 },
        } as any)
        .catch(() => undefined);
      for (let i = 0; i < 50 && !acmeIssue.mock.calls.length; i++) {
        await roundTrip();
      }
      expect(acmeIssue).toHaveBeenCalledTimes(1);

      // BullMQ gives up on it; half an hour later the reaper queues the
      // renewal again with a new token
      queue.finish(id);
      await new Promise((resolve) => setTimeout(resolve, 3));
      await service.recoverStuck(new Date(Date.now() + STUCK_AFTER_MS + 1000));
      expect(queue.renewals()).toEqual([id, id]);

      // The replacement succeeds, then the stale job finally fails
      acmeIssue.mockResolvedValueOnce('new-leaf|new-chain');
      await runFinalAttempt(id);
      failStale(new Error('late failure'));
      await staleRun;

      expect(table.row(id)).toMatchObject({
        status: 'issued',
        crtPem: 'new-leaf',
        chainPem: 'new-chain',
        renewalFailedAt: null,
        failureReason: null,
      });
      expect(email.sendCertRenewalFailed).not.toHaveBeenCalled();
      expect(email.sendCertFailed).not.toHaveBeenCalled();
    });

    it('a new certificate that fails still ends failed with no PEM', async () => {
      const id = table.insert({
        userId: 'u1',
        status: 'failed',
        rawCsr: PEM,
      }).id;
      await service.retry(id, 'u1');
      acmeIssue.mockRejectedValue(new Error('DNS propagation timeout'));
      const job = queue.jobs.find((j) => j.data.certId === id)!;
      await worker
        .process({
          name: job.name,
          data: job.data,
          attemptsMade: 2,
          opts: { attempts: 3 },
        } as any)
        .catch(() => undefined);

      expect(table.row(id)).toMatchObject({
        status: 'failed',
        crtPem: null,
        failureReason: 'DNS propagation timeout',
      });
      expect(table.row(id).renewalFailedAt ?? null).toBeNull();
      expect(email.sendCertFailed).toHaveBeenCalledTimes(1);
    });

    it('retry renews again, without plan limits, and needs certs:renew on a scoped key', async () => {
      const id = current({
        renewalFailedAt: new Date(),
        failureReason: 'CAA record forbids',
      });
      // Free plan, already at its total active limit: a renewal is still fine
      for (let i = 0; i < 10; i++) issued();

      await expect(
        service.retry(id, 'u1', { issue: true, renew: false }),
      ).rejects.toThrow('certs:renew');
      expect(table.row(id).status).toBe('issued');

      const res = await service.retry(id, 'u1', { issue: false, renew: true });
      expect(res).toEqual({ id, status: 'renewing', queued: false });
      expect(table.row(id)).toMatchObject({
        status: 'renewing',
        renewalFailedAt: null,
        failureReason: null,
        crtPem: 'old-leaf',
      });
      expect(queue.renewals()).toEqual([id]);
    });

    it('retry still refuses an issued certificate whose renewal did not fail', async () => {
      const id = current();
      await expect(service.retry(id, 'u1')).rejects.toThrow(/failed/);
    });

    it('a scoped key without certs:issue cannot issue a failed certificate again', async () => {
      const id = table.insert({
        userId: 'u1',
        status: 'failed',
        rawCsr: PEM,
      }).id;
      await expect(
        service.retry(id, 'u1', { issue: false, renew: true }),
      ).rejects.toThrow('certs:issue');
    });

    it('automatic renewal waits about a day before trying again', async () => {
      const id = current({ renewalFailedAt: new Date(Date.now() - 60_000) });

      await service.renewInternal(id);
      expect(table.row(id).status).toBe('issued');
      expect(queue.renewals()).toEqual([]);

      await table.update(id, {
        renewalFailedAt: new Date(Date.now() - RENEWAL_RETRY_BACKOFF_MS - 1),
      });
      await service.renewInternal(id);
      expect(queue.renewals()).toEqual([id]);
    });

    it('renewAfter shows when it will be tried again', async () => {
      const failedAt = new Date();
      const id = current({ renewalFailedAt: failedAt, expiresAt: inDays(3) });

      const res = await service.toResponse(table.row(id) as any);
      expect(res.renewAfter).toBe(
        new Date(failedAt.getTime() + RENEWAL_RETRY_BACKOFF_MS).toISOString(),
      );
    });

    it('ifDue skips a recently failed renewal; a plain renew goes ahead', async () => {
      const id = current({
        renewalFailedAt: new Date(),
        expiresAt: inDays(2),
      });

      const skipped = await service.renew(id, 'u1', { ifDue: true });
      expect(skipped).toMatchObject({
        skipped: true,
        reason: 'not_due',
        status: 'issued',
        retryAfter: expect.any(String),
      });
      expect(queue.renewals()).toEqual([]);

      const renewed = await service.renew(id, 'u1');
      expect(renewed).toMatchObject({ skipped: false, status: 'renewing' });
      expect(queue.renewals()).toEqual([id]);
    });

    it('a connector timer sees the same wait through ifDue', async () => {
      const id = current({
        managedBy: 'connector',
        renewalFailedAt: new Date(),
        expiresAt: inDays(2),
      });
      await expect(
        service.renew(id, 'u1', { ifDue: true }),
      ).resolves.toMatchObject({ skipped: true, reason: 'not_due' });
    });
  });
});
