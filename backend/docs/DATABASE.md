# Database Schema

## Overview

The KrakenKey backend uses PostgreSQL as the primary data store via TypeORM ORM.

## Database Configuration

### Connection Details

Configured via environment variables:

```env
TYPEORM_HOST=localhost           # Database host
TYPEORM_PORT=5432               # Database port
TYPEORM_USERNAME=postgres        # Database user
TYPEORM_PASSWORD=password        # Database password
TYPEORM_DATABASE=krakenkey       # Database name
TYPEORM_SSL=false               # Enable SSL
TYPEORM_SYNCHRONIZE=false       # Auto-sync schema (dev only)
```

### Connection Pool

- Managed by TypeORM
- Connection pooling enabled by default
- Maximum connections: configurable via TypeORM options

### Initialization

```bash
# Create database and tables
yarn run db:create
```

**Script**: `scripts/create-db.ts`

---

## Entity: TlsCrt

Represents a TLS certificate request and its associated data.

### Schema

```sql
CREATE TABLE "tls_crt" (
  "id" SERIAL PRIMARY KEY,
  "rawCsr" VARCHAR NOT NULL,
  "parsedCsr" JSONB NOT NULL,
  "crtPem" TEXT,
  "status" VARCHAR DEFAULT 'pending',
  "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### TypeScript Definition

```typescript
import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class TlsCrt {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  rawCsr: string;

  @Column('jsonb')
  parsedCsr: JSON;

  @Column({ type: 'text', nullable: true })
  crtPem: string | null;

  @Column({ default: 'pending', nullable: true })
  status: string;
}
```

### Column Definitions

| Column | Type | Required | Nullable | Default | Description |
|--------|------|----------|----------|---------|-------------|
| `id` | INTEGER | Yes | No | AUTO | Primary key, auto-incremented |
| `rawCsr` | VARCHAR | Yes | No | - | Original CSR in PEM format |
| `parsedCsr` | JSONB | Yes | No | - | Parsed CSR structure |
| `crtPem` | TEXT | No | Yes | NULL | Issued certificate in PEM format |
| `status` | VARCHAR | No | Yes | 'pending' | Certificate status |

### Status Values

| Status | Meaning | Description |
|--------|---------|-------------|
| `pending` | Awaiting Processing | CSR received, job queued |
| `issuing` | In Progress | ACME workflow executing |
| `issued` | Success | Certificate successfully issued and stored |
| `failed` | Error | Issuance failed after max retries |

### parsedCsr Structure

JSON representation of the parsed CSR:

```json
{
  "subject": [
    {
      "name": "countryName",
      "shortName": "C",
      "value": "US"
    },
    {
      "name": "commonName",
      "shortName": "CN",
      "value": "example.com"
    }
  ],
  "attributes": [
    {
      "name": "extensionRequest",
      "value": {...}
    }
  ],
  "extensions": [
    {
      "name": "subjectAltName",
      "altNames": [
        {
          "type": 2,
          "value": "example.com"
        },
        {
          "type": 2,
          "value": "www.example.com"
        }
      ]
    }
  ],
  "publicKeyLength": 2048
}
```

### Data Size Estimates

**Average Record Size**:
- `rawCsr`: 1-2 KB
- `parsedCsr`: 2-3 KB
- `crtPem`: 2-3 KB
- **Total per record**: 5-8 KB

**Storage for 100,000 records**: ~500 MB - 1 GB

---

## Indexes

### Current Indexes

```sql
-- Primary key index (auto-created)
CREATE INDEX idx_tls_crt_pkey ON tls_crt(id);

-- Status index (recommended for queries)
CREATE INDEX idx_tls_crt_status ON tls_crt(status);
```

### Recommended Indexes

```sql
-- For status-based queries
CREATE INDEX idx_tls_crt_status ON tls_crt(status);

-- For time-range queries
CREATE INDEX idx_tls_crt_created_at ON tls_crt(createdAt);
CREATE INDEX idx_tls_crt_updated_at ON tls_crt(updatedAt);

