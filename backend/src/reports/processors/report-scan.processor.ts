import { Processor, WorkerHost } from '@nestjs/bullmq';
import { BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { Repository } from 'typeorm';
import type { ReportHostResult } from '@krakenkey/shared';
import { Report } from '../entities/report.entity';
import { ReportHost } from '../entities/report-host.entity';
import { PublicScanService } from '../../public-scan/public-scan.service';
import { classifyFailure, classifyScan } from '../report-classifier';
import { runWithConcurrency, TimeoutError, withTimeout } from '../concurrency';
import {
  HOST_CONCURRENCY,
  HOST_DEADLINE_MS,
  HOST_TIMEOUT_MS,
  REPORT_JOB_CONCURRENCY,
  REPORT_QUEUE,
  type ReportScanJob,
} from '../reports.constants';

/**
 * Scans the hosts of one report, HOST_CONCURRENCY at a time, through the
 * same scanner path as POST /public-scan (PublicScanService.scanHost, which
 * also refuses private addresses). Each host's result is stored as soon as
 * it is ready, and a failure on one host never affects the others. Only
 * hosts still pending are scanned, so a job retried after a crash resumes.
 */
@Processor(REPORT_QUEUE, { concurrency: REPORT_JOB_CONCURRENCY })
export class ReportScanProcessor extends WorkerHost {
  private readonly logger = new Logger(ReportScanProcessor.name);

  constructor(
    @InjectRepository(Report)
    private readonly reportRepo: Repository<Report>,
    @InjectRepository(ReportHost)
    private readonly hostRepo: Repository<ReportHost>,
    private readonly scanner: PublicScanService,
  ) {
    super();
  }

  async process(
    job: Job<ReportScanJob>,
  ): Promise<{ scanned: number; skipped?: boolean }> {
    const { reportId } = job.data;
    const report = await this.reportRepo.findOne({ where: { id: reportId } });
    if (!report) return { scanned: 0, skipped: true }; // deleted meanwhile

    try {
      await this.reportRepo.update(reportId, {
        status: 'running',
        startedAt: report.startedAt ?? new Date(),
      });

      const pending = await this.hostRepo.find({
        where: { reportId, status: 'pending' },
        order: { position: 'ASC' },
      });

      let scanned = 0;
      await runWithConcurrency(
        pending,
        HOST_CONCURRENCY,
        async (row) => {
          const result = await this.scanOne(row.host, row.port);
          await this.save(row, result);
          scanned += 1;
        },
        async (err, row) => {
          // Saving failed: record the host as failed so the report can finish.
          this.logger.warn(
            `Report ${reportId}: could not store ${row.host}:${row.port}: ${String(err)}`,
          );
          await this.save(
            row,
            classifyFailure(
              row.host,
              row.port,
              'Scan result could not be saved',
            ),
          ).catch(() => undefined);
        },
      );

      await this.reportRepo.update(reportId, {
        status: 'complete',
        completedAt: new Date(),
      });
      this.logger.log(`Report ${reportId} complete: ${scanned} host(s)`);
      return { scanned };
    } catch (err) {
      this.logger.error(`Report ${reportId} failed: ${String(err)}`);
      await this.reportRepo
        .update(reportId, { status: 'failed', completedAt: new Date() })
        .catch(() => undefined);
      throw err;
    }
  }

  /** Scans one host. Never throws: failures become a critical result. */
  async scanOne(host: string, port: number): Promise<ReportHostResult> {
    try {
      const scan = await withTimeout(
        this.scanner.scanHost(host, port, { timeoutMs: HOST_TIMEOUT_MS }),
        HOST_DEADLINE_MS,
      );
      return classifyScan(host, port, scan);
    } catch (err) {
      if (err instanceof BadRequestException) {
        const message = err.message;
        if (/resolve/i.test(message)) {
          return classifyFailure(
            host,
            port,
            'Hostname does not resolve',
            new Date(),
            'unreachable',
          );
        }
        if (/private|internal/i.test(message)) {
          return classifyFailure(
            host,
            port,
            'Hostname resolves to a private or internal address, so it was not scanned',
          );
        }
        return classifyFailure(host, port, message);
      }
      if (err instanceof TimeoutError) {
        return classifyFailure(
          host,
          port,
          `Scan did not finish within ${HOST_DEADLINE_MS / 1000}s`,
        );
      }
      return classifyFailure(
        host,
        port,
        'Scan did not complete (timed out or scanner unavailable). Run the report again to retry.',
      );
    }
  }

  private async save(row: ReportHost, result: ReportHostResult) {
    await this.hostRepo.update(row.id, {
      status: result.status,
      severity: result.severity,
      result,
      scannedAt: result.scannedAt ? new Date(result.scannedAt) : new Date(),
    });
  }
}
