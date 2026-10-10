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

**API keys** — Long-lived, prefixed with `kk_`. Created from a dashboard session. The raw key is shown only once at creation time.

Both methods use the same header format. The backend tries JWT validation first, then falls back to API key validation.

API keys work for domains, certificates and endpoints, but some routes only accept a dashboard session and return `403` for a key, so a leaked key can't mint a replacement or take the account over:

- `POST /auth/api-keys`, `DELETE /auth/api-keys/:id`
- `PATCH /users/:id`, `DELETE /users/:id`
- `POST /organizations` and every organization change: members, roles, settings, deletion, ownership transfer
- `POST /billing/checkout`, `POST /billing/portal`, `POST /billing/upgrade`

Admin rights also need a session; an admin's API key acts as a regular user. The routes are marked with `@SessionOnly()` and enforced by `JwtOrApiKeyGuard`.

### API key scopes and restrictions

A key can be limited when it is created. None of the limits can be changed afterwards; create a new key instead. A key created without limits has full access, which is also what every key created before scopes existed has.

**Scopes.** A key with `scopes` set can only call routes that declare one of them, and gets `403` (`This API key needs the <scope> scope for this request.`) everywhere else. Dashboard sessions are not affected.

| Scope | Routes |
| --- | --- |
| `certs:read` | `GET /certs/tls`, `GET /certs/tls/:id`, `/details`, `/chain` |
| `certs:issue` | `POST /certs/tls`, `POST /certs/tls/:id/retry` |
| `certs:renew` | `POST /certs/tls/:id/renew`, `PATCH /certs/tls/:id` |
| `certs:revoke` | `POST /certs/tls/:id/revoke`, `DELETE /certs/tls/:id` |
| `domains:read` | `GET /domains`, `GET /domains/:id` |
| `domains:write` | `POST /domains`, `POST /domains/:id/verify`, `DELETE /domains/:id` |
| `endpoints:read` | `GET /endpoints`, `GET /endpoints/:id`, results, export, latest, `GET /endpoints/probes/mine` |
| `endpoints:write` | every other `/endpoints` route (create, update, delete, probes, regions, scan) |
| `probes:report` | `POST /probes/register`, `POST /probes/report`, `GET /probes/:probeId/config` |
| `account:read` | `GET /auth/profile`, `GET /auth/api-keys`, `GET /users/:id`, `GET /billing/subscription`, `POST /billing/upgrade/preview`, `GET /organizations/:id` |
| `account:write` | `PATCH /auth/profile`, `POST /auth/confirm-auto-renewal`, `POST /feedback` |

The dashboard and CLI offer presets: **read-only** (`certs:read`, `domains:read`, `endpoints:read`, `account:read`), **cert renewal** (`certs:read`, `certs:renew`, `account:read`), **probe** (`probes:report`) and **full** (no scopes). The lists live in `API_KEY_SCOPES` and `API_KEY_PRESETS` in `@krakenkey/shared`. A new route is refused to scoped keys until it declares a scope with `@RequireScope()`, and `require-scope.coverage.spec.ts` fails if a route that accepts keys declares neither a scope nor `@SessionOnly()`.

**Domains.** `allowedDomainIds` limits the key to those domains (ids of domains on the account or its organization):

- certificates are visible only when every name on them is one of those domains or a subdomain; others return `404`
- `POST /certs/tls` refuses a CSR with any name outside them (`403`)
- only those domains are listed, the rest return `404`, and `POST /domains` is refused
- endpoints are visible, and can be created, only for hosts under those domains

**Certificates.** `allowedCertIds` limits the key to those certificates; others return `404`. Such a key cannot request new certificates. Renewal keeps the certificate id, so the limit survives renewals.

When a key has both, a certificate must satisfy both. Keys limited to domains or certificates cannot use the probe routes, since a probe sees every endpoint assigned to it.

**Source IPs.** `allowedIps` takes up to 20 IPv4/IPv6 addresses or CIDR ranges. A request from any other address gets `403` (`This API key cannot be used from this IP address.`), is logged with the key id and address, does not update `lastUsedAt`, and does not count toward the failed-key lockout. The address is the client IP as resolved through `KK_TRUSTED_PROXIES`.

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

