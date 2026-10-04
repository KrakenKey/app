# Changelog

Notable changes to the KrakenKey API, grouped by release.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/). Dates are merge dates.

---

## [Unreleased]

### Added
- API keys record when and from where they were last used. `GET /auth/api-keys` returns `lastUsedAt` and `lastUsedIp`, updated on successful authentication at most once a minute per key unless the IP changes, and the dashboard shows them in a new "Last used" column. Migration `AddApiKeyRevocationAndUsage1779000000000` adds `revokedAt`, `lastUsedAt` and `lastUsedIp` to `user_api_key`.
- CLI browser login, modelled on the OAuth device authorization grant (RFC 8628). `POST /auth/device/code` starts a login and returns a user code and a `https://<app>/device?code=...` link. The user approves it on the new dashboard `/device` page, which shows the requesting client, IP and age. The CLI polls `POST /auth/device/token`, and the poll that finds the request approved creates a regular `kk_` API key (`CLI login: <client>`, plan limits apply) and returns it once; no key is ever stored in Redis. Approval needs a dashboard session; API keys get 403. Requests live in Redis for 10 minutes, device codes are stored hashed, and signing in from the link returns to the approval page. See [ARCHITECTURE.md](../backend/docs/ARCHITECTURE.md#auth-module).
- Certificates now carry a `failureReason`: the error message from the last failed issuance or renewal attempt, such as a missing `_acme-challenge` CNAME or a CAA refusal. It is returned by `GET /certs/tls` and `GET /certs/tls/:id`, shown on failed certificates in the dashboard, and cleared when the next attempt starts. Until now the reason only reached the owner by email, so API and CLI users saw a bare `failed`. Migration `AddCertFailureReason1778000000000` adds the nullable column.

### Changed
- `DELETE /auth/api-keys/:id` revokes the key instead of deleting the row. A revoked key stops working immediately and frees its plan slot, and a revoked key presented for auth is logged. `GET /auth/api-keys?includeRevoked=true` lists keys revoked in the last 30 days (without the flag only active keys are returned, so existing clients are unaffected), and a daily job at 04:30 deletes older ones. The dashboard's Delete button is now Revoke, and revoked keys stay visible, dimmed, with the date. See [API_REFERENCE.md](../backend/docs/API_REFERENCE.md#delete-authapi-keysid).

### Fixed
- Error responses built from a plain string message now carry the matching `error` label for their status, for example `"error": "Too Many Requests"` on the API key lockout 429. They previously all said `"Internal Server Error"`.
- API key lockout checks were skipped once after each start: the Redis client used `lazyConnect` with no offline queue, so the first command failed (open) before the connection was ready. The client now connects at module init, like device login.
- The `auth_total` metric counted every successful request as `jwt`: it looked for an `x-api-key` header that no client sends. It now reads the authenticated user, and failed attempts are classified by the `Bearer kk_` prefix.
- The OpenAPI spec synced to krakenkey.io (`yarn openapi:export`) only scanned 5 controllers, so the published API reference was missing endpoint monitoring, probes, organizations, billing, feedback, health and public scan: 20 of 48 paths. The controller list now lives in `src/config/openapi-controllers.ts` and covers all 12 non-excluded controllers, matching the live `/swagger-json` operation for operation, and a unit test fails when a new controller is neither listed nor marked `@ApiExcludeController`.

### Security
- User API keys can no longer escalate. A key could create new keys (so a leaked key could mint a replacement and outlive its own revocation), delete keys, change the account email, delete the account, change organization ownership and membership, and start billing changes. Those routes now require a dashboard session and return `403` for an API key. Admin rights also need a session: an admin's key acts as a regular user. Keys keep working for domains, certificates, endpoints and the read-only account routes. See [API_REFERENCE.md](../backend/docs/API_REFERENCE.md#authentication).

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
