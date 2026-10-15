import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  scanIntervalMinutes,
  type ScanMode,
  type SubscriptionPlan,
} from '@krakenkey/shared';
import { Probe } from './entities/probe.entity';
import { ProbeScanResult } from './entities/probe-scan-result.entity';
import { Endpoint } from '../endpoints/entities/endpoint.entity';
import { EndpointHostedRegion } from '../endpoints/entities/endpoint-hosted-region.entity';
import { EndpointProbeAssignment } from '../endpoints/entities/endpoint-probe-assignment.entity';
import type { RegisterProbeDto } from './dto/register-probe.dto';
import type { SubmitReportDto, ScanResultDto } from './dto/submit-report.dto';
import { AlertsService } from '../notifications/channels/alerts.service';
import { scanFailureReason } from './scan-failure';
import { BillingService } from '../billing/billing.service';

/** Format of the config response's intervals (Go duration syntax). */
function formatInterval(minutes: number): string {
  return `${minutes}m`;
}

/** Interval in the config response when a probe has no endpoints. */
const DEFAULT_INTERVAL_MINUTES = 60;

/**
 * Slack for a result that arrives a little early (probe timers, network):
 * 10% of the interval, at least 20 seconds.
 */
export function earlyResultSlackMs(intervalMinutes: number): number {
  return Math.max(intervalMinutes * 6_000, 20_000);
}

/** The columns of a previous result that the report and config read. */
export type PreviousResult = Pick<
  ProbeScanResult,
  | 'createdAt'
  | 'scannedAt'
  | 'connectionSuccess'
  | 'connectionError'
  | 'certChainComplete'
  | 'certTrusted'
  | 'certNotAfter'
  | 'certDaysUntilExpiry'
>;

/**
 * The last result per endpoint from one probe ($1 endpoint ids, $2 probe
 * id), on the (endpointId, probeId, createdAt) index.
 */
export const PREVIOUS_RESULTS_SQL = `
  SELECT e.id AS "endpointId", r.*
  FROM unnest($1::uuid[]) AS e(id)
  CROSS JOIN LATERAL (
    SELECT "createdAt", "scannedAt", "connectionSuccess", "connectionError",
           "certChainComplete", "certTrusted", "certNotAfter",
           "certDaysUntilExpiry"
    FROM probe_scan_result
    WHERE "endpointId" = e.id AND "probeId" = $2
    ORDER BY "createdAt" DESC
    LIMIT 1
  ) r`;

/** An endpoint's SNI as probes scan it: its own, or its host. */
const SNI_MATCH = `COALESCE(NULLIF(e.sni, ''), e.host) = :sni`;

/** How long an on-demand scan request keeps `scanNow` set for probes. */
const SCAN_NOW_WINDOW_MS = 5 * 60 * 1000;

/**
 * True when a result arrives too soon after the previous one from the same
 * probe for the same endpoint: within the plan's scan interval, minus the
 * slack, and without an on-demand scan requested since.
 */
export function arrivesTooSoon(
  previousAt: Date | null | undefined,
  now: Date,
  intervalMinutes: number,
  scanRequestedAt?: Date | null,
): boolean {
  if (!previousAt) return false;
  if (scanRequestedAt && scanRequestedAt > previousAt) return false;
  const elapsed = now.getTime() - previousAt.getTime();
  return (
    elapsed < intervalMinutes * 60_000 - earlyResultSlackMs(intervalMinutes)
  );
}

export interface HostedEndpoint {
  host: string;
  port: number;
  sni: string;
  userId: string;
  /**
   * The owner's plan scan interval, e.g. "30m": how often to scan for a
   * hosted probe, the shortest accepted interval for a connected probe.
   */
  interval: string;
  /**
   * When the API received the last accepted result from this probe for
   * this endpoint (ISO 8601), so a restarted probe keeps its schedule.
   */
  lastScanAt?: string;
  /**
   * A scan was requested (POST /endpoints/:id/scan) in the last 5 minutes
   * and this probe hasn't delivered a result since.
   */
  scanNow?: boolean;
}

