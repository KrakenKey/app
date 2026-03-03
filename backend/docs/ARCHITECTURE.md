# Backend Architecture

## System Overview

KrakenKey is a modular, service-oriented backend built with NestJS for managing TLS certificate lifecycle through ACME protocol automation.

```
┌─────────────────────────────────────────────────────────────┐
│                    KrakenKey Backend                        │
└─────────────────────────────────────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
    ┌───▼────┐        ┌───▼─────┐         ┌───▼──────┐
    │ App    │        │ Certs   │         │Auth/Users│
    │Module  │        │ Module  │         │ Modules  │
    └────────┘        └───┬─────┘         └───┬──────┘
                          │                   │
                      ┌───▼──────┐        ┌───▼─────────┐
                      │   TLS    │        │  Authentik  │
                      │  Module  │        │  (OIDC)     │
                      └───┬──────┘        └─────────────┘
                          │
                    ┌─────┴─────┐
                    │           │
            ┌───────▼───┐  ┌────▼────────┐
            │ TLS       │  │ Job Queue   │
            │ Service   │  │ (BullMQ)    │
            └────┬──────┘  └─────┬──────┘
                 │               │
        ┌────────┼───────────────┼────────┐
        │        │               │        │
    ┌───▼──┐ ┌──▼──┐ ┌─────────▼──┐ ┌─▼────┐
    │ACME  │ │DNS  │ │PostgreSQL  │ │Redis │
    │Issuer│ │Prov.│ │  Database  │ │Queue │
    └──────┘ └─────┘ └────────────┘ └──────┘
```

## Module Hierarchy

### Root Module (AppModule)
**File**: `src/app.module.ts`

Configuration and initialization of the entire application.

**Imports**:
- `AuthModule` - Authentication and OIDC integration
- `UsersModule` - User management
- `DomainsModule` - Domain verification
- `CertsModule` - Certificate management functionality
- `ConfigModule` - Environment variable loading (global)
- `TypeOrmModule` - PostgreSQL database connection
- `BullModule` - Redis-backed job queue initialization
- `ScheduleModule` - NestJS cron scheduler (enables `@Cron` decorators globally)

**Providers**:
- `AppService` - Health check and version information
- `AppController` - Root endpoint handler

**Key Responsibilities**:
- Initialize database connection with TypeORM
- Load environment variables globally
- Setup Redis connection for job queue
- Bootstrap the application

### Auth Module
**File**: `src/auth/auth.module.ts`

Handles authentication and authorization integration.

**Imports**:
- `UsersModule` - User persistence
- `PassportModule` - Strategy execution

**Providers**:
- `AuthService` - OAuth/OIDC flow management
- `JwtStrategy` - Validates Authentik JWTs
- `ApiKeyStrategy` - Validates persistent API keys

**Key Responsibilities**:
- OIDC Redirects & Callback handling
- API Key generation and hashing
- Request Guards (JwtOrApiKeyGuard)

### Users Module
**File**: `src/users/users.module.ts`

Manages user identities.

**Imports**:
- `TypeOrmModule` - User repository

**Providers**:
- `UsersService` - CRUD operations

**Key Responsibilities**:
- User persistence
- Lookups by email/ID

### Domains Module
**File**: `src/domains/domains.module.ts`

Handles domain ownership verification.

**Providers**:
- `DomainsService` - Verification logic (DNS TXT)
- `DomainsController` - Endpoints
- `DomainMonitorService` - Scheduled re-verification cron (`0 2 * * *`)

**Key Responsibilities**:
- Register domains for users
- Verify ownership via DNS TXT records
- Periodically re-check verified domains and revoke if TXT record is removed

### Certs Module
**File**: `src/certs/certs.module.ts`

Container module for all certificate-related functionality.

**Imports**:
- `TlsModule` - TLS-specific operations

**Exports**: None (used internally)

**Key Responsibilities**:
- Organize certificate-related features
- Provide namespace for certificate endpoints (`/certs`)

