import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { Probe } from './entities/probe.entity';
import { ProbeScanResult } from './entities/probe-scan-result.entity';
import { Domain } from '../domains/entities/domain.entity';
import { TlsCrt } from '../certs/tls/entities/tls-crt.entity';
import type { RegisterProbeDto } from './dto/register-probe.dto';
import type { SubmitReportDto, ScanResultDto } from './dto/submit-report.dto';

@Injectable()
export class ProbesService {
  private readonly logger = new Logger(ProbesService.name);

  constructor(
    @InjectRepository(Probe)
    private readonly probeRepo: Repository<Probe>,
    @InjectRepository(ProbeScanResult)
    private readonly scanResultRepo: Repository<ProbeScanResult>,
    @InjectRepository(Domain)
    private readonly domainRepo: Repository<Domain>,
    private readonly config: ConfigService,
  ) {}

  async registerProbe(dto: RegisterProbeDto): Promise<Probe> {
    const existing = await this.probeRepo.findOne({
      where: { id: dto.probeId },
    });

    if (existing) {
      existing.name = dto.name;
      existing.version = dto.version;
      existing.mode = dto.mode;
      existing.region = dto.region;
      existing.os = dto.os;
      existing.arch = dto.arch;
      existing.status = 'active';
      existing.lastSeenAt = new Date();
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
    });
    return this.probeRepo.save(probe);
  }

  async submitReport(dto: SubmitReportDto): Promise<{ accepted: number }> {
    const probe = await this.probeRepo.findOne({
      where: { id: dto.probeId },
    });
    if (!probe) {
      throw new NotFoundException(`Probe ${dto.probeId} not registered`);
    }

    probe.lastSeenAt = new Date();
    await this.probeRepo.save(probe);

    const scannedAt = new Date(dto.timestamp);
    const entities = dto.results.map((r: ScanResultDto) =>
      this.scanResultRepo.create({
        probeId: dto.probeId,
        host: r.endpoint.host,
        port: r.endpoint.port,
        sni: r.endpoint.sni,
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

    await this.scanResultRepo.save(entities);
    this.logger.log(
      `Accepted ${entities.length} scan results from probe ${dto.probeId}`,
    );
    return { accepted: entities.length };
  }

  async getHostedConfig(
    probeId: string,
  ): Promise<{ endpoints: HostedEndpoint[]; interval: string }> {
    const probe = await this.probeRepo.findOne({ where: { id: probeId } });
    if (!probe) {
      throw new NotFoundException(`Probe ${probeId} not registered`);
    }

    // Find all verified domains that have at least one active certificate
    const rows: { hostname: string; userId: string }[] = await this.domainRepo
      .createQueryBuilder('d')
      .select('DISTINCT d.hostname', 'hostname')
      .addSelect('d.userId', 'userId')
      .innerJoin(TlsCrt, 't', 't."userId" = d."userId"')
      .where('d."isVerified" = true')
      .andWhere('t.status IN (:...statuses)', {
        statuses: ['issued', 'renewing'],
      })
      .andWhere('t."crtPem" IS NOT NULL')
      .getRawMany();

    const endpoints: HostedEndpoint[] = rows.map((r) => ({
      host: r.hostname,
      port: 443,
      sni: r.hostname,
      userId: r.userId,
    }));

    const interval =
      this.config.get<string>('KK_PROBE_HOSTED_INTERVAL') ?? '60m';

    return { endpoints, interval };
  }
}

export interface HostedEndpoint {
  host: string;
  port: number;
  sni: string;
  userId: string;
}
