# Backend Architecture

## System Overview

KrakenKey is a modular NestJS backend for TLS certificate lifecycle management, endpoint monitoring, and team collaboration.

```
┌──────────────────────────────────────────────────────────────────┐
│                        KrakenKey Backend                         │
├──────────┬──────────┬──────────┬──────────┬──────────┬──────────┤
│   Auth   │  Certs   │ Domains  │ Billing  │   Orgs   │Endpoints │
│  Module  │  Module  │  Module  │  Module  │  Module  │  Module  │
└────┬─────┴────┬─────┴────┬─────┴────┬─────┴────┬─────┴────┬─────┘
     │          │          │          │          │          │
┌────▼───┐ ┌───▼────┐ ┌───▼──┐ ┌────▼───┐ ┌───▼──┐ ┌────▼────┐
│Authentik│ │  ACME  │ │ DNS  │ │ Stripe │ │  DB  │ │ Probes  │
│ (OIDC) │ │ (LE)   │ │ (CF/ │ │        │ │      │ │         │
│        │ │        │ │ R53) │ │        │ │      │ │         │
└────────┘ └────────┘ └──────┘ └────────┘ └──────┘ └─────────┘
                          │
                    ┌─────┴──────┐
                    │            │
              ┌─────▼──┐  ┌─────▼──┐
              │  Redis │  │Postgres│
              │(BullMQ)│  │(TypeORM│
              └────────┘  └────────┘
```

## Module Hierarchy

### Root Module (AppModule)

**File**: `src/app.module.ts`

**Imports**:
- `ConfigModule` — Global environment variable loading
- `TypeOrmModule` — PostgreSQL connection with auto-running migrations
- `BullModule` — Redis-backed job queue
- `ScheduleModule` — Enables `@Cron` decorators globally
- `AuthModule` — Authentication and OIDC
- `UsersModule` — User management
- `DomainsModule` — Domain verification
- `CertsModule` — Certificate management
- `BillingModule` — Stripe subscriptions and plan limits
- `OrganizationsModule` — Team management
- `EndpointsModule` — TLS endpoint monitoring
- `ConnectorsModule` — Customer-hosted connectors: enrollment, Ed25519-signed key exchange, revocation
- `HealthModule` — Health checks
- `MetricsModule` — Prometheus metrics
- `NotificationsModule` — Email notifications, plus Slack, Teams and webhook channels (`notifications` BullMQ queue, `AlertsService.emit`)
- `FeedbackModule` — User feedback
- `ProbesModule` — Kubernetes probes
- `ThrottlerModule` — Rate limiting

**Global Guards**:
- `RoleGuard` — Enforces role-based access control on all routes

---

### Auth Module

**File**: `src/auth/auth.module.ts`

Handles authentication via Authentik OIDC, JWT validation, and API key management.

**Providers**:
- `AuthService` — OIDC flows, API key CRUD, profile management, service key seeding
- `JwtStrategy` — Validates Authentik JWTs via JWKS (RS256)
- `ApiKeyStrategy` — Validates `kk_*` bearer tokens via scrypt hash lookup
- `ServiceKeyStrategy` — Validates `kk_svc_*` service tokens
- `DeviceAuthService` — CLI browser login (`krakenkey auth login --web`), see below

**Guards**:
- `JwtOrApiKeyGuard` — Tries JWT first, falls back to API key
- `AdminGuard` — Checks Authentik `groups` for admin membership

**Key behaviors**:
- JIT user provisioning on first OIDC callback
- API keys hashed with scrypt using `KK_HMAC_SECRET` as salt
- Deleting a user API key revokes it (`revokedAt`); revoked rows are purged daily after 30 days. Successful key auth records `lastUsedAt`/`lastUsedIp`, written at most once a minute per key unless the IP changes
- Service key auto-seeded from `KK_PROBE_API_KEY` env var on startup

**CLI browser login (device flow)**, modelled on RFC 8628:

