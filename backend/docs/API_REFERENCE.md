# API Reference

## Base URL

```
http://localhost:8888
```

## Documentation

Interactive API documentation available at:
```
http://localhost:8888/swagger
```

## Endpoints

### Health Check

#### GET /
Returns API status and version information.

**Response**:
```json
{
  "status": "ok",
  "version": "0.1.0"
}
```

**Response Code**: 200 OK

**Use Case**: Health checks, readiness probes, liveness checks

---

### Certificate Management

#### POST /certs/tls
Submit a Certificate Signing Request (CSR) for certificate issuance.

**Request Body**:
```json
{
  "csrPem": "-----BEGIN CERTIFICATE REQUEST-----\nMIIC...\n-----END CERTIFICATE REQUEST-----",
  "status": "pending"
}
```

**Request Parameters**:
- `csrPem` (string, required) - CSR in PEM format with proper line breaks
- `status` (string, required) - Initial status (typically "pending")

**Validation Rules**:
- CSR must be valid PEM format
- CSR signature must be verifiable
- Embedded public key must be RSA
- RSA key must be at least 2048 bits
- CSR cannot contain unauthorized domains (if authorization checks enabled)

**Response** (201 Created):
```json
{
  "id": 1,
  "status": "pending"
}
```

**Response Parameters**:
- `id` (number) - Database record ID for tracking certificate
- `status` (string) - Initial status ("pending")

**Error Responses**:

| Code | Error | Cause |
|------|-------|-------|
| 400 | BadRequestException | Invalid CSR PEM format |
| 400 | BadRequestException | CSR signature verification failed |
| 400 | BadRequestException | Only RSA keys are supported currently |
| 400 | BadRequestException | RSA key must be at least 2048 bits |
| 400 | BadRequestException | CSR contains unauthorized domains |

**Workflow**:
1. CSR is parsed and validated
2. Domains (SANs + CN) are extracted
3. Record saved to database with status "pending"
4. Job enqueued to `tlsCertIssuance` queue
5. Async processing begins immediately

**Job Queue Details**:
- Queue: `tlsCertIssuance`
- Max retries: 3
- Backoff: exponential (5s initial delay)
- Typical processing time: 2-5 minutes (dependent on DNS propagation)

---

#### GET /certs/tls/{id}
Retrieve certificate request details and status.

**Path Parameters**:
- `id` (number, required) - Certificate record ID

**Response** (200 OK):
```json
{
  "id": 1,
  "rawCsr": "-----BEGIN CERTIFICATE REQUEST-----\n...\n-----END CERTIFICATE REQUEST-----",
  "parsedCsr": {
    "subject": [...],
    "attributes": [...],
    "extensions": [...],
    "publicKeyLength": 2048
  },
  "crtPem": "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----",
  "status": "issued"
}
```

**Response Parameters**:
- `id` (number) - Record ID
- `rawCsr` (string) - Original CSR in PEM format
- `parsedCsr` (object) - Parsed CSR structure with certificate details
- `crtPem` (string | null) - Issued certificate in PEM format (null until issued)
- `status` (string) - Current status: "pending", "issuing", "issued", or "failed"

**Status Meanings**:
- `pending` - CSR received, waiting to be processed
- `issuing` - Certificate issuance in progress
- `issued` - Certificate successfully issued and stored
- `failed` - Issuance failed after max retries

**Error Responses**:

| Code | Error | Cause |
|------|-------|-------|
| 404 | Not Found | Certificate record not found |

---

#### PATCH /certs/tls/{id}
Update certificate record (manual updates, typically for admin use).

**Path Parameters**:
- `id` (number, required) - Certificate record ID

**Request Body**:
```json
{
  "csrPem": "...",
  "status": "issued",
  "crtPem": "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"
}
```

**Request Parameters** (all optional):
- `csrPem` (string) - Updated CSR PEM
- `status` (string) - Updated status
- `crtPem` (string | null) - Updated certificate PEM

**Response** (200 OK):
```json
{
  "id": 1,
  "rawCsr": "...",
  "parsedCsr": {...},
  "crtPem": "...",
  "status": "issued"
}
```

**Error Responses**:

| Code | Error | Cause |
|------|-------|-------|
| 404 | Not Found | Certificate record not found |

---

#### DELETE /certs/tls/{id}
Revoke or remove a certificate.

**Path Parameters**:
- `id` (number, required) - Certificate record ID

