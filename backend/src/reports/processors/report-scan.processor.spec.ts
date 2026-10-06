import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { PublicScanResponse } from '@krakenkey/shared';
import { ReportScanProcessor } from './report-scan.processor';
import { HOST_CONCURRENCY } from '../reports.constants';
import { runWithConcurrency, withTimeout, TimeoutError } from '../concurrency';

const REPORT_ID = 'rep-1';

function okScan(host: string): PublicScanResponse {
  return {
    endpoint: { host, port: 443, sni: host },
    connection: { success: true, tlsVersion: 'TLS 1.3' },
    certificate: {
      sans: [host],
      issuer: "CN=R11,O=Let's Encrypt,C=US",
      notAfter: new Date(Date.now() + 60 * 86_400_000).toISOString(),
      trusted: true,
      chainDepth: 2,
      keyType: 'ECDSA',
      keySize: 256,
    },
    scannedAt: new Date().toISOString(),
  };
}

describe('ReportScanProcessor', () => {
  let reportRepo: { findOne: jest.Mock; update: jest.Mock };
  let hostRepo: { find: jest.Mock; update: jest.Mock };
  let scanner: { scanHost: jest.Mock };
  let processor: ReportScanProcessor;

  const rows = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `row-${i}`,
      reportId: REPORT_ID,
      position: i,
      host: `h${i}.example.com`,
      port: 443,
      status: 'pending',
    }));

  beforeEach(() => {
    reportRepo = {
      findOne: jest.fn().mockResolvedValue({ id: REPORT_ID, startedAt: null }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    hostRepo = {
      find: jest.fn().mockResolvedValue(rows(12)),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    scanner = {
      scanHost: jest.fn((host: string) => Promise.resolve(okScan(host))),
    };
    processor = new ReportScanProcessor(
      reportRepo as never,
      hostRepo as never,
      scanner as never,
    );
  });

  const run = () =>
    processor.process({ data: { reportId: REPORT_ID } } as never);

  it('moves the report pending -> running -> complete and stores every host', async () => {
    await expect(run()).resolves.toEqual({ scanned: 12 });
    const statuses = reportRepo.update.mock.calls.map((c) => c[1].status);
    expect(statuses).toEqual(['running', 'complete']);
    expect(hostRepo.update).toHaveBeenCalledTimes(12);
    expect(hostRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { reportId: REPORT_ID, status: 'pending' },
      }),
    );
    const [, saved] = hostRepo.update.mock.calls[0];
    expect(saved).toMatchObject({ status: 'complete', severity: 'ok' });
  });

  it(`never runs more than ${HOST_CONCURRENCY} scans at once`, async () => {
    let inFlight = 0;
    let peak = 0;
    scanner.scanHost.mockImplementation(async (host: string) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return okScan(host);
    });
    await run();
    expect(peak).toBe(HOST_CONCURRENCY);
    expect(scanner.scanHost).toHaveBeenCalledTimes(12);
  });

  it('stores each host as soon as its scan finishes', async () => {
    const order: string[] = [];
    scanner.scanHost.mockImplementation(async (host: string) => {
      // h0 is slowest; others should be saved before it.
      await new Promise((r) =>
        setTimeout(r, host === 'h0.example.com' ? 30 : 1),
      );
      return okScan(host);
    });
    hostRepo.update.mockImplementation((id: string) => {
      order.push(id);
      return Promise.resolve({ affected: 1 });
    });
    await run();
    expect(order[0]).not.toBe('row-0');
    expect(order).toContain('row-0');
  });

  it('isolates per-host failures', async () => {
    scanner.scanHost.mockImplementation((host: string) => {
      if (host === 'h1.example.com') {
        return Promise.reject(
          new BadRequestException('Could not resolve hostname'),
        );
      }
      if (host === 'h2.example.com') {
        return Promise.reject(
          new BadRequestException('Cannot scan private/internal addresses'),
        );
      }
      if (host === 'h3.example.com') {
        return Promise.reject(new ServiceUnavailableException('down'));
      }
      if (host === 'h4.example.com') return Promise.reject(new Error('boom'));
      return Promise.resolve(okScan(host));
    });

    await expect(run()).resolves.toEqual({ scanned: 12 });

    const byId = Object.fromEntries(
      hostRepo.update.mock.calls.map(([id, data]) => [id, data]),
    );
    expect(byId['row-0']).toMatchObject({ severity: 'ok' });
    expect(byId['row-1'].result.problems[0]).toMatchObject({
      code: 'unreachable',
      message: 'Hostname does not resolve',
    });
    expect(byId['row-2'].result.problems[0].message).toMatch(
      /private or internal/,
    );
    expect(byId['row-2'].status).toBe('error');
    expect(byId['row-3'].status).toBe('error');
    expect(byId['row-4'].severity).toBe('critical');
    expect(byId['row-5']).toMatchObject({ severity: 'ok' });
    expect(reportRepo.update.mock.calls.at(-1)[1].status).toBe('complete');
  });

  it('marks a host failed when its result cannot be saved, and still finishes', async () => {
    hostRepo.update
      .mockRejectedValueOnce(new Error('db hiccup'))
      .mockResolvedValue({ affected: 1 });
    await run();
    // 12 saves + 1 fallback save for the failed one
    expect(hostRepo.update).toHaveBeenCalledTimes(13);
    expect(reportRepo.update.mock.calls.at(-1)[1].status).toBe('complete');
  });

  it('passes the per-host timeout to the scanner', async () => {
    await run();
    expect(scanner.scanHost).toHaveBeenCalledWith('h0.example.com', 443, {
      timeoutMs: expect.any(Number),
    });
  });

  it('skips a report deleted before the job ran', async () => {
    reportRepo.findOne.mockResolvedValue(null);
    await expect(run()).resolves.toEqual({ scanned: 0, skipped: true });
    expect(scanner.scanHost).not.toHaveBeenCalled();
  });

  it('marks the report failed when loading hosts fails', async () => {
    hostRepo.find.mockRejectedValue(new Error('db down'));
    await expect(run()).rejects.toThrow('db down');
    expect(reportRepo.update.mock.calls.at(-1)[1].status).toBe('failed');
  });
});

describe('concurrency helpers', () => {
  it('runWithConcurrency routes errors to onError and keeps going', async () => {
    const done: number[] = [];
    const failed: number[] = [];
    await runWithConcurrency(
      [1, 2, 3, 4],
      2,
      async (n) => {
        if (n === 2) throw new Error('x');
        done.push(n);
      },
      (_e, n) => {
        failed.push(n);
      },
    );
    expect(done.sort()).toEqual([1, 3, 4]);
    expect(failed).toEqual([2]);
  });

  it('runWithConcurrency handles an empty list', async () => {
    await expect(
      runWithConcurrency([], 5, async () => {}),
    ).resolves.toBeUndefined();
  });

  it('withTimeout rejects slow work', async () => {
    jest.useFakeTimers();
    const p = withTimeout(new Promise(() => {}), 1000);
    jest.advanceTimersByTime(1001);
    await expect(p).rejects.toBeInstanceOf(TimeoutError);
    jest.useRealTimers();
  });
});
