# Rate Limiting

KrakenKey uses tier-aware rate limiting to protect the API from abuse while allowing higher throughput for paid subscribers.

## How It Works

- **Authenticated requests** are tracked by user ID (extracted from the JWT)
- **Unauthenticated requests** are tracked by client IP address
- **API key requests** fall back to IP-based tracking
- Limits are enforced per-window (sliding window via Redis)

## Rate Limit Categories

Each API endpoint belongs to one of four categories:

| Category | Description | Example Endpoints |
| --- | --- | --- |
| **public** | Unauthenticated endpoints | `GET /`, `GET /health`, `GET /auth/login`, `GET /auth/callback` |
| **read** | Authenticated read operations | `GET /domains`, `GET /certs/tls`, `GET /auth/profile` |
| **write** | Authenticated mutations | `POST /domains`, `DELETE /domains/:id`, `POST /auth/api-keys` |
| **expensive** | Resource-heavy operations | `POST /certs/tls` (issuance), `POST /certs/tls/:id/renew`, `POST /domains/:id/verify` |

## Limits by Tier

| Category | Free | Starter/Pro ($29) | Team ($79) | Business ($99-199) | Enterprise ($499+) |
| --- | --- | --- | --- | --- | --- |
| **public** | 30/min | 60/min | 60/min | 120/min | 120/min |
| **read** | 60/min | 120/min | 300/min | 600/min | 1000/min |
| **write** | 20/min | 40/min | 60/min | 120/min | 200/min |
| **expensive** | 5/hr | 10/hr | 30/hr | 60/hr | 100/hr |

## Response Headers

Every API response includes rate limit headers:

| Header | Description |
| --- | --- |
| `X-RateLimit-Limit` | Maximum requests allowed in the current window |
| `X-RateLimit-Remaining` | Requests remaining in the current window |
| `X-RateLimit-Reset` | Seconds until the current window resets |

## 429 Too Many Requests

When a rate limit is exceeded, the API returns:

```json
{
  "statusCode": 429,
  "message": "ThrottlerException: Too Many Requests",
  "error": "Too Many Requests",
  "timestamp": "2026-02-17T12:00:00.000Z",
  "path": "/domains"
}
```

The response includes a `Retry-After` header indicating how many seconds to wait before retrying.

## Architecture

Rate limiting is implemented using:

- **`@nestjs/throttler`** — NestJS throttler module
- **Redis** — shared storage for rate limit counters (supports multi-instance deployments)
- **`TierAwareThrottlerGuard`** — custom guard that resolves user tier and applies appropriate limits
- **`TierResolver`** — pluggable interface for determining a user's subscription tier

### Swapping the Tier Resolver

The default tier resolver returns `free` for all users. When a subscription system is implemented, swap the provider in `src/throttler/throttler.module.ts`:

```typescript
// Change:
{ provide: TIER_RESOLVER, useClass: DefaultTierResolver }
// To:
{ provide: TIER_RESOLVER, useClass: SubscriptionTierResolver }
```
