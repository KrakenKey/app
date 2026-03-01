# Integration Guides

## Overview

KrakenKey backend integrates with two primary external services for certificate issuance:

1. **Let's Encrypt (ACME)** - Certificate Authority
2. **Cloudflare DNS** - DNS provider for challenge solving

---

## Let's Encrypt / ACME Integration

### Overview

Let's Encrypt is a free, automated, and open Certificate Authority that issues SSL/TLS certificates via the ACME protocol.

**Service**: `AcmeIssuerStrategy`
**File**: `src/certs/tls/services/acme-issuer.strategy.ts`
**Library**: `acme-client` (v5.4.0)

### ACME Protocol Flow

```
Client                 Let's Encrypt           DNS Provider
   │                       │                       │
   ├──Submit CSR──────────→│                       │
   │                       │                       │
   │                    Create Order               │
   │                       │                       │
   │←────Authorizations────│                       │
   │                       │                       │
   ├─Request DNS-01────────│                       │
   │ Challenge             │                       │
   │                       │                       │
   ├──Create TXT Record────────────────────────────→│
   │                       │         Challenge      │
   │←────Confirmed─────────────────────────────────┤
   │                       │                       │
   │──Complete Challenge───→│                       │
   │                       │                       │
   │←─Challenge Valid──────│                       │
   │                       │                       │
   │──Finalize Order───────→│                       │
   │  with CSR             │                       │
   │                       │ Generate Certificate  │
   │←─Certificate Ready────│                       │
   │                       │                       │
   ├──Delete TXT Record────────────────────────────→│
   │                       │                       │
   └──Installation─────────────────────────────────→│
        to server                                  (cleanup)
```

### ACME Implementation Details

#### Client Initialization

```typescript
async issue(csrPem: string, dnsProvider: DnsProvider): Promise<string> {
  // 1. Load account key
  const rawLetsEncryptAccountKey = this.configService.get('ACME_ACCOUNT_KEY');
  const letsEncryptAccountKey = rawLetsEncryptAccountKey.replace(/\\n/g, '\n');

  // 2. Create ACME client
  const client = new acme.Client({
    directoryUrl: acme.directory.letsencrypt.staging,
    accountKey: letsEncryptAccountKey,
  });

  // 3. Create/verify account
  await client.createAccount({
    termsOfServiceAgreed: true,
    contact: ['mailto:admin@cloudwalker.it'],
  });
}
```

**Key Options**:
- `directoryUrl`: ACME server endpoint
  - Staging: `acme.directory.letsencrypt.staging`
  - Production: `acme.directory.letsencrypt.production`
- `accountKey`: Private key for account signing
- `accountUrl`: Pre-existing account URL (optional)

#### Order Creation

```typescript
const csrData = acme.crypto.readCsrDomains(csrPem);
const domains = [csrData.commonName, ...(csrData.altNames || [])]
  .filter((v, i, a) => v && a.indexOf(v) === i);

const order = await client.createOrder({
  identifiers: domains.map((domain) => ({
    type: 'dns',
    value: domain,
  })),
});
```

**Response**:
```json
{
  "location": "https://acme-staging-v02.api.letsencrypt.org/acme/order/123456/789",
  "status": "pending",
  "expires": "2026-02-12T14:30:00Z",
  "identifiers": [
    { "type": "dns", "value": "example.com" },
    { "type": "dns", "value": "www.example.com" }
  ],
  "authorizations": [
    "https://acme-staging-v02.api.letsencrypt.org/acme/authz/123",
    "https://acme-staging-v02.api.letsencrypt.org/acme/authz/124"
  ],
  "finalize": "https://acme-staging-v02.api.letsencrypt.org/acme/order/123456/789/finalize"
}
```

#### Challenge Resolution

```typescript
const authorizations = await client.getAuthorizations(order);

for (const authz of authorizations) {
  const domain = authz.identifier.value;
  const challenge = authz.challenges.find((c) => c.type === 'dns-01');
  
  if (!challenge) throw new Error(`No DNS-01 challenge for ${domain}`);
  
  // Get the key authorization
  const keyAuthorization = await client.getChallengeKeyAuthorization(challenge);
  
  // This is what goes in the DNS TXT record
  // Format: _acme-challenge.example.com = keyAuthorization
}
```

