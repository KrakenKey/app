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
- Connector-managed certificates (`managedBy: "connector"`) get the warning but are never renewed here; see [Connector-Managed Certificates](#connector-managed-certificates)

### Renewal Windows

| Plan | Renewal Window |
|------|---------------|
| Free | 5 days before expiry |
| Starter, Team, Business, Enterprise | 30 days before expiry |

### ACME Renewal Information (ARI)

The renewal windows above decide normal timing. KrakenKey also asks the CA for its suggested renewal window ([RFC 9773](https://www.rfc-editor.org/rfc/rfc9773)) so it can replace a certificate early when the CA asks, for example before a mass revocation.

- **AriMonitorService** runs hourly. For each `issued` certificate with `autoRenew: true` or `managedBy: "connector"` whose next check is due, it computes the certificate's ARI identifier (`base64url(AKI).base64url(serial)`), fetches `GET <renewalInfo>/<id>` from the ACME directory (no account needed), and stores `ariWindowStart`, `ariWindowEnd` and `ariExplanationUrl`. The next check follows the CA's `Retry-After`, clamped to 1-24 hours (default 6 hours); a certificate the CA has no info for is checked again after 24 hours, and a failed request after 6 hours.
- The window only pulls a renewal earlier when the CA asks for **early replacement**:
  - the window moved more than a day earlier than the one seen at the previous check (what a CA does before revoking in bulk), or
  - the first window seen starts in the first half of the certificate's lifetime (a normal Let's Encrypt window starts about two thirds in), or
  - the CA sent an `explanationURL`.
- Then `ariReplacementRequestedAt` is set and the certificate is renewed as soon as the CA's window opens, whatever the plan's renewal window. Free-plan owners still need a current auto-renewal confirmation. `renew?ifDue=true` also treats such a certificate as due. Connector-managed certificates are not renewed here; the owner gets the `cert.replacement_requested` alert and the connector sees the earlier window through `renewAfter`.
- A normal window (Let's Encrypt suggests renewing about 30 days before expiry for a 90-day certificate) changes nothing: Free still renews 5 days before expiry and paid plans 30 days before.
- Every renewal order sends `replaces: <ARI identifier of the old certificate>` so the CA links the two. If the CA refuses it (for example the certificate was already replaced), the order is retried without it.
- Issuing a new certificate stores its identifier and clears the old window. Set `KK_ACME_ARI=false` to turn the checks off; `replaces` is still sent.

### Connector-Managed Certificates

A customer-hosted connector can renew a certificate itself, so the private key never leaves the customer's machine and is replaced on every renewal. It marks the certificate with `PATCH /certs/tls/:id` and `{"managedBy": "connector"}`. From then on:

- KrakenKey never renews the certificate on its own. The daily auto-renewal and ARI early replacement skip it, whatever `autoRenew` says.
- Expiry warnings and `cert.expiring` alerts still fire inside the plan's renewal window, and `cert.replacement_requested` when the CA asks for early replacement, so the owner hears about a connector that stopped renewing. The free-plan confirmation below does not apply to them.
- ARI checks still run and store the CA's window.
- The certificate's `renewAfter` tells the connector when to renew: the earlier of `expiresAt` minus the renewal window and `ariWindowStart`, whether the CA's window is routine or an early-replacement request, since the connector follows the CA's suggestion (RFC 9773). For these certificates the window is the plan's window but at least 30 days, so on the Free plan too they are renewed 30 days before expiry at the latest.
- For certificates KrakenKey renews, `renewAfter` is `expiresAt` minus the plan window, and only moves to `ariWindowStart` once `ariReplacementRequestedAt` is set, matching when the server actually renews.
- The connector renews with `POST /certs/tls/:id/renew` and a body of `{"csrPem": "..."}` holding a CSR for a new key with the same names. The new CSR replaces the stored one. `?ifDue=true` treats the certificate as due once `renewAfter` has passed.

`{"managedBy": null}` hands renewal back to KrakenKey, which then renews with the last CSR it stored.

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

A manual renewal always runs and counts against the monthly certificate limit. Without a body it reuses the stored CSR (the same key); send `{"csrPem": "..."}` to renew with a new CSR for the same names. To renew from a scheduled job without re-issuing every day, add `?ifDue=true`: the request only renews once the certificate is inside the renewal window above, and otherwise returns `200` with `"skipped": true` and queues nothing. See [API_REFERENCE.md](API_REFERENCE.md#post-certstlsidrenew).

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