/** Endpoint rows the config is built from, before the plan interval. */
type ConfigRow = {
  id: string;
  host: string;
  port: number;
  sni: string;
  userId: string;
  lastScanRequestedAt: Date | null;
};

interface ProbeAuthUser {
  /** Present when authenticated via user API key */
  userId?: string;
  /** Present when authenticated via service key */
  isServiceKey?: boolean;
  serviceKeyId?: string;
}

@Injectable()
export class ProbesService {
  private readonly logger = new Logger(ProbesService.name);

  constructor(
    @InjectRepository(Probe)
    private readonly probeRepo: Repository<Probe>,
    @InjectRepository(ProbeScanResult)
    private readonly scanResultRepo: Repository<ProbeScanResult>,
    @InjectRepository(Endpoint)
    private readonly endpointRepo: Repository<Endpoint>,
    private readonly alerts: AlertsService,
    private readonly billing: BillingService,
  ) {}

  async registerProbe(
    dto: RegisterProbeDto,
    user: ProbeAuthUser,
  ): Promise<Probe> {
    const existing = await this.probeRepo.findOne({
      where: { id: dto.probeId },
    });
    this.assertProbeAccess(dto.mode, user, existing);

    const userId = user.isServiceKey ? undefined : user.userId;

    if (existing) {
      existing.name = dto.name;
      existing.version = dto.version;
      existing.mode = dto.mode;
      existing.region = dto.region;
      existing.os = dto.os;
      existing.arch = dto.arch;
      existing.status = 'active';
      existing.lastSeenAt = new Date();
      existing.userId = userId ?? null;
      return this.probeRepo.save(existing);
    }

    const probe = this.probeRepo.create({
      id: dto.probeId,
      name: dto.name,
      version: dto.version,
      mode: dto.mode,
      region: dto.region,
      os: dto.os,
      arch: dto.arch,
      status: 'active',
      lastSeenAt: new Date(),
      userId,
    });
    return this.probeRepo.save(probe);
  }

