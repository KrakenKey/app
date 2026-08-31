import { getTrustedProxies } from './trusted-proxies';

describe('getTrustedProxies', () => {
  it('returns the built-in defaults when the env override is unset', () => {
    const list = getTrustedProxies(undefined);
    // Local/private proxies (Traefik) must always be present…
    expect(list).toEqual(
      expect.arrayContaining(['loopback', 'linklocal', 'uniquelocal']),
    );
    // …alongside Cloudflare edges (spot-check well-known ranges).
    expect(list).toEqual(
      expect.arrayContaining(['104.16.0.0/13', '2606:4700::/32']),
    );
    // And never a bare hop count.
    expect(list.every((e) => typeof e === 'string')).toBe(true);
  });

  it('treats an empty env override as unset', () => {
    expect(getTrustedProxies('')).toEqual(getTrustedProxies(undefined));
    expect(getTrustedProxies(' , ')).toEqual(getTrustedProxies(undefined));
  });

  it('replaces the defaults with the env override when provided', () => {
    const list = getTrustedProxies('loopback, 10.0.0.0/8');
    expect(list).toEqual(['loopback', '10.0.0.0/8']);
  });
});