**Challenge Mechanics**:
- Each domain receives one challenge
- DNS-01 challenge requires TXT record with specific value
- TXT record name: `_acme-challenge.domain.com`
- TXT record value: Key authorization string
- Let's Encrypt queries DNS to verify ownership

#### Order Finalization

```typescript
// Submit CSR to finalize order
await client.finalizeOrder(order, csrPem);

// Poll for completion
await client.waitForValidStatus(order);

const finalizedOrder = await client.getOrder(order);

// Download certificate
const certificatePem = await client.getCertificate(finalizedOrder);
```

**Certificate Format**:
```
-----BEGIN CERTIFICATE-----
MIIFazCCBFOgAwIBAgISA...
base64-encoded-certificate
...
-----END CERTIFICATE-----
```

### ACME Rate Limits

#### Staging Environment
- **20 certificates per domain per week** (very generous for testing)
- **50 subdomains per registration per week**

#### Production Environment
- **50 certificates per domain per 7 days** (strict)
- **Renewal exemption**: Renewal certificates don't count against limit
- **Duplicate certificate limit**: 50 identical certificates per week

**Rate Limit Error**:
```
Error: too many certificates already issued for exact set of domains
```

**Solution**: 
- Use staging for testing
- Space out certificate requests
- Re-use certificates via renewal

### ACME Error Handling

```typescript
try {
  const certificatePem = await client.getCertificate(finalizedOrder);
  return certificatePem;
} catch (err: unknown) {
  if (err instanceof Error) {
    console.error('Error issuing certificate:', err.message);
    
    // Common errors
    if (err.message.includes('unauthorized')) {
      // Domain authorization failed - DNS record not detected
      throw new Error('Domain validation failed. Check DNS records.');
    }
    if (err.message.includes('rate limit')) {
      // Rate limit exceeded
      throw new Error('Let\'s Encrypt rate limit exceeded. Try again later.');
    }
  }
  throw err;
}
```

### ACME Account Management

```typescript
// Using existing account
const client = new acme.Client({
  directoryUrl: acme.directory.letsencrypt.staging,
  accountKey: existingPrivateKey,
  accountUrl: 'https://acme-staging-v02.api.letsencrypt.org/acme/acct/123456',
});

// Create new account
const client = new acme.Client({
  directoryUrl: acme.directory.letsencrypt.staging,
  accountKey: newPrivateKey,
});

await client.createAccount({
  termsOfServiceAgreed: true,
  contact: ['mailto:admin@example.com'],
  externalAccountBinding: undefined,  // For CAA requirements
});
```

### Staging vs Production

**Switching to Production**:

```typescript
// In AcmeIssuerStrategy
async issue(csrPem: string, dnsProvider: DnsProvider): Promise<string> {
  const client = new acme.Client({
    directoryUrl: process.env.ACME_ENV === 'production'
      ? acme.directory.letsencrypt.production
      : acme.directory.letsencrypt.staging,
    accountKey: letsEncryptAccountKey,
  });
  // ...
}
```

**Environment Configuration**:
```env
# Staging (testing)
ACME_DIRECTORY_URL=https://acme-staging-v02.api.letsencrypt.org/directory

# Production (live)
ACME_DIRECTORY_URL=https://acme-v02.api.letsencrypt.org/directory
```

---

## Cloudflare DNS Integration

### Overview

Cloudflare DNS provider enables automated DNS record management for ACME DNS-01 challenges.

**Service**: `CloudflareDnsStrategy`
**File**: `src/certs/tls/services/cloudflare-dns.strategy.ts`
**Library**: `cloudflare` (v5.2.0)

### Cloudflare API Authentication

```typescript
@Injectable()
export class CloudflareDnsStrategy implements DnsProvider {
  private readonly client: Cloudflare;

  constructor(private readonly configService: ConfigService) {
    this.client = new Cloudflare({
      apiToken: this.configService.get('CLOUDFLARE_API_TOKEN'),
    });
  }
}
```

**Authentication Types**:
1. **API Token** (recommended) - Scoped permissions
2. **API Key** (legacy) - Full account access

**API Token Permissions**:
- Zone > DNS > Edit
- Zone > Zone > Read

