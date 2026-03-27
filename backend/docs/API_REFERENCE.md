# API Reference

## Base URL

```
http://localhost:8080
```

## Documentation

Interactive Swagger docs available at `/swagger` (development mode only).

## Authentication

All protected endpoints require an `Authorization` header:

```
Authorization: Bearer <jwt_or_api_key>
```

**JWT tokens** — Short-lived, obtained via Authentik OIDC login flow.

**API keys** — Long-lived, prefixed with `kk_`. Created via the API or dashboard. The raw key is shown only once at creation time.

Both methods use the same header format. The backend tries JWT validation first, then falls back to API key validation.

## Error Response Format

All errors follow a consistent JSON format:

```json
{
  "statusCode": 400,
  "message": "Invalid CSR PEM format",
  "error": "Bad Request",
  "timestamp": "2026-03-27T10:00:00.000Z",
  "path": "/certs/tls"
}
```

### Common HTTP Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success (GET, PATCH, DELETE) |
| 201 | Created (POST) |
| 400 | Validation failure or invalid input |
| 401 | Missing or invalid authentication |
| 403 | Insufficient permissions (wrong role) |
| 404 | Resource not found |
| 409 | Conflict (duplicate resource) |
| 422 | Validation errors (detailed) |
| 429 | Rate limit exceeded |
| 500 | Internal server error |

---

## Health Check

### GET /

Returns API status and version.

**Authentication**: None

```json
{
  "status": "ok",
  "version": "0.1.0"
}
```

---

## Authentication & Profile

### GET /auth/register

Redirects to Authentik enrollment flow for new user registration.

**Authentication**: None

### GET /auth/login

Redirects to Authentik OIDC login page.

**Authentication**: None

### GET /auth/callback

OIDC callback handler. Exchanges the authorization code for tokens and provisions the user on first login (JIT provisioning).

**Query Parameters**: `code` (string)

**Authentication**: None

### GET /auth/profile

Returns the authenticated user's full profile including plan, resource counts, and organization info.

**Response:**
```json
{
  "userId": "authentik-sub-id",
  "username": "alice",
  "email": "alice@example.com",
  "displayName": "Alice",
  "groups": ["users"],
  "plan": "team",
  "domainCount": 5,
  "certCount": 12,
  "apiKeyCount": 2,
  "organization": {
    "id": "uuid",
    "name": "My Team",
    "role": "owner"
  }
}
```

### PATCH /auth/profile

Update the current user's profile.

**Request:**
```json
{
  "displayName": "Alice Smith",
  "notificationPreferences": {
    "certExpiry": true,
    "domainVerification": true
  }
}
```

### GET /auth/api-keys

List all API keys for the current user. Returns metadata only (name, dates) — hashes are never exposed.

**Response:**
```json
[
  {
    "id": "uuid",
    "name": "CI/CD Key",
    "expiresAt": "2027-03-27T00:00:00.000Z",
    "createdAt": "2026-03-27T10:00:00.000Z"
  }
]
```

### POST /auth/api-keys

Generate a new API key.

**Request:**
```json
{
  "name": "CI/CD Key",
  "expiresAt": "2027-03-27T00:00:00.000Z"
}
```

Both fields are optional. `name` defaults to `"default"` (max 100 chars). `expiresAt` is an ISO 8601 date string.

**Response:**
```json
{
  "id": "uuid",
  "name": "CI/CD Key",
  "apiKey": "kk_a1b2c3d4..."
}
```

The `apiKey` value is shown **only once**. Store it securely.

### DELETE /auth/api-keys/:id

Delete an API key.

### POST /auth/confirm-auto-renewal

Confirm auto-renewal for free tier users. Required every 6 months to keep auto-renewal active.

---

## Domains

All endpoints require authentication. Write operations require `owner`, `admin`, or `member` role in an organization.

### GET /domains

List all domains for the current user (or organization).

