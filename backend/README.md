# KrakenKey Backend

NestJS API for TLS certificate management — submit CSRs, automate ACME issuance via DNS-01 challenges, and manage certificates and domains.

## Quick Start

```bash
yarn install
yarn start:dev
```

The API runs on port 8080 by default. Swagger docs are available at `/swagger`.

## Modules

| Module | Purpose |
|--------|---------|
| `auth/` | Authentik OIDC login, JWT validation, API key management |
| `certs/tls/` | Certificate submission, ACME issuance, DNS-01 challenges |
| `domains/` | Domain registration and DNS verification |
| `users/` | User entities and account management |
| `billing/` | Stripe subscriptions, plan limits, checkout |
| `organizations/` | Team management with role-based access |
| `endpoints/` | TLS endpoint monitoring with probe scanning |
| `health/` | Health check and Kubernetes probes |
| `metrics/` | Prometheus metrics |
| `notifications/` | Email notifications |
| `feedback/` | User feedback collection |
| `throttler/` | Rate limiting |

## Documentation

See [docs/](docs/README.md) for detailed documentation:

- [Architecture](docs/ARCHITECTURE.md) — system design and module structure
- [API Reference](docs/API_REFERENCE.md) — endpoint documentation
- [Certificate Flow](docs/CERTIFICATE_FLOW.md) — CSR generation, issuance lifecycle, renewal
- [Database Schema](docs/DATABASE.md) — entities and relationships
- [Configuration](docs/CONFIGURATION.md) — environment variables reference
- [Integrations](docs/INTEGRATIONS.md) — Cloudflare, Let's Encrypt, Authentik, Stripe setup
- [Billing](docs/BILLING.md) — plans, subscriptions, Stripe integration
- [Organizations](docs/ORGANIZATIONS.md) — teams, roles, resource sharing
- [Endpoints](docs/ENDPOINTS.md) — TLS endpoint monitoring and probes

## Testing

```bash
yarn test          # unit tests
yarn test:cov      # coverage
yarn test:e2e      # end-to-end
```
