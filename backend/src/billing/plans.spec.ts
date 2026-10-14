import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  PLAN_LABELS,
  PLAN_LIMITS,
  PLAN_ORDER,
  SUBSCRIPTION_PLANS,
  canHaveOrganization,
  nextPlan,
  normalizePlan,
  planLabel,
} from '@krakenkey/shared';
import { CreateCheckoutDto } from './dto/create-checkout.dto';
import { UpgradePlanDto } from './dto/upgrade-plan.dto';
import { RATE_LIMIT_TIERS } from '../throttler/config/rate-limit-tiers.config';
import { RenamePlansToProAndBusiness1791600000000 } from '../migrations/1791600000000-RenamePlansToProAndBusiness';
import { planLimitReachedTemplate } from '../notifications/templates';
import { AddSubscriptionBillingInterval1791700000000 } from '../migrations/1791700000000-AddSubscriptionBillingInterval';

describe('plans', () => {
  it('has four plan ids, cheapest first', () => {
    expect(SUBSCRIPTION_PLANS).toEqual([
      'free',
      'pro',
      'business',
      'enterprise',
    ]);
    expect(Object.keys(PLAN_LIMITS)).toEqual([...SUBSCRIPTION_PLANS]);
    expect(
      [...SUBSCRIPTION_PLANS].sort((a, b) => PLAN_ORDER[a] - PLAN_ORDER[b]),
    ).toEqual([...SUBSCRIPTION_PLANS]);
  });

  describe('labels', () => {
    it('shows the free plan as Starter', () => {
      expect(PLAN_LABELS.free).toBe('Starter');
      expect(planLabel('free')).toBe('Starter');
    });

    it('labels the paid plans', () => {
      expect(planLabel('pro')).toBe('Pro');
      expect(planLabel('business')).toBe('Business');
      expect(planLabel('enterprise')).toBe('Enterprise');
    });

    it('labels legacy and unknown ids by the plan they read as', () => {
      expect(planLabel('starter')).toBe('Pro');
      expect(planLabel('team')).toBe('Business');
      expect(planLabel('nope')).toBe('Starter');
      expect(planLabel(null)).toBe('Starter');
    });
  });

  it('suggests Pro, then Business, then Enterprise', () => {
    expect(nextPlan('free')).toBe('pro');
    expect(nextPlan('pro')).toBe('business');
    expect(nextPlan('business')).toBe('enterprise');
    expect(nextPlan('enterprise')).toBeNull();
    expect(nextPlan('starter')).toBe('business');
  });

  it('gives organizations to Pro and up', () => {
    expect(canHaveOrganization('free')).toBe(false);
    expect(canHaveOrganization('pro')).toBe(true);
    expect(canHaveOrganization('business')).toBe(true);
    expect(canHaveOrganization('enterprise')).toBe(true);
  });

  describe('normalizePlan', () => {
    it('keeps current ids', () => {
      for (const plan of SUBSCRIPTION_PLANS) {
        expect(normalizePlan(plan)).toBe(plan);
      }
    });

    it('maps starter to pro and team to business', () => {
      expect(normalizePlan('starter')).toBe('pro');
      expect(normalizePlan('team')).toBe('business');
    });

    it('reads anything else as free', () => {
      expect(normalizePlan('gold')).toBe('free');
      expect(normalizePlan('')).toBe('free');
      expect(normalizePlan(undefined)).toBe('free');
    });
  });

  // The table the plans were priced on; a change here is a pricing change.
  it.each([
    ['domains', 3, 15, 100, Infinity],
    ['totalActiveCerts', 10, 150, 1000, Infinity],
    ['certsPerMonth', 5, 100, 1000, Infinity],
    ['concurrentPending', 2, 10, 50, Infinity],
    ['renewalWindowDays', 10, 30, 30, 30],
    ['monitoredEndpoints', 3, 50, 300, Infinity],
    ['hostedMonitoredEndpoints', 1, 25, 150, Infinity],
    ['hostedProbeRegions', 1, Infinity, Infinity, Infinity],
    ['hostedScanInterval', 60, 30, 5, 1],
    ['minScanInterval', 60, 15, 1, 1],
    ['scanResultRetentionDays', 7, 30, 90, 90],
    ['reportHosts', 25, 250, 1000, 1000],
    ['apiKeys', 2, 10, 50, Infinity],
    // Enterprise: backstops, not unlimited
    ['connectors', 1, 5, 50, 1000],
    ['alertChannels', 1, 5, 25, 500],
    ['githubOidcTrusts', 2, 10, 50, 1000],
    ['orgMembers', 1, 3, Infinity, Infinity],
  ] as const)(
    '%s is %s / %s / %s / %s',
    (key, free, pro, business, enterprise) => {
      expect(PLAN_LIMITS.free[key]).toBe(free);
      expect(PLAN_LIMITS.pro[key]).toBe(pro);
      expect(PLAN_LIMITS.business[key]).toBe(business);
      expect(PLAN_LIMITS.enterprise[key]).toBe(enterprise);
    },
  );

  it('has a rate limit row for every plan, Pro on the former Team numbers', () => {
    expect(Object.keys(RATE_LIMIT_TIERS).sort()).toEqual(
      [...SUBSCRIPTION_PLANS].sort(),
    );
    expect(RATE_LIMIT_TIERS.pro.read.limit).toBe(300);
    expect(RATE_LIMIT_TIERS.pro.write.limit).toBe(60);
    expect(RATE_LIMIT_TIERS.pro.expensive.limit).toBe(30);
  });

  describe('checkout and upgrade bodies', () => {
    it.each([CreateCheckoutDto, UpgradePlanDto])(
      '%p accepts the paid plans and reads legacy ids as their replacement',
      async (Dto) => {
        for (const [input, plan] of [
          ['pro', 'pro'],
          ['business', 'business'],
          ['starter', 'pro'],
          ['team', 'business'],
        ]) {
          const dto = plainToInstance(Dto, { plan: input });
          expect(await validate(dto)).toHaveLength(0);
          expect(dto.plan).toBe(plan);
        }
      },
    );

    it.each([CreateCheckoutDto, UpgradePlanDto])(
      '%p refuses free and unknown plans',
      async (Dto) => {
        for (const input of ['free', 'gold', '']) {
          const dto = plainToInstance(Dto, { plan: input });
          expect(await validate(dto)).not.toHaveLength(0);
        }
      },
    );
  });
});

