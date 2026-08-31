/**
 * Trusted proxy configuration for Express's `trust proxy` setting.
 *
 * Why not `trust proxy: 1` (hop count): production traffic is
 * client → Cloudflare → Traefik → app, i.e. two proxy hops. Trusting one
 * hop resolves `req.ip` to a Cloudflare *edge* IP, so everything keyed on
 * client IP (tier throttler, API-key lockout) buckets unrelated users
 * together and lets an attacker dilute counters across edge IPs. Trusting
 * a fixed hop count of two is also wrong: anyone who reaches the origin
 * directly (bypassing Cloudflare) could then spoof X-Forwarded-For.
 *
 * Trusting an explicit address list solves both: `req.ip` becomes the
 * first address (walking socket → XFF right-to-left) that is NOT a known
 * proxy. A direct-to-origin caller's own address is untrusted, so their
 * spoofed XFF entries are never consulted.
 *
 * Cloudflare ranges below are from https://www.cloudflare.com/ips
 * (fetched 2026-07-06; they change rarely). Override the entire list with
 * KK_TRUSTED_PROXIES (comma-separated CIDRs/addresses/keywords) if they
 * rotate or the topology changes.
 */

/** https://www.cloudflare.com/ips-v4 */
const CLOUDFLARE_IPV4 = [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
];

/** https://www.cloudflare.com/ips-v6 */
const CLOUDFLARE_IPV6 = [
  '2400:cb00::/32',
  '2606:4700::/32',
  '2803:f800::/32',
  '2405:b500::/32',
  '2405:8100::/32',
  '2a06:98c0::/29',
  '2c0f:f248::/32',
];

/**
 * Default trust list: local/private addresses cover Traefik (docker
 * networks in dev, private subnets in prod) plus Cloudflare's edges.
 * 'loopback', 'linklocal' and 'uniquelocal' are express/proxy-addr
 * keywords (uniquelocal = RFC 1918 + fc00::/7).
 */
const DEFAULT_TRUSTED_PROXIES = [
  'loopback',
  'linklocal',
  'uniquelocal',
  ...CLOUDFLARE_IPV4,
  ...CLOUDFLARE_IPV6,
];

/**
 * Resolves the trusted proxy list, honouring the KK_TRUSTED_PROXIES
 * override (comma-separated). Empty/unset env → built-in defaults.
 */
export function getTrustedProxies(env?: string): string[] {
  const fromEnv = (env ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return fromEnv.length > 0 ? fromEnv : DEFAULT_TRUSTED_PROXIES;
}
