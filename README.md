# krakenkey-app

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://github.com/KrakenKey/app/blob/main/backend/LICENSE)

Web application for [KrakenKey](https://krakenkey.io) — TLS certificate lifecycle management. This repo contains the API backend, web dashboard, and shared type library.

## Architecture

```
app/
├── backend/     NestJS API — certificate issuance, domain verification, billing
├── frontend/    React + Vite dashboard — manage domains, certs, and endpoints
└── shared/      @krakenkey/shared — TypeScript types and route constants
```

**Backend** — NestJS 11, TypeORM, PostgreSQL, Redis, Stripe. Handles ACME certificate issuance, domain DNS verification, endpoint TLS monitoring, org/RBAC, and billing. Exposes a REST API with OpenAPI docs.

**Frontend** — React 19, Vite, Tailwind CSS, React Router. Provides the web dashboard for managing domains, certificates, endpoints, API keys, and account settings.

**Shared** — TypeScript-only package consumed by both backend and frontend. Exports domain types (`User`, `Domain`, `TlsCert`, `Endpoint`, `ApiKey`, `Subscription`, etc.) and API route constants.

## Getting started

### Prerequisites

- Node.js 22+
- Yarn
- PostgreSQL 18+
- Redis 8+

### Development (devcontainer)

The recommended setup uses the [devcontainer](https://github.com/KrakenKey/krakenkey/tree/main/.devcontainer) in the [krakenkey](https://github.com/KrakenKey/krakenkey) monorepo, which provisions PostgreSQL, Redis, and Traefik automatically.

### Manual setup

```bash
# Install dependencies
cd backend  && yarn install && cd ..
cd frontend && yarn install && cd ..
cd shared   && yarn install && yarn build && cd ..

# Run database migrations
cd backend && yarn migration:run

# Start the API (port 8080)
cd backend && yarn start:dev

# Start the dashboard (port 5173)
cd frontend && yarn dev --host
```

### Environment variables

Copy the template and fill in your values:

```bash
cp .env.template .env
```

Key variables:

| Variable | Description |
|---|---|
| `KK_API_PORT` | API listen port (default `8080`) |
| `KK_DB_HOST` | PostgreSQL host |
| `KK_DB_NAME` | PostgreSQL database name |
| `KK_REDIS_URL` | Redis connection URL |
| `KK_JWT_SECRET` | JWT signing secret |
| `KK_ACME_EMAIL` | Email for ACME account registration |

See the env template for the full list.

## Scripts

### Backend

```bash
yarn start:dev          # Development with hot reload
yarn build              # Compile TypeScript
yarn test               # Unit tests
yarn test:e2e           # End-to-end tests
yarn test:cov           # Coverage report
yarn migration:run      # Run pending migrations
yarn migration:revert   # Revert last migration
yarn openapi:export     # Export OpenAPI spec
```

### Frontend

```bash
yarn dev --host         # Dev server with HMR
yarn build              # Production build
yarn test               # Unit tests (Vitest)
yarn test:e2e           # E2E tests (Playwright)
yarn lint               # ESLint
```

## API documentation

When running locally, Swagger UI is available at `/api/docs` on the backend port.

## Related repos

- [krakenkey/cli](https://github.com/KrakenKey/cli) — CLI for terminal and CI/CD workflows
- [krakenkey/probe](https://github.com/KrakenKey/probe) — TLS endpoint monitoring agent
- [krakenkey/web](https://github.com/KrakenKey/web) — Marketing site
- [krakenkey/krakenkey](https://github.com/KrakenKey/krakenkey) — Devcontainer and workspace orchestration

## License

[AGPL-3.0](LICENSE)
