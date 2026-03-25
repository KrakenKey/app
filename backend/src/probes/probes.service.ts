import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { Probe } from './entities/probe.entity';
import { ProbeScanResult } from './entities/probe-scan-result.entity';
import { Endpoint } from '../endpoints/entities/endpoint.entity';
import { EndpointHostedRegion } from '../endpoints/entities/endpoint-hosted-region.entity';
import { EndpointProbeAssignment } from '../endpoints/entities/endpoint-probe-assignment.entity';
import type { RegisterProbeDto } from './dto/register-probe.dto';
import type { SubmitReportDto, ScanResultDto } from './dto/submit-report.dto';

export interface HostedEndpoint {
  host: string;
  port: number;
  sni: string;
  userId: string;
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
    private readonly config: ConfigService,
  ) {}

  async registerProbe(
    dto: RegisterProbeDto,
    user: ProbeAuthUser,
  ): Promise<Probe> {
    const existing = await this.probeRepo.findOne({
      where: { id: dto.probeId },
    });

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
      if (userId) existing.userId = userId;
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
  ): Promise<{ accepted: number }> {
    const probe = await this.probeRepo.findOne({
      where: { id: dto.probeId },
    });
    if (!probe) {
      throw new NotFoundException(`Probe ${dto.probeId} not registered`);
    }

    probe.lastSeenAt = new Date();
    await this.probeRepo.save(probe);

    const scannedAt = new Date(dto.timestamp);
    const probeMode = dto.mode;
    const probeRegion = dto.region;

    // For connected/hosted probes, resolve the userId to look up endpoints
    const probeUserId = user.isServiceKey ? undefined : user.userId;

    const entities: ProbeScanResult[] = [];

    for (const r of dto.results) {
      // Match host:port to a registered Endpoint
      const endpoint = await this.resolveEndpoint(
        r,
        probeMode,
        probeRegion,
        probeUserId,
      );

      if (!endpoint && (probeMode === 'connected' || probeMode === 'hosted')) {
        this.logger.warn(
          `No matching endpoint for ${r.endpoint.host}:${r.endpoint.port} from probe ${dto.probeId} (${probeMode}), skipping`,
        );
        continue;
      }

      // For hosted probes, userId comes from the endpoint owner
      const resultUserId = endpoint?.userId ?? probeUserId;

      entities.push(
        this.scanResultRepo.create({
          probeId: dto.probeId,
          endpointId: endpoint?.id,
          host: r.endpoint.host,
          port: r.endpoint.port,
          sni: r.endpoint.sni,
          userId: resultUserId,
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
        }),
      );
    }

    if (entities.length > 0) {
      await this.scanResultRepo.save(entities);
    }
    this.logger.log(
      `Accepted ${entities.length} scan results from probe ${dto.probeId}`,
    );
    return { accepted: entities.length };
  }

  async getConfig(
    probeId: string,
    user: ProbeAuthUser,
  ): Promise<{ endpoints: HostedEndpoint[]; interval: string }> {
    const probe = await this.probeRepo.findOne({ where: { id: probeId } });
    if (!probe) {
      throw new NotFoundException(`Probe ${probeId} not registered`);
    }

    let endpoints: HostedEndpoint[];

    if (user.isServiceKey) {
      // Hosted probe: return all endpoints with hosted regions matching probe's region
      endpoints = await this.getHostedEndpoints(probe.region);
    } else {
      // Connected probe: return endpoints assigned to this specific probe
      endpoints = await this.getConnectedEndpoints(user.userId!, probeId);
    }

    const interval =
      this.config.get<string>('KK_PROBE_HOSTED_INTERVAL') ?? '60m';

    return { endpoints, interval };
  }

  private async getHostedEndpoints(
    probeRegion?: string,
  ): Promise<HostedEndpoint[]> {
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
  ): Promise<HostedEndpoint[]> {
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

  private async resolveEndpoint(
    result: ScanResultDto,
    probeMode: string,
    probeRegion: string | undefined,
    probeUserId: string | undefined,
  ): Promise<Endpoint | null> {
    const host = result.endpoint.host;
    const port = result.endpoint.port;

    if (probeMode === 'connected' && probeUserId) {
      // Connected: match against user's endpoints
      return this.endpointRepo.findOne({
        where: { userId: probeUserId, host, port },
      });
    }

    if (probeMode === 'hosted' && probeRegion) {
      // Hosted: match against endpoints that have this region configured
      const row = await this.endpointRepo
        .createQueryBuilder('e')
        .innerJoin(EndpointHostedRegion, 'ehr', 'ehr."endpointId" = e.id')
        .where('e.host = :host AND e.port = :port', { host, port })
        .andWhere('ehr.region = :region', { region: probeRegion })
        .andWhere('e."isActive" = true')
        .getOne();
      return row;
    }

    // Standalone mode or fallback: no endpoint matching
    return null;
  }
}
