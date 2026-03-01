import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Domain } from '../entities/domain.entity';
import { DomainsService } from '../domains.service';

@Injectable()
export class DomainMonitorService {
  private readonly logger = new Logger(DomainMonitorService.name);

  constructor(
    @InjectRepository(Domain)
    private readonly domainsRepository: Repository<Domain>,
    private readonly domainsService: DomainsService,
  ) {}

  /**
   * Runs daily at 2 AM. Re-checks the TXT verification record for every
   * verified domain. If the record is no longer present in DNS, the domain is
   * marked as unverified, which blocks new certificate requests for that domain.
   *
   * Note: In-flight cert issuance/renewal jobs that were already queued before
   * this check runs will complete — the authorization check happens at submission
   * time, not at job execution time. Only new cert submissions are blocked.
   */
  @Cron('0 2 * * *')
  async checkVerifiedDomains(): Promise<void> {
    const verifiedDomains = await this.domainsRepository.find({
      where: { isVerified: true },
    });

    this.logger.log(
      `Domain verification check: ${verifiedDomains.length} verified domain(s) to check`,
    );

    for (const domain of verifiedDomains) {
      try {
        const stillVerified =
          await this.domainsService.checkVerificationRecord(domain);

        if (!stillVerified) {
          await this.domainsRepository.update(domain.id, {
            isVerified: false,
          });
          this.logger.warn(
            `Domain ${domain.hostname} (id: ${domain.id}) failed re-verification — TXT record not found, marked as unverified`,
          );
        }
      } catch (err) {
        this.logger.error(
          `Error re-verifying domain ${domain.hostname} (id: ${domain.id}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
}