### GET /auth/logout-url

Returns the Authentik end-session endpoint for OIDC RP-initiated logout, and the app origin to return to afterwards. The dashboard clears its token, then sends the browser to `url` with `id_token_hint=<ID token>` and `post_logout_redirect_uri=<postLogoutRedirectUri>`, which ends the Authentik session. The ID token goes to Authentik, not to this API.

`url` is `KK_AUTHENTIK_ISSUER_URL` + `end-session/`. `postLogoutRedirectUri` is the origin of `KK_AUTHENTIK_REDIRECT_URI` and must be registered as a logout redirect URI on the Authentik provider.

**Authentication**: None

**Response:**
```json
{
  "url": "https://auth.krakenkey.io/application/o/krakenkey/end-session/",
  "postLogoutRedirectUri": "https://app.krakenkey.io"
}
```

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

List the current user's active API keys. Returns metadata only (name, dates, last use); hashes are never exposed.

Query: `includeRevoked=true` also returns keys revoked in the last 30 days, with `revokedAt` set. The dashboard uses this; older clients that omit it only ever see active keys.

**Response:**
```json
[
  {
    "id": "uuid",
    "name": "CI/CD Key",
    "expiresAt": "2027-03-27T00:00:00.000Z",
    "createdAt": "2026-03-27T10:00:00.000Z",
    "revokedAt": null,
    "lastUsedAt": "2026-03-28T09:15:00.000Z",
    "lastUsedIp": "203.0.113.7",
    "scopes": ["certs:read", "certs:renew", "account:read"],
    "allowedDomainIds": ["3f1c2b9e-..."],
    "allowedCertIds": null,
    "allowedIps": ["203.0.113.7"]
  }
]
```

`scopes`, `allowedDomainIds`, `allowedCertIds` and `allowedIps` are `null` when the key is not limited that way.

`lastUsedAt` and `lastUsedIp` are updated on successful authentication, at most once a minute per key unless the client IP changes. `lastUsedIp` is the client address as resolved through `KK_TRUSTED_PROXIES`.

### POST /auth/api-keys

Generate a new API key.

**Request:**
```json
{
  "name": "pfe renewal",
  "expiresAt": "2027-03-27T00:00:00.000Z",
  "scopes": ["certs:read", "certs:renew", "account:read"],
  "allowedDomainIds": ["3f1c2b9e-..."],
  "allowedIps": ["203.0.113.7"]
}
```

