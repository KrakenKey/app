import {
  PAST_DUE_GRACE_DAYS,
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
    const sub = { plan: 'team', status: 'active', pastDueSince: null };
    expect(hasPlanEntitlement(sub, now)).toBe(true);
    expect(effectivePlan(sub, now)).toBe('team');
    expect(graceEndsAt(sub)).toBeNull();
  });

  it('applies the plan while past_due inside the grace period', () => {
    const sub = { plan: 'team', status: 'past_due', pastDueSince: since(13) };
    expect(effectivePlan(sub, now)).toBe('team');
    expect(graceEndsAt(sub)).toEqual(new Date(since(13).getTime() + 14 * DAY));
  });

  it('ends exactly 14 days after the first failure', () => {
    const sub = { plan: 'team', status: 'past_due', pastDueSince: since(14) };
    expect(effectivePlan(sub, now)).toBe('free');
  });

  it('gives no grace when pastDueSince is missing', () => {
    const sub = { plan: 'team', status: 'past_due', pastDueSince: null };
    expect(effectivePlan(sub, now)).toBe('free');
    expect(graceEndsAt(sub)).toBeNull();
  });

  it.each(['unpaid', 'canceled', 'incomplete', 'incomplete_expired'])(
    'treats %s as free',
    (status) => {
      const sub = { plan: 'team', status, pastDueSince: since(1) };
      expect(effectivePlan(sub, now)).toBe('free');
      expect(graceEndsAt(sub)).toBeNull();
    },
  );

  it('treats a missing subscription as free', () => {
    expect(effectivePlan(null, now)).toBe('free');
  });

  it('computes the SQL cutoff 14 days back', () => {
    expect(pastDueGraceCutoff(now)).toEqual(since(14));
  });
});
