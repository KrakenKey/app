import {
  Injectable,
  Logger,
  NotFoundException,
  HttpException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Endpoint } from './entities/endpoint.entity';
import { EndpointHostedRegion } from './entities/endpoint-hosted-region.entity';
import { ProbeScanResult } from '../probes/entities/probe-scan-result.entity';
import { User } from '../users/entities/user.entity';
import { BillingService } from '../billing/billing.service';
import { PLAN_LIMITS } from '../billing/constants/plan-limits';
import type { CreateEndpointDto } from './dto/create-endpoint.dto';
import type { UpdateEndpointDto } from './dto/update-endpoint.dto';
import type { SubscriptionPlan } from '@krakenkey/shared';

@Injectable()
export class EndpointsService {
  private readonly logger = new Logger(EndpointsService.name);

  constructor(
    @InjectRepository(Endpoint)
    private readonly endpointRepo: Repository<Endpoint>,
    @InjectRepository(EndpointHostedRegion)
    private readonly hostedRegionRepo: Repository<EndpointHostedRegion>,
    @InjectRepository(ProbeScanResult)
    private readonly scanResultRepo: Repository<ProbeScanResult>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly billingService: BillingService,
  ) {}

  async create(userId: string, dto: CreateEndpointDto): Promise<Endpoint> {
    const port = dto.port ?? 443;

    // Check for existing duplicate
    const existing = await this.endpointRepo.findOne({
      where: { userId, host: dto.host, port },
    });
    if (existing) {
      return existing;
    }

    // Plan-based endpoint limit check (pooled across org members)
    const plan = (await this.billingService.resolveUserTier(
      userId,
    )) as SubscriptionPlan;
    const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;
    if (limits.monitoredEndpoints !== Infinity) {
      const memberIds =
        await this.billingService.getResourceCountUserIds(userId);
      const count = await this.endpointRepo.count({
        where: { userId: In(memberIds) },
      });
      if (count >= limits.monitoredEndpoints) {
        throw new HttpException(
          {
            message: 'Endpoint limit reached',
            code: 'plan_limit_exceeded',
            limit: limits.monitoredEndpoints,
            current: count,
            plan,
          },
          403,
        );
      }
    }

    const endpoint = this.endpointRepo.create({
      userId,
      host: dto.host,
      port,
      sni: dto.sni,
      label: dto.label,
    });

    return this.endpointRepo.save(endpoint);
  }

