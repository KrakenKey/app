# Changelog

All notable changes to the KrakenKey backend application are documented here.

## [Unreleased]

### Added

- **Certificate Chain Support** ([PR #79](https://github.com/KrakenKey/app/pull/79))
  - New endpoint: `GET /certs/tls/:id/chain` — returns leaf cert details, per-intermediate chain entries, `chainPem` (intermediates only), and `fullChainPem` (leaf + intermediates)
  - `chainPem` column added to `TlsCrt` entity; database migration included
  - New shared types exported from `@krakenkey/shared`: `TlsCertChainEntry`, `TlsCertChainInfo`
  - New `CertUtilService` utilities: `splitChain`, `getChainInfo`, `getChain`

### Suggested version bump

No formal version file in this repo. Recommend tagging `v0.4.0` once PR #79 merges (minor feature addition; no breaking changes).

---

## [2026-05-03]

### Added

- **Public Scan API** ([PR #77](https://github.com/KrakenKey/app/pull/77), [PR #78](https://github.com/KrakenKey/app/pull/78))
  - New endpoint: `POST /public/scan` — unauthenticated, rate-limited, SSRF-protected
  - Proxies scan requests to the internal probe service via `KK_PROBE_INTERNAL_URL`
  - New `PublicScanModule` (controller, service, DTO)
  - New shared types: `PublicScanRequest`, `PublicScanResponse` in `shared/src/types/public-scan.ts`
  - New route constant `PUBLIC_SCAN` in `shared/src/constants/routes.ts`
  - New dependencies: `@nestjs/axios`, `axios`
  - See [`docs/PUBLIC_SCAN_API.md`](PUBLIC_SCAN_API.md) for endpoint details and configuration

---

## [2026-04-30]

### Added

- **Activation Funnel** ([PR #76](https://github.com/KrakenKey/app/pull/76))
  - New `User` entity fields (with migration): `firstDomainAddedAt`, `firstCertIssuedAt`, `onboardingEmailSentAt`
  - Welcome email sent on signup via `EmailService.sendWelcome`
  - `ActivationReminderService`: scheduled service that sends an activation reminder 24 hours after signup if the user has not yet added a domain
  - `DomainsService` sets `firstDomainAddedAt` when a user adds their first domain
  - `CertIssuerConsumer` sets `firstCertIssuedAt` when a user's first certificate is issued
