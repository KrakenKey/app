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
│  Check CNAME │────▶│  Create ACME │────▶│  Create DNS      │
│  Delegation  │     │    Order     │     │  TXT Record      │
└──────────────┘     └──────────────┘     └────────┬─────────┘
                                                   │
                                          15 attempts × 10s
                                                   │
                                                   ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────────┐
│  Finalize    │◄────│  Complete    │◄────│  Wait for DNS    │
│    Order     │     │  Challenge   │     │  Propagation     │
└──────┬───────┘     └──────────────┘     └──────────────────┘
       │
       ▼
┌──────────────┐
│  Store Cert  │
│  in DB       │
└──────┬───────┘
       │
       ▼
  Clean up DNS records
  Send success email
  Update metrics
```

### DNS-01 Challenge Process

1. **Challenge delegation checked** for every domain in the CSR, before any order is created (see [Challenge delegation precheck](#challenge-delegation-precheck) below)
2. **ACME order created** with Let's Encrypt for all domains in the CSR
3. **For each domain**, a TXT record is created:
   - Record name: `_acme-challenge.{domain}` (dots flattened to dashes in the hostname)
   - Record value: ACME challenge token
   - TTL: 60 seconds
   - Zone: The configured `KK_ACME_AUTH_ZONE_DOMAIN`
4. **DNS propagation polling**: Up to 15 attempts at 10-second intervals
5. **Challenge completed** with the ACME server
6. **Order finalized** with the original CSR
7. **Certificate PEM** retrieved and stored
8. **DNS TXT records cleaned up**

### Challenge delegation precheck

KrakenKey answers DNS-01 challenges from its own auth zone (`KK_ACME_AUTH_ZONE_DOMAIN`), so the customer delegates the challenge name to us once with a CNAME:

```
_acme-challenge.example.com.  CNAME  example-com.acme.krakenkey.io.
```

Dots in the customer domain are flattened to dashes to build the target, matching the record the DNS strategies write. A wildcard request (`*.example.com`) is checked against the base domain, since both share one `_acme-challenge` name.

Without that CNAME the CA can never see the TXT record we publish. Before this check existed, such a request still looked healthy on our side: the propagation poll queries the record in our own auth zone through `KK_ACME_DNS_RESOLVERS`, so it found the TXT value, waited out the 30-second cooldown and asked the CA to validate. The CA, following `_acme-challenge.<domain>` from the customer's zone, found nothing and failed the challenge with an opaque error, after the order had already counted against Let's Encrypt's rate limits. The precheck runs **before** the ACME client is even initialized, so a misconfigured domain costs nothing at the CA.

Resolution behavior:

- The **system resolver** is used, not `KK_ACME_DNS_RESOLVERS`. Those resolvers are authoritative for our own zone and may not answer recursive queries for customer domains.
- CNAME chains are followed for up to **5 hops**, and stop early once the expected target is reached. Each lookup uses a 5-second timeout with 2 tries.
- Only a **missing or mismatched** CNAME fails the job. Any other resolver condition — timeout, `SERVFAIL`, refusal — is logged as a warning and issuance proceeds, so a flaky resolver never blocks a correctly configured domain.

Both failure messages are actionable and name the exact record to create. Abbreviated here; the full text also tells the customer to request the certificate again once the record is fixed:

| Condition | Message |
|-----------|---------|
| No CNAME at `_acme-challenge.<domain>` | `ACME challenge delegation missing: no CNAME found at … Create a CNAME record from … to …` |
| CNAME points elsewhere | `ACME challenge delegation mismatch: … points to …, expected …` |

Both are classified as **permanent** failures by the issuance processor. Only the customer can fix them, so the job fails on the first attempt instead of using its retries. See [Retry Policy](#retry-policy).

### Retry Policy

| Setting | Value |
|---------|-------|
| Attempts | 3 (the first try plus 2 retries) |
| Backoff | Exponential (5-second base delay) |
| Retry delays | ~5s, then ~10s |

If the last attempt fails, the certificate status is set to `failed`, the error message is stored in `failureReason` (truncated to 2,000 characters) and a failure notification email is sent. `failureReason` is returned by `GET /certs/tls` and `GET /certs/tls/:id`, shown on the dashboard, and cleared when the next attempt starts.

Some failures are classified as **permanent** and skip retries entirely: an invalid CSR, a malformed ACME key authorization, a missing or mismatched challenge delegation, a CA policy refusal (including CAA), a deactivated ACME account, or a CA rate limit. Retrying the first group would produce the same result every time while delaying the customer's failure notification. CA rate limits last hours to days, far longer than the seconds-scale backoff, so they fail fast too and the customer can retry once the limit clears. Any of these fails the job on the first attempt. The patterns are listed in `PERMANENT_FAILURE_PATTERNS` in `backend/src/certs/tls/processors/tls-crt-issuer.processor.ts`; add to that list when introducing an error that only the customer can resolve.

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
