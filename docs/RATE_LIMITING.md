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

Source of truth: `backend/src/throttler/config/rate-limit-tiers.config.ts`. Update the table above and the one in the repository-root `AGENTS.md` whenever that file changes.

---

## Categories

Defined in `interfaces/rate-limit-category.enum.ts`:

| Category | Enum value | Covers |
|----------|-----------|--------|
| `public` | `PUBLIC` | Unauthenticated endpoints — `/`, `/health`, `/auth/*`, `POST /public/scan` |
| `read` | `AUTHENTICATED_READ` | Authenticated reads — list domains, view certificates, endpoint history |
| `write` | `AUTHENTICATED_WRITE` | Authenticated mutations — create domain, delete certificate, update endpoint |
| `expensive` | `EXPENSIVE` | Resource-heavy operations — certificate issuance, renewal, retry, revocation, domain verification |

A route declares its category with the `@RateLimitCategory()` decorator, read from the handler first and then the controller:

```ts
import { RateLimitCategoryDecorator as RateLimitCategory } from '../throttler/decorators/rate-limit-category.decorator';
import { RateLimitCategory as Category } from '../throttler/interfaces/rate-limit-category.enum';

@Post('tls')
@RateLimitCategory(Category.EXPENSIVE)
async issueCert(@Body() dto: CreateTlsCertDto) { /* ... */ }
```

**Undecorated routes fall back to an inference from the HTTP method**: `GET`, `HEAD` and `OPTIONS` are treated as `read`, and everything else as `write`. A new expensive endpoint that forgets the decorator is therefore limited as an ordinary write — decorate expensive handlers explicitly.

---

## Tier resolution

`TierAwareThrottlerGuard` resolves the caller's tier per request via the `TIER_RESOLVER` token, bound to `SubscriptionTierResolver` (`backend/src/billing/services/subscription-tier-resolver.service.ts`), which delegates to `BillingService.resolveUserTier()`.

If tier resolution throws, the guard logs a warning and falls back to `free` — the most restrictive tier. A billing or database outage therefore tightens limits rather than removing them.

> `DefaultTierResolver` in `throttler/services/` returns `free` unconditionally and is **not** wired in `throttler.module.ts`. It exists as a drop-in for environments without billing.

---

## Tracking key

`getTracker()` keys buckets by identity where it can, and by IP otherwise:

| Caller | Bucket key |
|--------|-----------|
| JWT-authenticated | `user:<sub>` |
| API key (`Bearer kk_...`) | client IP |
| Unauthenticated | client IP |

Two details matter when changing this code:

- **The guard runs as `APP_GUARD`, before the auth guards.** To key by user it decodes the JWT payload without verifying the signature. That is safe for rate limiting specifically — a forged token only moves the attacker into a different bucket, and `JwtOrApiKeyGuard` still rejects it afterwards — but the decoded `sub` must never be treated as authenticated identity.
- **API key requests key by IP**, because resolving the owning user from a `kk_` token needs a database lookup the guard does not perform. Several API keys behind one NAT therefore share a bucket. This is the main reason a customer may report limits stricter than their tier's table row.
- `req.ip` is used, never `req.ips[0]`. `req.ip` resolves the client through the trusted proxy chain (`backend/src/config/trusted-proxies.ts`); the leftmost `X-Forwarded-For` entry is client-controlled and forgeable, so keying on it would let a caller mint unlimited buckets.

---

## Storage

Counters live in Redis via `@nest-lab/throttler-storage-redis`, under the key prefix `throttle:`, on the connection configured by `KK_BULLMQ_HOST`, `KK_BULLMQ_PORT` and `KK_BULLMQ_PASSWORD`. Limits are shared across API replicas because the store is shared; restarting an API pod does not reset a caller's counter.

`blockDuration` equals the category TTL, so a caller that exceeds a limit stays blocked for the remainder of that window rather than being let through as soon as the oldest request ages out.

---

## Client behavior

An exceeded limit returns **`429 Too Many Requests`**. Clients should back off rather than retry immediately; expensive-category windows are hourly, so a tight retry loop on a failed issuance will stay blocked for up to an hour.

For the plan limits that cap resource *totals* (domains, certificates per month, monitored endpoints) rather than request rates, see the Plan Limits table in the repository-root `AGENTS.md` — those are enforced separately from this guard.

---

## Testing

```bash
cd backend
npm test -- throttler
```

`guards/tier-aware-throttler.guard.spec.ts` covers category resolution, tier lookup and tracker selection. When adding a tier, update `RATE_LIMIT_TIERS` and extend the guard spec — the config is a plain record, so a missing tier silently falls back to `free` via `RATE_LIMIT_TIERS[tier] ?? RATE_LIMIT_TIERS[DEFAULT_TIER]`.
