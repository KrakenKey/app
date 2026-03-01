# Certificate Issuance Flow

This document details the complete flow of a certificate request from submission to issuance.

## Overview

```
┌─────────────────────────────────────────────────────────────┐
│                   Certificate Request Lifecycle              │
└─────────────────────────────────────────────────────────────┘

1. CSR Submission       2. Validation           3. Storage
   (Client)               (Service)               (Database)
   ↓                      ↓                       ↓
   CSR PEM ────────→ Verify & Parse ────────→ Record Created
                     Extract Domains         Queue Job
                     Key Strength Check

4. Async Processing     5. ACME Challenge      6. Verification
   (BullMQ)            (Let's Encrypt)        (Cloudflare)
   ↓                   ↓                       ↓
   Dequeue Job ─────→ Create Order ─────────→ DNS Challenge
   Fetch Record        Get Challenges         Create Record
   Initialize ACME     DNS-01 Challenge       Propagate
                                             Wait & Verify

7. Finalization        8. Certificate        9. Storage
   (ACME)              Retrieval             (Database)
   ↓                   ↓                      ↓
   Finalize Order ──→ Download PEM ────────→ Update Record
   Sign with CSR       Parse Cert            Status: issued
                       Extract Details        Return to Client
```

---

## Phase 1: Request Submission

### 1.1 Client Prepares CSR

**Prerequisites**:
- Private key generated locally (RSA 2048+ bits recommended)
- CSR created with domains (CN + SANs)
- CSR signed with private key

**Client Example**:
```bash
# Generate private key
openssl genrsa -out example.key 2048

# Create CSR with SAN
openssl req -new \
  -key example.key \
  -subj "/CN=example.com" \
  -addext "subjectAltName=DNS:example.com,DNS:www.example.com" \
  -out example.csr

# Convert to PEM
openssl req -in example.csr -noout -text  # View
cat example.csr | base64  # Encode if needed
```

### 1.2 Submit to API

**Endpoint**: `POST /certs/tls`

**Request**:
```json
{
  "csrPem": "-----BEGIN CERTIFICATE REQUEST-----\nMIIC...\n-----END CERTIFICATE REQUEST-----",
  "status": "pending"
}
```

**Handler**: `TlsController.create()`
```typescript
@Post()
create(@Body() createTlsCrtDto: CreateTlsCrtDto) {
  return this.tlsService.create(createTlsCrtDto);
}
```

---

## Phase 2: CSR Validation

### 2.1 Format Validation

**Service**: `CsrUtilService.validateAndParse()`

**Steps**:
1. Parse PEM string to CSR object
   ```typescript
   const csr = forge.pki.certificationRequestFromPem(pem);
   ```

2. Verify CSR signature
   ```typescript
   if (!csr.verify()) {
     throw new BadRequestException('CSR signature verification failed');
   }
   ```
   - Uses public key embedded in CSR
   - Validates signature block
   - Proof of possession of private key

### 2.2 Domain Extraction

**Steps**:
1. Extract Common Name (CN)
   ```typescript
   const cn = csr.subject.getField('CN')?.value
   ```

2. Extract Subject Alternative Names (SANs)
   - Look in extensions for "subjectAltName"
   - Parse DNS names from extension
   - Example: `DNS:example.com, DNS:www.example.com`

3. Combine and deduplicate
   ```typescript
   const domains = [cn, ...sans].filter(unique)
   ```

### 2.3 Key Strength Validation

**Requirements**:
- Only RSA keys supported
- Minimum 2048 bits
- 4096 bits recommended for production

**Validation Code**:
```typescript
const publicKey = csr.publicKey as forge.pki.rsa.PublicKey;
if (!publicKey.n) {
  throw new BadRequestException('Only RSA keys are supported currently');
}
const bitLength = publicKey.n.bitLength();
if (bitLength < 2048) {
  throw new BadRequestException('RSA key must be at least 2048 bits');
}
```

### 2.4 Domain Authorization (Optional)

