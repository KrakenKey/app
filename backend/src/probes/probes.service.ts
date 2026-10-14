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
 * 10% of the interval, at least 10 seconds.
 */
export function earlyResultSlackMs(intervalMinutes: number): number {
  return Math.max(intervalMinutes * 6_000, 10_000);
}

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
  scanNow?: boolean;
}

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

    const scannedAt = new Date(dto.timestamp);
    const probeMode = dto.mode;
    const probeRegion = dto.region;

    // For connected/hosted probes, resolve the userId to look up endpoints
    const probeUserId = user.isServiceKey ? undefined : user.userId;

    const entities: ProbeScanResult[] = [];
    const newlyFailing: { endpoint: Endpoint; result: ProbeScanResult }[] = [];

    // Match host:port to registered Endpoint(s). Hosted mode may return
    // several endpoints (different users, same host:port).
    const matched: { r: ScanResultDto; endpoint: Endpoint }[] = [];
    for (const r of dto.results) {
      const endpoints = await this.resolveEndpoints(
        r,
        probeMode,
        probeRegion,
        probeUserId,
      );

      if (endpoints.length === 0) {
        this.logger.warn(
          `No matching endpoint for ${r.endpoint.host}:${r.endpoint.port} from probe ${dto.probeId} (${probeMode}), skipping`,
        );
        continue;
      }
      for (const endpoint of endpoints) matched.push({ r, endpoint });
    }

    // Each owner's plan sets how often their endpoints may be scanned
    const scanMode: ScanMode = probeMode === 'hosted' ? 'hosted' : 'connected';
    const tiers = await this.billing.resolveTiers(
      matched.map((m) => m.endpoint.userId),
    );
    const receivedAt = new Date();
    let tooSoon = 0;

    for (const { r, endpoint } of matched) {
      const previous = await this.previousResult(endpoint.id, dto.probeId);
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
   * The latest stored result from this probe for this endpoint: null when
   * there is none, undefined when the lookup fails (the report is still
   * accepted, without an interval check or a failure alert).
   */
  private async previousResult(
    endpointId: string,
    probeId: string,
  ): Promise<ProbeScanResult | null | undefined> {
    try {
      return await this.scanResultRepo.findOne({
        where: { endpointId, probeId },
        order: { scannedAt: 'DESC' },
      });
    } catch (err) {
      this.logger.warn(
        `Could not load previous scan for endpoint ${endpointId}: ${err instanceof Error ? err.message : String(err)}`,
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
    previous: ProbeScanResult | null | undefined,
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

    let rows: Omit<HostedEndpoint, 'interval'>[];
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

    const tiers = await this.billing.resolveTiers(rows.map((r) => r.userId));
    const minutes = (userId: string) =>
      scanIntervalMinutes(
        tiers.get(userId) ?? ('free' as SubscriptionPlan),
        mode,
      );
    const endpoints = rows.map((r) => ({
      ...r,
      interval: formatInterval(minutes(r.userId)),
    }));
    const shortest = rows.length
      ? Math.min(...rows.map((r) => minutes(r.userId)))
      : DEFAULT_INTERVAL_MINUTES;

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

  private async getHostedEndpoints(
    probeRegion?: string,
  ): Promise<Omit<HostedEndpoint, 'interval'>[]> {
    const query = this.endpointRepo
      .createQueryBuilder('e')
      .innerJoin(EndpointHostedRegion, 'ehr', 'ehr."endpointId" = e.id')
      .select('e.host', 'host')
      .addSelect('e.port', 'port')
      .addSelect('COALESCE(e.sni, e.host)', 'sni')
      .addSelect('e."userId"', 'userId')
      .addSelect('e."lastScanRequestedAt"', 'lastScanRequestedAt')
      .where('e."isActive" = true');

    if (probeRegion) {
      query.andWhere('ehr.region = :region', { region: probeRegion });
    }

    const rows: {
      host: string;
      port: number;
      sni: string;
      userId: string;
      lastScanRequestedAt: Date | null;
    }[] = await query.getRawMany();

    const scanNowCutoff = new Date(Date.now() - 5 * 60 * 1000);

    return rows.map((r) => ({
      host: r.host,
      port: r.port,
      sni: r.sni,
      userId: r.userId,
      ...(r.lastScanRequestedAt &&
      new Date(r.lastScanRequestedAt) > scanNowCutoff
        ? { scanNow: true }
        : {}),
    }));
  }

  private async getConnectedEndpoints(
    userId: string,
    probeId: string,
  ): Promise<Omit<HostedEndpoint, 'interval'>[]> {
    // Return only endpoints explicitly assigned to this probe
    const endpoints = await this.endpointRepo
      .createQueryBuilder('e')
      .innerJoin(EndpointProbeAssignment, 'epa', 'epa."endpointId" = e.id')
      .where('e."userId" = :userId', { userId })
      .andWhere('e."isActive" = true')
      .andWhere('epa."probeId" = :probeId', { probeId })
      .getMany();

    const scanNowCutoff = new Date(Date.now() - 5 * 60 * 1000);

    return endpoints.map((e) => ({
      host: e.host,
      port: e.port,
      sni: e.sni ?? e.host,
      userId: e.userId,
      ...(e.lastScanRequestedAt && e.lastScanRequestedAt > scanNowCutoff
        ? { scanNow: true }
        : {}),
    }));
  }

  /**
   * Resolve scan result to one or more endpoints.
   * Hosted mode can match multiple users' endpoints for the same host:port.
   * Connected mode matches exactly one (the user's).
   */
  private async resolveEndpoints(
    result: ScanResultDto,
    probeMode: string,
    probeRegion: string | undefined,
    probeUserId: string | undefined,
  ): Promise<Endpoint[]> {
    const host = result.endpoint.host;
    const port = result.endpoint.port;

    if (probeMode === 'connected' && probeUserId) {
      const ep = await this.endpointRepo.findOne({
        where: { userId: probeUserId, host, port },
      });
      return ep ? [ep] : [];
    }

    if (probeMode === 'hosted' && probeRegion) {
      return this.endpointRepo
        .createQueryBuilder('e')
        .innerJoin(EndpointHostedRegion, 'ehr', 'ehr."endpointId" = e.id')
        .where('e.host = :host AND e.port = :port', { host, port })
        .andWhere('ehr.region = :region', { region: probeRegion })
        .andWhere('e."isActive" = true')
        .getMany();
    }

    // Standalone mode: no endpoint matching
    return [];
  }
}
