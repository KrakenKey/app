# Database Schema

## Overview

KrakenKey uses PostgreSQL as the primary data store via TypeORM. Migrations run automatically on startup.

## Configuration

Configured via environment variables (see [Configuration](./CONFIGURATION.md)):

| Variable | Description |
|----------|-------------|
| `KK_DB_HOST` | Database hostname |
| `KK_DB_PORT` | Database port (default: 5432) |
| `KK_DB_USERNAME` | Database user |
| `KK_DB_PASSWORD` | Database password |
| `KK_DB_DATABASE` | Database name (default: krakenkey) |
| `KK_DB_SYNCHRONIZE` | Auto-sync schema — **never enable in production** |
| `KK_DB_SSL` | Enable SSL connections |

---

## Entities

### User

Represents an authenticated user. The `id` comes from Authentik's `sub` claim (not a UUID).

```sql
CREATE TABLE "user" (
  "id" TEXT PRIMARY KEY,                          -- Authentik sub claim
  "username" VARCHAR NOT NULL UNIQUE,
  "email" VARCHAR NOT NULL UNIQUE,
  "groups" TEXT[] DEFAULT '{}',                    -- Authentik groups
  "displayName" VARCHAR,
  "notificationPreferences" JSONB,
  "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "autoRenewalConfirmedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "autoRenewalReminderSentAt" TIMESTAMP,
  "role" VARCHAR,                                 -- org role: owner/admin/member/viewer
  "organizationId" UUID REFERENCES organization(id) ON DELETE CASCADE
);
```

**Relationships:**
- Has many `UserApiKey`
- Has many `Domain`
- Has many `TlsCrt`
- Belongs to `Organization` (optional)

---

### Domain

Represents a domain registered by a user for DNS verification. Verification is required before certificates can be issued.

```sql
CREATE TABLE "domain" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "hostname" VARCHAR NOT NULL,                    -- FQDN (max 253 chars)
  "verificationCode" VARCHAR NOT NULL,            -- DNS TXT value (hidden from API)
  "isVerified" BOOLEAN DEFAULT FALSE,
  "userId" TEXT NOT NULL REFERENCES "user"(id),
  "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("userId", "hostname")
);

CREATE INDEX idx_domain_user_verified ON domain("userId", "isVerified");
```

**Relationships:**
- Belongs to `User`

**Verification:**
- A daily cron job at 02:00 UTC re-checks DNS TXT records
- If the record is missing, `isVerified` is set to `false` and an email notification is sent
- Parent domain verification covers subdomains (verifying `example.com` authorizes `sub.example.com`)

---

### TlsCrt

Represents a TLS certificate request and its lifecycle from submission through issuance, renewal, and revocation.

```sql
CREATE TABLE "tls_crt" (
  "id" SERIAL PRIMARY KEY,
  "rawCsr" VARCHAR NOT NULL,                      -- Original CSR PEM (hidden from API)
  "parsedCsr" JSONB NOT NULL,                     -- Parsed CSR metadata
  "crtPem" TEXT,                                  -- Issued certificate PEM
  "status" VARCHAR DEFAULT 'pending',             -- pending/issuing/issued/failed/renewing/revoking/revoked
  "expiresAt" TIMESTAMP,                          -- Certificate expiration
  "lastRenewedAt" TIMESTAMP,
  "autoRenew" BOOLEAN DEFAULT TRUE,
  "renewalCount" INTEGER DEFAULT 0,
  "lastRenewalAttemptAt" TIMESTAMP,
  "revocationReason" INTEGER,                     -- RFC 5280 reason code (0-10)
  "revokedAt" TIMESTAMP,
  "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "userId" TEXT NOT NULL REFERENCES "user"(id)
);

CREATE INDEX idx_tls_crt_user ON tls_crt("userId");
CREATE INDEX idx_tls_crt_renewal ON tls_crt("status", "autoRenew", "expiresAt");
```

**Status Values:**

| Status | Description |
|--------|-------------|
| `pending` | CSR received, validated, job queued |
| `issuing` | ACME workflow actively running |
| `issued` | Certificate successfully issued |
| `failed` | Issuance failed after 3 retries |
| `renewing` | Renewal in progress |
| `revoking` | Revocation request sent to ACME CA |
| `revoked` | Certificate successfully revoked |

**parsedCsr Structure:**

```json
{
  "subject": [
    {"name": "commonName", "shortName": "CN", "value": "example.com"}
  ],
  "extensions": [
    {
      "name": "subjectAltName",
      "altNames": [
        {"type": 2, "value": "example.com"},
        {"type": 2, "value": "www.example.com"}
      ]
    }
  ],
  "publicKeyLength": 4096
}
```

**Relationships:**
- Belongs to `User`

---

### UserApiKey

API keys for programmatic access. Keys are hashed with scrypt using `KK_HMAC_SECRET` as salt.

```sql
CREATE TABLE "user_api_key" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "name" VARCHAR NOT NULL DEFAULT 'default',      -- Friendly name (max 100 chars)
  "hash" VARCHAR NOT NULL UNIQUE,                 -- scrypt hash (hidden from API)
  "expiresAt" TIMESTAMP,
  "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
);

CREATE INDEX idx_api_key_user ON user_api_key("userId");
```

Key format: `kk_` prefix followed by random bytes. The raw key is only returned once at creation time.

---

### ServiceApiKey

System-level API keys for probe instances and internal services. Separate from user keys.

