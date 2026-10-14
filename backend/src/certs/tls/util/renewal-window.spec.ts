import {
  RENEWAL_RETRY_BACKOFF_MS,
  RENEWAL_RETRY_MIN_BACKOFF_MS,
  certRenewalWindowDays,
  hasRenewalFailure,
  renewAfter,
  renewalRetryAt,
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
    it('is the creation time for an awaiting_csr certificate: due now', () => {
      const createdAt = new Date('2026-10-01T12:00:00.000Z');
      expect(
        renewAfter(
          {
            status: 'awaiting_csr',
            expiresAt: null,
            createdAt,
            managedBy: 'connector',
          },
          30,
        ),
      ).toEqual(createdAt);
      expect(
        renewAfter(
          {
            status: 'awaiting_csr',
            expiresAt: null,
            createdAt: '2026-10-01T12:00:00.000Z',
          },
          30,
        ),
      ).toEqual(createdAt);
    });

    it('is null without an expiry for any other status', () => {
      expect(
        renewAfter(
          { status: 'pending', expiresAt: null, createdAt: new Date() },
          5,
        ),
      ).toBeNull();
    });

    it('is expiry minus the window', () => {
      expect(renewAfter({ status: 'issued', expiresAt }, 5)).toEqual(
        daysBefore(5),
      );
      expect(renewAfter({ status: 'issued', expiresAt }, 30)).toEqual(
        daysBefore(30),
      );
    });

    describe('connector-managed certificates', () => {
      const connector = {
        status: 'issued' as const,
        expiresAt,
        managedBy: 'connector' as const,
      };

      it('take a routine ARI window start when it is earlier', () => {
        const ariWindowStart = daysBefore(40);
        expect(renewAfter({ ...connector, ariWindowStart }, 30)).toEqual(
          ariWindowStart,
        );
      });

      it('take an early-replacement ARI window start too', () => {
        const ariWindowStart = daysBefore(60);
        expect(
          renewAfter(
            {
              ...connector,
              ariWindowStart,
              ariReplacementRequestedAt: daysBefore(61),
            },
            30,
          ),
        ).toEqual(ariWindowStart);
      });

      it('keep the window when the ARI window starts later', () => {
        expect(
          renewAfter({ ...connector, ariWindowStart: daysBefore(20) }, 30),
        ).toEqual(daysBefore(30));
      });
    });

    describe('certificates KrakenKey renews', () => {
      it('ignore a routine ARI window, which the server does not act on', () => {
        expect(
          renewAfter(
            { status: 'issued', expiresAt, ariWindowStart: daysBefore(30) },
            5,
          ),
        ).toEqual(daysBefore(5));
      });

      it('take the ARI window start once the CA asked for early replacement', () => {
        const ariWindowStart = daysBefore(50);
        expect(
          renewAfter(
            {
              status: 'issued',
              expiresAt,
              ariWindowStart,
              ariReplacementRequestedAt: daysBefore(51),
            },
            30,
          ),
        ).toEqual(ariWindowStart);
      });

      it('keep the window when an early-replacement window starts later', () => {
        expect(
          renewAfter(
            {
              status: 'issued',
              expiresAt,
              ariWindowStart: daysBefore(3),
              ariReplacementRequestedAt: daysBefore(4),
            },
            5,
          ),
        ).toEqual(daysBefore(5));
      });
    });

    it('accepts ISO strings', () => {
      expect(
        renewAfter(
          {
            expiresAt: expiresAt.toISOString(),
            ariWindowStart: daysBefore(40).toISOString(),
            ariReplacementRequestedAt: daysBefore(41).toISOString(),
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

    it('waits the retry backoff after a failed renewal', () => {
      const failedAt = daysBefore(10);
      expect(
        renewAfter(
          { status: 'issued', expiresAt, renewalFailedAt: failedAt },
          30,
        ),
      ).toEqual(new Date(failedAt.getTime() + RENEWAL_RETRY_BACKOFF_MS));
    });

    it('ignores an old failure once the window is later anyway', () => {
      expect(
        renewAfter(
          { status: 'issued', expiresAt, renewalFailedAt: daysBefore(60) },
          30,
        ),
      ).toEqual(daysBefore(30));
    });
  });

  describe('renewalRetryAt', () => {
    const HOUR = 3_600_000;
    const failedAt = new Date('2026-10-14T06:03:00.000Z');
    const after = (hoursLeft: number, extra = {}) =>
      (renewalRetryAt({
        renewalFailedAt: failedAt.toISOString(),
        expiresAt: new Date(failedAt.getTime() + hoursLeft * HOUR),
        ...extra,
      })!.getTime() -
        failedAt.getTime()) /
      HOUR;

    it('is null when the last renewal did not fail', () => {
      expect(renewalRetryAt({ renewalFailedAt: null })).toBeNull();
    });

    it('waits 20 hours with plenty of time left', () => {
      expect(after(30 * 24)).toBe(20);
      expect(after(80)).toBe(20);
    });

    it('waits a quarter of the time left near the deadline', () => {
      expect(after(24)).toBe(6);
      expect(after(12)).toBe(3);
    });

    it('waits at least 2 hours, even past the deadline', () => {
      expect(after(8)).toBe(2);
      expect(after(1)).toBe(2);
      expect(after(-5)).toBe(2);
      expect(RENEWAL_RETRY_MIN_BACKOFF_MS).toBe(2 * HOUR);
    });

    it('uses the end of an early-replacement window when it comes first', () => {
      const windowEnd = new Date(failedAt.getTime() + 24 * HOUR);
      expect(
        after(30 * 24, {
          ariReplacementRequestedAt: failedAt,
          ariWindowEnd: windowEnd,
        }),
      ).toBe(6);
      // A routine window (no replacement requested) doesn't count
      expect(after(30 * 24, { ariWindowEnd: windowEnd })).toBe(20);
    });

    it('ignores a failure older than the last successful renewal', () => {
      expect(
        hasRenewalFailure({
          renewalFailedAt: failedAt,
          lastRenewedAt: new Date(failedAt.getTime() + HOUR),
        }),
      ).toBe(false);
      expect(
        renewalRetryAt({
          renewalFailedAt: failedAt,
          lastRenewedAt: new Date(failedAt.getTime() + HOUR),
        }),
      ).toBeNull();
      expect(
        hasRenewalFailure({
          renewalFailedAt: failedAt,
          lastRenewedAt: new Date(failedAt.getTime() - HOUR),
        }),
      ).toBe(true);
    });
  });
});
