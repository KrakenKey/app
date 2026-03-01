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
| `users/` | User entities and management |

## Documentation

See [docs/](docs/README.md) for detailed documentation:

- [Architecture](docs/ARCHITECTURE.md)
- [API Reference](docs/API_REFERENCE.md)
- [Certificate Issuance Flow](docs/CERTIFICATE_FLOW.md)
- [Database Schema](docs/DATABASE.md)
- [Configuration](docs/CONFIGURATION.md)
- [Integrations](docs/INTEGRATIONS.md)

## Testing

```bash
yarn test          # unit tests
yarn test:cov      # coverage
yarn test:e2e      # end-to-end
```