### TLS Module
**File**: `src/certs/tls/tls.module.ts`

Core module for TLS certificate issuance and management.

**Imports**:
- `TypeOrmModule` - TlsCrt entity repository
- `BullModule` - Job queue for async processing

**Providers**:
- `TlsService` - Business logic
- `CsrUtilService` - CSR parsing and validation
- `CertUtilService` - Certificate parsing utilities
- `CertIssuerConsumer` - Job processor (queue worker)
- `AcmeIssuerStrategy` - ACME protocol implementation
- `CloudflareDnsStrategy` - Cloudflare DNS integration
- `Route53DnsStrategy` - AWS Route 53 DNS integration
- `CertMonitorService` - Scheduled expiry monitoring cron (`0 6 * * *`)

**Database Entities**:
- `TlsCrt` - Certificate request record

**Key Responsibilities**:
- Handle CSR submission and validation
- Manage certificate issuance workflow
- Integrate with external ACME and DNS services
- Process async jobs through BullMQ
- Automatically queue renewal jobs for certificates expiring within 30 days

## Data Flow Architecture

### 1. Request Submission Flow

```
Client CSR
    │
    ▼
TlsController.create()
    │
    ▼
TlsService.create()
    ├─ CsrUtilService.validateAndParse()
    │  ├─ Verify CSR signature
    │  ├─ Extract domains (SANs + CN)
    │  ├─ Check key strength (min 2048 bits)
    │  └─ Parse to JSON
    ├─ Save to Database (TlsCrt entity)
    ├─ Enqueue Job to BullMQ
    │  ├─ Retry: 3 attempts
    │  └─ Backoff: exponential (5s initial)
    └─ Return { id, status: 'pending' }
```

### 2. Certificate Issuance Flow

```
BullMQ Job Processing
    │
    ▼
CertIssuerConsumer.process()
    ├─ Fetch CSR from Database
    ├─ Validate CSR Format
    ├─ Update Status: 'pending' → 'issuing'
    ├─ AcmeIssuerStrategy.issue()
    │  ├─ Initialize ACME Client
    │  ├─ Create Account (if needed)
    │  ├─ Extract Domains from CSR
    │  ├─ Create Order
    │  ├─ Get Authorizations & Challenges
    │  ├─ For each domain:
    │  │  ├─ CloudflareDnsStrategy.createRecord()
    │  │  ├─ Wait for DNS Propagation
    │  │  ├─ Notify ACME: Challenge Ready
    │  │  ├─ Poll Challenge Status
    │  │  └─ Clean up: removeRecord()
    │  ├─ Finalize Order with CSR
    │  ├─ Wait for CA Processing
    │  ├─ Retrieve Certificate PEM
    │  └─ Return certificate
    ├─ Update Status: 'issuing' → 'issued'
    ├─ Store Certificate in Database
    └─ Log Success
```

### 3. Status Query Flow

```
Client GET /certs/tls/:id
    │
    ▼
TlsController.findOne()
    │
    ▼
TlsService.findOne()
    │
    ▼
Database Query (TlsCrt)
    │
    ▼
Return Certificate Record with Status
```

## Service Layer Architecture

### TlsService
**Responsibilities**:
- CSR validation and persistence
- Certificate record CRUD operations
- Status management
- Job enqueueing

**Methods** (user-facing, ownership-checked):
- `create(userId, createTlsCrtDto)` - Validate and queue CSR for issuance
- `findAll(userId)` - List user's certificates
- `findOne(id, userId)` - Retrieve one certificate
- `update(id, userId, updateTlsCrtDto, status?)` - Update record
- `renew(id, userId)` - Queue renewal for an `issued` certificate
- `retry(id, userId)` - Re-queue issuance for a `failed` certificate
- `remove(id, userId)` - Revoke certificate (stub)