**If enabled**: Check if requested domains are in allowed list
```typescript
isAuthorized(dnsNames: string[], allowedDomains: string[]) {
  const isAuthorized = dnsNames.every((domain) =>
    allowedDomains.includes(domain),
  );
  if (!isAuthorized) {
    throw new BadRequestException('CSR contains unauthorized domains');
  }
}
```

### 2.5 JSON Serialization

Convert parsed CSR to JSON for storage:
```typescript
{
  "subject": [
    { name: "countryName", value: "US" },
    { name: "commonName", value: "example.com" }
  ],
  "attributes": [...],
  "extensions": [
    {
      name: "subjectAltName",
      altNames: [
        { type: 2, value: "example.com" },
        { type: 2, value: "www.example.com" }
      ]
    }
  ],
  "publicKeyLength": 2048
}
```

---

## Phase 3: Storage & Queueing

### 3.1 Database Record Creation

**Service**: `TlsService.create()`

**Save to Database**:
```typescript
const savedCsr = await this.TlsCrtRepository.save({
  rawCsr: csr.raw,           // Original PEM
  parsedCsr: csr.parsed,     // Parsed JSON
  status: 'pending',         // Initial status
});
```

**TlsCrt Entity**:
```typescript
@Entity()
export class TlsCrt {
  @PrimaryGeneratedColumn()
  id: number;                             // Auto-incremented ID

  @Column()
  rawCsr: string;                         // Original CSR PEM

  @Column('jsonb')
  parsedCsr: JSON;                        // Parsed structure

  @Column({ type: 'text', nullable: true })
  crtPem: string | null;                  // Certificate (null until issued)

  @Column({ default: 'pending', nullable: true })
  status: string;                         // pending|issuing|issued|failed
}
```

### 3.2 Job Enqueueing

**Queue**: `tlsCertIssuance` (BullMQ)

**Job Data**:
```typescript
{
  certId: savedCsr.id
}
```

**Job Configuration**:
```typescript
{
  attempts: 3,                    // Max retries
  backoff: {
    type: 'exponential',          // Exponential backoff
    delay: 5000                   // Initial: 5 seconds
  }
}
```

**Backoff Schedule**:
- Attempt 1: Immediate
- Attempt 2: ~5 seconds after attempt 1 fails
- Attempt 3: ~25 seconds after attempt 2 fails
- After all attempts: Job fails, status = "failed"

### 3.3 API Response

```json
{
  "id": 42,
  "status": "pending"
}
```

---

## Phase 4: Async Job Processing

### 4.1 Job Dequeue

**Processor**: `CertIssuerConsumer` (BullMQ WorkerHost)

**Trigger**: Job dequeued from `tlsCertIssuance` queue

```typescript
@Processor('tlsCertIssuance')
export class CertIssuerConsumer extends WorkerHost {
  async process(job: Job<{ certId: string }>): Promise<any> {
    const { certId } = job.data;
    // ... processing
  }
}
```

### 4.2 Record Retrieval & Validation

**Steps**:
1. Fetch CSR record from database
   ```typescript
   const csrRecord = await this.tlsService.findOne(parseInt(certId));
   ```

2. Validate record exists
   ```typescript
   if (!csrRecord) {
     throw new Error(`CSR with ID ${certId} not found`);
   }
   ```

3. Validate CSR format
   ```typescript
   const raw = csrRecord.rawCsr ?? '';
   if (!raw.includes('-----BEGIN') || !raw.includes('-----END')) {
     throw new Error('CSR appears to be invalid or empty');
   }
   ```

### 4.3 Status Update

Update status to "issuing":
```typescript
await this.tlsService.update(csrRecord.id, { crtPem: null }, 'issuing');
```

---

## Phase 5: ACME Workflow

### 5.1 Initialize ACME Client

**Service**: `AcmeIssuerStrategy.issue()`

**Steps**:
1. Load account key from environment
   ```typescript
   const letsEncryptAccountKey = this.configService.get('ACME_ACCOUNT_KEY');
   ```

