import {
  MARKETPLACE_SUSPENDED_GRACE_DAYS,
  PAST_DUE_GRACE_DAYS,
  entitledSubscriptionSql,
  entitlementSqlParams,
  effectivePlan,
  graceEndsAt,
  hasPlanEntitlement,
  pastDueGraceCutoff,
} from './entitlement';

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-10-12T12:00:00Z');
const since = (days: number) => new Date(now.getTime() - days * DAY);

describe('entitlement', () => {
  it('uses a 14-day grace period', () => {
    expect(PAST_DUE_GRACE_DAYS).toBe(14);
  });

  it('applies the plan while active', () => {
    const sub = { plan: 'business', status: 'active', pastDueSince: null };
    expect(hasPlanEntitlement(sub, now)).toBe(true);
    expect(effectivePlan(sub, now)).toBe('business');
    expect(graceEndsAt(sub)).toBeNull();
  });

  it('applies the plan while past_due inside the grace period', () => {
    const sub = {
      plan: 'business',
      status: 'past_due',
      pastDueSince: since(13),
    };
    expect(effectivePlan(sub, now)).toBe('business');
    expect(graceEndsAt(sub)).toEqual(new Date(since(13).getTime() + 14 * DAY));
  });

  it('ends exactly 14 days after the first failure', () => {
    const sub = {
      plan: 'business',
      status: 'past_due',
      pastDueSince: since(14),
    };
    expect(effectivePlan(sub, now)).toBe('free');
  });

  it('gives no grace when pastDueSince is missing', () => {
    const sub = { plan: 'business', status: 'past_due', pastDueSince: null };
    expect(effectivePlan(sub, now)).toBe('free');
    expect(graceEndsAt(sub)).toBeNull();
  });

  it.each(['unpaid', 'canceled', 'incomplete', 'incomplete_expired'])(
    'treats %s as free',
    (status) => {
      const sub = { plan: 'business', status, pastDueSince: since(1) };
      expect(effectivePlan(sub, now)).toBe('free');
      expect(graceEndsAt(sub)).toBeNull();
    },
  );

  it('reads a legacy plan id written by an older release as its replacement', () => {
    const active = (plan: string) => ({
      plan,
      status: 'active',
      pastDueSince: null,
    });
    expect(effectivePlan(active('starter'), now)).toBe('pro');
    expect(effectivePlan(active('team'), now)).toBe('business');
    expect(effectivePlan(active('gold'), now)).toBe('free');
  });

  it('treats a missing subscription as free', () => {
    expect(effectivePlan(null, now)).toBe('free');
  });

  it('computes the SQL cutoff 14 days back', () => {
    expect(pastDueGraceCutoff(now)).toEqual(since(14));
  });

  describe('Microsoft Marketplace', () => {
    const mp = (status: string, pastDueSince: Date | null = null) => ({
      plan: 'business',
      status,
      pastDueSince,
      source: 'marketplace' as const,
    });

    it('uses a 30-day grace period, matching Microsoft', () => {
      expect(MARKETPLACE_SUSPENDED_GRACE_DAYS).toBe(30);
    });

    it('applies the plan while Subscribed (active)', () => {
      expect(effectivePlan(mp('active'), now)).toBe('business');
    });

    it('keeps the plan while Suspended (past_due) past the Stripe grace', () => {
      const sub = mp('past_due', since(20));
      expect(effectivePlan(sub, now)).toBe('business');
      expect(graceEndsAt(sub)).toEqual(
        new Date(since(20).getTime() + 30 * DAY),
      );
    });

    it('drops to free 30 days after the suspension', () => {
      expect(effectivePlan(mp('past_due', since(30)), now)).toBe('free');
    });

    it('drops to free once Unsubscribed (canceled)', () => {
      expect(effectivePlan(mp('canceled'), now)).toBe('free');
    });

    it('still gives Stripe subscriptions 14 days', () => {
      const sub = { ...mp('past_due', since(20)), source: 'stripe' as const };
      expect(effectivePlan(sub, now)).toBe('free');
    });
  });

  describe('AWS Marketplace subscriptions', () => {
    const aws = (currentPeriodEnd: Date | null, status = 'active') => ({
      plan: 'business',
      status,
      pastDueSince: null,
      source: 'aws_marketplace' as const,
      currentPeriodEnd,
    });
    const hours = (h: number) => new Date(now.getTime() + h * 3600_000);

    it('keeps the plan inside the paid term and its 24-hour grace', () => {
      expect(effectivePlan(aws(hours(240)), now)).toBe('business');
      expect(effectivePlan(aws(hours(-23)), now)).toBe('business');
    });

    it('drops to Starter past the term, even while the row still says active', () => {
      expect(effectivePlan(aws(hours(-25)), now)).toBe('free');
      expect(hasPlanEntitlement(aws(hours(-25)), now)).toBe(false);
    });

    it('gives nothing to a row without a term end', () => {
      expect(effectivePlan(aws(null), now)).toBe('free');
    });

    it('never applies a row that is not active', () => {
      expect(effectivePlan(aws(hours(240), 'canceled'), now)).toBe('free');
    });
  });

  it('binds the cutoffs for the SQL check', () => {
    expect(entitlementSqlParams(now)).toEqual({
      awsTermCutoff: since(1),
      graceCutoff: since(14),
      marketplaceGraceCutoff: since(30),
    });
    const sql = entitledSubscriptionSql('s');
    expect(sql).toContain(
      `s.source = 'marketplace' AND s."pastDueSince" > :marketplaceGraceCutoff`,
    );
    expect(sql).toContain(
      `s.source <> 'marketplace' AND s."pastDueSince" > :graceCutoff`,
    );
    expect(sql).toContain(
      `(s.source <> 'aws_marketplace' OR s."currentPeriodEnd" > :awsTermCutoff) AND`,
    );
  });
});
