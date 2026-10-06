import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  GITHUB_OIDC_KEY_TTL_SECONDS,
  type GithubOidcExchangeResponse,
  type GithubOidcTrust as GithubOidcTrustDto,
} from '@krakenkey/shared';
import { GithubOidcTrust } from '../entities/github-oidc-trust.entity';
import { AuthService } from '../auth.service';
import {
  GithubOidcVerifier,
  type GithubOidcClaims,
} from './github-oidc.verifier';
import type { CreateGithubOidcTrustDto } from './github-oidc.dto';
import { GithubRepoLookup } from './github-repo-lookup';

/** Trust policies per user. */
export const MAX_TRUSTS_PER_USER = 20;

/** Whether a token's ref is allowed: exact, or prefix for entries ending in `*`. */
export function refAllowed(
  ref: string | undefined,
  allowed: string[] | null,
): boolean {
  if (!allowed) return true;
  if (!ref) return false;
  return allowed.some((a) =>
    a.endsWith('*') ? ref.startsWith(a.slice(0, -1)) : ref === a,
  );
}

@Injectable()
export class GithubOidcService {
  private readonly logger = new Logger(GithubOidcService.name);

  constructor(
    @InjectRepository(GithubOidcTrust)
    private readonly trustRepo: Repository<GithubOidcTrust>,
    private readonly authService: AuthService,
    private readonly verifier: GithubOidcVerifier,
    private readonly repoLookup: GithubRepoLookup,
  ) {}

  async list(userId: string): Promise<GithubOidcTrustDto[]> {
    const trusts = await this.trustRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
    return trusts.map(toDto);
  }

  async create(
    userId: string,
    dto: CreateGithubOidcTrustDto,
  ): Promise<GithubOidcTrustDto> {
    const count = await this.trustRepo.count({ where: { userId } });
    if (count >= MAX_TRUSTS_PER_USER) {
      throw new BadRequestException(
        `You can have at most ${MAX_TRUSTS_PER_USER} GitHub trust policies`,
      );
    }
    const limits = await this.authService.validateRestrictions(userId, {
      scopes: dto.scopes,
      allowedDomainIds: dto.allowedDomainIds,
      allowedCertIds: dto.allowedCertIds,
    });
    const repositoryId = await this.resolveRepositoryId(
      dto.repository,
      dto.repositoryId,
    );
    const trust = this.trustRepo.create({
      userId,
      name: dto.name,
      repository: dto.repository,
      repositoryId,
      allowedRefs: dto.allowedRefs ?? null,
      environment: dto.environment ?? null,
      scopes: limits.scopes,
      allowedDomainIds: limits.allowedDomainIds,
      allowedCertIds: limits.allowedCertIds,
      lastUsedAt: null,
      lastUsedRef: null,
    });
    await this.trustRepo.save(trust);
    return toDto(trust);
  }

  /**
   * The id to pin a new policy to. A given id is used as is, unless GitHub
   * says the public repository has a different one (a typo in either
   * field). Without one, a public repository's id is looked up; a private,
   * misspelled or unreachable one stays unpinned and pins on first use.
   */
  private async resolveRepositoryId(
    repository: string,
    given?: string,
  ): Promise<string | null> {
    const found = await this.repoLookup.lookup(repository);
    if (given) {
      if (found.status === 'found' && found.id !== given) {
        throw new BadRequestException(
          `${repository} has repository id ${found.id} on GitHub, not ${given}`,
        );
      }
      return given;
    }
    return found.status === 'found' ? found.id : null;
  }

  async remove(userId: string, id: string): Promise<void> {
    const result = await this.trustRepo.delete({ id, userId });
    if (!result.affected) {
      throw new NotFoundException(`Trust policy #${id} not found`);
    }
  }

  /**
   * Exchanges a GitHub Actions OIDC token for a short-lived API key carrying
   * the matching trust policy's scopes and restrictions.
   */
  async exchange(
    token: string,
    trustId: string | undefined,
    ip?: string,
  ): Promise<GithubOidcExchangeResponse> {
    const claims = await this.verifier.verify(token);

    const candidates = await this.trustRepo
      .createQueryBuilder('t')
      .where('lower(t.repository) = lower(:repo)', { repo: claims.repository })
      .getMany();

    const matching = candidates.filter((t) => {
      if (trustId && t.id !== trustId) return false;
      if (t.repositoryId && t.repositoryId !== claims.repository_id) {
        this.logger.warn(
          `GitHub OIDC: ${claims.repository} has id ${claims.repository_id} but trust ${t.id} is pinned to ${t.repositoryId}; refused`,
        );
        return false;
      }
      if (!refAllowed(claims.ref, t.allowedRefs)) return false;
      if (t.environment && t.environment !== claims.environment) return false;
      return true;
    });

    if (matching.length === 0) {
      this.logger.warn(
        `GitHub OIDC exchange refused for ${claims.repository} ref ${claims.ref ?? '-'} env ${claims.environment ?? '-'}${ip ? ` from ${ip}` : ''}: no matching trust policy`,
      );
      throw new ForbiddenException(
        'No KrakenKey trust policy matches this repository, ref and environment',
      );
    }
    if (matching.length > 1) {
      throw new HttpException(
        {
          statusCode: 409,
          message:
            'Several trust policies match this repository; pass trust-id to choose one',
          trustIds: matching.map((t) => t.id),
        },
        409,
      );
    }

    const trust = matching[0];
    const key = await this.authService.createEphemeralApiKey(
      trust.userId,
      `GitHub OIDC: ${claims.repository}${claims.ref ? `@${claims.ref}` : ''}`,
      'github-oidc',
      GITHUB_OIDC_KEY_TTL_SECONDS,
      {
        scopes: trust.scopes,
        allowedDomainIds: trust.allowedDomainIds,
        allowedCertIds: trust.allowedCertIds,
      },
    );

    await this.trustRepo.update(trust.id, {
      // Pin on first use so a re-created repository with the same name is refused
      repositoryId: trust.repositoryId ?? claims.repository_id,
      lastUsedAt: new Date(),
      lastUsedRef: claims.ref ?? null,
    });

    this.logger.log(
      `GitHub OIDC exchange: trust ${trust.id} repo ${claims.repository} (${claims.repository_id}) ref ${claims.ref ?? '-'} sha ${claims.sha ?? '-'} run ${claims.run_id ?? '-'} actor ${claims.actor ?? '-'} -> key ${key.id}`,
    );

    return {
      apiKey: key.apiKey,
      expiresAt: key.expiresAt.toISOString(),
      trustId: trust.id,
      scopes: trust.scopes,
    };
  }
}

function toDto(t: GithubOidcTrust): GithubOidcTrustDto {
  return {
    id: t.id,
    name: t.name,
    repository: t.repository,
    repositoryId: t.repositoryId,
    allowedRefs: t.allowedRefs,
    environment: t.environment,
    scopes: t.scopes,
    allowedDomainIds: t.allowedDomainIds,
    allowedCertIds: t.allowedCertIds,
    lastUsedAt: t.lastUsedAt ? t.lastUsedAt.toISOString() : null,
    lastUsedRef: t.lastUsedRef,
    createdAt: t.createdAt.toISOString(),
  };
}

export type { GithubOidcClaims };