**Response** (200 OK):
```json
{
  "message": "This action revokes a #1 tlsCrt"
}
```

**Note**: This endpoint is currently a stub. Actual revocation logic needs implementation.

**Error Responses**:

| Code | Error | Cause |
|------|-------|-------|
| 404 | Not Found | Certificate record not found |

---

## Data Types

### TlsCrt Object
```typescript
{
  id: number;                 // Primary key
  rawCsr: string;            // Original CSR PEM
  parsedCsr: JSON;           // Parsed CSR details
  crtPem: string | null;     // Issued certificate
  status: string;            // Status flag
}
```

### CreateTlsCrtDto
```typescript
{
  csrPem: string;    // CSR in PEM format
  status: string;    // Initial status
}
```

### UpdateTlsCrtDto
```typescript
{
  csrPem?: string;           // Optional CSR update
  status?: string;           // Optional status update
  crtPem?: string | null;    // Optional certificate update
}
```

---

## Common Request/Response Patterns

### Successful CSR Submission
```
Request:
POST /certs/tls
Content-Type: application/json

{
  "csrPem": "-----BEGIN CERTIFICATE REQUEST-----\n...",
  "status": "pending"
}

Response:
201 Created
{
  "id": 42,
  "status": "pending"
}
```

### Polling for Certificate Status
```
Request:
GET /certs/tls/42

Response:
200 OK
{
  "id": 42,
  "status": "issued",
  "crtPem": "-----BEGIN CERTIFICATE-----\n..."
}
```

### Typical Polling Intervals
- Initial check: 10-30 seconds
- Regular polling: 30-60 seconds
- Max polling time: 10-15 minutes

---

## Error Handling

### Error Response Format

All errors follow a consistent format:

```json
{
  "statusCode": 400,
  "message": "Invalid CSR PEM format",
  "error": "BadRequestException"
}
```

### Common HTTP Status Codes

| Code | Meaning | When It Occurs |
|------|---------|----------------|
| 200 | OK | Successful GET/PATCH/DELETE |
| 201 | Created | Successful POST |
| 400 | Bad Request | Validation failure, invalid input |
| 404 | Not Found | Resource doesn't exist |
| 500 | Internal Server Error | Server-side exception |

---

## Rate Limiting

Currently no rate limiting is implemented. For production use, consider:
- Rate limiting per IP address
- Rate limiting per user/API key
- Burst allowance for legitimate clients

---

## Authentication

Authentication is handled via **Authentik (OIDC)** for users and **API Keys** for automation.
All protected endpoints require a valid `Authorization` header.

**Header Format**:
```
Authorization: Bearer <token_or_api_key>
```

---

## CSR Format Requirements

### Valid CSR Format
PEM format with proper line breaks (64 characters per line):

```
-----BEGIN CERTIFICATE REQUEST-----
MIICnjCCAYcCAQAwXTELMAkGA1UEBhMCQVUxEzARBgNVBAgMClNvbWUtU3RhdGUx
ITAfBgNVBAoMGEludGVybmV0IFdpZGdpdHMgUHR5IEx0ZDEYMBYGA1UEAwwPZXhh
...
-----END CERTIFICATE REQUEST-----
```

### CSR Requirements
- **Algorithm**: RSA (currently only supported)
- **Key Size**: Minimum 2048 bits (4096 recommended)
- **Signature**: Self-signed with private key
- **Domains**: At least one domain (CN) with optional SANs

### SANs Support
The API automatically extracts both:
- Common Name (CN) from subject
- Subject Alternative Names (SANs) from extensions

Example domains:
```
CN: example.com
SANs: www.example.com, api.example.com
Result domains: [example.com, www.example.com, api.example.com]
```

---

## Certificate Status Lifecycle

```
              Submit CSR
                  ↓
            +─────────────+
            │   pending   │  (awaiting processing)
            +─────────────+
                  ↓
            +─────────────+
            │   issuing   │  (ACME workflow in progress)
            +─────────────+
                  ↓
        ┌─────────┴──────────┐
        ↓                    ↓
    +────────+        +─────────────+
    │ issued │        │   failed    │
    +────────+        +─────────────+
    (success)         (manual retry)
```

**Possible Transitions**:
- `pending` → `issuing` (automatic)
- `issuing` → `issued` (automatic)
- `issuing` → `failed` (after max retries)
- Any status → manual update via PATCH

