# Changelog

Notable changes to the KrakenKey API, grouped by release.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/). Dates are merge dates.

---

## [Unreleased]

### Added
- Connector deployment status and alerts. A connector reports, with its own short-lived key, where it installed each certificate: `POST /connectors/report` takes `version`, `os`, `arch` and up to 500 certificates with up to 50 targets each (`label`, `state` of `pending`, `staged`, `activated`, `verified`, `activated_unverifiable`, `failed` or `rolled_back`, optional hex `serial` and `error`, `updatedAt`). Only keys issued to a connector are accepted (`403` otherwise). Certificates outside the connector's restrictions, or not owned by its user, are skipped and returned in `rejectedCertificateIds`; the response is `200` `{ "accepted": <certificates stored>, "rejectedCertificateIds": [...] }`. `updatedAt` takes RFC 3339 with or without milliseconds. Each report replaces the connector's targets for the certificates it lists. `GET /connectors/:id` now includes the connector's `deployments`, and `GET /connectors/deployments?certificateId=` lists a certificate's deployments across the user's active connectors. New alert events `deploy.failed` (a target enters `failed` or `rolled_back`; at most 20 channel alerts and one email per report) and `connector.stale` (hourly at :45, once per outage for connectors not seen for 24 hours, re-armed by any contact), both in the default channel events, with matching emails and the `deploy_failed` and `connector_stale` email preferences (shown in Settings). The report route accepts bodies up to 2 MB. Uses the `connector_deployment` table and `connector.staleAlertedAt` from `AddConnectors1786000000000`.
- Connector enrollment and short-lived keys. A connector is an agent on the customer's own machines that keeps private keys there; it now has an identity in KrakenKey with no long-lived secret. `POST /connectors` (dashboard session only) creates one with a name, an optional `clientLabel`, scopes (`certs:read`, optionally `certs:renew`) and `allowedCertIds` and/or `allowedDomainIds` (at least one is required), and returns a single-use `kkce_` enrollment token that expires after 24 hours and is stored only as a hash. The connector calls `POST /connectors/enroll` with the token and its Ed25519 public key; the token is consumed by one conditional update, so it works exactly once. After that it gets one-hour API keys from `POST /connectors/token` by signing `KRAKENKEY-CONNECTOR-TOKEN-V1`, its id, an RFC 3339 timestamp (within 300 seconds of server time) and a nonce (single use per connector for 10 minutes, kept in Redis), and can replace its key with `POST /connectors/rotate`, signed by the current one. Issued keys carry the connector's scopes and restrictions, use the same short-lived key path as GitHub OIDC (`source: 'connector'`, not listed, no plan slot, purged an hour after expiry) and record `connectorId`. `DELETE /connectors/:id` revokes the connector and every key it was issued; revoked connectors stay listed. Also `GET /connectors`, `GET /connectors/:id` (`account:read`), `PATCH /connectors/:id` and `POST /connectors/:id/enrollment-token` (session only, `409` once enrolled). Up to 50 active connectors per user (`402`). Enroll, token and rotate are public routes in a new `public-strict` rate limit category, 10 requests per minute per IP. Every enrollment failure returns `401` `Invalid enrollment token` and every signed-request failure `401` `Invalid connector credentials`. Types and constants (`Connector`, `CreateConnectorRequest`, `ConnectorTokenRequest`, `CONNECTOR_TOKEN_SIGNING_PREFIX` and others) and `API_ROUTES.CONNECTORS` are in `@krakenkey/shared`. Migration `AddConnectors1786000000000` adds the `connector` and `connector_deployment` tables and `user_api_key.connectorId`. See [API_REFERENCE.md](../backend/docs/API_REFERENCE.md#connectors).
- Pending certificates, so a connector can issue a certificate the first time with a key that never leaves its machine. `POST /certs/tls` accepts `{"names": [...], "managedBy": "connector"}` instead of `csrPem` (exactly one of the two, otherwise `400`). Names (1 to 100 DNS names, wildcards allowed) get the same verified-domain and API key domain checks as CSR names, and an API key limited to certificates still can't create one. The certificate is created with the new status `awaiting_csr`, no CSR, `requestedNames` set, `managedBy: "connector"` and `autoRenew: false`; nothing goes to the CA. It counts toward the total active certificate and monthly limits but not concurrent pending, and a repeat of the same names within 15 minutes returns the original. The connector completes it with `POST /certs/tls/:id/renew` and a `csrPem` whose names equal `requestedNames` (`certs:renew` is enough, so a key limited to that certificate can do it): the CSR is stored and the certificate is issued like a new request, `pending` -> `issuing` -> `issued`. Without a CSR the response is `400` `This certificate is waiting for a CSR`, and `ifDue=true` always treats it as due (`renewAfter` is its creation time). An `awaiting_csr` certificate can be deleted. Certificate responses gain `requestedNames`, and `rawCsr`/`parsedCsr` are `null` while a certificate waits; the dashboard lists it by its requested names as "Awaiting CSR". `@krakenkey/shared` gains `CertStatus.AWAITING_CSR`, `TlsCert.requestedNames`, nullable `rawCsr`/`parsedCsr`, `MAX_REQUESTED_NAMES`, and `CreateTlsCertRequest` becomes a union of the two request forms. Migration `AddPendingCertificates1787000000000` makes `rawCsr` and `parsedCsr` nullable and adds `requestedNames text[]` to `tls_crt`. See [API_REFERENCE.md](../backend/docs/API_REFERENCE.md#pending-certificates) and [CERTIFICATE_FLOW.md](../backend/docs/CERTIFICATE_FLOW.md#pending-certificates).
- Renewal with a new CSR and connector-managed certificates, for customer-hosted connectors that keep private keys on their own machines and rotate them on every renewal. `POST /certs/tls/:id/renew` accepts an optional body `{"csrPem": "..."}`: the CSR gets the same checks as a new request, its names (CN plus DNS SANs, case-insensitive, any order) must equal the certificate's or the response is `400` `CSR names must match the certificate`, and it replaces the stored CSR once the renewal is queued (not when `ifDue=true` skips it). Without a body renewal is unchanged. `PATCH /certs/tls/:id` accepts `managedBy: "connector" | null`; a connector-managed certificate is never renewed by the daily auto-renewal or ARI early replacement, while expiry warnings, alerts and ARI checks still run, whatever its `autoRenew`. Certificate responses (`GET /certs/tls`, `GET /certs/tls/:id`, `PATCH /certs/tls/:id`) gain `managedBy` and `renewAfter`, computed on read as the time the certificate will be renewed: expiry minus the renewal window, or the stored ARI window start when earlier. Connector-managed certificates use any ARI window and a window of at least 30 days, and `renew?ifDue=true` follows `renewAfter` for them; other certificates use the plan window and only an early-replacement ARI window. `TlsCert` in `@krakenkey/shared` gains both fields, plus `RenewTlsCertRequest`, `CertManagedBy` and `CONNECTOR_MIN_RENEWAL_WINDOW_DAYS`. Migration `AddCertManagedBy1785000000000` adds the nullable `managedBy` column to `tls_crt`. See [API_REFERENCE.md](../backend/docs/API_REFERENCE.md#post-certstlsidrenew) and [CERTIFICATE_FLOW.md](../backend/docs/CERTIFICATE_FLOW.md#connector-managed-certificates).
- Slack, Microsoft Teams and signed webhook notifications (#120). New `/notifications/channels` routes (list, create, update, delete, `POST :id/test`, `POST :id/rotate-secret`; `account:read`/`account:write` scopes) let each user add up to 10 channels and pick which events go to each: `cert.issued`, `cert.renewed`, `cert.failed`, `cert.expiring`, `cert.revoked`, `cert.replacement_requested`, `domain.verification_failed` and `endpoint.scan_failed`. Alerts are sent next to the existing emails, through a new `notifications` BullMQ queue with 5 attempts and exponential backoff; failures never affect issuance, monitoring or probe reports. `endpoint.scan_failed` fires when a probe's result for an endpoint turns from healthy to failing. Teams channels take Workflows webhook URLs, since Office 365 connectors are retired. Webhook deliveries are signed (`X-KrakenKey-Signature: t=...,v1=<HMAC-SHA256>`), the secret is shown once at creation, and the destination must resolve to public addresses, checked when saved and again on every send. URLs and secrets are encrypted at rest with AES-256-GCM under a key derived from `KK_HMAC_SECRET`; responses only show a masked URL. New metric `alert_deliveries_total{type,result}`. Migration `AddNotificationChannels1783000000000` adds the `notification_channel` table. See [API_REFERENCE.md](../backend/docs/API_REFERENCE.md#notification-channels).
- Portfolio TLS reports (#123). Paste a list of hostnames (optionally `host:port`) on the new dashboard Reports page, or `POST /reports`, and KrakenKey scans each one through the public scanner and reports reachability, TLS version, expiry and days left, issuer, SAN coverage (wildcards cover one label), chain problems, key type and size, and whether Let's Encrypt issued it. Hosts are sorted critical, warning, notice, ok, then by days left, with totals, an issuer breakdown and the earliest expiry. Scans run in a BullMQ queue (`reportScan`), five hosts at a time with a 20 second limit each, and results are stored per host as they finish. IP addresses, internal names and names resolving to private addresses are refused. Free plan: 25 hosts per report, paid plans: 250 (`PLAN_LIMITS.reportHosts`, `REPORT_HOST_LIMITS` in `@krakenkey/shared`). Reports can be downloaded as CSV and shared through a read-only link (`/r/<token>`, 32 random bytes, only the hash stored) that works without login, expires after 30 days and can be revoked; `GET /public/reports/:token` is unauthenticated, rate limited per IP and returns no ids or owner details. Reports are owner only and deleted after 90 days by a daily job. Routes use the `account:read` and `account:write` scopes; keys limited to domains or certificates are refused. `PublicScanService.scanHost()` and `src/common/net/ssrf.ts` now hold the scan call and private address checks that `POST /public-scan` already used; its behaviour is unchanged. Migration `AddPortfolioReports1784000000000` adds the `report` and `report_host` tables. See [API_REFERENCE.md](../backend/docs/API_REFERENCE.md#reports).
- ACME Renewal Information (RFC 9773, #121). An hourly job asks the CA for each auto-renewing certificate's suggested renewal window and stores it (`ariWindowStart`, `ariWindowEnd`, `ariExplanationUrl` on the certificate), honouring `Retry-After`. Normal timing still follows the plan's renewal window. When the CA asks for early replacement (the window moves earlier, starts in the first half of the lifetime, or comes with an explanation URL), `ariReplacementRequestedAt` is set and the certificate is renewed as soon as the CA's window opens, on any plan; `renew?ifDue=true` treats it as due. Renewal orders now send `replaces` with the old certificate's ARI identifier, and fall back to a plain order if the CA refuses it. New metric `ari_checks_total{result}`, new setting `KK_ACME_ARI` (default on). Migration `AddCertRenewalInfo1781000000000` adds six nullable columns to `tls_crt`. See [CERTIFICATE_FLOW.md](../backend/docs/CERTIFICATE_FLOW.md#acme-renewal-information-ari).
- Alert channels subscribed to `cert.replacement_requested` now get it the first time the CA asks for early replacement of a certificate (ACME ARI). The alert carries the CA's window, its explanation URL when there is one, and the certificate's expiry. It is sent even when a lapsed free-plan auto-renewal confirmation stops the early renewal, since the owner then has to act.
- GitHub Actions OIDC (KrakenKey/cert-action#32). Account owners create trust policies for a repository (`POST /auth/github-oidc/trusts`, dashboard session only), optionally limited to refs, a GitHub environment, scopes, domains and certificates. A workflow job exchanges its GitHub OIDC token at `POST /auth/github-oidc` for an API key that lasts 15 minutes and carries the policy's limits, so no long-lived key has to be stored as a secret. Tokens are verified against GitHub's JWKS (RS256, issuer, audience `KK_GITHUB_OIDC_AUDIENCE`, expiry). The repository's numeric id is pinned on first use. These keys don't appear in the key list, don't count toward the plan limit, and are purged an hour after expiry. Migration `AddGithubOidcTrust1782000000000` adds the `github_oidc_trust` table and a `source` column on `user_api_key`. See [API_REFERENCE.md](../backend/docs/API_REFERENCE.md#github-actions-oidc).
- GitHub trust policies are pinned to the repository's numeric id when they are created, instead of only on the first workflow run. Public repositories are looked up on GitHub automatically; for a private one, pass `repositoryId` (shown as an optional field in the dashboard). A given id that doesn't match the public repository is refused. Policies that can't be pinned up front still pin on first use, as before.
- Scoped API keys (#122). `POST /auth/api-keys` accepts `scopes` (`certs:read`, `certs:issue`, `certs:renew`, `certs:revoke`, `domains:read`, `domains:write`, `endpoints:read`, `endpoints:write`, `probes:report`, `account:read`, `account:write`), `allowedDomainIds`, `allowedCertIds` and `allowedIps` (IPv4/IPv6 addresses or CIDR ranges). All are fixed at creation, and `GET /auth/api-keys` returns them. A scoped key gets `403` on routes outside its scopes. A domain-limited key only sees certificates whose names are all under those domains, and endpoints under them, and can only request certificates for them. A certificate-limited key only sees those certificates and cannot request new ones. A key used from an address outside its allowlist gets `403` and the attempt is logged. Keys without these fields keep full access, so existing keys are unaffected. Every route that accepts keys now declares its scope with `@RequireScope()`, and a unit test fails if one is missing. Migration `AddApiKeyScopesAndRestrictions1780000000000` adds four nullable array columns to `user_api_key`. See [API_REFERENCE.md](../backend/docs/API_REFERENCE.md#api-key-scopes-and-restrictions).
- API keys record when and from where they were last used. `GET /auth/api-keys` returns `lastUsedAt` and `lastUsedIp`, updated on successful authentication at most once a minute per key unless the IP changes, and the dashboard shows them in a new "Last used" column. Migration `AddApiKeyRevocationAndUsage1779000000000` adds `revokedAt`, `lastUsedAt` and `lastUsedIp` to `user_api_key`.
- CLI browser login, modelled on the OAuth device authorization grant (RFC 8628). `POST /auth/device/code` starts a login and returns a user code and a `https://<app>/device?code=...` link. The user approves it on the new dashboard `/device` page, which shows the requesting client, IP and age. The CLI polls `POST /auth/device/token`, and the poll that finds the request approved creates a regular `kk_` API key (`CLI login: <client>`, plan limits apply) and returns it once; no key is ever stored in Redis. Approval needs a dashboard session; API keys get 403. Requests live in Redis for 10 minutes, device codes are stored hashed, and signing in from the link returns to the approval page. See [ARCHITECTURE.md](../backend/docs/ARCHITECTURE.md#auth-module).
- Certificates now carry a `failureReason`: the error message from the last failed issuance or renewal attempt, such as a missing `_acme-challenge` CNAME or a CAA refusal. It is returned by `GET /certs/tls` and `GET /certs/tls/:id`, shown on failed certificates in the dashboard, and cleared when the next attempt starts. Until now the reason only reached the owner by email, so API and CLI users saw a bare `failed`. Migration `AddCertFailureReason1778000000000` adds the nullable column.
- `POST /certs/tls/:id/renew` accepts an optional `ifDue=true` query parameter. With it, the certificate is only renewed once it is inside the plan's renewal window (Free: 5 days, paid plans: 30 days, the same window auto-renewal uses). Otherwise the request returns `200` with `"skipped": true`, `"reason": "not_due"`, `expiresAt` and `renewalWindowDays`, and nothing is queued or counted against the monthly limit. Until now a daily `krakenkey cert renew` from cron or a systemd timer re-issued the certificate every day and used up the monthly certificate limit. Without the parameter, manual renewal still always runs. See [API_REFERENCE.md](../backend/docs/API_REFERENCE.md#post-certstlsidrenew).

### Changed
- `GET /auth/profile` no longer counts short-lived keys (GitHub OIDC and connector keys) in `resourceCounts.apiKeys`, matching the key list and the plan limit.
- The `POST /certs/tls/:id/renew` response now includes `"skipped": false` when a renewal is queued (`RenewTlsCertResponse.skipped` in `@krakenkey/shared`).

### Changed
- `DELETE /auth/api-keys/:id` revokes the key instead of deleting the row. A revoked key stops working immediately and frees its plan slot, and a revoked key presented for auth is logged. `GET /auth/api-keys?includeRevoked=true` lists keys revoked in the last 30 days (without the flag only active keys are returned, so existing clients are unaffected), and a daily job at 04:30 deletes older ones. The dashboard's Delete button is now Revoke, and revoked keys stay visible, dimmed, with the date. See [API_REFERENCE.md](../backend/docs/API_REFERENCE.md#delete-authapi-keysid).

### Fixed
- `PATCH /certs/tls/:id` no longer accepts `csrPem` (#148). Its body type was built from the create request, so `csrPem` passed validation, was listed in the OpenAPI schema for the route, and was passed on to the database update, where it is not a column. The body now declares only `autoRenew` and `managedBy`; anything else, including `csrPem`, is dropped like on every other route, and the service copies just those two fields. To renew with a new CSR, use `POST /certs/tls/:id/renew` with a `csrPem` body.
- Logging out now ends the Authentik session. Before, the dashboard only dropped its token, so the SSO session survived and clicking "Log in" signed the user straight back in. Logout now uses OIDC RP-initiated logout: the dashboard clears its token, gets the end-session URL from the new public `GET /auth/logout-url`, and sends the browser to Authentik with the ID token as `id_token_hint`, so the token never reaches the API. If the URL can't be fetched it falls back to the old local-only logout. A token that fails validation on page load now only clears the local session. Requires the provider's logout redirect URI (the app origin) and an invalidation flow change on the Authentik side (infra-int).
- Error responses built from a plain string message now carry the matching `error` label for their status, for example `"error": "Too Many Requests"` on the API key lockout 429. They previously all said `"Internal Server Error"`.
- API key lockout checks were skipped once after each start: the Redis client used `lazyConnect` with no offline queue, so the first command failed (open) before the connection was ready. The client now connects at module init, like device login.
- The `auth_total` metric counted every successful request as `jwt`: it looked for an `x-api-key` header that no client sends. It now reads the authenticated user, and failed attempts are classified by the `Bearer kk_` prefix.
- The OpenAPI spec synced to krakenkey.io (`yarn openapi:export`) only scanned 5 controllers, so the published API reference was missing endpoint monitoring, probes, organizations, billing, feedback, health and public scan: 20 of 48 paths. The controller list now lives in `src/config/openapi-controllers.ts` and covers all 12 non-excluded controllers, matching the live `/swagger-json` operation for operation, and a unit test fails when a new controller is neither listed nor marked `@ApiExcludeController`.

### Security
- Frontend dev tooling from the 2026-09-07 audit (#104), no effect on the built app:
  - `vitest` and `@vitest/ui` 4.0.18 → 4.1.11: arbitrary file read and execution through the Vitest UI server (GHSA-5xrq-8626-4rwp) and the `@vitest/mocker` redirect path traversal (GHSA-82fw-gwwq-j7x9).
  - `vite` 7.3.1 → 7.3.6: dev server file read and `server.fs.deny` bypasses (GHSA-p9ff-h696-f583, GHSA-v2wj-q39q-566r, GHSA-fx2h-pf6j-xcff, GHSA-4w7w-66w2-5vf9, GHSA-v6wh-96g9-6wx3).
  - These bumps were blocked by a yarn 1 linker error (`could not find a copy of vite to link`, see #99). vitest 4.1 lists `vite` as both a dependency and a peer dependency, and yarn 1 fails when the dependency range resolves to a different vite than the project's own. A `resolutions` entry pins vite to `^7.3.6`, so the whole tree shares one copy.
  - `form-data` 4.0.5 → 4.0.6 via `jsdom` (GHSA-hmw2-7cc7-3qxx), plus an in-range lockfile refresh of `postcss`, `nanoid`, `ws`, `fflate`, `js-yaml` and the eslint tooling (`brace-expansion`, `minimatch`, `picomatch`, `flatted`, `ajv`, `browserslist`).
  - Still open: `esbuild` 0.27.7 (GHSA-g7r4-m6w7-qqqr, low, Windows dev server only) needs 0.28.1, outside the range vite 7 accepts.
- User API keys can no longer escalate. A key could create new keys (so a leaked key could mint a replacement and outlive its own revocation), delete keys, change the account email, delete the account, change organization ownership and membership, and start billing changes. Those routes now require a dashboard session and return `403` for an API key. Admin rights also need a session: an admin's key acts as a regular user. Keys keep working for domains, certificates, endpoints and the read-only account routes. See [API_REFERENCE.md](../backend/docs/API_REFERENCE.md#authentication).
- Backend dependency advisories from the 2026-09-07 audit (#104):
  - `node-forge` 1.3.3 → 1.4.0 through a `resolutions` entry. `acme-client` 5.4.0 is the latest release and still allows 1.3.x. Clears Ed25519 and RSA-PKCS signature forgery, the basicConstraints chain bypass and the `modInverse` DoS (GHSA-q67f-28xg-22rw, GHSA-ppp5-5v6c-4jwp, GHSA-2328-f5f3-gj25, GHSA-5m6q-g25r-mvwx).
  - `axios`: a `resolutions` entry removes the stale 1.13.4 copy that `acme-client` pulled in next to the direct 1.20.0, along with the axios advisories it still carried.
  - `nodemailer` 9.1.1 → 10.0.14 (major): addressparser DoS (GHSA-prgh-xp8r-p3m5, GHSA-v53p-9fqp-m79j) and later fixes. 10.0 requires Node.js 20 (we run 24) and ships its own type declarations, so `@types/nodemailer` is removed. The email service only uses SMTP `createTransport`/`sendMail` and needed no changes.
  - `@nestjs/swagger` 11.2.6 → 11.4.7: drops the exact `path-to-regexp` 8.3.0 pin (ReDoS, GHSA-j3q9-mxjg-w52f, GHSA-27v5-c462-wpq7). Since 11.4.3 the package only exports its root, so `scripts/export-openapi.ts` now loads the explorer classes by file path; the generated spec has the same 53 paths and 29 schemas.
  - `@nestjs/common`, `core`, `platform-express` and `testing` 11.2.3 → 11.2.7: `multer` 2.2.0 → 2.4.0.
  - `@aws-sdk/client-route-53` 3.1000.0 → 3.1146.0: the newer `@aws-sdk/xml-builder` no longer depends on `fast-xml-parser` (5.3.6 had four advisories).
  - `@nestjs/config` 4.0.3 → 4.0.4 and the swagger bump move `lodash` to 4.18.1 (GHSA-r5fr-rjxr-66jc, GHSA-f23m-r3pf-42rh). `js-yaml` refreshed to 4.3.2 and 3.15.2; the copy `@nestjs/swagger` pins is lifted to 5.4.2 with a scoped resolution (GHSA-r3ph-w7gj-g6xm).
  - Lockfile refresh inside existing ranges: `handlebars` 4.7.9 (dev, GHSA-2w6w-674q-4c4q), `form-data` 4.0.6, `fast-uri`, `follow-redirects`, and the eslint/jest tooling (`brace-expansion`, `minimatch`, `picomatch`, `flatted`, `ajv`, `browserslist`).
  - Still open: `node-forge` GHSA-86w9-cpqp-85rv has no fixed release; `acme-client` only uses node-forge in its legacy `forge` helpers, which the backend does not call. `uuid` 11.1.0 (GHSA-w5hq-g745-h8pq) is pinned by `bullmq` 5.70.1 and only affects v3/v5/v6 with a caller-supplied buffer; bullmq uses v4.

---

## [2026-09-24] — Challenge Delegation Precheck, Queue Metrics

### Added
- `bullmq_queue_jobs` Prometheus gauge: BullMQ job counts labelled by `queue` and `state`, covering the `tlsCertIssuance` and `orgDissolution` queues across the `waiting`, `active`, `delayed`, `failed`, `completed` and `paused` states. Counts are read from Redis at scrape time rather than polled in the background; each queue's read is bounded by a 2-second timeout and failures omit that queue's series instead of failing the whole `/metrics` scrape. See [OBSERVABILITY.md](../backend/docs/OBSERVABILITY.md). (PR #106)

### Changed
- Certificate issuance now verifies `_acme-challenge.<domain>` CNAME delegation **before** creating an ACME order. A missing or misdirected CNAME previously passed our own propagation check (which queries our auth zone directly), then failed CA validation with an opaque error after the order had counted against Let's Encrypt's rate limits. Failures now return an actionable message naming the exact record to create, and are classified as permanent so the job fails on the first attempt instead of retrying. CNAME chains are followed up to 5 hops; resolver timeouts and `SERVFAIL` are logged and issuance proceeds, so a flaky resolver never blocks a correctly configured domain. See [CERTIFICATE_FLOW.md](../backend/docs/CERTIFICATE_FLOW.md#challenge-delegation-precheck). (PR #108)

### Fixed
- Organization dissolution no longer fails when the owner already holds a personal subscription. A user may hold only one personal subscription (`UQ_subscription_userId_partial`), so reassigning the organization's subscription to an owner who already had one violated the constraint. Resolution now depends on which subscriptions are live in Stripe: a cancelled org subscription is dropped, an inactive personal subscription is replaced by the org's paid one, and two subscriptions both billing in Stripe raise an `UnrecoverableError` for manual review rather than orphaning a subscription that is still charging. See [BILLING.md](../backend/docs/BILLING.md#owner-subscription-conflicts). (PR #107)
- A failed `orgDissolution` job no longer blocks all subsequent retries for that organization. The job ID is derived from the organization ID and BullMQ ignores `add()` for an existing ID, so a failed attempt was permanently sticky; failed jobs are now removed before re-queueing, with the previous failure reason logged. (PR #107)

### Documentation
- New [`backend/docs/OBSERVABILITY.md`](../backend/docs/OBSERVABILITY.md): the `/metrics` endpoint and full metric catalog had never been documented.

---

## [2026-09-04] — Dependency Security Upgrades

### Security
- `react-router` / `react-router-dom` 7.13.1 → 7.18.3. Clears the `turbo-stream` RCE (GHSA-49rj-9fvp-4h2h) plus CSRF-bypass, stored-XSS, open-redirect and DoS advisories. In-range; no route code changes. (PR #103)
- `nodemailer` 8.0.1 → 9.1.1 (major). Clears the `raw`-option arbitrary file read / SSRF (GHSA-p6gq-j5cr-w38f). `@types/nodemailer` to 8.0.1. The email service uses plain SMTP `createTransport`/`sendMail` and is unaffected by the v9 API changes. (PR #103)
- `typeorm` 0.3.28 → 0.3.31: SQL injection (GHSA-9ggv-8w38-r7pm). (PR #102)
- `axios` → 1.20.0 as a direct dependency in both workspaces (GHSA-pf86-5x62-jrwf). The backend lockfile still resolves axios 1.13.4 through `acme-client`. (PR #102)
- `@nestjs/core` + `@nestjs/platform-express` → 11.2.3: bundled `path-to-regexp` and `multer` advisories. (PR #102)

Lockfile-only for PR #102; no `package.json` ranges changed. Still outstanding from the dependency audit (#99): `vitest` and the `handlebars`/`ts-jest` dev chain.

---

## [2026-08-31] — OpenAPI Spec Sync

### Fixed
- The workflow that publishes `openapi.json` to the `web` repo now opens and squash-merges a pull request instead of pushing to `web@main` directly. Direct pushes had been rejected since `web` gained a ruleset requiring pull requests (GH013), so every sync run failed after 2026-05-14 and the published spec at `krakenkey.io/docs/api` went stale. (PR #100)
- The sync uses the REST API rather than GraphQL — fine-grained PATs cannot authenticate against GraphQL. (PR #101)

---

## [2026-05-28] — Certificate Chain

### Added
- `GET /certs/tls/:id/chain` — returns full certificate chain info: leaf certificate details (`leafCert`), array of parsed intermediate CA entries (`intermediates`: serial number, issuer, subject, validity window, fingerprint per entry), and `fullChainPem` (leaf + intermediates, PEM-concatenated). New `chainPem` column added to `tls_cert` table via migration (stores the intermediate chain server-side; not itself part of the API response). New shared types: `TlsCertChainEntry`, `TlsCertChainInfo`. (PR #79)

---

## [2026-05-03] — Public Scan API

### Added
- `POST /public/scan` — unauthenticated endpoint that proxies free TLS scan requests to the hosted probe. SSRF-protected (private IP ranges blocked), per-IP rate-limited. Request: `{ host, port }`. Response: full TLS scan result. (PRs #77, #78)
- `PublicScanModule` with `PublicScanService` and `PublicScanController`.
- New shared types: `PublicScanRequest`, `PublicScanResponse`.
- `@nestjs/axios` dependency for probe proxying.
- New env vars: `KK_PROBE_INTERNAL_URL`, `KK_PROBE_SCAN_SECRET` (see [infra-int ENV_VARS.md](https://github.com/krakenkey/infra-int/blob/main/docs/ENV_VARS.md)).

---

## [2026-04-30] — Activation Funnel

### Added
- `User` entity fields: `firstDomainAddedAt`, `firstCertIssuedAt`, `onboardingEmailSentAt` — tracked via TypeORM migration.
- Welcome email sent on first signup via `ActivationReminderService`.
- 24-hour drip email if first domain is not added within 24 hours of signup.
- `ActivationReminderService` scheduled via NestJS cron. (PR #76)

---

## [2026-04-08] — Plan Limits Update

### Changed
- Hosted probe limits for Starter plan updated: 2 hosted probe regions, 5 hosted monitored endpoints, 30-minute hosted scan interval. (PR #75)

---

## [2026-03-27] — Security Hardening + Scrypt

### Added
- API key hashing switched from bcrypt to scrypt for improved performance under load. (PR #26)
- HMAC-SHA256 signing for service keys using `KK_HMAC_SECRET`. (PR #25)
- CSRF protection on OAuth callback. (PR #22)
- Log sanitization to prevent sensitive fields from appearing in application logs. (PR #21)

### Changed
- Code coverage raised above 80% across backend modules. (PR #20)

---

## [2026-03-27] — Hosted Probe + Billing

### Added
- Hosted probe mode: probe registers via service key (`kk_svc_`), receives endpoint config from API by region. (PR #23)
- Prorated plan upgrades: upgrade mid-cycle charges only for remaining days. (PR #18)
- Organization billing: org-level Stripe subscription management. (PR #19)

---

## [2026-03-12] — Teams + Orgs RBAC

### Added
- Organizations and RBAC: create orgs, invite members, assign roles (owner/admin/member). (PR #16)
- Teams endpoint: `GET /organizations/:id/members`. (PR #17)
