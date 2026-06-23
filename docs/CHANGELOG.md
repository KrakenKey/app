# Changelog

Notable changes to the KrakenKey API, grouped by release.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/). Dates are merge dates.

---

## [Unreleased]

---

## [2026-05-28] — Certificate Chain

### Added
- `GET /certs/tls/:id/chain` — returns intermediate CA chain details: per-entry subject, issuer, fingerprint, notAfter; plus `chainPem` (intermediates only) and `fullChainPem` (leaf + intermediates) fields. New `chainPem` column added to `tls_cert` table via migration. New shared types: `TlsCertChainEntry`, `TlsCertChainInfo`. (PR #79)

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
