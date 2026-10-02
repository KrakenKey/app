# Rate Limiting

The KrakenKey API applies tier-aware rate limits through a global NestJS guard. Limits vary by **subscription tier** and by **request category**, so a single numeric "requests per minute" figure does not describe the behavior.

Implementation lives in `backend/src/throttler/`.

---

## Limits by tier and category

| Tier | Public | Reads | Writes | Expensive |
|------|--------|-------|--------|-----------|
| free | 30/min | 60/min | 20/min | 5/hr |
| starter | 60/min | 120/min | 40/min | 10/hr |
| team | 60/min | 300/min | 60/min | 30/hr |
| business | 120/min | 600/min | 120/min | 60/hr |
| enterprise | 120/min | 1000/min | 200/min | 100/hr |

Source of truth: `backend/src/throttler/config/rate-limit-tiers.config.ts`. Update the table above and the one in the KrakenKey monorepo's `AGENTS.md` whenever that file changes.

Each limit applies **per route**, not across the API. See [Tracking key](#tracking-key).

`PUBLIC` routes are always limited per IP at the `free` row, because the caller's tier can only come from an unverified token there. The higher Public values for paid tiers are currently unused.

---

## Categories

Defined in `interfaces/rate-limit-category.enum.ts`:

| Category | Enum value | Covers |
|----------|-----------|--------|
| `public` | `PUBLIC` | Unauthenticated endpoints: `/`, `/health`, the login, registration and OAuth callback routes under `/auth`, `POST /public-scan` |
| `read` | `AUTHENTICATED_READ` | Authenticated reads: list domains, view certificates, endpoint history |
| `write` | `AUTHENTICATED_WRITE` | Authenticated mutations: create domain, delete certificate, update endpoint |
| `expensive` | `EXPENSIVE` | Resource-heavy operations: certificate issuance, renewal, retry, revocation, domain verification |

`AuthController` is `PUBLIC` at the class level, but its authenticated routes (profile, API keys, `confirm-auto-renewal`) override that with `AUTHENTICATED_READ` or `AUTHENTICATED_WRITE`.

A route declares its category with `@RateLimitCategoryDecorator()`, read from the handler first and then the controller:

```ts
import { RateLimitCategoryDecorator } from '../throttler/decorators/rate-limit-category.decorator';
import { RateLimitCategory } from '../throttler/interfaces/rate-limit-category.enum';

@Post()
@RateLimitCategoryDecorator(RateLimitCategory.EXPENSIVE)
create(@Request() req: RequestWithUser, @Body() createTlsCrtDto: CreateTlsCrtDto) { /* ... */ }
```

**Undecorated routes fall back to an inference from the HTTP method**: `GET`, `HEAD` and `OPTIONS` are treated as `read`, and everything else as `write`. A new expensive endpoint that forgets the decorator is therefore limited as an ordinary write, so decorate expensive handlers explicitly.

---

## Tier resolution

`TierAwareThrottlerGuard` resolves the caller's tier per request via the `TIER_RESOLVER` token, bound to `SubscriptionTierResolver` (`backend/src/billing/services/subscription-tier-resolver.service.ts`), which delegates to `BillingService.resolveUserTier()`.

If the billing lookup throws, `SubscriptionTierResolver` logs a warning and returns `free`, the most restrictive tier. The guard has its own catch with the same fallback, but the resolver never rethrows, so in practice it is not reached. Either way, a billing or database outage tightens limits rather than removing them.

> `DefaultTierResolver` in `throttler/services/` returns `free` unconditionally and is **not** wired in `throttler.module.ts`. It exists as a drop-in for environments without billing.

---

## Tracking key

`getTracker()` keys buckets by identity where it can, and by IP otherwise:

| Caller | Tracker |
|--------|---------|
| Bearer JWT, non-`PUBLIC` route | `user:<sub>` |
| Bearer JWT, `PUBLIC` route | client IP |
| API key (`Bearer kk_...`) | client IP |
| Unauthenticated | client IP |

The guard does not override `generateKey()`, so the library default applies: the stored key is a hash of the controller name, the handler name and the tracker. **Every route has its own bucket.** A free-tier user gets 5 issuances per hour *and* 5 renewals per hour *and* 5 domain verifications per hour, and being blocked on one route does not block the others.

Details that matter when changing this code:

- **The guard runs as `APP_GUARD`, before the auth guards.** To key by user it decodes the JWT payload without verifying the signature, so the `sub` it uses is unauthenticated and must never be treated as identity.
- **`PUBLIC` routes ignore the token entirely** and always key by IP at the default tier. Nothing on those routes rejects a forged token, so trusting its `sub` would let a caller send a different one per request and get a fresh bucket each time. On authenticated routes this is safe because `JwtOrApiKeyGuard` rejects a forged token after the throttler has counted it.
- **API key requests key by IP**, because resolving the owning user from a `kk_` token needs a database lookup the guard does not perform. Several API keys behind one NAT therefore share a bucket. This is the main reason a customer may report limits stricter than their tier's table row.
- `req.ip` is used, never `req.ips[0]`. `req.ip` resolves the client through the trusted proxy chain (`backend/src/config/trusted-proxies.ts`); the leftmost `X-Forwarded-For` entry is client-controlled and forgeable, so keying on it would let a caller mint unlimited buckets.

---

## Storage

Counters live in Redis via `@nest-lab/throttler-storage-redis`, under the key prefix `throttle:`, on the connection configured by `KK_BULLMQ_HOST`, `KK_BULLMQ_PORT` and `KK_BULLMQ_PASSWORD`. Limits are shared across API replicas because the store is shared; restarting an API pod does not reset a caller's counter.

Windows are **fixed**, not sliding: the hit counter's expiry is set on the first request of a window and is not extended by later ones. Once a caller exceeds the limit, a separate block key is set for `blockDuration`, counted from that moment. The guard passes the category TTL as `blockDuration` (which is also the library default), so a caller who goes over a limit is blocked for one full window from the request that exceeded it, regardless of how much of the original window was left.

Because the guard is global and runs before every controller, a Redis outage fails every throttled request, including `GET /metrics`.

---

## Client behavior

An exceeded limit returns **`429 Too Many Requests`** with a `Retry-After` header giving the seconds until the block lifts. Allowed responses carry `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset` (seconds until the current window resets).

Clients should back off rather than retry immediately. Expensive-category windows are hourly, so a tight retry loop on a failed issuance will stay blocked for up to an hour.

For the plan limits that cap resource *totals* (domains, certificates per month, monitored endpoints) rather than request rates, see the Plan Limits table in the KrakenKey monorepo's `AGENTS.md`. Those are enforced separately from this guard.

---

## Testing

```bash
cd backend
yarn test throttler
```

`guards/tier-aware-throttler.guard.spec.ts` covers category resolution, tier lookup and tracker selection. When adding a tier, update `RATE_LIMIT_TIERS` and extend the guard spec. The config is a plain record, so a missing tier silently falls back to `free` via `RATE_LIMIT_TIERS[tier] ?? RATE_LIMIT_TIERS[DEFAULT_TIER]`.