-- Composite index for common queries
CREATE INDEX idx_tls_crt_status_created ON tls_crt(status, createdAt DESC);
```

---

## Queries

### Find by ID

```typescript
const tlsCrt = await this.TlsCrtRepository.findOneBy({ id });
```

**SQL**:
```sql
SELECT * FROM tls_crt WHERE id = $1;
```

### Find by Status

```typescript
const pending = await this.TlsCrtRepository.find({
  where: { status: 'pending' }
});
```

**SQL**:
```sql
SELECT * FROM tls_crt WHERE status = $1;
```

### Count by Status

```typescript
const count = await this.TlsCrtRepository.count({
  where: { status: 'issued' }
});
```

**SQL**:
```sql
SELECT COUNT(*) FROM tls_crt WHERE status = $1;
```

### Update Status

```typescript
await this.TlsCrtRepository.update(
  { id },
  { status: 'issued', crtPem: certificate }
);
```

**SQL**:
```sql
UPDATE tls_crt 
SET status = $1, crtPem = $2, updatedAt = CURRENT_TIMESTAMP
WHERE id = $3;
```

### Recent Certificates (Issued)

```typescript
const recent = await this.TlsCrtRepository.find({
  where: { status: 'issued' },
  order: { id: 'DESC' },
  take: 10
});
```

**SQL**:
```sql
SELECT * FROM tls_crt 
WHERE status = 'issued'
ORDER BY id DESC
LIMIT 10;
```

---

## Relationships

**Current**: No relationships defined

**Potential Future Relationships**:

```typescript
// Future: User/Account relationship
@ManyToOne(() => User)
@JoinColumn({ name: 'userId' })
user: User;

// Future: Certificate renewal chain
@OneToMany(() => TlsCrt, (crt) => crt.previous)
renewals: TlsCrt[];

@ManyToOne(() => TlsCrt, (crt) => crt.renewals, { nullable: true })
@JoinColumn({ name: 'previousCrtId' })
previous: TlsCrt | null;
```

---

## Migrations

TypeORM synchronization can be enabled for development:

```typescript
// In app.module.ts
synchronize: configService.get('TYPEORM_SYNCHRONIZE') === 'true'
```

### Generating Migrations

```bash
# Generate migration from schema changes
npx typeorm migration:generate src/migrations/AddColumnX

# Run migrations
npx typeorm migration:run

# Revert migration
npx typeorm migration:revert
```

### Manual Migration Example

```typescript
// src/migrations/1234567890000-AddExpiryDateToTlsCrt.ts
import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddExpiryDateToTlsCrt1234567890000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'tls_crt',
      new TableColumn({
        name: 'expiresAt',
        type: 'TIMESTAMP',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('tls_crt', 'expiresAt');
  }
}
```

---

## Backup & Recovery

### Backup Strategies

```bash
# Full database backup
pg_dump -h localhost -U postgres -d krakenkey > backup.sql

# Compressed backup
pg_dump -h localhost -U postgres -d krakenkey | gzip > backup.sql.gz

# Custom format backup (faster restore)
pg_dump -h localhost -U postgres -d krakenkey -F custom > backup.dump
```

### Restore Procedures

```bash
# From SQL dump
psql -h localhost -U postgres -d krakenkey < backup.sql

# From compressed dump
gunzip -c backup.sql.gz | psql -h localhost -U postgres -d krakenkey

# From custom format
pg_restore -h localhost -U postgres -d krakenkey backup.dump
```

### Point-in-Time Recovery

Requires WAL (Write-Ahead Logging) enabled:

```sql
-- Enable WAL
ALTER SYSTEM SET wal_level = replica;
-- Restart PostgreSQL
```

---

## Maintenance

### Vacuum & Analyze

```bash
# Clean up dead tuples
VACUUM ANALYZE tls_crt;

# Or via command line
vacuumdb -h localhost -U postgres -d krakenkey -v -z tls_crt
```

### Check Bloat

```sql
SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
FROM pg_tables
WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

### Reindex

```bash
# Reindex table
REINDEX TABLE tls_crt;

# Or via command line
reindexdb -h localhost -U postgres -d krakenkey -t tls_crt
```

---

## Monitoring

### Connection Monitoring

```sql
-- Active connections
SELECT datname, count(*) FROM pg_stat_activity GROUP BY datname;

-- Long-running queries
SELECT pid, now() - query_start, query 
FROM pg_stat_activity 
WHERE query_start < now() - interval '5 minutes';
```

### Disk Usage

```sql
-- Database size
SELECT pg_size_pretty(pg_database_size('krakenkey'));

-- Table size
SELECT 
  schemaname, 
  tablename, 
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename))
FROM pg_tables
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

### Query Performance

```sql
-- Enable query logging
SET log_min_duration_statement = 1000;  -- Log queries > 1 second