2. Create ACME client
   ```typescript
   const client = new acme.Client({
     directoryUrl: acme.directory.letsencrypt.staging,  // or production
     accountKey: letsEncryptAccountKey,
   });
   ```

3. Create/verify account
   ```typescript
   await client.createAccount({
     termsOfServiceAgreed: true,
     contact: ['mailto:admin@cloudwalker.it'],
   });
   ```

**Staging vs Production**:
- **Staging**: `acme.directory.letsencrypt.staging`
  - Rate limits: Generous
  - Certificates: Untrusted
  - Purpose: Testing

- **Production**: `acme.directory.letsencrypt.production`
  - Rate limits: Strict
  - Certificates: Trusted browsers
  - Purpose: Live use

### 5.2 Extract Domains & Create Order

**Extract domains**:
```typescript
const csrData = acme.crypto.readCsrDomains(csrPem);
const domains = [csrData.commonName, ...(csrData.altNames || [])]
  .filter((v, i, a) => v && a.indexOf(v) === i);  // Deduplicate
```

**Create ACME Order**:
```typescript
const order = await client.createOrder({
  identifiers: domains.map((domain) => ({
    type: 'dns',
    value: domain
  })),
});
```

**Response**:
```
Order {
  location: 'https://acme-staging-v02.api.letsencrypt.org/acme/order/...',
  status: 'pending',
  expires: '2026-02-12T...',
  identifiers: [
    { type: 'dns', value: 'example.com' },
    { type: 'dns', value: 'www.example.com' }
  ],
  authorizations: ['https://acme-staging-v02.api.letsencrypt.org/acme/authz/...'],
  finalize: 'https://acme-staging-v02.api.letsencrypt.org/acme/order/.../finalize'
}
```

### 5.3 Get Authorizations & Extract Challenges

**Fetch authorizations**:
```typescript
const authorizations = await client.getAuthorizations(order);
```

**For each authorization**:
```typescript
for (const authz of authorizations) {
  const domain = authz.identifier.value;
  const challenge = authz.challenges.find((c) => c.type === 'dns-01');
  
  if (!challenge) throw new Error(`No DNS-01 challenge for ${domain}`);
  
  const keyAuthorization = await client.getChallengeKeyAuthorization(challenge);
  const recordName = `_acme-challenge.${domain}`;
  // ...
}
```

---

## Phase 6: DNS Challenge Resolution

### 6.1 Create DNS Challenge Record

**Service**: `CloudflareDnsStrategy.createRecord()`

**Cloudflare API Call**:
```typescript
async createRecord(clientDomain: string, challengeToken: string) {
  const zoneId = this.configService.get<string>('CLOUDFLARE_ZONE_ID');
  const recordName = `${clientDomain.replace(/\./g, '-')}.test.cloudwalker.it`;

  await this.client.dns.records.create({
    zone_id: zoneId,
    type: 'TXT',
    name: recordName,
    content: challengeToken,
    ttl: 60,  // Low TTL for fast updates
  });
}
```

**DNS Record Example**:
```
Name: example-com.test.cloudwalker.it
Type: TXT
TTL: 60
Content: "aCmhPH9ZE8K8zD3j9mL4k5nQ7rT2vW6xB8cF1gH2j3k4l5m6n7o8p9q0r1s2t"
```

### 6.2 Verify DNS Propagation

**Service**: `AcmeIssuerStrategy.waitForDns()`

**Process**:
```typescript
private async waitForDns(recordName: string, expectedValue: string) {
  const resolver = new dns.Resolver();
  resolver.setServers(['172.64.35.65', '108.162.195.65']);  // Cloudflare NS
  
  const targetRecord = `${recordName.replace(/\./g, '-')}.test.cloudwalker.it`;
  
  for (let i = 0; i < 15; i++) {
    try {
      const records = await resolver.resolveTxt(targetRecord);
      if (records.flat().includes(expectedValue)) {
        // Found! Wait for propagation
        await this.sleep(30000);  // 30 second cooldown
        return;  // Success
      }
    } catch (err) {
      // Not yet propagated, continue
    }
    
    // Wait before retry
    await this.sleep(10000);  // 10 second retry interval
  }
  
  throw new Error(`DNS propagation failed for ${targetRecord}`);
}
```

