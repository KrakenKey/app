import { describe, expect, it } from 'vitest';
import { getKeyExpiry } from '../expiration';

const NOW = Date.parse('2026-10-11T12:00:00.000Z');
const inDays = (d: number) => new Date(NOW + d * 86_400_000).toISOString();

describe('getKeyExpiry', () => {
  it('says Never, uncolored, for keys without an expiry', () => {
    expect(getKeyExpiry(null, NOW)).toEqual({
      label: 'Never',
      days: null,
      tone: 'muted',
    });
  });

  it('only colors keys with 30 days or less left', () => {
    expect(getKeyExpiry(inDays(265.5), NOW)).toMatchObject({
      days: '265d',
      tone: 'muted',
    });
    expect(getKeyExpiry(inDays(30.5), NOW)).toMatchObject({
      days: '30d',
      tone: 'warning',
    });
    expect(getKeyExpiry(inDays(9.5), NOW)).toMatchObject({
      days: '9d',
      tone: 'warning',
    });
    expect(getKeyExpiry(inDays(3.5), NOW)).toMatchObject({
      days: '3d',
      tone: 'danger',
    });
    expect(getKeyExpiry(inDays(-2), NOW)).toMatchObject({
      days: 'expired',
      tone: 'danger',
    });
  });
});
