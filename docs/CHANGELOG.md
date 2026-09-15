# Changelog

Notable changes to the KrakenKey API, grouped by release.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/). Dates are merge dates.

---

## [Unreleased]

---

## [2026-09-04] — Dependency Security Upgrades

### Security
- `react-router` / `react-router-dom` 7.13.1 → 7.18.3 — clears the `turbo-stream` RCE (GHSA-49rj-9fvp-4h2h) plus CSRF-bypass, stored-XSS, open-redirect and DoS advisories. In-range; no route code changes. (PR #103)
- `nodemailer` 8.0.1 → 9.1.1 (major) — clears the `raw`-option arbitrary file read / SSRF (GHSA-p6gq-j5cr-w38f). `@types/nodemailer` to 8.0.1. The email service uses plain SMTP `createTransport`/`sendMail` and is unaffected by the v9 API changes. (PR #103)
- `typeorm` 0.3.28 → 0.3.31 — SQL injection (GHSA-9ggv-8w38-r7pm). (PR #102)
- `axios` → 1.20.0 in both workspaces (GHSA-pf86-5x62-jrwf). (PR #102)
- `@nestjs/core` + `@nestjs/platform-express` → 11.2.3 — bundled `path-to-regexp` and `multer` advisories. (PR #102)
- `vite` → 7.3.6 — dev-server arbitrary file read. (PR #102)

Lockfile-only for PR #102; no `package.json` ranges changed. Still outstanding from the dependency audit (#99): `vitest` and the `handlebars`/`ts-jest` dev chain.

### Build
- Workflow actions bumped to Node24-capable majors ahead of GitHub's removal of the Node20 runtime.

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
