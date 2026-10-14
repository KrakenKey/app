import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
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
    if (userIds.length === 0) return Promise.resolve(0);
    switch (limit) {
      case 'connectors':
        return this.connectors.count({
          where: { userId: In(userIds), revokedAt: IsNull() },
        });
      case 'alertChannels':
        return this.channels.count({ where: { userId: In(userIds) } });
      case 'githubOidcTrusts':
        return this.trusts.count({ where: { userId: In(userIds) } });
    }
  }

  /** Throws 402 plan_limit_exceeded when the account can't add another. */
  async assertCanAdd(userId: string, limit: PooledLimit): Promise<void> {
    const plan = await this.billing.resolveUserTier(userId);
    const max = PLAN_LIMITS[plan][limit];
    if (!Number.isFinite(max)) return;
    const userIds = await this.billing.getResourceCountUserIds(userId);
    const current = await this.count(limit, userIds);
    if (current >= max) throw planLimitExceeded(limit, plan, current);
  }

  /** Members of an organization, owner included. */
  countMembers(organizationId: string): Promise<number> {
    return this.users.count({ where: { organizationId } });
  }

  /**
   * Throws 402 plan_limit_exceeded when the organization the actor belongs
   * to is at its plan's member limit.
   */
  async assertCanAddMember(
    organizationId: string,
    actorId: string,
  ): Promise<void> {
    const plan = await this.billing.resolveUserTier(actorId);
    const max = PLAN_LIMITS[plan].orgMembers;
    if (!Number.isFinite(max)) return;
    const current = await this.countMembers(organizationId);
    if (current >= max) throw planLimitExceeded('orgMembers', plan, current);
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
