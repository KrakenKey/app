import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { LessThan, Repository } from 'typeorm';
import { createHash, randomBytes } from 'crypto';
import {
  REPORT_RETENTION_DAYS,
  REPORT_SHARE_TTL_DAYS,
  type CreateReportShareResponse,
  type PublicReport,
  type Report as ReportResponse,
  type ReportHostResult,
  type ReportListItem,
  type ReportSeverity,
  type SubscriptionPlan,
} from '@krakenkey/shared';
import { Report } from './entities/report.entity';
import { ReportHost } from './entities/report-host.entity';
import { BillingService } from '../billing/billing.service';
import { PLAN_LIMITS } from '../billing/constants/plan-limits';
import { parseHostList } from './report-hosts';
import {
  emptyCounts,
  pendingResult,
  sortHosts,
  summarize,
} from './report-classifier';
import { csvFilename, reportToCsv } from './report-csv';
import { REPORT_QUEUE, type ReportScanJob } from './reports.constants';
import type { CreateReportDto } from './dto/create-report.dto';

const DAY_MS = 24 * 60 * 60 * 1000;
/** base64url of 32 random bytes */
const SHARE_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const LIST_LIMIT = 100;

export interface CsvExport {
  filename: string;
  data: string;
}

export function hashShareToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);
  private readonly appDomain: string;

  constructor(
    @InjectRepository(Report)
    private readonly reportRepo: Repository<Report>,
    @InjectRepository(ReportHost)
    private readonly hostRepo: Repository<ReportHost>,
    @InjectQueue(REPORT_QUEUE)
    private readonly queue: Queue<ReportScanJob>,
    private readonly billingService: BillingService,
    config: ConfigService,
  ) {
    this.appDomain = config.get<string>('KK_APP_DOMAIN', 'app.krakenkey.io');
  }

  async create(userId: string, dto: CreateReportDto): Promise<ReportResponse> {
    const { targets, errors } = parseHostList(dto.hosts);
    if (errors.length) {
      throw new BadRequestException(errors.slice(0, 20));
    }
    if (targets.length === 0) {
      throw new BadRequestException('Add at least one hostname');
    }

    const plan = (await this.billingService.resolveUserTier(
      userId,
    )) as SubscriptionPlan;
    const limit = (PLAN_LIMITS[plan] ?? PLAN_LIMITS.free).reportHosts;
    if (targets.length > limit) {
      throw new HttpException(
        {
          message: `Report host limit reached: your plan allows ${limit} hosts per report`,
          code: 'plan_limit_exceeded',
          limit,
          current: targets.length,
          plan,
        },
        403,
      );
    }

    const name = dto.name?.trim() || null;
    const { report, hosts } = await this.reportRepo.manager.transaction(
      async (em) => {
        const report = await em.save(
          em.create(Report, {
            userId,
            name,
            status: 'pending',
            hostCount: targets.length,
            expiresAt: new Date(Date.now() + REPORT_RETENTION_DAYS * DAY_MS),
          }),
        );
        const hosts = await em.save(
          targets.map((t, position) =>
            em.create(ReportHost, {
              reportId: report.id,
              position,
              host: t.host,
              port: t.port,
              status: 'pending',
            }),
          ),
        );
        return { report, hosts };
      },
    );

    await this.queue.add(
      'scanReport',
      { reportId: report.id },
      { jobId: report.id, removeOnComplete: 100, removeOnFail: 500 },
    );

    this.logger.log(
      `Report ${report.id} queued: ${targets.length} host(s), user=${userId}`,
    );
    return this.toResponse(report, hosts);
  }

  async findAll(userId: string): Promise<ReportListItem[]> {
    const reports = await this.reportRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: LIST_LIMIT,
    });
    if (reports.length === 0) return [];

    const rows = await this.hostRepo
      .createQueryBuilder('h')
      .select('h.reportId', 'reportId')
      .addSelect('h.severity', 'severity')
      .addSelect('COUNT(*)', 'count')
      .where('h.reportId IN (:...ids)', { ids: reports.map((r) => r.id) })
      .groupBy('h.reportId')
      .addGroupBy('h.severity')
      .getRawMany<{
        reportId: string;
        severity: ReportSeverity | null;
        count: string;
      }>();

    const counts = new Map<string, Record<ReportSeverity, number>>();
    for (const row of rows) {
      if (!row.severity) continue;
      const c = counts.get(row.reportId) ?? emptyCounts();
      c[row.severity] = Number(row.count);
      counts.set(row.reportId, c);
    }

    return reports.map((r) => {
      const c = counts.get(r.id) ?? emptyCounts();
      return {
        ...this.baseFields(r),
        completedCount: c.critical + c.warning + c.notice + c.ok,
        counts: c,
      };
    });
  }

  async findOne(id: string, userId: string): Promise<ReportResponse> {
    const report = await this.findOwned(id, userId);
    const hosts = await this.hostsOf(report.id);
    return this.toResponse(report, hosts);
  }

  async remove(id: string, userId: string): Promise<void> {
    const report = await this.findOwned(id, userId);
    await this.reportRepo.delete({ id: report.id });
    // A queued job finds no report and exits; a running one stops writing.
    await this.queue.remove(report.id).catch(() => undefined);
  }

  /** Creates a share link, replacing (and so revoking) any existing one. */
  async createShare(
    id: string,
    userId: string,
  ): Promise<CreateReportShareResponse> {
    const report = await this.findOwned(id, userId);
    const token = randomBytes(32).toString('base64url');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + REPORT_SHARE_TTL_DAYS * DAY_MS);
    await this.reportRepo.update(report.id, {
      shareTokenHash: hashShareToken(token),
      shareCreatedAt: now,
      shareExpiresAt: expiresAt,
    });
    return {
      url: `https://${this.appDomain}/r/${token}`,
      token,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async revokeShare(id: string, userId: string): Promise<void> {
    const report = await this.findOwned(id, userId);
    await this.reportRepo.update(report.id, {
      shareTokenHash: null,
      shareCreatedAt: null,
      shareExpiresAt: null,
    });
  }

  /**
   * The report behind a share token. Unknown, revoked and expired tokens all
   * get the same 404. The response carries no ids or owner details.
   */
  async findShared(token: string): Promise<PublicReport> {
    const report = await this.findByToken(token);
    const hosts = sortHosts((await this.hostsOf(report.id)).map(hostResult));
    return {
      name: report.name,
      status: report.status,
      hostCount: report.hostCount,
      completedCount: hosts.filter((h) => h.severity !== null).length,
      createdAt: report.createdAt.toISOString(),
      completedAt: report.completedAt?.toISOString() ?? null,
      shareExpiresAt: report.shareExpiresAt!.toISOString(),
      summary: summarize(hosts),
      hosts,
    };
  }

  async exportCsv(id: string, userId: string): Promise<CsvExport> {
    const report = await this.findOwned(id, userId);
    return this.csvOf(report);
  }

  async exportSharedCsv(token: string): Promise<CsvExport> {
    return this.csvOf(await this.findByToken(token));
  }

  /** Deletes reports past retention and clears expired share links. */
  async purgeExpired(now = new Date()): Promise<{
    reports: number;
    shares: number;
  }> {
    const deleted = await this.reportRepo.delete({ expiresAt: LessThan(now) });
    const cleared = await this.reportRepo.update(
      { shareExpiresAt: LessThan(now) },
      { shareTokenHash: null, shareCreatedAt: null, shareExpiresAt: null },
    );
    return { reports: deleted.affected ?? 0, shares: cleared.affected ?? 0 };
  }

  // --- helpers ---------------------------------------------------------------

  private async findOwned(id: string, userId: string): Promise<Report> {
    const report = await this.reportRepo.findOne({ where: { id, userId } });
    if (!report) throw new NotFoundException(`Report ${id} not found`);
    return report;
  }

  private async findByToken(token: string): Promise<Report> {
    const notFound = new NotFoundException('Report not found');
    if (!SHARE_TOKEN.test(token)) throw notFound;
    const report = await this.reportRepo.findOne({
      where: { shareTokenHash: hashShareToken(token) },
    });
    if (
      !report ||
      !report.shareExpiresAt ||
      report.shareExpiresAt.getTime() <= Date.now() ||
      report.expiresAt.getTime() <= Date.now()
    ) {
      throw notFound;
    }
    return report;
  }

  private async hostsOf(reportId: string): Promise<ReportHost[]> {
    return this.hostRepo.find({
      where: { reportId },
      order: { position: 'ASC' },
    });
  }

  private async csvOf(report: Report): Promise<CsvExport> {
    const hosts = sortHosts((await this.hostsOf(report.id)).map(hostResult));
    return {
      filename: csvFilename(report.name, report.createdAt),
      data: reportToCsv(hosts),
    };
  }

  private baseFields(r: Report) {
    return {
      id: r.id,
      name: r.name,
      status: r.status,
      hostCount: r.hostCount,
      share:
        r.shareExpiresAt && r.shareExpiresAt.getTime() > Date.now()
          ? {
              expiresAt: r.shareExpiresAt.toISOString(),
              createdAt: (r.shareCreatedAt ?? r.createdAt).toISOString(),
            }
          : null,
      createdAt: r.createdAt.toISOString(),
      completedAt: r.completedAt?.toISOString() ?? null,
      expiresAt: r.expiresAt.toISOString(),
    };
  }

  private toResponse(report: Report, rows: ReportHost[]): ReportResponse {
    const hosts = sortHosts(rows.map(hostResult));
    return {
      ...this.baseFields(report),
      completedCount: hosts.filter((h) => h.severity !== null).length,
      summary: summarize(hosts),
      hosts,
    };
  }
}

/** The stored result, or a pending placeholder for hosts not scanned yet. */
export function hostResult(row: ReportHost): ReportHostResult {
  return row.result ?? pendingResult(row.host, row.port);
}
