import {
  certRenewalWindowDays,
  renewAfter,
  renewalWindowDays,
} from './renewal-window';

const DAY = 86_400_000;
const expiresAt = new Date('2027-01-31T00:00:00.000Z');
const daysBefore = (days: number) => new Date(expiresAt.getTime() - days * DAY);

describe('renewal window', () => {
  describe('certRenewalWindowDays', () => {
    it('uses the plan window for certificates KrakenKey renews', () => {
      expect(certRenewalWindowDays('free', null)).toBe(
        renewalWindowDays('free'),
      );
      expect(certRenewalWindowDays('free', null)).toBe(5);
      expect(certRenewalWindowDays('team', undefined)).toBe(30);
    });

    it('gives connector-managed certificates at least 30 days', () => {
      expect(certRenewalWindowDays('free', 'connector')).toBe(30);
      expect(certRenewalWindowDays('business', 'connector')).toBe(30);
    });

    it('falls back to the free window for an unknown plan', () => {
      expect(certRenewalWindowDays('nope', null)).toBe(5);
      expect(certRenewalWindowDays('nope', 'connector')).toBe(30);
    });
  });

  describe('renewAfter', () => {
    it('is expiry minus the window', () => {
      expect(renewAfter({ status: 'issued', expiresAt }, 5)).toEqual(
        daysBefore(5),
      );
      expect(renewAfter({ status: 'issued', expiresAt }, 30)).toEqual(
        daysBefore(30),
      );
    });

    it('takes the ARI window start when it is earlier', () => {
      const ariWindowStart = daysBefore(40);
      expect(
        renewAfter({ status: 'issued', expiresAt, ariWindowStart }, 30),
      ).toEqual(ariWindowStart);
    });

    it('ignores an ARI window that starts later than the plan window', () => {
      expect(
        renewAfter(
          { status: 'issued', expiresAt, ariWindowStart: daysBefore(20) },
          30,
        ),
      ).toEqual(daysBefore(30));
    });

    it('accepts ISO strings', () => {
      expect(
        renewAfter(
          {
            expiresAt: expiresAt.toISOString(),
            ariWindowStart: daysBefore(40).toISOString(),
          },
          30,
        ),
      ).toEqual(daysBefore(40));
    });

    it('is null without an expiry (not issued yet)', () => {
      expect(renewAfter({ status: 'pending', expiresAt: null }, 30)).toBeNull();
    });

    it('is null for a revoked certificate', () => {
      expect(renewAfter({ status: 'revoked', expiresAt }, 30)).toBeNull();
      expect(renewAfter({ status: 'revoking', expiresAt }, 30)).toBeNull();
    });
  });
});