1. The CLI calls `POST /auth/device/code` (no auth) and gets a 256-bit device code plus an 8-character user code such as `BCDF-GHJK`, and a link to `https://<KK_APP_DOMAIN>/device?code=...`.
2. The user opens the link while signed in to the dashboard. The page shows the user code, client name, requesting IP and age (`GET /auth/device/:userCode`), and the user approves or denies.
3. Approval (`POST /auth/device/approve`) checks the plan's API key limit, so a full plan shows a 402 on the page, and records who approved. It does not create a key.
4. The CLI polls `POST /auth/device/token` every `interval` seconds. The poll that finds the request approved removes it with `GETDEL` and creates a normal `kk_` API key named `CLI login: <client>` for the approving user through `AuthService.createApiKey`, then returns it. Later polls return `expired`.

Approve, deny and lookup require a dashboard (JWT) session; an API key gets 403, so a key can't mint further keys without a person. State lives in Redis under `device-auth:` with a 10-minute TTL. Device codes are stored as SHA-256 hashes, and no API key is ever written to Redis: the raw key exists only in the poll response, as with `POST /auth/api-keys`. Unlike API key lockout, the flow fails closed when Redis is unavailable.

---

### Users Module

**File**: `src/users/users.module.ts`

**Providers**:
- `UsersService` — CRUD operations
- `AccountDeletionService` — Cascading account deletion (revokes certs, deletes domains, anonymizes feedback)

---

### Domains Module

**File**: `src/domains/domains.module.ts`

**Providers**:
- `DomainsService` — Domain registration, DNS TXT verification, plan limit enforcement
- `DomainsController` — REST endpoints
- `DomainMonitorService` — Daily re-verification cron

**Key behaviors**:
- Generates unique verification codes on domain creation
- Parent domain verification covers subdomains
- Organization-scoped: org members share verified domains

---

### Certs Module → TLS Module

**Files**: `src/certs/certs.module.ts`, `src/certs/tls/tls.module.ts`

**Providers**:
- `TlsService` — CSR validation, certificate CRUD, plan limits, job queuing
- `CsrUtilService` — CSR parsing, signature verification, domain extraction
- `CertUtilService` — Certificate parsing (expiry, details, fingerprint)
- `CertIssuerConsumer` — BullMQ job processor for issuance and renewal
- `AcmeIssuerStrategy` — ACME protocol (orders, challenges, finalization)
- `CloudflareDnsStrategy` — Cloudflare TXT record management
- `Route53DnsStrategy` — AWS Route 53 TXT record management
- `CertMonitorService` — Daily expiry monitoring cron

**DNS provider selection**: Factory pattern using `KK_DNS_PROVIDER` env var.

---

### Billing Module

**File**: `src/billing/billing.module.ts`

**Providers**:
- `BillingService` — Stripe checkout, portal, upgrades, webhook processing, tier resolution
- `SubscriptionTierResolverService` — Resolves user's current plan (gracefully degrades to `free`)
- `OrgDissolutionProcessor` — BullMQ processor for async organization dissolution

**Key behaviors**:
- Plan limits enforced across all resource-creating modules
- Flat-fee proration for upgrades (not day-based)
- Organization subscriptions: personal ↔ org conversion on create/delete
- Auto-dissolution of orgs when downgrading below Team tier

**Plan tiers**: `free` → `starter` → `team` → `business` → `enterprise`

---

### Organizations Module

**File**: `src/organizations/organizations.module.ts`

**Providers**:
- `OrganizationsService` — CRUD, member management, ownership transfer
- `OrganizationsController` — REST endpoints with role-based access

**Key behaviors**:
- Role hierarchy: `owner` > `admin` > `member` > `viewer`
- Requires Team+ plan to create
- Users can only belong to one organization
- Deletion queues async dissolution via BillingService

---

### Endpoints Module

**File**: `src/endpoints/endpoints.module.ts`

**Providers**:
- `EndpointsService` — Endpoint CRUD, probe management, scan results, CSV/JSON export
- `EndpointsController` — REST endpoints