Every field is optional. `name` defaults to `"default"` (max 100 chars). `expiresAt` is an ISO 8601 date string. `scopes`, `allowedDomainIds` (max 50), `allowedCertIds` (max 50) and `allowedIps` (max 20) are described in [API key scopes and restrictions](#api-key-scopes-and-restrictions); omit them for a full-access key. Unknown scopes, ids that don't belong to the account or its organization, and malformed IPs or ranges return `400`.

**Response:**
```json
{
  "id": "uuid",
  "name": "pfe renewal",
  "apiKey": "kk_a1b2c3d4...",
  "scopes": ["certs:read", "certs:renew", "account:read"],
  "allowedDomainIds": ["3f1c2b9e-..."],
  "allowedCertIds": null,
  "allowedIps": ["203.0.113.7"]
}
```

The `apiKey` value is shown **only once**. Store it securely.

### GitHub Actions OIDC

Workflows can authenticate without a stored API key. The account owner creates a **trust policy** for a repository in the dashboard; a workflow job in that repository then exchanges its GitHub OIDC token for an API key that lasts 15 minutes and carries the policy's scopes and restrictions. The [GitHub Action](https://github.com/KrakenKey/cert-action) does this when no `api-key` input is set and the job has `permissions: id-token: write`.

#### POST /auth/github-oidc

No authentication. Rate-limited as a public route.

```json
{ "token": "<GitHub Actions OIDC JWT>", "trustId": "optional uuid" }
```

The token must be signed by GitHub (`https://token.actions.githubusercontent.com`, keys from its JWKS, RS256 only), unexpired, and issued for the audience `https://api.krakenkey.io` (`KK_GITHUB_OIDC_AUDIENCE` on other environments). Then it must match exactly one trust policy:

- `repository` equals the token's `repository` (case-insensitive), and its numeric `repository_id` equals the one pinned on the policy. The id is pinned when the policy is created (see below) or else from the first token, so a repository deleted and re-created under the same name is refused.
- If the policy has `allowedRefs`, the token's `ref` equals one of them, or starts with an entry ending in `*` (`refs/tags/v*`).
- If the policy has `environment`, the job runs in that GitHub environment.

**Response `200`:**
```json
{
  "apiKey": "kk_...",
  "expiresAt": "2026-10-06T00:15:00.000Z",
  "trustId": "uuid",
  "scopes": ["certs:read", "certs:renew", "account:read"]
}
```

`401` for an invalid, expired or wrong-audience token; `403` when no policy matches; `409` with `trustIds` when several do (pass `trustId`). These keys are not listed under `GET /auth/api-keys`, don't count toward the plan's key limit, and are deleted an hour after they expire. Every exchange is logged with the repository, ref, commit, run id and actor; the policy records when it was last used and from which ref.

#### GET /auth/github-oidc/trusts

Lists trust policies (`account:read`). Each has `id`, `name`, `repository`, `repositoryId` (null until pinned), `allowedRefs`, `environment`, `scopes`, `allowedDomainIds`, `allowedCertIds`, `lastUsedAt`, `lastUsedRef` and `createdAt`.

#### POST /auth/github-oidc/trusts

Creates a policy. Dashboard session only, like creating API keys.

```json
{
  "name": "website deploy",
  "repository": "octo/website",
  "repositoryId": "123456789",
  "allowedRefs": ["refs/heads/main"],
  "environment": "production",
  "scopes": ["certs:read", "certs:renew", "account:read"],
  "allowedDomainIds": ["3f1c2b9e-..."]
}
```

Only `name` and `repository` are required.

The policy is pinned to GitHub's numeric repository id right away when possible:

- With `repositoryId`, that id is used. If the repository is public and GitHub reports a different id, the request fails with `400`, which catches a typo in either field.
- Without it, KrakenKey looks the repository up on GitHub's public API (unauthenticated, 3-second timeout). A public repository is pinned to the id GitHub returns. A private, misspelled or renamed repository, or a failed lookup, leaves `repositoryId` null, and the policy pins to the first token that matches it.

For a private repository, get the id with `gh api repos/OWNER/NAME --jq .id`.

Scopes and restrictions work as for [API keys](#api-key-scopes-and-restrictions). Policies can't be edited; create a new one and delete the old. Up to 20 per account.

#### DELETE /auth/github-oidc/trusts/:id

Deletes a policy. Dashboard session only. Keys it already issued stay valid until they expire (at most 15 minutes).

### DELETE /auth/api-keys/:id

Revoke an API key. It stops authenticating immediately and no longer counts toward the plan's API key limit. The row is kept, and listed with `includeRevoked=true`, for 30 days; a daily job deletes it after that. Returns `404` if the key doesn't exist, belongs to someone else, or is already revoked.

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

Submit a Certificate Signing Request for issuance, or create a [pending certificate](#pending-certificates) that a connector issues with its own key. Send exactly one of `csrPem` and `names`; both or neither return `400`.

**Request (CSR):**
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
  "status": "pending"
}
```

#### Pending certificates

A connector keeps its private keys on its own machine, so it can't hand a CSR to the dashboard. Instead the certificate is created from its names, and the connector completes it later with a CSR made with its own key.

**Request (names):**
```json
{
  "names": ["example.com", "www.example.com"],
  "managedBy": "connector"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `names` | string[] | 1 to 100 DNS names; a leading `*.` wildcard is allowed. IP addresses, trailing dots and other forms return `400`. Names are lowercased and duplicates dropped; the order is kept. |
| `managedBy` | `"connector"` | Required with `names`. Any other value, or leaving it out, returns `400`. `managedBy` is not accepted with `csrPem`; use [PATCH](#patch-certstlsid) on an existing certificate. |

The names get the same checks a CSR's names get: each must be one of the account's (or organization's) verified domains or a subdomain of one (`400` otherwise, and `400` when no domain is verified), and an API key limited to domains may only use names under them (`403`). An API key limited to certificates cannot create one (`403`).

The certificate is created with status `awaiting_csr`, `rawCsr` and `parsedCsr` `null`, `requestedNames` set, `managedBy: "connector"` and `autoRenew: false`. Nothing is sent to the CA. It counts toward the total active certificate and monthly limits, but not the concurrent pending limit. A repeat of the same set of names within 15 minutes returns the original certificate, like a repeated CSR.

**Response** (201):
```json
{
  "id": 43,
  "status": "awaiting_csr"
}
```

The connector completes it with [`POST /certs/tls/:id/renew`](#post-certstlsidrenew) and a `csrPem` whose names equal `requestedNames`. Until then it can be deleted. See [CERTIFICATE_FLOW.md](CERTIFICATE_FLOW.md#pending-certificates) for the whole flow.

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
  "managedBy": null,
  "renewAfter": "2026-05-26T10:00:00.000Z",
  "createdAt": "2026-03-27T10:00:00.000Z"
}
```

`managedBy` is `"connector"` when a customer-hosted connector renews the certificate (see [PATCH /certs/tls/:id](#patch-certstlsid)), otherwise `null`.

`requestedNames` is the list of names a [pending certificate](#pending-certificates) was created with, and stays set after the connector's CSR arrives. It is `null` for certificates requested with a CSR. While a certificate is `awaiting_csr`, `rawCsr` and `parsedCsr` are `null`, so read its names from `requestedNames`.

`renewAfter` (ISO 8601) is when the certificate will be renewed:

- **Connector-managed certificates:** the earlier of `expiresAt` minus the renewal window and the start of the CA's suggested window (`ariWindowStart`, see [ACME Renewal Information](CERTIFICATE_FLOW.md#acme-renewal-information-ari)), routine or early, since the connector follows the CA's suggestion. The renewal window is the owner's plan window but at least 30 days on every plan.
- **Other certificates:** `expiresAt` minus the plan's renewal window (Free: 5 days, paid plans: 30 days). `ariWindowStart` only counts, when it is earlier, once the CA has asked for early replacement (`ariReplacementRequestedAt` set), because that is the only time KrakenKey renews early. A routine ARI window does not move it.

It is computed on each read, and is `null` when the certificate has no expiry yet (not issued) or is revoked. For an `awaiting_csr` certificate it is the creation time: the certificate is due now. `GET /certs/tls` and `PATCH /certs/tls/:id` return the same two fields.

`rawCsr` and internal fields are excluded from API responses.

### GET /certs/tls/:id/details

Get parsed certificate details (issuer, subject, key type/size, validity, fingerprint). Only available for `issued` certificates.

### GET /certs/tls/:id/chain

Get the full certificate chain: leaf certificate details, parsed intermediate CA entries, and the PEM-concatenated full chain. Only available for `issued` certificates.

**Response:**
```json
{
  "leafCert": {
    "serialNumber": "...",
    "issuer": "...",
    "subject": "...",
    "validFrom": "2026-05-14T10:00:00.000Z",
    "validTo": "2026-08-12T10:00:00.000Z",
    "keyType": "RSA",
    "keySize": 2048,
    "fingerprint": "..."
  },
  "intermediates": [
    {
      "serialNumber": "...",
      "issuer": "...",
      "subject": "...",
      "validFrom": "2026-01-01T00:00:00.000Z",
      "validTo": "2031-01-01T00:00:00.000Z",
      "fingerprint": "..."
    }
  ],
  "fullChainPem": "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----\n-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"
}
```

Returns `400` if the certificate has not yet been issued.

### PATCH /certs/tls/:id

Update certificate metadata. Needs the `certs:renew` scope. Returns the updated certificate.

**Request:**
```json
{
  "autoRenew": false,
  "managedBy": "connector"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `autoRenew` | boolean | Turn KrakenKey's automatic renewal on or off. |
| `managedBy` | `"connector"` or `null` | `"connector"` hands renewal to a customer-hosted connector that keeps the private key and renews with a new CSR (see [renew](#post-certstlsidrenew)). KrakenKey then never renews the certificate on its own: the daily auto-renewal and ARI early replacement both skip it, whatever `autoRenew` says. Expiry warnings, `cert.expiring` and `cert.replacement_requested` alerts and ARI checks still run. `null` hands renewal back to KrakenKey. Any other value returns `400`. |

Other fields are ignored and never stored, the same as on every other route. In particular a `csrPem` here does not change the certificate's CSR; to renew with a new CSR, send it to [`POST /certs/tls/:id/renew`](#post-certstlsidrenew).

### POST /certs/tls/:id/renew

Manually queue a renewal for an `issued` certificate. Creates a new ACME order using the stored CSR, or a new one from the request body. By default the renewal always runs, whatever the expiry date, so it can be used to replace a certificate right away (for example after a key compromise). Each renewal counts against the monthly certificate limit.

**Request body (optional):**
```json
{
  "csrPem": "-----BEGIN CERTIFICATE REQUEST-----\n...\n-----END CERTIFICATE REQUEST-----"
}
```

Without a body, the CSR stored at first issuance is used again, so the key stays the same. With `csrPem`, the certificate is renewed with that CSR, which lets a client that keeps its keys locally rotate the key on every renewal:

- The CSR gets the same checks as [POST /certs/tls](#post-certstls): PEM format, at most 10,000 characters, a valid signature, and an RSA (2048 bits or more) or ECDSA (P-256, P-384) key. A CSR that fails returns `400`. Domain verification is not checked again, the same as any renewal; the name rule below keeps the certificate on the names it already had.
- Its names (CN plus DNS SANs, lowercased, without duplicates, in any order) must equal the certificate's names. Otherwise the response is `400` with the message `CSR names must match the certificate`. To change names, request a new certificate.
- Once the renewal is queued, the new CSR replaces the stored one, so later renewals (and a retry after a failed renewal) use it. When `ifDue=true` skips the renewal, or a plan limit refuses it, the stored CSR is left unchanged.

Scope (`certs:renew`), roles, API key limits and rate limit category are the same with or without a body.

**Completing a pending certificate.** For an `awaiting_csr` certificate (see [pending certificates](#pending-certificates)) the body is required: without `csrPem` the response is `400` `This certificate is waiting for a CSR`. The CSR gets the checks above, its names must equal `requestedNames` (same comparison, `400` `CSR names must match the certificate` otherwise), and they must still be under the account's verified domains. Then it is issued like a new request: the CSR is stored, the status goes `pending` -> `issuing` -> `issued`, a `cert.issued` alert is sent, and the concurrent pending and monthly limits apply (the certificate itself already holds its place in the total active and monthly counts). `ifDue=true` always treats it as due. `certs:renew` is enough, so an API key limited to that certificate (`allowedCertIds`) can complete it. If two requests race, one gets `409`.

```json
{
  "id": 43,
  "status": "pending",
  "skipped": false
}
```

**Query parameters:**

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `ifDue` | boolean | `false` | Only renew if the certificate is inside its plan's renewal window (Free: 5 days before expiry, paid plans: 30 days, the same window auto-renewal uses). A connector-managed certificate is due once its `renewAfter` has passed (at least 30 days before expiry, earlier when the CA's ARI window opens sooner), and only then, even when the CA has asked for early replacement. Only the string `true` turns it on. |

A certificate the CA has asked to replace early (`ariReplacementRequestedAt` set, see [ACME Renewal Information](CERTIFICATE_FLOW.md#acme-renewal-information-ari)) counts as due whatever the window.

Use `ifDue=true` when calling renew on a schedule (cron, systemd timer, CI): it renews once the certificate is due and does nothing on the other days, so no quota is used. A certificate with no recorded expiry is always renewed. The status and CSR checks run first either way, so a certificate that is not `issued` still returns `400`.

**Response `201` (renewal queued):**
```json
{
  "id": 42,
  "status": "renewing",
  "skipped": false
}
```

**Response `200` (`ifDue=true`, not due yet; nothing queued, status unchanged):**
```json
{
  "id": 42,
  "status": "issued",
  "skipped": true,
  "reason": "not_due",
  "expiresAt": "2026-12-20T09:15:00.000Z",
  "renewalWindowDays": 30
}
```

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

Delete a certificate record. Only `failed`, `revoked` or `awaiting_csr` certificates can be deleted.

### Certificate Status Values

| Status | Description |
|--------|-------------|
| `awaiting_csr` | Created from names; waiting for a connector's CSR. Not sent to the CA. |
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

## Notification Channels

Send alerts to Slack, Microsoft Teams or your own HTTPS endpoint, alongside the existing emails. Channels belong to the signed-in user. Each user can have up to 10.

| Method | Path | Scope | Rate limit | Description |
|--------|------|-------|------------|-------------|
| GET | `/notifications/channels` | `account:read` | read | List channels |
| POST | `/notifications/channels` | `account:write` | write | Add a channel |
| PATCH | `/notifications/channels/:id` | `account:write` | write | Change `name`, `url`, `events` or `enabled` |
| DELETE | `/notifications/channels/:id` | `account:write` | write | Delete a channel (`204`) |
| POST | `/notifications/channels/:id/test` | `account:write` | expensive | Send a `test` alert now and report the result |
| POST | `/notifications/channels/:id/rotate-secret` | `account:write` | write | New webhook signing secret (webhook channels only) |

A channel that belongs to someone else returns `404`. API keys limited to specific domains or certificates can list channels but get `403` on the write routes, because a channel receives alerts for the whole account.

### Channel types and URLs

| `type` | Accepted URL |
|--------|--------------|
| `slack` | A Slack incoming webhook: `https://hooks.slack.com/services/...` |
| `teams` | A Teams **Workflows** webhook (Power Automate "When a Teams webhook request is received"): https, host ending in `.logic.azure.com`, `.powerplatform.com`, `.environment.api.powerplatform.com` or `.webhook.office.com`. Microsoft has retired Office 365 connectors, so their `outlook.office.com/webhook/...` URLs are not accepted. |
| `webhook` | Any `https` URL whose host resolves only to public addresses. Any port is fine. URLs with a username or password, `localhost`, and private, loopback, link-local or IPv4-mapped private addresses are rejected. The host is checked again on every delivery. |

URLs and webhook secrets are stored encrypted (AES-256-GCM, key derived from `KK_HMAC_SECRET`). Responses only include `urlMasked`, for example `https://hooks.slack.com/…a1B2`.

### Events

| Event | Sent when |
|-------|-----------|
| `cert.issued` | A new certificate was issued |
| `cert.renewed` | A certificate was renewed |
| `cert.failed` | Issuance or renewal failed after all retries |
| `cert.expiring` | The daily expiry check found a certificate inside its renewal window |
| `cert.revoked` | A certificate was revoked |
| `cert.replacement_requested` | The CA asked for early replacement (ACME ARI) |
| `domain.verification_failed` | A verified domain failed its daily TXT re-check |
| `endpoint.scan_failed` | A monitored endpoint started failing: connection error, incomplete or untrusted chain, or expired certificate. Sent when a probe's result changes from healthy (or no previous result) to failing, not on every failing scan. |

When `events` is left out, a new channel subscribes to everything except `cert.issued` and `cert.renewed`.

### POST /notifications/channels

**Request:**
```json
{
  "type": "webhook",
  "name": "SIEM",
  "url": "https://hooks.example.com/krakenkey",
  "events": ["cert.failed", "cert.expiring", "endpoint.scan_failed"]
}
```

**Response (201):**
```json
{
  "id": "3f0c9a4e-8d1b-4c55-9a8e-2b7d1c0e6f11",
  "type": "webhook",
  "name": "SIEM",
  "urlMasked": "https://hooks.example.com/…okey",
  "events": ["cert.failed", "cert.expiring", "endpoint.scan_failed"],
  "enabled": true,
  "hasSecret": true,
  "lastDeliveryAt": null,
  "lastDeliveryStatus": null,
  "lastError": null,
  "createdAt": "2026-10-05T12:00:00.000Z",
  "updatedAt": "2026-10-05T12:00:00.000Z",
  "secret": "whsec_6vQ2..."
}
```

`secret` is only present for webhook channels and only in this response. Store it now; it cannot be read back. Use `rotate-secret` to get a new one, which also returns it once and replaces the old one immediately.

### POST /notifications/channels/:id/test

Sends a `test` event right away (no queue, no retries) and records the outcome on the channel.

```json
{ "ok": false, "status": 404, "error": "HTTP 404" }
```

### Delivery

Alerts are queued on the `notifications` BullMQ queue, one job per channel. Each delivery is a `POST` with a 10 second timeout. Redirects are not followed. Network errors, timeouts, `408`, `429` and `5xx` are retried up to 5 attempts with exponential backoff starting at 30 seconds. Any other non-2xx status is recorded as failed and not retried. Every attempt updates `lastDeliveryAt`, `lastDeliveryStatus` (`ok` or `failed`) and `lastError`.

### Webhook payload

```http
POST /krakenkey HTTP/1.1
Content-Type: application/json
User-Agent: KrakenKey-Webhooks/1
X-KrakenKey-Event: cert.expiring
X-KrakenKey-Delivery: 9b2e6f0a-41c7-4d8e-a1f3-6c0d2b7e9a55
X-KrakenKey-Signature: t=1759665600,v1=5f1c...e9

{
  "id": "9b2e6f0a-41c7-4d8e-a1f3-6c0d2b7e9a55",
  "type": "cert.expiring",
  "createdAt": "2026-10-05T06:00:01.000Z",
  "data": {
    "title": "Certificate expiring soon",
    "subject": "api.example.com",
    "resource": { "type": "certificate", "id": 42 },
    "details": {
      "certificateId": 42,
      "expiresAt": "2026-10-10T00:00:00.000Z",
      "daysUntilExpiry": 5
    },
    "url": "https://app.krakenkey.io/dashboard/certificates"
  }
}
```

`id` is unique per delivery and repeats across retries of the same delivery, so you can use it to drop duplicates. `data.resource` is `null` for `test` events. `data.details` varies by event.

### Verifying the signature

`X-KrakenKey-Signature` is `t=<unix seconds>,v1=<hex>`, where `<hex>` is HMAC-SHA256 of `<t>.<raw request body>` keyed with the full secret string (including `whsec_`). Compute it over the raw bytes before parsing the JSON, compare in constant time, and reject old timestamps to stop replays.

```js
const crypto = require('node:crypto');

function verifyKrakenKey(rawBody, header, secret, toleranceSec = 300) {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${t}.${rawBody}`)
    .digest('hex');
  const given = Buffer.from(parts.v1 ?? '', 'hex');
  const want = Buffer.from(expected, 'hex');
  return given.length === want.length && crypto.timingSafeEqual(given, want);
}

// Express: app.post('/krakenkey', express.raw({ type: 'application/json' }), (req, res) => {
//   if (!verifyKrakenKey(req.body.toString('utf8'), req.get('X-KrakenKey-Signature'), process.env.KK_WEBHOOK_SECRET))
//     return res.sendStatus(401);
//   ...
// });
```

---

## Reports

Portfolio TLS reports: scan a list of hosts once and get expiry, issuer, hostname coverage, chain problems and reachability for each, sorted by what needs attention first. Owner only: another account's report returns `404`, also for organization members. API keys limited to specific domains or certificates get `403` on every report route.

### POST /reports

Create a report. Scope: `account:write`. Rate limit category: expensive.

**Request:**
```json
{
  "name": "Client sites",
  "hosts": ["example.com", "shop.example.com", "api.example.com:8443"]
}
```

- `hosts`: one hostname per entry, optionally with `:port` (default `443`). A pasted URL such as `https://example.com/login` is reduced to its host and port. Entries are lowercased and duplicates (same host and port) dropped.
- IP addresses, single-label names (`localhost`), wildcards and internal suffixes (`.local`, `.internal`, `.lan`, `.home.arpa`) are refused with `400`; `message` lists every rejected entry. Names that resolve to a private or internal address are refused at scan time and show up as a critical host.
- Plan limit, counted after dedupe: Free 25 hosts per report, paid plans 250. Over the limit returns `403` with `code: "plan_limit_exceeded"`, `limit`, `current` and `plan`.

Returns the report with `status: "pending"`. Hosts are scanned in the background, five at a time with a 20 second limit each, through the same scanner as `POST /public-scan`. Status moves `pending` -> `running` -> `complete` (or `failed`), and each host is stored as soon as it finishes, so poll `GET /reports/:id`.

### GET /reports

List your reports (newest first, up to 100). Scope: `account:read`. Each item has `id`, `name`, `status`, `hostCount`, `completedCount`, `counts` (`critical`, `warning`, `notice`, `ok`), `share` (`{ expiresAt, createdAt }` or `null`), `createdAt`, `completedAt` and `expiresAt`. No per-host results.

### GET /reports/:id

Full report. Scope: `account:read`.

```json
{
  "id": "1f0c...",
  "name": "Client sites",
  "status": "complete",
  "hostCount": 3,
  "completedCount": 3,
  "share": null,
  "createdAt": "2026-10-05T10:00:00.000Z",
  "completedAt": "2026-10-05T10:00:41.000Z",
  "expiresAt": "2027-01-03T10:00:00.000Z",
  "summary": {
    "totalHosts": 3,
    "scannedHosts": 3,
    "counts": { "critical": 1, "warning": 0, "notice": 1, "ok": 1 },
    "issuers": [{ "issuer": "Let's Encrypt", "count": 2 }],
    "letsEncryptHosts": 2,
    "earliestExpiry": { "host": "shop.example.com", "port": 443, "notAfter": "2026-10-28T09:12:00Z", "daysLeft": 22 }
  },
  "hosts": [
    {
      "host": "api.example.com",
      "port": 8443,
      "status": "complete",
      "severity": "critical",
      "problems": [{ "code": "unreachable", "severity": "critical", "message": "Could not connect: connection refused" }],
      "reachable": false,
      "daysLeft": null,
      "issuerName": null,
      "letsEncrypt": null
    }
  ]
}
```

Each host also carries `tlsVersion`, `notAfter`, `issuer` (full DN), `subject`, `sans`, `hostnameCovered`, `trusted`, `chainDepth`, `keyType`, `keySize`, `error` and `scannedAt`. Hosts are sorted by severity, then fewest days left, then hostname. Hosts not scanned yet have `severity: null` and sort last.

| Severity | Problems |
|----------|----------|
| `critical` | unreachable or scan failed, no certificate, expired, hostname not covered by any SAN (a wildcard covers exactly one label), untrusted chain, server sends no intermediates |
| `warning` | expires within 14 days, TLS older than 1.2, RSA key under 2048 bits or EC key under 256 bits |
| `notice` | expires within 30 days |
| `ok` | none of the above |

### GET /reports/:id/export?format=csv

Download the report as CSV (sorted like the report). Scope: `account:read`. `format` defaults to `csv`; any other value returns `400`. Columns: `host, port, severity, status, reachable, days_left, not_after, issuer, lets_encrypt, tls_version, key, hostname_covered, trusted, problems`. Cells that start with `=`, `+`, `-` or `@` are prefixed with `'` so spreadsheets do not run them as formulas.

### DELETE /reports/:id

Delete a report, its results and its share link. Scope: `account:write`. Returns `204`.

### POST /reports/:id/share

Create a read-only share link. Scope: `account:write`. Replaces any existing link, so the old one stops working.

```json
{
  "url": "https://app.krakenkey.io/r/3q2-7wEh...",
  "token": "3q2-7wEh...",
  "expiresAt": "2026-11-04T10:05:00.000Z"
}
```

The token is 32 random bytes, base64url encoded. Only its SHA-256 hash is stored, so the link is shown once; create a new one to get it again. Links expire 30 days after creation.

### DELETE /reports/:id/share

Revoke the share link. Scope: `account:write`. Returns `204`.

### GET /public/reports/:token

The shared report. No authentication; rate limited per IP (public category). Returns `name`, `status`, `hostCount`, `completedCount`, `createdAt`, `completedAt`, `shareExpiresAt`, `summary` and `hosts`, with no report id, owner or account details. Unknown, revoked and expired tokens all return `404`. Responses carry `Cache-Control: no-store` and `X-Robots-Tag: noindex, nofollow`.

### GET /public/reports/:token/export?format=csv

CSV download of a shared report, same rules as above.

### Retention

Reports are deleted 90 days after creation by a daily job at 03:30, which also clears expired share links.

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
