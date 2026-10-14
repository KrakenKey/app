import { HttpException } from '@nestjs/common';
import { FindOperator } from 'typeorm';
import { PLAN_LIMITS } from '@krakenkey/shared';
import {
  PLAN_LIMIT_LOCK_NAMESPACE,
  PlanLimitsService,
} from './plan-limits.service';
import { planLimitMessage } from './plan-limit-error';

function countRepo(n: number) {
  return { count: jest.fn().mockResolvedValue(n) };
}

describe('PlanLimitsService', () => {
  let billing: {
    resolveUserTier: jest.Mock;
    getResourceCountUserIds: jest.Mock;
  };
  let users: {
    count: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
    manager: { transaction: jest.Mock };
  };
  // What runs inside the transaction: the lock, then counts and saves
  let calls: string[];
  let manager: { query: jest.Mock; getRepository: jest.Mock };
  let connectors: { count: jest.Mock };
  let channels: { count: jest.Mock };
  let trusts: { count: jest.Mock };
  let svc: PlanLimitsService;

  const build = () =>
    new PlanLimitsService(
      billing as any,
      users as any,
      connectors as any,
      channels as any,
      trusts as any,
    );

  beforeEach(() => {
    billing = {
      resolveUserTier: jest.fn().mockResolvedValue('free'),
      getResourceCountUserIds: jest.fn().mockResolvedValue(['u1']),
    };
    calls = [];
    connectors = countRepo(0);
    channels = countRepo(0);
    trusts = countRepo(0);
    users = {
      count: jest.fn().mockResolvedValue(0),
      findOne: jest.fn().mockResolvedValue({ id: 'u1', organizationId: null }),
      find: jest.fn().mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]),
      manager: { transaction: jest.fn() },
    };
    manager = {
      query: jest.fn(async (sql: string, params?: unknown[]) => {
        calls.push(
          sql.startsWith('SET LOCAL') ? sql : `lock ${String(params?.[1])}`,
        );
      }),
      getRepository: jest.fn((entity: { name: string }) => {
        const repo = {
          Connector: connectors,
          NotificationChannel: channels,
          GithubOidcTrust: trusts,
          User: users,
        }[entity.name];
        return {
          count: (...args: unknown[]) => {
            calls.push(`count ${entity.name}`);
            return (repo as { count: jest.Mock }).count(...args);
          },
          find: (...args: unknown[]) => {
            calls.push(`find ${entity.name}`);
            return (repo as { find: jest.Mock }).find(...args);
          },
        };
      }),
    };
    users.manager.transaction.mockImplementation(
      (cb: (m: typeof manager) => unknown) => cb(manager),
    );
    svc = build();
  });

  const refusal = async (p: Promise<unknown>) => {
    const err = await p.then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(402);
    return (err as HttpException).getResponse() as Record<string, unknown>;
  };

  describe.each([
    ['connectors', () => connectors, 1, 5, 50],
    ['alertChannels', () => channels, 1, 5, 25],
    ['githubOidcTrusts', () => trusts, 2, 10, 50],
  ] as const)('%s', (limit, repo, free, pro, business) => {
    it.each([
      ['free', free],
      ['pro', pro],
      ['business', business],
    ])('allows %s up to %i', async (plan, max) => {
      billing.resolveUserTier.mockResolvedValue(plan);
      repo().count.mockResolvedValue(max - 1);
      await expect(svc.assertCanAdd('u1', limit)).resolves.toBeUndefined();
      repo().count.mockResolvedValue(max);
      const body = await refusal(svc.assertCanAdd('u1', limit));
      expect(body).toMatchObject({
        code: 'plan_limit_exceeded',
        limit: max,
        current: max,
        plan,
      });
    });

    it('refuses new ones while over the limit, without touching existing ones', async () => {
      repo().count.mockResolvedValue(free + 3);
      const body = await refusal(svc.assertCanAdd('u1', limit));
      expect(body.current).toBe(free + 3);
    });

    it('has a high backstop on Enterprise', async () => {
      billing.resolveUserTier.mockResolvedValue('enterprise');
      const max = PLAN_LIMITS.enterprise[limit];
      expect(Number.isFinite(max)).toBe(true);
      expect(max).toBeGreaterThanOrEqual(500);
      repo().count.mockResolvedValue(max - 1);
      await expect(svc.assertCanAdd('u1', limit)).resolves.toBeUndefined();
      repo().count.mockResolvedValue(max);
      await refusal(svc.assertCanAdd('u1', limit));
    });

    it('saves under the account lock only while there is room', async () => {
      const save = jest.fn(async () => {
        calls.push('save');
        return 'saved';
      });
      repo().count.mockResolvedValue(free - 1);
      await expect(svc.addWithinLimit('u1', limit, save)).resolves.toBe(
        'saved',
      );
      expect(save).toHaveBeenCalledWith(manager);
      // Lock first, then count, then insert, all in one transaction
      expect(calls).toEqual([
        "SET LOCAL lock_timeout = '5s'",
        'lock user:u1',
        expect.stringMatching(/^count /),
        'save',
      ]);
      // Nothing inside the transaction goes through another connection
      expect(billing.getResourceCountUserIds).not.toHaveBeenCalled();
      expect(manager.query).toHaveBeenCalledWith(
        'SELECT pg_advisory_xact_lock($1, hashtext($2))',
        [PLAN_LIMIT_LOCK_NAMESPACE, 'user:u1'],
      );

      save.mockClear();
      repo().count.mockResolvedValue(free);
      await refusal(svc.addWithinLimit('u1', limit, save));
      expect(save).not.toHaveBeenCalled();
    });

    it('counts across every member of the organization', async () => {
      billing.resolveUserTier.mockResolvedValue('pro');
      billing.getResourceCountUserIds.mockResolvedValue(['u1', 'u2', 'u3']);
      repo().count.mockResolvedValue(pro);
      await refusal(svc.assertCanAdd('u2', limit));
      const where = repo().count.mock.calls[0][0].where;
      expect(where.userId).toBeInstanceOf(FindOperator);
      expect(where.userId.value).toEqual(['u1', 'u2', 'u3']);
    });
  });

  it('counts only active connectors', async () => {
    await svc.assertCanAdd('u1', 'connectors');
    const where = connectors.count.mock.calls[0][0].where;
    expect(where.revokedAt).toBeInstanceOf(FindOperator);
    expect(where.revokedAt.type).toBe('isNull');
  });

  it('locks the whole organization and counts its members under the lock', async () => {
    users.findOne.mockResolvedValue({ id: 'u2', organizationId: 'org-1' });
    await svc.addWithinLimit('u2', 'connectors', async () => undefined);
    expect(calls.slice(1, 3)).toEqual(['lock org:org-1', 'find User']);
    const where = connectors.count.mock.calls[0][0].where;
    expect(where.userId.value).toEqual(['u1', 'u2']);
    expect(billing.getResourceCountUserIds).not.toHaveBeenCalled();
  });

  it('asks to retry when the account lock is busy for too long', async () => {
    manager.query.mockImplementation(async (sql: string) => {
      if (!sql.startsWith('SET LOCAL')) {
        throw Object.assign(
          new Error('canceling statement due to lock timeout'),
          {
            code: '55P03',
          },
        );
      }
    });
    await expect(
      svc.addWithinLimit('u1', 'connectors', async () => undefined),
    ).rejects.toMatchObject({ status: 409 });
  });

  describe('organization members', () => {
    const save = jest.fn(async () => 'added');

    it('allows a third member on Pro and refuses a fourth', async () => {
      billing.resolveUserTier.mockResolvedValue('pro');
      users.count.mockResolvedValue(2);
      await expect(
        svc.addMemberWithinLimit('org-1', 'owner', save),
      ).resolves.toBe('added');
      expect(users.count).toHaveBeenCalledWith({
        where: { organizationId: 'org-1' },
      });
      expect(calls[1]).toBe('lock org:org-1');
      users.count.mockResolvedValue(3);
      save.mockClear();
      const body = await refusal(
        svc.addMemberWithinLimit('org-1', 'owner', save),
      );
      expect(save).not.toHaveBeenCalled();
      expect(body).toMatchObject({
        limit: 3,
        current: 3,
        plan: 'pro',
        upgradeTo: 'business',
      });
    });

    it.each(['business', 'enterprise'])(
      'has no member limit on %s',
      async (plan) => {
        billing.resolveUserTier.mockResolvedValue(plan);
        await expect(
          svc.addMemberWithinLimit('org-1', 'owner', save),
        ).resolves.toBe('added');
        expect(users.count).not.toHaveBeenCalled();
      },
    );
  });

  it('reports pooled usage for the profile', async () => {
    users.findOne.mockResolvedValue({ id: 'u1', organizationId: 'org-1' });
    billing.getResourceCountUserIds.mockResolvedValue(['u1', 'u2']);
    connectors.count.mockResolvedValue(2);
    channels.count.mockResolvedValue(3);
    trusts.count.mockResolvedValue(4);
    await expect(svc.usage('u1')).resolves.toEqual({
      connectors: 2,
      alertChannels: 3,
      githubOidcTrusts: 4,
      orgMembers: 2,
    });
  });

  it('reports no organization members outside an organization', async () => {
    users.findOne.mockResolvedValue({ id: 'u1', organizationId: null });
    expect((await svc.usage('u1')).orgMembers).toBe(0);
  });
});

describe('planLimitMessage', () => {
  it('names what the plan includes and the next plan', () => {
    expect(planLimitMessage('connectors', 'free')).toBe(
      'Connector limit reached: the Starter plan includes 1. Upgrade to Pro for 5.',
    );
    expect(planLimitMessage('githubOidcTrusts', 'pro')).toBe(
      'GitHub trust policy limit reached: the Pro plan includes 10. Upgrade to Business for 50.',
    );
    expect(planLimitMessage('alertChannels', 'business')).toBe(
      'Alert channel limit reached: the Business plan includes 25. Contact us about Enterprise for a higher limit.',
    );
    expect(planLimitMessage('orgMembers', 'pro')).toBe(
      'Organization member limit reached: the Pro plan includes 3. Upgrade to Business to remove the limit.',
    );
  });
});
