# Certificate Issuance Flow

End-to-end walkthrough of how KrakenKey processes certificate requests, from CSR submission through ACME issuance to automated renewal.

## Certificate Lifecycle

```
             submit CSR
                 │
                 ▼
            ┌─────────┐
            │ pending  │
            └────┬─────┘
                 │  BullMQ job picked up
                 ▼
            ┌─────────┐
            │ issuing  │──── ACME DNS-01 challenge ────┐
            └────┬─────┘                               │
                 │                                     │
           success │                              failure (after 3 retries)
                 │                                     │
                 ▼                                     ▼
            ┌─────────┐                          ┌──────────┐
            │ issued   │                          │  failed  │
            └────┬─────┘                          └──────────┘
                 │                                     │
        expiring │ (auto-renew)               retry │ (manual)
                 ▼                                     │
            ┌──────────┐                               │
            │ renewing  │◄─────────────────────────────┘
            └────┬──────┘
                 │
                 ▼
            ┌─────────┐
            │ issued   │  (renewed)
            └────┬─────┘
                 │
          revoke │ (manual)
                 ▼
            ┌──────────┐
            │ revoking  │
            └────┬──────┘
                 │
                 ▼
            ┌─────────┐
            │ revoked  │
            └──────────┘
```

### Status Values

| Status | Description |
|--------|-------------|
| `pending` | CSR received, validated, and queued for processing |
| `issuing` | ACME workflow actively running (order created, challenges in progress) |
| `issued` | Certificate successfully issued and stored |
| `failed` | Issuance failed after 3 retry attempts |
| `renewing` | Renewal job in progress for an expiring certificate |
| `revoking` | Revocation request sent to ACME CA |
| `revoked` | Certificate successfully revoked |

---

## Step 1: Generate a CSR

Before submitting to KrakenKey, generate a Certificate Signing Request using OpenSSL.

### Single Domain

```bash
# Generate private key
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 -out domain.key

# Generate CSR
openssl req -new -key domain.key -out domain.csr \
  -subj "/CN=example.com"
```

### Multiple Domains (SANs)

```bash
# Generate private key
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 -out domain.key

# Generate CSR with Subject Alternative Names
openssl req -new -key domain.key -out domain.csr \
  -subj "/CN=example.com" \
  -addext "subjectAltName=DNS:example.com,DNS:www.example.com,DNS:api.example.com"
```

### Wildcard Certificate

```bash
openssl req -new -key domain.key -out domain.csr \
  -subj "/CN=*.example.com" \
  -addext "subjectAltName=DNS:*.example.com,DNS:example.com"
```

### ECDSA Key (Alternative to RSA)

```bash
# Generate ECDSA key (P-256 or P-384)
openssl ecparam -genkey -name prime256v1 -out domain.key

# Generate CSR
openssl req -new -key domain.key -out domain.csr \
  -subj "/CN=example.com"
```

### CSR Requirements

| Requirement | Details |
|-------------|---------|
| Format | PEM-encoded, 64-character line width |
| Key types | RSA (min 2048-bit, recommended 4096) or ECDSA (P-256, P-384) |
| Signature | CSR must be self-signed with the corresponding private key |
| Max size | 10,000 characters |
| Domains | All domains in the CSR (CN + SANs) must be verified in your account |

---

## Step 2: Verify Domain Ownership

Every domain in the CSR must be verified before a certificate can be issued. See the [Domain Verification Guide](../../docs/DOMAIN_VERIFICATION_GUIDE.md) for full instructions.

**Key points:**
- Add a DNS TXT record with the verification code provided by KrakenKey
- Parent domain verification covers subdomains (verifying `example.com` authorizes `sub.example.com`)
- Wildcard certificates require the base domain to be verified
- TXT records must remain in DNS — a daily cron job at 02:00 UTC re-verifies all domains

---

## Step 3: Submit the CSR

### Via API

```bash
# Read CSR file content
CSR_PEM=$(cat domain.csr)

# Submit CSR
curl -X POST https://api.example.com/certs/tls \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"csrPem\": \"$CSR_PEM\"}"
```

**Response:**

```json
{
  "id": 42,
  "status": "pending",
  "parsedCsr": {
    "subject": [{"shortName": "CN", "value": "example.com"}],
    "extensions": [{"name": "subjectAltName", "altNames": [{"type": 2, "value": "example.com"}]}],
    "publicKeyLength": 4096
  },
  "createdAt": "2026-03-27T10:00:00.000Z"
}
```

### What Happens on Submission

1. **CSR Validation** — Signature verified, key strength checked, PEM format normalized
2. **Domain Authorization** — All domains in the CSR checked against user's verified domains
3. **Plan Limits** — Concurrent pending, total active, and monthly certificate quotas enforced
4. **Job Queued** — A `tlsCertIssuance` job is added to the BullMQ queue
5. **Status: `pending`** — Certificate record created in database

---

## Step 4: ACME Issuance (Background)

The BullMQ job processor handles issuance asynchronously:

```
┌──────────────┐     ┌──────────────┐     ┌──────────────────┐
│  Create ACME │────▶│  Create DNS  │────▶│  Wait for DNS    │
│    Order     │     │  TXT Record  │     │  Propagation     │
└──────────────┘     └──────────────┘     └────────┬─────────┘
                                                   │
                                          15 attempts × 10s
                                                   │
                                                   ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────────┐
│  Store Cert  │◄────│  Finalize    │◄────│  Complete        │
│  in DB       │     │  Order       │     │  Challenge       │
└──────────────┘     └──────────────┘     └──────────────────┘
        │
        ▼
  Clean up DNS records
  Send success email
  Update metrics
```

### DNS-01 Challenge Process

1. **ACME order created** with Let's Encrypt for all domains in the CSR
2. **For each domain**, a TXT record is created:
   - Record name: `_acme-challenge.{domain}` (dots flattened to dashes in the hostname)
   - Record value: ACME challenge token
   - TTL: 60 seconds
   - Zone: The configured `ACME_AUTH_ZONE_DOMAIN`
3. **DNS propagation polling**: Up to 15 attempts at 10-second intervals
4. **Challenge completed** with the ACME server
5. **Order finalized** with the original CSR
6. **Certificate PEM** retrieved and stored
7. **DNS TXT records cleaned up**

### Retry Policy

| Setting | Value |
|---------|-------|
| Max retries | 3 |
| Backoff | Exponential (5-second base delay) |
| Retry delays | ~5s, ~25s, ~125s |

If all retries fail, the certificate status is set to `failed` and a failure notification email is sent.

---

## Step 5: Retrieve the Certificate

### Poll for Status

```bash
curl https://api.example.com/certs/tls/42 \
  -H "Authorization: Bearer $API_KEY"
```

**Response (issued):**

```json
{
  "id": 42,
  "status": "issued",
  "crtPem": "-----BEGIN CERTIFICATE-----\nMIIE...\n-----END CERTIFICATE-----\n",
  "parsedCsr": { ... },
  "expiresAt": "2026-06-25T10:00:00.000Z",
  "autoRenew": true,
  "renewalCount": 0,
  "createdAt": "2026-03-27T10:00:00.000Z"
}
```

### Get Certificate Details

```bash
curl https://api.example.com/certs/tls/42/details \
  -H "Authorization: Bearer $API_KEY"
```

Returns parsed certificate information including issuer, subject, key type/size, validity period, and fingerprint.

---

## Auto-Renewal

KrakenKey automatically monitors and renews certificates.

### How It Works

- **CertMonitorService** runs daily at **06:00 UTC**
- Finds all `issued` certificates with `autoRenew: true` that are expiring within the renewal window
- Queues renewal jobs to the `tlsCertRenewal` BullMQ queue
- Sends expiry warning emails for certificates approaching expiration

### Renewal Windows

| Plan | Renewal Window |
|------|---------------|
| Free | 5 days before expiry |
| Starter, Team, Business, Enterprise | 30 days before expiry |

### Free Tier Confirmation

Free tier users must confirm auto-renewal every 6 months by calling:

```bash
curl -X POST https://api.example.com/auth/confirm-auto-renewal \
  -H "Authorization: Bearer $API_KEY"
```

If not confirmed within 6 months, auto-renewal is paused until re-confirmed.

### Manual Renewal

```bash
curl -X POST https://api.example.com/certs/tls/42/renew \
  -H "Authorization: Bearer $API_KEY"
```

### Disabling Auto-Renewal

```bash
curl -X PATCH https://api.example.com/certs/tls/42 \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"autoRenew": false}'
```

---

## Revocation

Revoke a certificate when the private key is compromised or the certificate is no longer needed.

```bash
curl -X POST https://api.example.com/certs/tls/42/revoke \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"reason": 1}'
```

### RFC 5280 Revocation Reason Codes

| Code | Reason |
|------|--------|
| 0 | Unspecified |
| 1 | Key compromise |
| 2 | CA compromise |
| 3 | Affiliation changed |
| 4 | Superseded |
| 5 | Cessation of operation |
| 9 | Privilege withdrawn |
| 10 | AA compromise |

Revoked and failed certificates can be deleted from your account:

```bash
curl -X DELETE https://api.example.com/certs/tls/42 \
  -H "Authorization: Bearer $API_KEY"
```

Only certificates in `failed` or `revoked` status can be deleted.

---

## Retrying Failed Certificates

If issuance failed (e.g. DNS propagation timeout), you can retry:

```bash
curl -X POST https://api.example.com/certs/tls/42/retry \
  -H "Authorization: Bearer $API_KEY"
```

This re-queues the original CSR for another issuance attempt.

---

## Plan Limits

Certificate operations are subject to plan-based quotas:

| Limit | Free | Starter | Team | Business | Enterprise |
|-------|------|---------|------|----------|------------|
| Certificates per month | 5 | 50 | 250 | 1,000 | Unlimited |
| Active certificates | 10 | 75 | 375 | 1,500 | Unlimited |

See [Billing](./BILLING.md) for full plan details.