**Methods** (`@internal` — no ownership check, system use only):
- `findOneInternal(id)` - Fetch cert without user scope (used by queue processors)
- `updateInternal(id, dto, status?)` - Update cert without user scope (used by queue processors)
- `renewInternal(id)` - Queue `tlsCertRenewal` job without user scope (used by `CertMonitorService`)

### DomainsService
**Responsibilities**:
- Domain registration and ownership verification via DNS TXT lookup
- Gating certificate issuance to verified domains only

**Methods** (user-facing, ownership-checked):
- `create(userId, createDomainDto)` - Register a domain and generate verification code
- `findAll(userId)` - List user's domains
- `findAllVerified(userId)` - List only verified domains (used by cert issuance auth check)
- `findOne(id, userId)` - Retrieve one domain
- `verify(userId, id)` - Perform DNS TXT lookup and mark as verified
- `delete(userId, id)` - Remove a domain

**Methods** (`@internal` — system use only):
- `checkVerificationRecord(domain)` - DNS TXT lookup returning `boolean`; used by `DomainMonitorService` for periodic re-verification

### CsrUtilService
**Responsibilities**:
- Parse and validate CSRs
- Extract SANs and CN from CSR
- Verify RSA key strength
- Format PEM strings

**Methods**:
- `validateAndParse(pem)` - Complete CSR validation and parsing
- `isAuthorized(dnsNames, allowedDomains)` - Domain authorization check
- `formatPem(pem)` - Ensure correct PEM line wrapping

### AcmeIssuerStrategy
**Responsibilities**:
- ACME protocol communication
- Order creation and finalization
- Challenge verification coordination
- Certificate retrieval

**Methods**:
- `issue(csrPem, dnsProvider)` - Execute full issuance workflow
- `waitForDns(recordName, expectedValue)` - Poll DNS propagation

### CloudflareDnsStrategy
**Responsibilities**:
- Cloudflare API communication
- DNS record creation and deletion
- TXT record management

**Methods**:
- `createRecord(clientDomain, challengeToken)` - Create TXT record
- `removeRecord(clientDomain)` - Delete TXT record

## Database Schema

### User Entity
```typescript
@Entity()
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column({ nullable: true })
  username: string;

  @Column({ type: 'simple-array', default: [] })
  groups: string[];
}
```

### Domain Entity
```typescript
@Entity()
export class Domain {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  hostname: string;

  @Column()
  verificationCode: string;

  @Column({ default: false })
  isVerified: boolean;

  @ManyToOne(() => User)
  user: User;
}
```

### TlsCrt Entity
```typescript
@Entity()
export class TlsCrt {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  rawCsr: string;                    // Original PEM

  @Column('jsonb')
  parsedCsr: JSON;                   // Parsed structure

  @Column({ type: 'text', nullable: true })
  crtPem: string | null;             // Issued certificate

  @Column({ default: 'pending', nullable: true })
  status: string;                    // pending|issuing|issued|failed
}
```

**Statuses**:
- `pending` - CSR received, awaiting processing
- `issuing` - Certificate issuance in progress
- `issued` - Certificate successfully issued
- `failed` - Issuance failed (manual intervention may be needed)

## Scheduled Jobs

All cron jobs are managed by `@nestjs/schedule` (`ScheduleModule.forRoot()` registered in `AppModule`). Jobs run in-process — no separate worker process is required.

| Service | Cron | Time | Action |
|---------|------|------|--------|
| `DomainMonitorService` | `0 2 * * *` | Daily 02:00 UTC | Re-checks TXT record for all verified domains; marks unverified if record is absent |
| `CertMonitorService` | `0 6 * * *` | Daily 06:00 UTC | Finds `issued` certs expiring within 30 days; queues `tlsCertRenewal` BullMQ jobs |

**Ordering rationale**: Domain re-verification runs at 2AM so any domains that have lost their TXT record are marked unverified before the cert monitor runs at 6AM. New certificate submissions for those domains will be blocked immediately after 2AM.

### DomainMonitorService