### DNS Record Management

#### Create Challenge Record

```typescript
async createRecord(
  clientDomain: string,
  challengeToken: string,
): Promise<void> {
  const zoneId = this.configService.get<string>('CLOUDFLARE_ZONE_ID');
  const recordName = `${clientDomain.replace(/\./g, '-')}.${this.authZoneDomain}`;

  await this.client.dns.records.create({
    zone_id: zoneId,
    type: 'TXT',
    name: recordName,
    content: challengeToken,
    ttl: 60,  // Low TTL for rapid updates
  });
}
```

**Record Properties**:
- `type`: 'TXT' (required for ACME DNS-01)
- `name`: Full domain name for record
- `content`: Challenge token from ACME
- `ttl`: Time-to-live in seconds (60 = 1 minute)
- `proxied`: false (must not be proxied for DNS-01)

**Example Record**:
```
Zone: test.cloudwalker.it
Name: example-com.test.cloudwalker.it
Type: TXT
TTL: 60
Content: "aCmhPH9ZE8K8zD3j9mL4k5nQ7rT2vW6xB8cF1gH2j3k4l5m6n7o8p9q0r1s2t"
```

#### Delete Challenge Record

```typescript
async removeRecord(clientDomain: string): Promise<void> {
  const zoneId = this.configService.get<string>('CLOUDFLARE_ZONE_ID');
  const recordName = `${clientDomain.replace(/\./g, '-')}.${this.authZoneDomain}`;

  // 1. Find record
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

### Zone Configuration

**Getting Zone ID**:
1. Cloudflare Dashboard → Select Domain
2. Right sidebar → Zone ID
3. Copy and store in `CLOUDFLARE_ZONE_ID`

**DNS Setup**:
```
Primary Domain: example.com
Cloudflare Zone: example.com

Challenge Subdomain: test.cloudwalker.it
  (Should be NS-delegated to Cloudflare)
```

**NS Delegation Example**:
```
test.cloudwalker.it NS ns1.cloudflare.com
test.cloudwalker.it NS ns2.cloudflare.com
```

### Propagation Verification

```typescript
private async waitForDns(recordName: string, expectedValue: string) {
  const resolver = new dns.Resolver();
  
  // Use Cloudflare's nameservers directly
  resolver.setServers([
    '172.64.35.65',   // CloudFlare NS
    '108.162.195.65', // CloudFlare NS
  ]);

  const targetRecord = `${recordName.replace(/\./g, '-')}.test.cloudwalker.it`;

  for (let i = 0; i < 15; i++) {
    try {
      const records = await resolver.resolveTxt(targetRecord);
      if (records.flat().includes(expectedValue)) {
        // Found! Cool down before completing challenge
        await new Promise((res) => setTimeout(res, 30000));
        return;
      }
    } catch (err) {
      // Record not yet found
    }
    
    // Wait before next attempt
    await new Promise((res) => setTimeout(res, 10000));
  }
  
  throw new Error(`DNS propagation failed for ${targetRecord}`);
}
```

**Verification Details**:
- Polls Cloudflare NS directly (not recursive resolvers)
- Retries every 10 seconds for up to 150 seconds
- 30-second cooldown after detection before ACME notification
- Handles transient DNS failures gracefully

### Rate Limits

**Cloudflare API Rate Limits**:
- Free plan: 1200 requests/5 minutes
- Pro+ plan: 3000 requests/5 minutes

**Per-action cost** (approximate):
- Create record: 1 request
- List records: 1 request
- Delete record: 1 request

**For single CSR with 2 domains**:
- Create challenges: 2 requests
- Verify propagation: 30 requests (worst case)
- Delete records: 2 requests
- **Total**: ~34 requests

**Scaling consideration**: For bulk operations, space out requests or upgrade Cloudflare plan.

### Cloudflare Error Handling

```typescript
try {
  await this.client.dns.records.create({...});
} catch (err: unknown) {
  if (err instanceof Error) {
    if (err.message.includes('already exists')) {
      // Record already created, safe to proceed
      console.warn('Record already exists, continuing...');
    }
    if (err.message.includes('authentication')) {
      // Invalid API token
      throw new Error('Cloudflare authentication failed. Check API token.');
    }
    if (err.message.includes('zone not found')) {
      // Invalid zone ID
      throw new Error('Cloudflare zone not found. Check zone ID.');
    }
  }
  throw err;
}
```

### Multi-Domain Management

**Challenge record naming**:
```
Domain: example.com
Record: example-com.test.cloudwalker.it
Token: abc123...