  async submitReport(
    dto: SubmitReportDto,
    user: ProbeAuthUser,
  ): Promise<{ accepted: number; tooSoon: number }> {
    const probe = await this.probeRepo.findOne({
      where: { id: dto.probeId },
    });
    if (!probe) {
      throw new NotFoundException(`Probe ${dto.probeId} not registered`);
    }
    this.assertProbeAccess(dto.mode, user, probe);

    probe.lastSeenAt = new Date();
    await this.probeRepo.save(probe);

    // The probe's timestamp is kept as the scan time, but every interval
    // check uses the time the API received the result (stored as
    // createdAt), which a probe can't set.
    const receivedAt = new Date();
    // A scan can't happen after the API received it; a future timestamp
    // would also keep the row past its retention.
    const reported = new Date(dto.timestamp);
    const scannedAt = reported > receivedAt ? receivedAt : reported;
    const probeMode = dto.mode;
    const probeRegion = dto.region;

    const entities: ProbeScanResult[] = [];
    const newlyFailing: { endpoint: Endpoint; result: ProbeScanResult }[] = [];

    // Match host:port to registered Endpoint(s): a connected probe's
    // results only count for endpoints assigned to it, a hosted probe's for
    // endpoints with a hosted region that is the probe's registered region.
    // Hosted mode may match several endpoints (different users, same
    // host:port). Each endpoint takes at most one result per report.
    const matched: { r: ScanResultDto; endpoint: Endpoint }[] = [];
    const seen = new Set<string>();
    let tooSoon = 0;
    for (const r of dto.results) {
      const endpoints = await this.resolveEndpoints(r, probe, probeMode);

      if (endpoints.length === 0) {
        this.logger.warn(
          `No matching endpoint for ${r.endpoint.host}:${r.endpoint.port} from probe ${dto.probeId} (${probeMode}), skipping`,
        );
        continue;
      }
      for (const endpoint of endpoints) {
        if (seen.has(endpoint.id)) {
          tooSoon++;
          continue;
        }
        seen.add(endpoint.id);
        matched.push({ r, endpoint });
      }
    }

    // Each owner's plan sets how often their endpoints may be scanned
    const scanMode: ScanMode = probeMode === 'hosted' ? 'hosted' : 'connected';
    const [tiers, previousByEndpoint] = await Promise.all([
      this.billing.resolveTiers(matched.map((m) => m.endpoint.userId)),
      this.previousResults(
        dto.probeId,
        matched.map((m) => m.endpoint.id),
      ),
    ]);

    for (const { r, endpoint } of matched) {
      // undefined when the lookup failed: accept without a check or alert
      const previous = previousByEndpoint
        ? (previousByEndpoint.get(endpoint.id) ?? null)
        : undefined;
      const interval = scanIntervalMinutes(
        tiers.get(endpoint.userId) ?? 'free',
        scanMode,
      );
      if (
        arrivesTooSoon(
          previous?.createdAt,
          receivedAt,
          interval,
          endpoint.lastScanRequestedAt,
        )
      ) {
        tooSoon++;
        continue;
      }

      const entity = this.scanResultRepo.create({
        probeId: dto.probeId,
        endpointId: endpoint.id,
        host: r.endpoint.host,
        port: r.endpoint.port,
        sni: r.endpoint.sni,
        userId: endpoint.userId,
        probeMode,
        probeRegion,
        connectionSuccess: r.connection.success,
        connectionError: r.connection.error,
        latencyMs: r.connection.latencyMs,
        tlsVersion: r.connection.tlsVersion,
        cipherSuite: r.connection.cipherSuite,
        ocspStapled: r.connection.ocspStapled,
        certSubject: r.certificate?.subject,
        certSans: r.certificate?.sans,
        certIssuer: r.certificate?.issuer,
        certSerialNumber: r.certificate?.serialNumber,
        certNotBefore: r.certificate?.notBefore
          ? new Date(r.certificate.notBefore)
          : undefined,
        certNotAfter: r.certificate?.notAfter
          ? new Date(r.certificate.notAfter)
          : undefined,
        certDaysUntilExpiry: r.certificate?.daysUntilExpiry,
        certKeyType: r.certificate?.keyType,
        certKeySize: r.certificate?.keySize,
        certSignatureAlgorithm: r.certificate?.signatureAlgorithm,
        certFingerprint: r.certificate?.fingerprint,
        certChainDepth: r.certificate?.chainDepth,
        certChainComplete: r.certificate?.chainComplete,
        certTrusted: r.certificate?.trusted,
        scannedAt,
      });
      entities.push(entity);
      if (this.startedFailing(entity, previous)) {
        newlyFailing.push({ endpoint, result: entity });
      }
    }

    if (entities.length > 0) {
      await this.scanResultRepo.save(entities);
    }
    for (const { endpoint, result } of newlyFailing) {
      await this.alerts.emit(endpoint.userId, 'endpoint.scan_failed', {
        subject: `${endpoint.host}:${endpoint.port}`,
        resource: { type: 'endpoint', id: endpoint.id },
        details: {
          endpointId: endpoint.id,
          label: endpoint.label ?? null,
          reason: scanFailureReason(result),
          probeMode: result.probeMode ?? null,
          probeRegion: result.probeRegion ?? null,
          scannedAt: result.scannedAt.toISOString(),
        },
      });
    }
    if (tooSoon > 0) {
      this.logger.log(
        `Skipped ${tooSoon} scan result(s) from probe ${dto.probeId} that arrived before the plan's scan interval`,
      );
    }
    this.logger.log(
      `Accepted ${entities.length} scan results from probe ${dto.probeId}`,
    );
    return { accepted: entities.length, tooSoon };
  }