**Key behaviors**:
- Dual scanning: managed (hosted) cloud probes and user-connected probes
- Plan-based limits on endpoint count, hosted regions, hosted endpoints
- Organization-scoped resource sharing

### Connectors Module

**File**: `src/connectors/connectors.module.ts`

**Providers**:
- `ConnectorsService` — Connector CRUD, enrollment, signed key exchange and key rotation, revocation
- `ConnectorReportsService` — Stores deployment status reports, sends `deploy.failed` on transitions, and runs the hourly `connector.stale` check (at :45)
- `ConnectorNonceStore` — Remembers used nonces per connector in Redis (`connector-nonce:` prefix, 10 minutes); fails closed
- `ConnectorsController` — REST endpoints

**Key behaviors**:
- A connector enrolls once with a single-use `kkce_` token (scrypt hash stored, consumed by one conditional `UPDATE ... RETURNING`), registering an Ed25519 public key
- `POST /connectors/token` verifies a signature over `KRAKENKEY-CONNECTOR-TOKEN-V1`, the connector id, a timestamp (300 seconds of skew) and a nonce, then mints a one-hour key through `AuthService.createEphemeralApiKey` (`source: 'connector'`, `connectorId` set) with the connector's scopes and restrictions
- Revoking a connector revokes every key it was issued; a key minted while the revocation runs is caught by a second check after the insert
- Enroll, token and rotate are public routes limited per IP (`PUBLIC_STRICT`, 10/min)
- `POST /connectors/report` only accepts keys issued to a connector; a report is applied in one transaction with the connector row locked, so concurrent reports can't double-alert. `connector.stale` claims stale connectors with one `UPDATE ... RETURNING` on `staleAlertedAt`, so it alerts once across replicas, and any contact from the connector clears it

---

## Data Flow Architecture

### 1. Certificate Submission Flow

```
Client → POST /certs/tls
  │
  ▼
TlsController.create()
  │
  ▼
TlsService.create()
  ├─ CsrUtilService.validateAndParse()
  │  ├─ Verify CSR signature
  │  ├─ Extract domains (CN + SANs)
  │  ├─ Validate key strength (RSA ≥2048, ECDSA P-256/P-384)
  │  └─ Normalize PEM format
  ├─ CsrUtilService.isAuthorized() — check domains against verified list
  ├─ enforceCertLimits() — check plan quotas
  ├─ Save TlsCrt to database (status: pending)
  ├─ Enqueue tlsCertIssuance BullMQ job
  └─ Return { id, status: 'pending' }
```

### 2. ACME Issuance Flow (Background)

```
BullMQ picks up job
  │
  ▼
CertIssuerConsumer.process()
  ├─ Fetch TlsCrt from DB
  ├─ Update status → 'issuing'
  ├─ AcmeIssuerStrategy.issue()
  │  ├─ Initialize ACME client (account key from env)
  │  ├─ Create ACME order for all domains
  │  ├─ For each domain:
  │  │  ├─ DnsStrategy.createRecord() — TXT at _acme-challenge.{domain}
  │  │  ├─ waitForDns() — poll 15x at 10s intervals
  │  │  └─ Complete ACME challenge
  │  ├─ Finalize order with CSR
  │  ├─ Retrieve certificate PEM
  │  └─ DnsStrategy.removeRecord() — cleanup
  ├─ Extract expiration date from certificate
  ├─ Update TlsCrt: status → 'issued', store crtPem + expiresAt
  ├─ Send success notification email
  └─ Update metrics
```

### 3. Auto-Renewal Flow

```
CertMonitorService (daily 06:00 UTC)
  ├─ Query: status=issued, autoRenew=true, expiring within window
  ├─ Filter by user tier (free: 5 days, paid: 30 days)
  ├─ For each cert: TlsService.renewInternal()
  │  ├─ Update status → 'renewing'
  │  └─ Enqueue tlsCertRenewal BullMQ job
  └─ Send expiry warning emails
```

### 4. Organization Dissolution Flow

