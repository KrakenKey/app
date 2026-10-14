import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, IsNull, Repository } from 'typeorm';
import { PLAN_LIMITS } from '@krakenkey/shared';
import { BillingService } from '../billing.service';
import { User } from '../../users/entities/user.entity';
import { Connector } from '../../connectors/entities/connector.entity';
import { NotificationChannel } from '../../notifications/channels/entities/notification-channel.entity';
import { GithubOidcTrust } from '../../auth/entities/github-oidc-trust.entity';
import { planLimitExceeded, type CountedLimit } from './plan-limit-error';

/** Resources counted across an account's resource owners. */
export type PooledLimit = Exclude<CountedLimit, 'orgMembers'>;

/**
 * Advisory lock namespace ("KKPL") for plan limit checks, taken per account
 * (organization or user) so two requests can't both pass the count and
 * insert past the limit. Distinct from the renewal queue's namespace.
 */
export const PLAN_LIMIT_LOCK_NAMESPACE = 0x4b4b504c;

/** Longest wait for the per-account lock. */
const LOCK_WAIT = '5s';

/** Postgres lock_not_available, raised when lock_timeout runs out. */
const LOCK_NOT_AVAILABLE = '55P03';

const ENTITIES = {
  connectors: Connector,
  alertChannels: NotificationChannel,
  githubOidcTrusts: GithubOidcTrust,
} as const;

/**
 * Checks the per-plan limits on connectors, alert channels, GitHub OIDC
 * trusts and organization members. Counts are pooled like domains: across
 * every member of the user's organization, or the user alone. Limits only
 * refuse new resources; anything already over a limit keeps working.
 */
@Injectable()
export class PlanLimitsService {
  constructor(
    private readonly billing: BillingService,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(Connector)
    private readonly connectors: Repository<Connector>,
    @InjectRepository(NotificationChannel)
    private readonly channels: Repository<NotificationChannel>,
    @InjectRepository(GithubOidcTrust)
    private readonly trusts: Repository<GithubOidcTrust>,
  ) {}

  /** How many of the resource these users have (active connectors only). */
  count(limit: PooledLimit, userIds: string[]): Promise<number> {
    const repo = {
      connectors: this.connectors,
      alertChannels: this.channels,
      githubOidcTrusts: this.trusts,
    }[limit] as Repository<{ userId: string }>;
    return countIn(repo, limit, userIds);
  }

  /**
   * Creates a resource only while the account is under its plan limit.
   * The count and `save` run in one transaction under a per-account
   * advisory lock, so concurrent requests can't both take the last slot.
   * `save` must write through the manager it is given.
   */
  async addWithinLimit<T>(
    userId: string,
    limit: PooledLimit,
    save: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    // Everything outside the transaction runs before it opens, and
    // everything inside goes through its manager: a second pool connection
    // taken while holding the lock could exhaust the pool under load.
    const plan = await this.billing.resolveUserTier(userId);
    const max = PLAN_LIMITS[plan][limit];
    const user = await this.users.findOne({
      where: { id: userId },
      select: { id: true, organizationId: true },
    });
    const organizationId = user?.organizationId ?? null;
    const lockKey = organizationId ? `org:${organizationId}` : `user:${userId}`;
    return this.users.manager.transaction(async (manager) => {
      await this.lock(manager, lockKey);
      // Members are read under the lock, so the pool is current
      const userIds = organizationId
        ? (
            await manager.getRepository(User).find({
              where: { organizationId },
              select: { id: true },
            })
          ).map((u) => u.id)
        : [userId];
      const current = await countIn(
        manager.getRepository(ENTITIES[limit]) as Repository<{
          userId: string;
        }>,
        limit,
        userIds,
      );
      if (current >= max) throw planLimitExceeded(limit, plan, current);
      return save(manager);
    });
  }

  /**
   * Adds a member only while the organization is under its plan's member
   * limit, under the same per-account lock as addWithinLimit.
   */
  async addMemberWithinLimit<T>(
    organizationId: string,
    actorId: string,
    save: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    const plan = await this.billing.resolveUserTier(actorId);
    const max = PLAN_LIMITS[plan].orgMembers;
    return this.users.manager.transaction(async (manager) => {
      await this.lock(manager, `org:${organizationId}`);
      if (Number.isFinite(max)) {
        const current = await manager
          .getRepository(User)
          .count({ where: { organizationId } });
        if (current >= max) {
          throw planLimitExceeded('orgMembers', plan, current);
        }
      }
      return save(manager);
    });
  }

  /**
   * Takes the per-account lock, waiting at most LOCK_WAIT. A request that
   * can't get it in time is told to retry instead of holding a connection.
   */
  private async lock(manager: EntityManager, key: string): Promise<void> {
    await manager.query(`SET LOCAL lock_timeout = '${LOCK_WAIT}'`);
    try {
      await manager.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [
        PLAN_LIMIT_LOCK_NAMESPACE,
        key,
      ]);
    } catch (err) {
      if ((err as { code?: string }).code === LOCK_NOT_AVAILABLE) {
        throw new ConflictException(
          'Another change to this account is in progress. Try again in a moment.',
        );
      }
      throw err;
    }
  }

  /**
   * Throws 402 plan_limit_exceeded when the account can't add another. A
   * quick check before slower work; addWithinLimit is the one that holds.
   */
  async assertCanAdd(userId: string, limit: PooledLimit): Promise<void> {
    const plan = await this.billing.resolveUserTier(userId);
    const max = PLAN_LIMITS[plan][limit];
    if (!Number.isFinite(max)) return;
    const userIds = await this.billing.getResourceCountUserIds(userId);
    const current = await this.count(limit, userIds);
    if (current >= max) throw planLimitExceeded(limit, plan, current);
  }

  /** Pooled usage of every counted limit, for the profile's resourceCounts. */
  async usage(userId: string): Promise<Record<CountedLimit, number>> {
    const user = await this.users.findOne({
      where: { id: userId },
      select: { id: true, organizationId: true },
    });
    const userIds = await this.billing.getResourceCountUserIds(userId);
    const [connectors, alertChannels, githubOidcTrusts] = await Promise.all([
      this.count('connectors', userIds),
      this.count('alertChannels', userIds),
      this.count('githubOidcTrusts', userIds),
    ]);
    return {
      connectors,
      alertChannels,
      githubOidcTrusts,
      orgMembers: user?.organizationId ? userIds.length : 0,
    };
  }
}

/** Counts the resource for these users through the given repository. */
function countIn(
  repo: Repository<{ userId: string }>,
  limit: PooledLimit,
  userIds: string[],
): Promise<number> {
  if (userIds.length === 0) return Promise.resolve(0);
  return repo.count({
    where:
      limit === 'connectors'
        ? ({ userId: In(userIds), revokedAt: IsNull() } as never)
        : { userId: In(userIds) },
  });
}