**Response:**
```json
[
  {
    "id": "uuid",
    "hostname": "example.com",
    "isVerified": true,
    "verificationCode": "krakenkey-site-verification=abc123...",
    "createdAt": "2026-03-27T10:00:00.000Z",
    "updatedAt": "2026-03-27T10:00:00.000Z"
  }
]
```

### POST /domains

Register a new domain.

**Request:**
```json
{
  "hostname": "example.com"
}
```

`hostname` must be a valid FQDN, max 253 characters. Subject to plan-based domain limits.

**Response** (201): Domain object with `verificationCode` for DNS TXT setup.

### GET /domains/:id

Get a specific domain.

### POST /domains/:id/verify

Trigger DNS TXT verification for a domain. Checks for the verification code in DNS TXT records.

**Response** (200): Updated domain object with `isVerified: true` on success.

**Error** (400): Verification failed — TXT record not found or incorrect.

### DELETE /domains/:id

Remove a domain. Certificates already issued for this domain remain valid.

---

## Certificates

All endpoints require authentication. Write operations require `owner`, `admin`, or `member` role.

### POST /certs/tls

Submit a Certificate Signing Request for issuance.

**Request:**
```json
{
  "csrPem": "-----BEGIN CERTIFICATE REQUEST-----\nMIIC...\n-----END CERTIFICATE REQUEST-----"
}
```

**Validation:**
- PEM format, max 10,000 characters
- CSR signature verified against embedded public key
- RSA (min 2048-bit) or ECDSA (P-256, P-384)
- All domains (CN + SANs) must be verified in the user's account
- Plan-based limits enforced (concurrent pending, total active, monthly quota)

**Response** (201):
```json
{
  "id": 42,
  "status": "pending",
  "parsedCsr": {
    "subject": [{"shortName": "CN", "value": "example.com"}],
    "extensions": [{"name": "subjectAltName", "altNames": [...]}],
    "publicKeyLength": 4096
  },
  "createdAt": "2026-03-27T10:00:00.000Z"
}
```

### GET /certs/tls

List all certificates for the current user (or organization).

### GET /certs/tls/:id

Get certificate details and status.

**Response:**
```json
{
  "id": 42,
  "status": "issued",
  "parsedCsr": {...},
  "crtPem": "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----",
  "expiresAt": "2026-06-25T10:00:00.000Z",
  "autoRenew": true,
  "renewalCount": 0,
  "createdAt": "2026-03-27T10:00:00.000Z"
}
```

`rawCsr` and internal fields are excluded from API responses.

### GET /certs/tls/:id/details

Get parsed certificate details (issuer, subject, key type/size, validity, fingerprint). Only available for `issued` certificates.

### PATCH /certs/tls/:id

Update certificate metadata.

**Request:**
```json
{
  "autoRenew": false
}
```

### POST /certs/tls/:id/renew

Manually queue a renewal for an `issued` certificate. Creates a new ACME order using the original CSR.

### POST /certs/tls/:id/retry

Retry issuance for a `failed` certificate. Re-queues the original CSR.

### POST /certs/tls/:id/revoke

Revoke an issued certificate via ACME.

**Request:**
```json
{
  "reason": 1
}
```

`reason` is an optional RFC 5280 revocation code (0–10). Default: 0 (unspecified).

### DELETE /certs/tls/:id

Delete a certificate record. Only `failed` or `revoked` certificates can be deleted.

### Certificate Status Values

| Status | Description |
|--------|-------------|
| `pending` | CSR received, job queued |
| `issuing` | ACME workflow running |
| `issued` | Certificate issued successfully |
| `failed` | Failed after 3 retries |
| `renewing` | Renewal in progress |
| `revoking` | Revocation in progress |
| `revoked` | Certificate revoked |

---

## Billing

See [Billing](./BILLING.md) for full plan details and subscription lifecycle.

### POST /billing/checkout

Create a Stripe Checkout session. Returns a URL to redirect the user to.

**Request:**
```json
{
  "plan": "starter"
}
```

Valid plans: `starter`, `team`, `business`, `enterprise`

### GET /billing/subscription

Get the current user's (or organization's) subscription.

### POST /billing/portal

