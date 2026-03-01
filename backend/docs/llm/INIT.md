# Provides info about the repo to load context for LLM

Project: KrakenKey Core (/workspace/Repos/core)
Purpose: TLS certificate management platform - users register domains, verify via DNS, submit CSRs, get Let's Encrypt certs via ACME + Cloudflare DNS-01

Stack:
- Backend: NestJS 11 + TypeORM (PostgreSQL) + BullMQ (Redis) + Passport (JWT/API Key) + acme-client + Cloudflare SDK
- Frontend: React 19 + Vite 8 + React Router v7 + Axios + Context API
- Shared: TypeScript types library

Modules: auth/ (Authentik OIDC), users/, domains/ (DNS verification), certs/tls/ (cert issuance)
Auth: JWT or API Key via JwtOrApiKeyGuard
Cert Flow: CSR → Validation → BullMQ job → ACME challenge → Cloudflare DNS → Let's Encrypt → Store

Key Files:
- backend/src/main.ts - Bootstrap
- backend/src/auth/ - Authentication module
- backend/src/certs/tls/ - Certificate issuance
- frontend/src/context/AuthContext.tsx - Auth state
- shared/src/constants/routes.ts - API routes
