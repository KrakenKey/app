import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  HttpException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Domain } from './entities/domain.entity';
import { User } from '../users/entities/user.entity';
import { CreateDomainDto } from './dto/create-domain.dto';
import { randomBytes } from 'crypto';
import { resolveTxt } from 'dns/promises';
import { MetricsService } from '../metrics/metrics.service';
import { BillingService } from '../billing/billing.service';
import { PLAN_LIMITS } from '../billing/constants/plan-limits';
import type { SubscriptionPlan } from '@krakenkey/shared';

@Injectable()
export class DomainsService {
  private readonly logger = new Logger(DomainsService.name);

  constructor(
    @InjectRepository(Domain)
    private domainsRepository: Repository<Domain>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly metricsService: MetricsService,
    private readonly billingService: BillingService,
  ) {}

  /**
   * Creates a new domain for a user.
   * If the domain already exists for this user, it returns the existing one.
   * Otherwise, it generates a verification code and saves the new domain.
   */
  async create(
    userId: string,
    createDomainDto: CreateDomainDto,
  ): Promise<Domain> {
    // Check if the user has already added this domain
    const existing = await this.domainsRepository.findOne({
      where: { hostname: createDomainDto.hostname, userId },
    });

    if (existing) {
      return existing;
    }

    // Plan-based domain limit check (pooled across org members)
    const plan = (await this.billingService.resolveUserTier(
      userId,
    )) as SubscriptionPlan;
    const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;
    if (limits.domains !== Infinity) {
      const memberIds =
        await this.billingService.getResourceCountUserIds(userId);
      const count = await this.domainsRepository.count({
        where: { userId: In(memberIds) },
      });
      if (count >= limits.domains) {
        throw new HttpException(
          {
            message: 'Domain limit reached',
            limit: limits.domains,
            current: count,
            plan,
          },
          402,
        );
      }
    }

    // Generate a unique verification string (e.g., krakenkey-site-verification=...)
    const verificationCode = `krakenkey-site-verification=${randomBytes(16).toString('hex')}`;

    const domain = this.domainsRepository.create({
      hostname: createDomainDto.hostname,
      userId,
      verificationCode,
      isVerified: false,
    });

    return this.domainsRepository.save(domain);
  }

  /**
   * Retrieves all domains visible to a user.
   * If the user belongs to an organization, returns domains owned by any org member.
   * Otherwise returns only the user's own domains.
   */
  async findAll(userId: string): Promise<Domain[]> {
    const memberIds = await this.getOrgMemberIds(userId);
    if (memberIds) {
      return this.domainsRepository.find({ where: { userId: In(memberIds) } });
    }
    return this.domainsRepository.find({ where: { userId } });
  }

  /**
   * Retrieves verified domains visible to a user (org-scoped).
   * Used for domain authorization checks before issuing certificates.
   * Org members may use any verified domain owned by any org member.
   */
  async findAllVerified(userId: string): Promise<Domain[]> {
    const memberIds = await this.getOrgMemberIds(userId);
    if (memberIds) {
      return this.domainsRepository.find({
        where: { userId: In(memberIds), isVerified: true },
      });
    }
    return this.domainsRepository.find({
      where: { userId, isVerified: true },
    });
  }

  /**
   * Returns all user IDs in the same org as `userId`, or null if the user has no org.
   */
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

  /**
   * Finds a specific domain by ID and User ID.
   * Throws an error if the domain is not found.
   */
  async findOne(id: string, userId: string): Promise<Domain> {
    let domain = await this.domainsRepository.findOne({
      where: { id, userId },
    });

    // Check org membership if not directly owned
    if (!domain) {
      const memberIds = await this.getOrgMemberIds(userId);
      if (memberIds) {
        domain = await this.domainsRepository.findOne({
          where: { id, userId: In(memberIds) },
        });
      }
    }

    if (!domain) {
      throw new NotFoundException(`Domain #${id} not found`);
    }
    return domain;
  }

  /**
   * Verifies domain ownership by checking DNS TXT records.
   *
   * User must add a TXT record with the verificationCode to their domain's DNS.
   * This method performs a DNS lookup and marks the domain as verified if found.
   */
  async verify(userId: string, id: string): Promise<Domain> {
    const domain = await this.findOne(id, userId);

    // If already verified, skip DNS lookup
    if (domain.isVerified) {
      return domain;
    }

    let records: string[][];
    try {
      records = await resolveTxt(domain.hostname);
    } catch (error) {
      this.metricsService.domainsVerifiedTotal.inc({ status: 'failed' });
      throw new BadRequestException(`DNS lookup failed: ${error.message}`);
    }

    // TXT records can be split into 255-character chunks (DNS spec).
    // Join chunks to get the full record content.
    const flatRecords = records.map((chunk) => chunk.join(''));

    this.logger.debug(
      `DNS lookup for ${domain.hostname}: found ${flatRecords.length} TXT records`,
    );

    const hasVerification = flatRecords.some((record) =>
      record.includes(domain.verificationCode),
    );

    if (!hasVerification) {
      this.metricsService.domainsVerifiedTotal.inc({ status: 'failed' });
      this.logger.debug(
        `Verification failed for ${domain.hostname}: expected code not found among ${flatRecords.length} TXT records`,
      );
      throw new BadRequestException(
        'Verification TXT record not found. Please ensure the record has propagated and try again.',
      );
    }

    domain.isVerified = true;
    this.metricsService.domainsVerifiedTotal.inc({ status: 'verified' });
    return this.domainsRepository.save(domain);
  }

  /**
   * @internal
   * SYSTEM USE ONLY. Do not use this in Controllers.
   * Performs a DNS TXT lookup and returns whether the domain's verification
   * record is still present. Returns false on any DNS failure.
   * Intended for use by DomainMonitorService periodic re-verification only.
   */
  async checkVerificationRecord(domain: Domain): Promise<boolean> {
    try {
      const records = await resolveTxt(domain.hostname);
      const flatRecords = records.map((chunk) => chunk.join(''));
      return flatRecords.some((record) =>
        record.includes(domain.verificationCode),
      );
    } catch {
      return false;
    }
  }

  /**
   * Deletes a domain.
   * Throws an error if the domain to delete doesn't exist.
   */
  async delete(userId: string, id: string): Promise<void> {
    // Verify access (includes org membership check)
    const domain = await this.findOne(id, userId);
    const result = await this.domainsRepository.delete(domain.id);
    if (result.affected === 0) {
      throw new NotFoundException(`Domain #${id} not found`);
    }
  }
}