---

## Webhook Support

Not currently implemented. Future enhancement:
- Webhook delivery on status changes
- Event: cert.issued, cert.failed
- Configurable callback URLs

---

## Batch Operations

Not currently supported. Future enhancement:
- Batch CSR submission
- Bulk status check
- Bulk operations endpoint

---

## Examples

### JavaScript/Fetch

```javascript
// Submit CSR
const response = await fetch('http://localhost:8080/certs/tls', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    csrPem: csrPemString,
    status: 'pending'
  })
});
const { id, status } = await response.json();

// Poll for status
const pollInterval = setInterval(async () => {
  const statusResponse = await fetch(`http://localhost:8080/certs/tls/${id}`);
  const { status, crtPem } = await statusResponse.json();

  if (status === 'issued') {
    console.log('Certificate ready:', crtPem);
    clearInterval(pollInterval);
  }
}, 5000);
```

### cURL

```bash
# Submit CSR
curl -X POST http://localhost:8080/certs/tls \
  -H "Content-Type: application/json" \
  -d '{
    "csrPem": "-----BEGIN CERTIFICATE REQUEST-----\n...",
    "status": "pending"
  }'

# Get status
curl http://localhost:8080/certs/tls/1
```

---

## Debugging

### Enable Request Logging
Set environment variable: `DEBUG=nestjs:*`

### Database Query Logging
Set in database config: `logging: ['query']`

### ACME Debug Logging
Check application logs for ACME client debug output

---

## Authentication & API Keys

### Overview

KrakenKey uses **Authentik (OIDC)** for user authentication and **API Keys** for automation.

#### Human Login Flow
1. User visits application URL.
2. Redirected to `https://auth.krakenkey.io` (Authentik).
3. Authenticates and redirects back to `/auth/callback`.
4. Backend swaps code for access token.

### Endpoints

#### GET /auth/login
Initiates the OIDC login flow.
**Response**: Redirects to Authentik. or returns redirect URL.

#### GET /auth/register
Initiates the OIDC registration flow.
**Response**: Redirects to Authentik enrollment.

#### GET /auth/callback
Handles the OIDC callback.
**Query Parameters**: `code` (string)
**Response**: Returns auth tokens/session data.

#### POST /auth/api-keys
Generate a new API key.
**Restricted**: Requires JWT authentication.

**Headers:**
```
Authorization: Bearer <authentik_access_token>
```

**Request Body:**
```json
{
  "name": "default"
}
```

**Response:**
```json
{
  "apiKey": "kk__abc123..."
}
```

**Notes:**
- The API key is shown **only once**.
- Store it securely; it cannot be retrieved again.
- The key is hashed before being stored in the database.

---

#### `GET /auth/profile`
Retrieve the authenticated user’s profile.

**Headers:**
```
Authorization: Bearer <authentik_access_token>
```

**Response:**
```json
{
  "userId": "uuid",
  "username": "jdoe",
  "email": "jdoe@example.com",
  "groups": ["users"]
}
```

---

#### `Authorization: Bearer kk__...`
Use API keys for automation.

**Example:**
```bash
curl -H "Authorization: Bearer kk__abc123..." https://api.krakenkey.io/certs/tls
```

**Validation:**
- API keys are validated via SHA-256 hash lookup.
- Invalid or revoked keys return `401 Unauthorized`.

---

### Security Notes
- API keys are **long-lived** and should be rotated regularly.
- Authentik access tokens are **short-lived** and used for user sessions.
- Both authentication methods use the `Authorization: Bearer` header.

---

## User Management

#### GET /users
Retrieve all users.

**Response**: Array of User objects.

#### GET /users/{id}
Retrieve a specific user.

#### PATCH /users/{id}
Update a user.

#### DELETE /users/{id}
Delete a user.

---

## Domain Management

#### GET /domains
List all domains for the authenticated user.

**Response**:
```json
[
  {
    "id": "uuid",
    "hostname": "example.com",
    "isVerified": false,
    "verificationCode": "krakenkey-site-verification=..."
  }
]
```

#### POST /domains
Add a new domain.

**Request Body**:
```json
{
  "hostname": "example.com"
}
```

#### POST /domains/{id}/verify
Trigger DNS verification for a domain.

**Response**:
Verified domain object or 400 Bad Request if verification fails.

#### DELETE /domains/{id}
Remove a domain.
