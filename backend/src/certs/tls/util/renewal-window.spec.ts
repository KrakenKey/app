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
  });
});