Domain: www.example.com
Record: www-example-com.test.cloudwalker.it
Token: def456...

Domain: api.example.com
Record: api-example-com.test.cloudwalker.it
Token: ghi789...
```

**Cleanup tracking**:
```typescript
const challengeRecords: { recordName: string }[] = [];

for (const domain of domains) {
  const recordName = `${domain.replace(/\./g, '-')}.${this.authZoneDomain}`;
  challengeRecords.push({ recordName });
  // Create record...
}

finally {
  // Cleanup all at end
  for (const record of challengeRecords) {
    await dnsProvider.removeRecord(record.recordName);
  }
}
```

---

## Alternative Integrations

### Other DNS Providers

The code is designed to support additional DNS providers via the `DnsProvider` interface:

```typescript
export interface DnsProvider {
  createRecord(domain: string, challengeToken: string): Promise<void>;
  removeRecord(domain: string): Promise<void>;
}
```

### Implementing Additional Providers

```typescript
// src/certs/tls/services/route53-dns.strategy.ts
import { DnsProvider } from '../interfaces/dns-provider.interface';
import { Route53 } from 'aws-sdk';

@Injectable()
export class Route53DnsStrategy implements DnsProvider {
  private readonly route53 = new Route53();

  async createRecord(domain: string, challengeToken: string): Promise<void> {
    // Implementation for AWS Route53
  }

  async removeRecord(domain: string): Promise<void> {
    // Implementation for AWS Route53
  }
}
```

### Supported DNS Providers (Future)

1. **AWS Route53** - Amazon's DNS service
2. **Google Cloud DNS** - Google's managed DNS
3. **Azure DNS** - Microsoft's DNS service
4. **DigitalOcean** - DigitalOcean managed DNS
5. **Linode DNS** - Linode managed DNS
6. **Generic HTTP API** - Custom DNS API

---

## Integration Testing

### Test Staging First

Always test ACME integration with Let's Encrypt staging:

```typescript
// Development/Testing
const client = new acme.Client({
  directoryUrl: acme.directory.letsencrypt.staging,
  accountKey: stagingAccountKey,
});
```

**Benefits**:
- Unlimited rate limits for testing
- No certificate issuance limits
- No cost
- Safe to experiment

### Simulate DNS Challenges

```typescript
// Mock DNS provider for testing
class MockDnsProvider implements DnsProvider {
  private records = new Map<string, string>();

  async createRecord(domain: string, token: string): Promise<void> {
    this.records.set(domain, token);
    console.log(`Mock: Created DNS record ${domain} = ${token}`);
  }

  async removeRecord(domain: string): Promise<void> {
    this.records.delete(domain);
    console.log(`Mock: Deleted DNS record ${domain}`);
  }

  getRecords() {
    return this.records;
  }
}
```

### Integration Test Example

```typescript
describe('AcmeIssuerStrategy', () => {
  let strategy: AcmeIssuerStrategy;
  let mockDns: MockDnsProvider;

  beforeEach(() => {
    mockDns = new MockDnsProvider();
    // Initialize strategy...
  });

  it('should issue certificate with valid CSR', async () => {
    const csrPem = /* valid CSR */;
    const certificate = await strategy.issue(csrPem, mockDns);
    expect(certificate).toContain('BEGIN CERTIFICATE');
  });

  it('should create and cleanup DNS records', async () => {
    await strategy.issue(csrPem, mockDns);
    expect(mockDns.getRecords().size).toBe(0);  // All cleaned up
  });
});
```

---

## Monitoring & Logging

### ACME Logging

```typescript
private readonly logger = new Logger(AcmeIssuerStrategy.name);