Create a Stripe Customer Portal session for managing payment methods, invoices, and cancellation.

### POST /billing/upgrade/preview

Preview the prorated cost of upgrading.

**Request:**
```json
{
  "plan": "business"
}
```

**Response:**
```json
{
  "currentPlan": "team",
  "newPlan": "business",
  "proratedAmount": 4500,
  "currency": "usd"
}
```

### POST /billing/upgrade

Execute a subscription upgrade. Charges the prorated difference immediately.

### POST /billing/webhook

Stripe webhook endpoint. Verifies webhook signature and processes events. Not called by users directly.

---

## Organizations

See [Organizations](./ORGANIZATIONS.md) for full feature documentation.

All endpoints require authentication.

### POST /organizations

Create a new organization. Requires Team+ plan. The creating user becomes the owner.

**Request:**
```json
{
  "name": "My Team"
}
```

### GET /organizations/:id

Get organization details with member list.

### POST /organizations/:id/members

Invite a member. Requires `owner` or `admin` role.

**Request:**
```json
{
  "email": "bob@example.com",
  "role": "member"
}
```

### DELETE /organizations/:id/members/:userId

Remove a member. Admins can remove non-owners; members can remove themselves.

### PATCH /organizations/:id

Update organization name. Requires `owner` or `admin` role.

### DELETE /organizations/:id

Delete organization. Owner only. Queues async dissolution.

### POST /organizations/:id/transfer-ownership

Transfer ownership to another member. Owner only.

**Request:**
```json
{
  "email": "bob@example.com"
}
```

### PATCH /organizations/:id/members/:userId

Update a member's role. Requires `owner` or `admin` role.

**Request:**
```json
{
  "role": "admin"
}
```

---

## Endpoints (Monitoring)

See [Endpoints](./ENDPOINTS.md) for full feature documentation.

All endpoints require authentication.

### POST /endpoints

Create a monitored endpoint.

**Request:**
```json
{
  "host": "api.example.com",
  "port": 443,
  "label": "Production API"
}
```

### GET /endpoints

List all monitored endpoints.

### GET /endpoints/:id

Get endpoint details.

### PATCH /endpoints/:id

Update endpoint settings.

### DELETE /endpoints/:id

Delete an endpoint.

### POST /endpoints/:id/scan

Request an immediate scan.

### GET /endpoints/:id/results

Get paginated scan results.

### GET /endpoints/:id/results/latest

Get the latest result from each assigned probe.

### GET /endpoints/:id/results/export

Export results as CSV or JSON. Query parameter: `format=csv` or `format=json`.

### GET /endpoints/probes/mine

List available connected probes.

### POST /endpoints/:id/probes

Assign probes to an endpoint.

### DELETE /endpoints/:id/probes/:probeId

Unassign a probe.

### POST /endpoints/:id/regions

Add a hosted probe region.

### DELETE /endpoints/:id/regions/:region

Remove a hosted region.

---

## Users

Admin-only endpoints except where noted.

### GET /users

List all users. Admin only.

### GET /users/:id

Get a user. Accessible to the user themselves or admins.

### PATCH /users/:id

Update a user. Accessible to the user themselves or admins.

### DELETE /users/:id

Delete a user account. Cascades: revokes all certificates, deletes domains, anonymizes feedback, deletes API keys.

Accessible to the user themselves or admins.

---

## Rate Limiting

Rate limits are applied per IP address, per user, and per API key. Limits vary by endpoint category. When rate limited, the API returns `429 Too Many Requests` with a `Retry-After` header.

---

## CSR Format Requirements

- **Format**: PEM with 64-character lines
- **Key types**: RSA (min 2048-bit, recommended 4096) or ECDSA (P-256, P-384)
- **Signature**: Must be self-signed with the corresponding private key
- **Domains**: CN and/or SANs — all must be verified in your account
- **Max size**: 10,000 characters
- **Wildcards**: Supported (e.g. `*.example.com`) — requires base domain verification

See [Certificate Flow](./CERTIFICATE_FLOW.md) for CSR generation examples.
