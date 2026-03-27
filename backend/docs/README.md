# KrakenKey Backend Documentation

This directory contains comprehensive documentation for the KrakenKey backend API, a NestJS-based service for TLS certificate management, endpoint monitoring, and team collaboration.

## Table of Contents

### Core
1. [Architecture Overview](./ARCHITECTURE.md) — System design, module structure, data flows
2. [API Reference](./API_REFERENCE.md) — Complete endpoint documentation
3. [Database Schema](./DATABASE.md) — Entities, relationships, migrations

### Setup
4. [Configuration](./CONFIGURATION.md) — Environment variables reference
5. [Integrations](./INTEGRATIONS.md) — Cloudflare, Let's Encrypt, Authentik, Stripe setup

### Features
6. [Certificate Flow](./CERTIFICATE_FLOW.md) — CSR generation, ACME issuance, renewal, revocation
7. [Billing](./BILLING.md) — Plans, subscriptions, Stripe integration
8. [Organizations](./ORGANIZATIONS.md) — Teams, roles, resource sharing
9. [Endpoints](./ENDPOINTS.md) — TLS endpoint monitoring and probes

### Guides
10. [Domain Verification](../docs/DOMAIN_VERIFICATION_GUIDE.md) — DNS TXT verification walkthrough
11. [Error Handling](../docs/ERROR_HANDLING.md) — Frontend and backend error handling patterns

## Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL 12+
- Redis 6+ (for BullMQ queue)
- Cloudflare or AWS Route 53 account (for DNS-01 challenges)
- Let's Encrypt ACME account key
- Authentik instance (for OIDC authentication)

### Installation

```bash
# Install dependencies
yarn install

# Set up environment variables
cp .env.example .env
# Edit .env — see docs/CONFIGURATION.md for all variables

# Start in development mode
yarn start:dev
```

The API runs on port 8080 by default. Swagger docs are available at `/swagger`.

### Running Tests

```bash
yarn test          # unit tests
yarn test:cov      # coverage
yarn test:e2e      # end-to-end
```

## Project Structure

```
src/
├── main.ts                 # Application entry point
├── app.module.ts           # Root module
├── app.controller.ts       # Health check endpoint
├── auth/                   # OIDC login, JWT, API key management
├── users/                  # User entities and account management
├── domains/                # Domain registration and DNS verification
├── certs/                  # Certificate management
│   └── tls/                # TLS certificate issuance (ACME, DNS-01)
│       ├── entities/       # TlsCrt entity
│       ├── dto/            # Request/response DTOs
│       ├── services/       # ACME issuer, DNS strategies, CSR utils
│       └── processors/     # BullMQ job processors
├── billing/                # Stripe subscriptions and plan limits
│   ├── entities/           # Subscription entity
│   ├── constants/          # Plan limit definitions
│   └── processors/         # Org dissolution processor
├── organizations/          # Team management and RBAC
├── endpoints/              # TLS endpoint monitoring
│   └── entities/           # Endpoint, hosted region, probe assignment
├── health/                 # Health checks
├── metrics/                # Prometheus metrics
├── notifications/          # Email notifications
├── feedback/               # User feedback
├── probes/                 # Kubernetes readiness/liveness probes
├── throttler/              # Rate limiting
├── filters/                # Global exception filter
└── migrations/             # Database migrations
```

## Technology Stack

- **Framework**: NestJS 11.x
- **Language**: TypeScript
- **Database**: PostgreSQL with TypeORM
- **Queue**: BullMQ (Redis-backed)
- **ACME Client**: acme-client
- **DNS Providers**: Cloudflare SDK, AWS SDK (Route 53)
- **Authentication**: Authentik (OIDC), JWT, API keys
- **Billing**: Stripe
- **Cryptography**: node-forge
- **Documentation**: Swagger/OpenAPI