- **File**: `src/domains/services/domain-monitor.service.ts`
- **Query**: All domains where `isVerified = true`
- **Check**: `resolveTxt(hostname)` — looks for `verificationCode` in flattened TXT records
- **On failure**: Updates `isVerified = false`; logs a warning with domain hostname and ID
- **On DNS error**: Returns `false` (cautious — transient DNS failures will revoke verification)
- **Error isolation**: Per-domain try/catch so one failure does not abort the rest of the batch

### CertMonitorService

- **File**: `src/certs/tls/services/cert-monitor.service.ts`
- **Query**: `status = 'issued' AND expiresAt < now() + 30 days` (DB-level filter via TypeORM `LessThan`)
- **Action**: Calls `TlsService.renewInternal(certId)` for each result
- **renewInternal**: Updates status to `renewing`, enqueues `tlsCertRenewal` BullMQ job
- **Error isolation**: Per-cert try/catch so one failure does not abort the rest of the batch

---

## Queue Architecture

### Job Queues (BullMQ)

**Queue**: `tlsCertIssuance` — initial certificate issuance

**Queue**: `tlsCertRenewal` — certificate renewal (triggered by user or `CertMonitorService`)

**Job Structure** (both queues):
```typescript
{
  certId: number  // ID of the TlsCrt database record
}
```

**Retry Policy** (both queues):
- Max attempts: 3
- Backoff strategy: exponential
- Initial delay: 5000ms
- Schedule: attempt 1 → immediate, attempt 2 → ~5s, attempt 3 → ~25s

**Processor**: `CertIssuerConsumer`

## External Service Integration

### Let's Encrypt ACME
- **Purpose**: Certificate Authority
- **Environment**: Staging (default) or Production
- **Key Workflow**:
  1. Account creation/reuse
  2. Order creation for domains
  3. Authorization retrieval
  4. Challenge response
  5. Order finalization
  6. Certificate download

### Cloudflare DNS
- **Purpose**: DNS provider for DNS-01 challenges
- **Key Operations**:
  1. Create TXT record with challenge token
  2. Verify propagation
  3. Delete record after verification
- **Configuration**: Zone ID and API token via environment

## Error Handling

### CSR Validation Errors
- Invalid PEM format → `BadRequestException`
- Signature verification failure → `BadRequestException`
- Key too small → `BadRequestException`
- Unauthorized domains → `BadRequestException`

### ACME Errors
- Challenge setup failure → Job retry with backoff
- DNS propagation timeout → Job failure
- Certificate retrieval failure → Job retry

### Job Processing
- Max retries: 3 with exponential backoff
- Failed jobs logged for manual review
- Status updated to `failed` after all retries exhausted

## Scalability Considerations

1. **Horizontal Scaling**:
   - Stateless service design
   - Redis-backed queue for distributed processing
   - PostgreSQL for shared state

2. **Performance Optimization**:
   - Async/await for non-blocking I/O
   - BullMQ for parallel job processing
   - Connection pooling via TypeORM

3. **Resource Management**:
   - Graceful shutdown handling
   - Configurable timeouts
   - Exponential backoff to prevent thundering herd

## Security Architecture

1. **CSR Validation**:
   - Signature verification using embedded public key
   - Key strength validation (min 2048 bits RSA)
   - Domain authorization through DNS challenges

2. **Credentials Management**:
   - ACME account key via environment variable
   - Cloudflare API token via environment variable
   - No hardcoded secrets

3. **DNS Challenge**:
   - DNS-01 challenge for domain validation
   - TXT record creation/deletion
   - DNS propagation verification before ACME notification

## Configuration Management

**Global Configuration Module**: `ConfigModule.forRoot({ isGlobal: true })`

**Environment Variables**:
- Database: `TYPEORM_*`
- Redis: `BULLMQ_*`
- ACME: `ACME_*`
- Cloudflare: `CLOUDFLARE_*`
- API: `PORT`, `API_VERSION`

All configuration loaded at startup and injected via `ConfigService`.