-- View slow query log
SELECT query, calls, total_time, mean_time 
FROM pg_stat_statements 
ORDER BY mean_time DESC 
LIMIT 10;
```

---

## Data Privacy & Compliance

### Data Sensitivity

| Field | Sensitivity | Notes |
|-------|-------------|-------|
| `rawCsr` | Medium | Contains domain names, public key |
| `parsedCsr` | Medium | Parsed certificate details |
| `crtPem` | Low | Public certificate |
| `status` | Low | Processing status |

### Retention Policies

**Recommended**:
- Keep issued certificates: Until expiry + 1 year
- Keep failed attempts: 90 days
- Archive old records: After 5 years

```typescript
// Example: Clean old failed records
async cleanupOldFailures(daysOld: number) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOld);
  
  await this.TlsCrtRepository.delete({
    status: 'failed',
    createdAt: LessThan(cutoffDate),
  });
}
```

### GDPR Considerations

- No personal data stored directly (CSR/cert only contain domain names)
- No user tracking without explicit user table
- Implement data deletion on request
- Log access to sensitive operations

---

## Performance Tuning

### Query Optimization

```typescript
// Bad: Fetches all columns
const record = await this.TlsCrtRepository.findOneBy({ id });

// Good: Select specific columns
const record = await this.TlsCrtRepository.find({
  select: { id: true, status: true },
  where: { id },
  take: 1,
});
```

### Pagination

```typescript
// Efficient: Paginated results
const page = 1;
const pageSize = 50;

const records = await this.TlsCrtRepository.find({
  skip: (page - 1) * pageSize,
  take: pageSize,
  order: { id: 'DESC' },
});
```

### Caching

```typescript
// Cache frequently accessed records
private cache = new Map<number, TlsCrt>();

async findOneWithCache(id: number) {
  if (this.cache.has(id)) {
    return this.cache.get(id);
  }
  const record = await this.TlsCrtRepository.findOneBy({ id });
  if (record) {
    this.cache.set(id, record);
  }
  return record;
}
```

---

## Troubleshooting

### Connection Issues

```typescript
// Error: "connect ECONNREFUSED 127.0.0.1:5432"
// Solution: Ensure PostgreSQL is running and listening on correct port
// Check: TYPEORM_HOST, TYPEORM_PORT, TYPEORM_USERNAME, TYPEORM_PASSWORD

// Error: "password authentication failed"
// Solution: Verify credentials in environment variables
```

### Synchronization Issues

```typescript
// Error: "migration error"
// Solution: Check TYPEORM_SYNCHRONIZE is 'false' in production
// Run migrations manually instead

// Error: "column does not exist"
// Solution: Ensure migrations have been run
// Run: yarn run typeorm migration:run
```

### Performance Issues

```typescript
// Slow queries
// Solution: Add indexes on frequently queried columns
// Use EXPLAIN ANALYZE to identify bottlenecks

// High memory usage
// Solution: Use pagination instead of loading all records
// Implement query result streaming for large datasets
```

---

## Future Schema Enhancements

### Proposed Additions

```typescript
// Track certificate lifecycle
@CreateDateColumn()
createdAt: Date;

@UpdateDateColumn()
updatedAt: Date;

@Column({ type: 'timestamp', nullable: true })
expiresAt: Date;  // Certificate expiry date

@Column({ type: 'timestamp', nullable: true })
issuedAt: Date;   // When certificate was issued


// Track user/API key ownership
@Column({ nullable: true })
userId: string;   // If user system added

@Column({ nullable: true })
apiKeyId: string; // If API key system added


// Audit trail
@Column('jsonb', { default: '[]' })
statusHistory: Array<{
  status: string;
  timestamp: Date;
  reason?: string;
}>;


// Links to related certificates
@Column({ nullable: true })
renewalOf: number;  // ID of certificate being renewed

@Column({ default: false })
autoRenewal: boolean;  // Enable auto-renewal


// Certificate details extracted from issued cert
@Column({ nullable: true })
serialNumber: string;

@Column({ type: 'text', nullable: true })
issuer: string;

@Column({ type: 'jsonb', nullable: true })
extensions: JSON;  // Certificate extensions
```

### Migration Script

```typescript
// src/migrations/AddEnhancedFields.ts
export class AddEnhancedFields1234567890000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'tls_crt',
      new TableColumn({
        name: 'createdAt',
        type: 'timestamp',
        default: 'CURRENT_TIMESTAMP',
      }),
    );
    // ... add other columns
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('tls_crt', 'createdAt');
    // ... drop other columns
  }
}
```