**Polling Details**:
- Max attempts: 15
- Retry interval: 10 seconds
- Total timeout: ~150 seconds (2.5 minutes)
- Once found: 30 second cooldown before ACME notification
- Cloudflare nameservers queried directly

### 6.3 Notify ACME of Challenge Response

```typescript
// Challenge is ready
await client.completeChallenge(challenge);

// Poll for validation
await client.waitForValidStatus(challenge);
```

### 6.4 Cleanup DNS Records

**Service**: `CloudflareDnsStrategy.removeRecord()`

**Process**:
```typescript
async removeRecord(clientDomain: string) {
  const zoneId = this.configService.get<string>('CLOUDFLARE_ZONE_ID');
  const recordName = `${clientDomain.replace(/\./g, '-')}.test.cloudwalker.it`;

  // 1. List DNS records
  const records = await this.client.dns.records.list({
    zone_id: zoneId,
    name: recordName,
    type: 'TXT',
  });

  // 2. Delete all matching records
  for (const record of records.result) {
    await this.client.dns.records.delete(record.id, {
      zone_id: zoneId,
    });
  }
}
```

**Timing**: Cleanup happens in finally block after all challenges processed

---

## Phase 7: Order Finalization

### 7.1 Finalize with CSR

```typescript
await client.finalizeOrder(order, csrPem);
```

**What Happens**:
- CSR sent to ACME server
- Server extracts public key from CSR
- Server generates certificate signed with CA key

### 7.2 Wait for Processing

```typescript
await client.waitForValidStatus(order);
const finalizedOrder = await client.getOrder(order);
```

**Status Progression**:
- `pending` → order created
- `ready` → all challenges valid
- `processing` → CA generating certificate
- `valid` → certificate ready

### 7.3 Download Certificate

```typescript
if (!finalizedOrder.certificate) {
  throw new Error('Order finalized but no certificate was returned');
}

const certificatePem = await client.getCertificate(finalizedOrder);
```

**Certificate Format**:
```
-----BEGIN CERTIFICATE-----
MIIFazCCBFOgAwIBAgISA2j9vXGMPxrRtKY...
... (base64 encoded certificate)
...
-----END CERTIFICATE-----
```

---

## Phase 8: Certificate Storage

### 8.1 Update Database

```typescript
await this.tlsService.update(csrRecord.id, { crtPem }, 'issued');
```

**Updated Record**:
```typescript
{
  id: 42,
  rawCsr: "-----BEGIN CERTIFICATE REQUEST-----\n...",
  parsedCsr: {...},
  crtPem: "-----BEGIN CERTIFICATE-----\n...",  // Now populated
  status: "issued"  // Updated from "issuing"
}
```

### 8.2 Job Completion

```typescript
return { success: true };
```

### 8.3 Logging

```typescript
console.log(`Certificate issued for ID: ${certId}`);
```

---

## Phase 9: Client Retrieval

### 9.1 Poll for Certificate

**Client polls** `GET /certs/tls/42`:

```json
{
  "id": 42,
  "status": "issued",
  "crtPem": "-----BEGIN CERTIFICATE-----\n...",
  "rawCsr": "-----BEGIN CERTIFICATE REQUEST-----\n...",
  "parsedCsr": {...}
}
```

### 9.2 Certificate Use