```
OrganizationsService.delete()
  ├─ Set org status → 'dissolving'
  └─ Enqueue org-dissolution BullMQ job
        │
        ▼
OrgDissolutionProcessor.process()
  ├─ Transfer non-owner member resources to owner
  ├─ Clear member org associations
  ├─ Convert org subscription → personal subscription
  └─ Delete organization record
```

---

## Scheduled Jobs

| Service | Cron | Time | Action |
|---------|------|------|--------|
| `DomainMonitorService` | `0 2 * * *` | 02:00 UTC | Re-verify DNS TXT for all verified domains. Marks unverified if missing. Sends email notification |
| `CertMonitorService` | `0 6 * * *` | 06:00 UTC | Find expiring certs, queue renewal jobs, send warning emails, update metrics |

**Ordering**: Domain re-verification runs at 2AM so revoked domains block cert operations before the 6AM cert monitor runs.

Both services use per-item try/catch — one failure does not abort the batch.

---

## Queue Architecture (BullMQ)

| Queue | Purpose | Retry | Backoff |
|-------|---------|-------|---------|
| `tlsCertIssuance` | Initial certificate issuance | 3 attempts | Exponential (5s base) |
| `tlsCertRenewal` | Certificate renewal | 3 attempts | Exponential (5s base) |
| `org-dissolution` | Async organization deletion | 3 attempts | Exponential |

All queues backed by Redis. Job payload is `{ certId }` for cert queues and `{ orgId }` for dissolution.

---

## Authentication Architecture

```
┌──────────────────────────────────────────────┐
│                Request                        │
│         Authorization: Bearer <token>         │
└──────────────────┬───────────────────────────┘
                   │
            ┌──────▼──────┐
            │JwtOrApiKey  │
            │   Guard     │
            └──────┬──────┘
                   │
         ┌─────────┴─────────┐
         ▼                   ▼
   ┌───────────┐      ┌───────────┐
   │JWT Strategy│      │API Key    │
   │(Authentik) │      │Strategy   │
   │RS256 + JWKS│      │kk_* hash  │
   └─────┬─────┘      └─────┬─────┘
         │                   │
         └─────────┬─────────┘
                   ▼
            ┌─────────────┐
            │  RoleGuard  │
            │(org roles)  │
            └──────┬──────┘
                   ▼
            ┌─────────────┐
            │  Controller │
            └─────────────┘
```

**API key types**:

| Prefix | Type | Purpose |
|--------|------|---------|
| `kk_` | User API key | Individual user access |
| `kk_svc_` | Service key | System-level (probes, internal services) |

---

## Security Architecture

1. **CSR validation**: Signature verification, key strength checks, domain authorization
2. **API key hashing**: scrypt with `KK_HMAC_SECRET` salt — keys cannot be verified without the secret
3. **OIDC**: JWT validated via JWKS endpoint, RS256 algorithm, issuer verification
4. **Role-based access**: Global `RoleGuard` enforces org roles on all routes
5. **Rate limiting**: Per IP, per user, per API key via `ThrottlerModule`
6. **Webhook verification**: Stripe webhook signatures verified before processing
7. **Helmet**: Security headers enabled globally
8. **CORS**: Domain-based whitelist
9. **Validation**: Global `ValidationPipe` with whitelist and transform

---

## Configuration

All configuration via environment variables, loaded globally by `ConfigModule`. See [Configuration](./CONFIGURATION.md) for the full reference.

**Variable prefixes**:
- `KK_DB_*` — PostgreSQL
- `KK_BULLMQ_*` — Redis
- `KK_AUTHENTIK_*` — OIDC provider
- `KK_STRIPE_*` — Billing
- `CLOUDFLARE_*` — DNS provider
- `AWS_*` / `KK_AWS_*` — Route 53
- `ACME_*` — Let's Encrypt

---

## Scalability

- **Stateless**: No in-process state — horizontally scalable behind a load balancer
- **Async processing**: BullMQ distributes cert issuance across workers
- **Connection pooling**: TypeORM manages database connections
- **Redis-backed queues**: Shared job state across instances
- **Graceful shutdown**: Properly drains connections and jobs