```sql
CREATE TABLE "service_api_key" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "name" VARCHAR NOT NULL,
  "hash" VARCHAR NOT NULL UNIQUE,                 -- scrypt hash (hidden from API)
  "expiresAt" TIMESTAMP,
  "revokedAt" TIMESTAMP,
  "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

Key format: `kk_svc_` prefix. Can be revoked (soft delete via `revokedAt`).

---

### Subscription

Stripe subscription records linked to users or organizations.

```sql
CREATE TABLE "subscription" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "plan" VARCHAR NOT NULL,                        -- starter/team/business/enterprise
  "status" VARCHAR NOT NULL,                      -- active/past_due/canceled/incomplete/trialing
  "stripeCustomerId" VARCHAR,
  "stripeSubscriptionId" VARCHAR UNIQUE,
  "currentPeriodStart" TIMESTAMP,
  "currentPeriodEnd" TIMESTAMP,
  "userId" TEXT REFERENCES "user"(id),
  "organizationId" UUID REFERENCES organization(id),
  "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_subscription_user ON subscription("userId");
CREATE INDEX idx_subscription_org ON subscription("organizationId");
```

**Relationships:**
- Belongs to `User` (personal subscription) OR `Organization` (team subscription)

---

### Organization

Teams with role-based access control. Requires Team+ plan.

```sql
CREATE TABLE "organization" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "name" VARCHAR NOT NULL,                        -- 2-80 characters
  "ownerId" TEXT NOT NULL,
  "status" VARCHAR DEFAULT 'active',              -- active/dissolving
  "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_org_owner ON organization("ownerId");
```

**Relationships:**
- Has one owner (`User`)
- Has many members (`User` via `organizationId` foreign key)
- Has one `Subscription`

---

### Endpoint

TLS endpoints monitored by probes.

```sql
CREATE TABLE "endpoint" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "host" VARCHAR NOT NULL,
  "port" INTEGER NOT NULL,
  "sni" VARCHAR,                                  -- SNI override
  "label" VARCHAR,                                -- Friendly name
  "isActive" BOOLEAN DEFAULT TRUE,
  "lastScanRequestedAt" TIMESTAMP,
  "ownerId" TEXT NOT NULL REFERENCES "user"(id)
);
```

**Relationships:**
- Belongs to `User`
- Has many `EndpointHostedRegion`
- Has many `EndpointProbeAssignment`

---

### EndpointHostedRegion

Join table linking endpoints to managed cloud probe regions.

```sql
CREATE TABLE "endpoint_hosted_region" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "endpointId" UUID NOT NULL REFERENCES endpoint(id),
  "region" VARCHAR NOT NULL,
  UNIQUE("endpointId", "region")
);
```

---

### EndpointProbeAssignment

Join table linking endpoints to connected probe instances.

```sql
CREATE TABLE "endpoint_probe_assignment" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "endpointId" UUID NOT NULL REFERENCES endpoint(id),
  "probeId" UUID NOT NULL,
  UNIQUE("endpointId", "probeId")
);
```

---

## Entity Relationship Diagram

```
┌──────────┐       ┌──────────────┐       ┌───────────────┐
│   User   │──1:N──│   Domain     │       │  Organization │
│          │──1:N──│   TlsCrt     │       │               │
│          │──1:N──│  UserApiKey  │       └───────┬───────┘
│          │──N:1──│ Organization │──1:1──Subscription
│          │──1:N──│  Endpoint    │
└──────────┘       └──────────────┘
                          │
                   ┌──────┴──────┐
                   │             │
          EndpointHosted   EndpointProbe
            Region          Assignment
```

---

## Migrations

Migrations run automatically on startup via TypeORM's `migrationsRun: true` configuration.

### Generating Migrations

```bash
# Generate migration from entity changes
npx typeorm migration:generate src/migrations/MigrationName

# Create empty migration
npx typeorm migration:create src/migrations/MigrationName

# Run pending migrations
npx typeorm migration:run

# Revert last migration
npx typeorm migration:revert
```

**Important:** In production, always use migrations (`KK_DB_SYNCHRONIZE=false`). The `synchronize` option is for development convenience only and can cause data loss.

---

## Backup & Recovery

### Backup

```bash
# Full database backup
pg_dump -h localhost -U postgres -d krakenkey > backup.sql

# Compressed backup
pg_dump -h localhost -U postgres -d krakenkey | gzip > backup.sql.gz

# Custom format (faster restore)
pg_dump -h localhost -U postgres -d krakenkey -F custom > backup.dump
```

### Restore

```bash
# From SQL dump
psql -h localhost -U postgres -d krakenkey < backup.sql

# From compressed dump
gunzip -c backup.sql.gz | psql -h localhost -U postgres -d krakenkey

# From custom format
pg_restore -h localhost -U postgres -d krakenkey backup.dump
```

---

## Monitoring

```sql
-- Active connections
SELECT datname, count(*) FROM pg_stat_activity GROUP BY datname;

-- Database size
SELECT pg_size_pretty(pg_database_size('krakenkey'));

-- Table sizes
SELECT tablename, pg_size_pretty(pg_total_relation_size('public.' || tablename))
FROM pg_tables WHERE schemaname = 'public'
ORDER BY pg_total_relation_size('public.' || tablename) DESC;

-- Long-running queries
SELECT pid, now() - query_start AS duration, query
FROM pg_stat_activity
WHERE query_start < now() - interval '5 minutes';
```