  /**
   * The latest stored result from this probe for each endpoint, by when the
   * API received it. One query, one index probe per endpoint: a LATERAL
   * subquery walks the (endpointId, probeId, createdAt) index backwards and
   * stops at the first row, instead of sorting every result kept in
   * retention. Only the columns the interval check and the failure alert
   * read. Undefined when the lookup fails (the report is still accepted,
   * without an interval check or a failure alert).
   */
  private async previousResults(
    probeId: string,
    endpointIds: string[],
  ): Promise<Map<string, PreviousResult> | undefined> {
    const byEndpoint = new Map<string, PreviousResult>();
    const ids = [...new Set(endpointIds)];
    if (ids.length === 0) return byEndpoint;
    try {
      const rows: (PreviousResult & { endpointId: string })[] =
        await this.scanResultRepo.query(PREVIOUS_RESULTS_SQL, [ids, probeId]);
      for (const row of rows) byEndpoint.set(row.endpointId, row);
      return byEndpoint;
    } catch (err) {
      this.logger.warn(
        `Could not load previous scans for probe ${probeId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return undefined;
    }
  }

  /**
   * True when this result is failing and the previous result from the same
   * probe for the same endpoint was healthy (or there was none). Alerts go
   * out on the transition only, not on every failing scan. Compared per
   * probe so a failing region does not flap against a healthy one.
   */
  private startedFailing(
    result: ProbeScanResult,
    previous: PreviousResult | null | undefined,
  ): boolean {
    if (!scanFailureReason(result) || !result.endpointId) return false;
    if (previous === undefined) return false;
    return !previous || scanFailureReason(previous) === null;
  }

  async getConfig(
    probeId: string,
    user: ProbeAuthUser,
  ): Promise<{ endpoints: HostedEndpoint[]; interval: string }> {
    // Each endpoint carries its owner's plan interval. The top-level
    // interval is the shortest of them, for probes that read only that.
    const probe = await this.probeRepo.findOne({ where: { id: probeId } });
    if (!probe) {
      throw new NotFoundException(`Probe ${probeId} not registered`);
    }
    this.assertProbeAccess(probe.mode, user, probe);

    let rows: ConfigRow[];
    let mode: ScanMode;

    if (user.isServiceKey) {
      // Hosted probe: return all endpoints with hosted regions matching probe's region
      rows = await this.getHostedEndpoints(probe.region);
      mode = 'hosted';
    } else {
      // Connected probe: return endpoints assigned to this specific probe
      rows = await this.getConnectedEndpoints(user.userId!, probeId);
      mode = 'connected';
    }

    const [tiers, previous] = await Promise.all([
      this.billing.resolveTiers(rows.map((r) => r.userId)),
      this.previousResults(
        probeId,
        rows.map((r) => r.id),
      ),
    ]);
    const minutes = (userId: string) =>
      scanIntervalMinutes(
        tiers.get(userId) ?? ('free' as SubscriptionPlan),
        mode,
      );
    const scanNowCutoff = Date.now() - SCAN_NOW_WINDOW_MS;
    const endpoints: HostedEndpoint[] = rows.map((r) => {
      const last = previous?.get(r.id)?.createdAt;
      const requested = r.lastScanRequestedAt
        ? new Date(r.lastScanRequestedAt)
        : null;
      return {
        host: r.host,
        port: r.port,
        sni: r.sni,
        userId: r.userId,
        interval: formatInterval(minutes(r.userId)),
        ...(last ? { lastScanAt: new Date(last).toISOString() } : {}),
        ...(requested &&
        requested.getTime() > scanNowCutoff &&
        (!last || requested > new Date(last))
          ? { scanNow: true }
          : {}),
      };
    });
    const shortest = rows.reduce(
      (min, r) => Math.min(min, minutes(r.userId)),
      rows.length ? Infinity : DEFAULT_INTERVAL_MINUTES,
    );

    return { endpoints, interval: formatInterval(shortest) };
  }

  /**
   * Hosted mode writes results into every customer's endpoint in a region, so
   * only service keys may use it. A user can only use a probe ID registered to
   * their own account. Service keys are our own infrastructure and may act on
   * any probe; registering with one turns the probe back into an unowned
   * hosted probe.
   */
  private assertProbeAccess(
    mode: string,
    user: ProbeAuthUser,
    probe?: Probe | null,
  ): void {
    if (user.isServiceKey) return;
    if (mode === 'hosted') {
      throw new ForbiddenException('Hosted mode requires a service key');
    }
    if (probe && (probe.userId ?? null) !== (user.userId ?? null)) {
      throw new ForbiddenException('Probe is registered to another account');
    }
  }

  private async getHostedEndpoints(probeRegion?: string): Promise<ConfigRow[]> {
    const query = this.endpointRepo
      .createQueryBuilder('e')
      .innerJoin(EndpointHostedRegion, 'ehr', 'ehr."endpointId" = e.id')
      .select('e.id', 'id')
      .addSelect('e.host', 'host')
      .addSelect('e.port', 'port')
      .addSelect('COALESCE(e.sni, e.host)', 'sni')
      .addSelect('e."userId"', 'userId')
      .addSelect('e."lastScanRequestedAt"', 'lastScanRequestedAt')
      .where('e."isActive" = true');

    if (probeRegion) {
      query.andWhere('ehr.region = :region', { region: probeRegion });
    }

    return query.getRawMany<ConfigRow>();
  }

  private async getConnectedEndpoints(
    userId: string,
    probeId: string,
  ): Promise<ConfigRow[]> {
    // Return only endpoints explicitly assigned to this probe
    const endpoints = await this.endpointRepo
      .createQueryBuilder('e')
      .innerJoin(EndpointProbeAssignment, 'epa', 'epa."endpointId" = e.id')
      .where('e."userId" = :userId', { userId })
      .andWhere('e."isActive" = true')
      .andWhere('epa."probeId" = :probeId', { probeId })
      .getMany();

    return endpoints.map((e) => ({
      id: e.id,
      host: e.host,
      port: e.port,
      sni: e.sni ?? e.host,
      userId: e.userId,
      lastScanRequestedAt: e.lastScanRequestedAt ?? null,
    }));
  }

  /**
   * Resolve scan result to one or more endpoints.
   * Hosted mode can match multiple users' endpoints for the same host:port.
   * Connected mode matches exactly one (the user's).
   */
  private async resolveEndpoints(
    result: ScanResultDto,
    probe: Probe,
    probeMode: string,
  ): Promise<Endpoint[]> {
    const host = result.endpoint.host;
    const port = result.endpoint.port;
    // Endpoints on the same host:port with different SNI are separate
    const sni = result.endpoint.sni || host;

    // A connected probe's results count only for the owner's endpoints
    // that are assigned to this probe
    if (probeMode === 'connected' && probe.userId) {
      const ep = await this.endpointRepo
        .createQueryBuilder('e')
        .innerJoin(EndpointProbeAssignment, 'epa', 'epa."endpointId" = e.id')
        .where('e."userId" = :userId', { userId: probe.userId })
        .andWhere('e.host = :host AND e.port = :port', { host, port })
        .andWhere(SNI_MATCH, { sni })
        .andWhere('epa."probeId" = :probeId', { probeId: probe.id })
        .getOne();
      return ep ? [ep] : [];
    }

    // A hosted probe's results count for endpoints with a hosted region
    // matching the region it registered with, not the one it reports
    if (probeMode === 'hosted' && probe.mode === 'hosted' && probe.region) {
      return this.endpointRepo
        .createQueryBuilder('e')
        .innerJoin(EndpointHostedRegion, 'ehr', 'ehr."endpointId" = e.id')
        .where('e.host = :host AND e.port = :port', { host, port })
        .andWhere(SNI_MATCH, { sni })
        .andWhere('ehr.region = :region', { region: probe.region })
        .andWhere('e."isActive" = true')
        .getMany();
    }

    // Standalone mode: no endpoint matching
    return [];
  }
}
