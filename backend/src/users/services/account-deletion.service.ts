import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../entities/user.entity';
import { TlsCrt } from '../../certs/tls/entities/tls-crt.entity';
import { Domain } from '../../domains/entities/domain.entity';
import { UserApiKey } from '../../auth/entities/user-api-key.entity';
import { Feedback } from '../../feedback/entities/feedback.entity';
import { AcmeIssuerStrategy } from '../../certs/tls/strategies/acme-issuer.strategy';
import { CertStatus } from '@krakenkey/shared';

@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);

  constructor(
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    @InjectRepository(TlsCrt)
    private readonly tlsCrtRepo: Repository<TlsCrt>,
    @InjectRepository(Domain)
    private readonly domainsRepo: Repository<Domain>,
    @InjectRepository(UserApiKey)
    private readonly apiKeysRepo: Repository<UserApiKey>,
    @InjectRepository(Feedback)
    private readonly feedbackRepo: Repository<Feedback>,
    private readonly acmeIssuer: AcmeIssuerStrategy,
  ) {}

  async deleteAccount(userId: string) {
    const user = await this.usersRepo.findOneBy({ id: userId });
    if (!user) {
      throw new NotFoundException(`User #${userId} not found`);
    }

    // 1. Revoke issued certs via ACME (best-effort)
    const issuedCerts = await this.tlsCrtRepo.find({
      where: { userId, status: CertStatus.ISSUED },
    });

    let certsRevoked = 0;
    for (const cert of issuedCerts) {
      if (cert.crtPem) {
        try {
          await this.acmeIssuer.revoke(cert.crtPem, 1); // reason 1 = keyCompromise
          certsRevoked++;
        } catch (err) {
          this.logger.warn(
            `Failed to revoke cert #${cert.id} during account deletion: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }

    // 2. Delete all certificate records
    await this.tlsCrtRepo.delete({ userId });

    // 3. Delete all domain records
    await this.domainsRepo.delete({ userId });

    // 4. Anonymize feedback (nullify userId, preserve data)
    await this.feedbackRepo.update({ userId }, { userId: null });

    // 5. Delete API keys (also handled by DB CASCADE, but explicit for clarity)
    await this.apiKeysRepo.delete({ userId });

    // 6. Delete user
    await this.usersRepo.delete(userId);

    this.logger.log(
      `Account deleted: user=${userId}, certsRevoked=${certsRevoked}, issuedCerts=${issuedCerts.length}`,
    );

    return { deleted: true, certsRevoked };
  }
}