  async findAll(userId: string): Promise<Endpoint[]> {
    const memberIds = await this.getOrgMemberIds(userId);
    if (memberIds) {
      return this.endpointRepo.find({
        where: { userId: In(memberIds) },
        relations: ['hostedRegions'],
        order: { createdAt: 'DESC' },
      });
    }
    return this.endpointRepo.find({
      where: { userId },
      relations: ['hostedRegions'],
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string, userId: string): Promise<Endpoint> {
    let endpoint = await this.endpointRepo.findOne({
      where: { id, userId },
      relations: ['hostedRegions'],
    });

    if (!endpoint) {
      const memberIds = await this.getOrgMemberIds(userId);
      if (memberIds) {
        endpoint = await this.endpointRepo.findOne({
          where: { id, userId: In(memberIds) },
          relations: ['hostedRegions'],
        });
      }
    }

    if (!endpoint) {
      throw new NotFoundException(`Endpoint #${id} not found`);
    }
    return endpoint;
  }

  async update(
    id: string,
    userId: string,
    dto: UpdateEndpointDto,
  ): Promise<Endpoint> {
    const endpoint = await this.findOne(id, userId);
    Object.assign(endpoint, dto);
    return this.endpointRepo.save(endpoint);
  }

  async delete(id: string, userId: string): Promise<void> {
    const endpoint = await this.findOne(id, userId);
    const result = await this.endpointRepo.delete(endpoint.id);
    if (result.affected === 0) {
      throw new NotFoundException(`Endpoint #${id} not found`);
    }
  }

  async addHostedRegion(
    endpointId: string,
    userId: string,
    region: string,
  ): Promise<EndpointHostedRegion> {
    const endpoint = await this.findOne(endpointId, userId);

    // Check plan limits for hosted monitoring
    const plan = (await this.billingService.resolveUserTier(
      userId,
    )) as SubscriptionPlan;
    const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;

    if (limits.hostedProbeRegions === 0) {
      throw new HttpException(
        {
          message: 'Hosted monitoring is not available on your plan',
          code: 'plan_limit_exceeded',
          plan,
        },
        403,
      );
    }

    // Check hosted endpoint limit (endpoints with at least one hosted region)
    if (limits.hostedMonitoredEndpoints !== Infinity) {
      const memberIds =
        await this.billingService.getResourceCountUserIds(userId);
      const hostedEndpointCount = await this.endpointRepo
        .createQueryBuilder('e')
        .innerJoin('endpoint_hosted_region', 'ehr', 'ehr."endpointId" = e.id')
        .where('e."userId" IN (:...memberIds)', { memberIds })
        .getCount();
      // Only enforce if this endpoint doesn't already have hosted regions
      const existingRegions = endpoint.hostedRegions?.length ?? 0;
      if (
        existingRegions === 0 &&
        hostedEndpointCount >= limits.hostedMonitoredEndpoints
      ) {
        throw new HttpException(
          {
            message: 'Hosted endpoint limit reached',
            code: 'plan_limit_exceeded',
            limit: limits.hostedMonitoredEndpoints,
            current: hostedEndpointCount,
            plan,
          },
          403,
        );
      }
    }

    // Check total hosted regions across all endpoints
    if (limits.hostedProbeRegions !== Infinity) {
      const memberIds =
        await this.billingService.getResourceCountUserIds(userId);
      const regionCount = await this.hostedRegionRepo
        .createQueryBuilder('ehr')
        .innerJoin('endpoint', 'e', 'e.id = ehr."endpointId"')
        .where('e."userId" IN (:...memberIds)', { memberIds })
        .getCount();
      if (regionCount >= limits.hostedProbeRegions) {
        throw new HttpException(
          {
            message: 'Hosted region limit reached',
            code: 'plan_limit_exceeded',
            limit: limits.hostedProbeRegions,
            current: regionCount,
            plan,
          },
          403,
        );
      }
    }

    // Check for duplicate
    const existing = await this.hostedRegionRepo.findOne({
      where: { endpointId: endpoint.id, region },
    });
    if (existing) {
      return existing;
    }

    const hostedRegion = this.hostedRegionRepo.create({
      endpointId: endpoint.id,
      region,
    });
    return this.hostedRegionRepo.save(hostedRegion);
  }

  async removeHostedRegion(
    endpointId: string,
    userId: string,
    region: string,
  ): Promise<void> {
    const endpoint = await this.findOne(endpointId, userId);
    const result = await this.hostedRegionRepo.delete({
      endpointId: endpoint.id,
      region,
    });
    if (result.affected === 0) {
      throw new NotFoundException(
        `Region '${region}' not found for endpoint #${endpointId}`,
      );
    }
  }

  async getResults(
    endpointId: string,
    userId: string,
    page = 1,
    limit = 20,
  ): Promise<{ data: ProbeScanResult[]; total: number }> {
    await this.findOne(endpointId, userId);
    const [data, total] = await this.scanResultRepo.findAndCount({
      where: { endpointId },
      order: { scannedAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { data, total };
  }

  async getLatestResults(
    endpointId: string,
    userId: string,
  ): Promise<ProbeScanResult[]> {
    await this.findOne(endpointId, userId);
    return this.scanResultRepo
      .createQueryBuilder('r')
      .where('r."endpointId" = :endpointId', { endpointId })
      .andWhere(
        'r.id IN ' +
          this.scanResultRepo
            .createQueryBuilder('sub')
            .select('DISTINCT ON (sub."probeId") sub.id')
            .where('sub."endpointId" = :endpointId')
            .orderBy('sub."probeId"')
            .addOrderBy('sub."scannedAt"', 'DESC')
            .getQuery(),
      )
      .setParameters({ endpointId })
      .getMany();
  }

  async exportResults(
    endpointId: string,
    userId: string,
    format: 'json' | 'csv' = 'json',
  ): Promise<{ data: string; contentType: string; filename: string }> {
    const endpoint = await this.findOne(endpointId, userId);
    const results = await this.scanResultRepo.find({
      where: { endpointId },
      order: { scannedAt: 'DESC' },
    });

    const filename = `${endpoint.host}_${endpoint.port}_scan_results`;

    if (format === 'csv') {
      const headers = [
        'scannedAt',
        'probeId',
        'probeMode',
        'probeRegion',
        'connectionSuccess',
        'connectionError',
        'latencyMs',
        'tlsVersion',
        'cipherSuite',
        'ocspStapled',
        'certSubject',
        'certIssuer',
        'certNotBefore',
        'certNotAfter',
        'certDaysUntilExpiry',
        'certKeyType',
        'certKeySize',
        'certSignatureAlgorithm',
        'certFingerprint',
        'certChainDepth',
        'certChainComplete',
        'certTrusted',
        'certSans',
      ];
      const csvRows = [headers.join(',')];
      for (const r of results) {
        const row = [
          r.scannedAt?.toISOString() ?? '',
          r.probeId,
          r.probeMode ?? '',
          r.probeRegion ?? '',
          String(r.connectionSuccess),
          this.csvEscape(r.connectionError),
          r.latencyMs?.toString() ?? '',
          r.tlsVersion ?? '',
          r.cipherSuite ?? '',
          r.ocspStapled?.toString() ?? '',
          this.csvEscape(r.certSubject),
          this.csvEscape(r.certIssuer),
          r.certNotBefore?.toISOString() ?? '',
          r.certNotAfter?.toISOString() ?? '',
          r.certDaysUntilExpiry?.toString() ?? '',
          r.certKeyType ?? '',
          r.certKeySize?.toString() ?? '',
          r.certSignatureAlgorithm ?? '',
          r.certFingerprint ?? '',
          r.certChainDepth?.toString() ?? '',
          r.certChainComplete?.toString() ?? '',
          r.certTrusted?.toString() ?? '',
          this.csvEscape(r.certSans?.join('; ')),
        ];
        csvRows.push(row.join(','));
      }
      return {
        data: csvRows.join('\n'),
        contentType: 'text/csv',
        filename: `${filename}.csv`,
      };
    }

    return {
      data: JSON.stringify(results, null, 2),
      contentType: 'application/json',
      filename: `${filename}.json`,
    };
  }

  private csvEscape(value: string | undefined | null): string {
    if (value == null) return '';
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }

  private async getOrgMemberIds(userId: string): Promise<string[] | null> {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: { id: true, organizationId: true },
    });
    if (!user?.organizationId) return null;
    const members = await this.userRepo.find({
      where: { organizationId: user.organizationId },
      select: { id: true },
    });
    return members.map((m) => m.id);
  }
}