async issue(csrPem: string, dnsProvider: DnsProvider): Promise<string> {
  this.logger.log(`Creating order for: ${domains.join(', ')}`);
  
  // ... workflow ...
  
  this.logger.log(`Challenge for ${domain} is valid.`);
  this.logger.log('Finalizing order...');
  this.logger.log('Order finalized and certificate obtained.');
}
```

**Log Output**:
```
[AcmeIssuerStrategy] Creating order for: example.com, www.example.com
[AcmeIssuerStrategy] Challenge for example.com is valid.
[AcmeIssuerStrategy] Challenge for www.example.com is valid.
[AcmeIssuerStrategy] Finalizing order...
[AcmeIssuerStrategy] Order finalized and certificate obtained.
[AcmeIssuerStrategy] Downloading certificate PEM...
```

### DNS Logging

```typescript
this.logger.log(`DNS match found. Cooldown 30s...`);
this.logger.log(`DNS propagation not yet detected for ${targetRecord}. Retrying in 10s...`);
this.logger.error('risky failed', (err as Error).stack);
```

### Metrics to Track

1. **Certificate Issuance Rate**
   - Certificates issued per day
   - Success rate %

2. **ACME Performance**
   - Average order creation time
   - Average issuance time
   - Rate limit utilization

3. **DNS Performance**
   - Average DNS propagation time
   - DNS query success rate
   - Cloudflare API latency

4. **Error Rates**
   - CSR validation failures
   - ACME challenges failed
   - DNS propagation failures

---

## Troubleshooting Guide

### ACME Issues

**Problem**: "Error: Challenge not valid"

**Causes**:
1. DNS record not propagated
2. Wrong DNS record value
3. Cloudflare DNS not properly configured

**Solution**:
```bash
# Verify DNS record
dig _acme-challenge.example-com.test.cloudwalker.it TXT

# Check Cloudflare zone delegation
dig test.cloudwalker.it NS
```

**Problem**: "Error: too many certificates already issued"

**Cause**: Rate limit exceeded on Let's Encrypt

**Solution**:
- Use staging environment for testing
- Wait 7 days before reissuing identical cert
- Use different domains if possible

### Cloudflare Issues

**Problem**: "Error: invalid API token"

**Causes**:
1. API token expired
2. API token has insufficient permissions
3. Environment variable not set

**Solution**:
```bash
# Verify token is set
echo $CLOUDFLARE_API_TOKEN

# Test API token
curl https://api.cloudflare.com/client/v4/user \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
```

**Problem**: "Error: zone not found"

**Cause**: Incorrect zone ID or zone not configured in Cloudflare

**Solution**:
```bash
# List zones
curl https://api.cloudflare.com/client/v4/zones \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"

# Find correct zone ID and update CLOUDFLARE_ZONE_ID
```

### DNS Propagation Issues

**Problem**: DNS record not visible after creation

**Cause**: 
1. DNS propagation delay
2. Query against wrong nameserver
3. TTL caching issues

**Solution**:
```bash
# Query Cloudflare nameservers directly
dig @172.64.35.65 example-com.test.cloudwalker.it TXT

# Query specific Cloudflare NS
dig @ns1.cloudflare.com example-com.test.cloudwalker.it TXT

# Check propagation globally
nslookup example-com.test.cloudwalker.it 1.1.1.1
```

---

## Security Best Practices

### ACME Account Key Security

1. **Generate securely**:
   ```bash
   openssl genrsa -out acme-account.key 4096
   chmod 600 acme-account.key
   ```

2. **Backup securely**:
   - Use encrypted backup storage
   - Keep separate from application code
   - Store in secure vault

3. **Rotation**:
   - Rotate periodically (yearly recommended)
   - Maintain old key until all certificates renewed

### Cloudflare Token Security

1. **Create scoped token**:
   - Only DNS Edit permission
   - Zone-specific scope
   - Set expiration date

2. **Store securely**:
   - Never hardcode in source
   - Use environment variables
   - Rotate regularly

3. **Monitor usage**:
   - Log all API calls
   - Alert on suspicious activity
   - Review API activity logs

### CSR & Certificate Security

1. **Validate CSR origin**:
   - Only accept from trusted sources
   - Verify signature with embedded key

2. **Protect private keys**:
   - Never store on insecure systems
   - Use hardware security modules (HSM) for production

3. **Monitor certificate usage**:
   - Track certificate installations
   - Alert on unauthorized deployments