Client can now:
- Install certificate on web server
- Configure HTTPS
- Chain with intermediate certificates
- Monitor expiry (typically 90 days for Let's Encrypt)

---

## Error Handling

### 9.1 Validation Errors (Phase 2)

**Immediate failure**: CSR rejected, not queued

**Possible errors**:
- Invalid PEM format
- Signature verification failed
- RSA key too small
- Unauthorized domains

**Response**: 400 Bad Request

### 9.2 Processing Errors (Phase 4-8)

**Retry behavior**: Up to 3 attempts with exponential backoff

**Possible errors**:
- Database connection failure
- ACME server unreachable
- DNS propagation timeout
- Network issues

**Resolution**:
- Auto-retry on first 2 failures
- Manual intervention on 3rd failure
- Status marked as "failed"

### 9.3 Cleanup on Failure

**Finally block** ensures cleanup:
```typescript
finally {
  for (const record of challengeRecords) {
    try {
      await dnsProvider.removeRecord(record.recordName);
    } catch {
      // Log warning but don't throw
      this.logger.warn(`Cleanup failed for ${record.recordName}`);
    }
  }
}
```

**Cleanup guarantees**:
- DNS records removed even if later steps fail
- Prevents dangling DNS records
- Reduces ACME validation issues on retry

---

## Timeline Example

**10:00:00** - CSR submitted
- ✓ Validation complete
- ✓ Database record created (ID: 42, status: pending)
- ✓ Job queued

**10:00:05** - Job processing begins
- ✓ Status changed to "issuing"
- ✓ ACME client initialized
- ✓ Order created for domains

**10:00:15** - DNS challenge created
- ✓ TXT record created in Cloudflare
- ✓ Waiting for propagation...

**10:02:30** - DNS propagated
- ✓ Record detected in DNS
- ✓ 30-second cooldown
- ✓ Challenge marked as complete
- ✓ ACME server validates

**10:03:45** - Certificate issued
- ✓ Order finalized
- ✓ CA processing complete
- ✓ Certificate downloaded

**10:04:00** - Storage complete
- ✓ Status changed to "issued"
- ✓ Certificate stored in database
- ✓ DNS record cleaned up

**10:04:05** - Client retrieves
- ✓ GET /certs/tls/42 returns certificate
- ✓ Ready for use

**Total time**: ~4 minutes

---

## Monitoring & Debugging

### View Job Queue
```bash
# Install bull-board or similar UI
# Or query directly via Redis CLI
redis-cli
> KEYS tlsCertIssuance:*
> HGETALL tlsCertIssuance:42
```

### Check Logs
```bash
# View ACME debug logs
# View DNS propagation logs
# Check job retry attempts
```

### Common Issues & Solutions

| Issue | Cause | Solution |
|-------|-------|----------|
| DNS timeout | Record not propagating | Check Cloudflare API token, zone ID |
| CSR rejected | Invalid signature | Regenerate CSR with valid private key |
| Certificate wrong domain | CSR mismatch | Ensure CSR contains correct domains |
| Job stuck | Queue stalled | Restart Redis, check queue status |
| Rate limit | Too many requests | Wait or use Let's Encrypt production limits |

---

## Automated Renewal

Certificates are automatically renewed before expiry by `CertMonitorService`.

**Schedule**: Daily at 06:00 UTC (`0 6 * * *`)

**Trigger window**: Certificates with `status = 'issued'` and `expiresAt` within the next 30 days

**Flow**:
```
06:00 UTC — CertMonitorService.checkExpiringCertificates()
    │
    ├─ Query: issued certs expiring within 30 days (DB-level filter)
    │
    └─ For each cert:
           TlsService.renewInternal(certId)
               ├─ Fetch cert (no ownership check)
               ├─ Guard: skip if not 'issued' or no rawCsr
               ├─ Update status: 'issued' → 'renewing'
               └─ Enqueue job: tlsCertRenewal (BullMQ)
                      └─ CertIssuerConsumer processes renewal
                             └─ Same ACME flow as initial issuance
                                └─ Status: 'renewing' → 'issued'
```

**Retry policy**: Same as initial issuance — 3 attempts, exponential backoff from 5s.

**Note**: Let's Encrypt certificates have a 90-day lifetime. The 30-day renewal window gives 3 daily attempts before expiry.

---

## Future Enhancements

1. **OCSP Stapling**: Include OCSP responses
2. **Wildcard Support**: `*.example.com` domains
3. **Multi-DNS Provider**: Support additional DNS providers beyond Cloudflare/Route 53
4. **Webhook Notifications**: Notify client on certificate issuance or renewal
5. **Batch Processing**: Submit multiple CSRs at once