describe('RenamePlansToProAndBusiness migration', () => {
  function runner() {
    const queries: string[] = [];
    return {
      queries,
      query: jest.fn(async (sql: string) => {
        queries.push(sql);
        return [];
      }),
    };
  }

  it('maps starter to pro and team to business, under a lock timeout', async () => {
    const qr = runner();
    await new RenamePlansToProAndBusiness1791600000000().up(qr as any);
    expect(qr.queries[0]).toBe(`SET LOCAL lock_timeout = '5s'`);
    expect(qr.queries).toContain(
      `UPDATE "subscription" SET "plan" = 'pro' WHERE "plan" = 'starter'`,
    );
    expect(qr.queries).toContain(
      `UPDATE "subscription" SET "plan" = 'business' WHERE "plan" = 'team'`,
    );
    // Data only: nothing the previous release depends on changes shape
    expect(qr.queries.join('\n')).not.toMatch(/ALTER|DROP|CREATE|DELETE/i);
  });

  it('only moves pro back on revert', async () => {
    const qr = runner();
    await new RenamePlansToProAndBusiness1791600000000().down(qr as any);
    expect(qr.queries).toEqual([
      `SET LOCAL lock_timeout = '5s'`,
      `UPDATE "subscription" SET "plan" = 'starter' WHERE "plan" = 'pro'`,
    ]);
  });
});

describe('plan names in emails', () => {
  const brand = { appUrl: 'https://app.krakenkey.io', logoUrl: 'x' };

  it('calls the free plan Starter in the plan limit email', () => {
    const { text } = planLimitReachedTemplate(
      {
        username: 'u',
        email: 'u@example.com',
        plan: 'free',
        resourceType: 'domains',
        current: 3,
        limit: 3,
      },
      brand,
    );
    expect(text).toContain('your Starter plan has reached its limit');
    expect(text).not.toMatch(/\bFree\b/);
  });
});

describe('AddSubscriptionBillingInterval migration', () => {
  it('only adds a nullable column, under a lock timeout', async () => {
    const queries: string[] = [];
    const qr = {
      query: jest.fn(async (sql: string) => {
        queries.push(sql);
        return [];
      }),
    };
    await new AddSubscriptionBillingInterval1791700000000().up(qr as any);
    expect(queries[0]).toBe(`SET LOCAL lock_timeout = '5s'`);
    const sql = queries.join('\n');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "billingInterval"');
    expect(sql).not.toMatch(/NOT NULL|DEFAULT|UPDATE/);
  });
});
