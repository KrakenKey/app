# Configuration Guide

Complete reference for all environment variables used by the KrakenKey backend and frontend.

## Backend Environment Variables

### General

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `API_VERSION` | No | `0.0.1` | API version string returned in health check |
| `NODE_ENV` | No | `dev` | Environment mode (`dev`, `production`, `test`) |
| `PORT` | No | `8888` | Internal port (unused by NestJS listener) |
| `KK_API_PORT` | No | `8080` | Port the NestJS API listens on |

### Domain Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `KK_APP_DOMAIN` | Yes | — | Web app domain. Must be a single-level subdomain for Cloudflare Free tier proxy support (e.g. `dev-web.krakenkey.io`) |

### PostgreSQL Database

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `KK_DB_HOST` | Yes | — | Database hostname (e.g. `krakenkey-db-dev` in Docker, `localhost` otherwise) |
| `KK_DB_PORT` | No | `5432` | Database port |
| `KK_DB_USERNAME` | Yes | — | Database user |
| `KK_DB_PASSWORD` | Yes | — | Database password |
| `KK_DB_DATABASE` | No | `krakenkey` | Database name |
| `KK_DB_LOGGING` | No | `false` | Enable TypeORM SQL query logging (`true`/`false`) |
| `KK_DB_SYNCHRONIZE` | No | `false` | Auto-sync schema from entities. **Never enable in production** — use migrations instead |
| `KK_DB_SSL` | No | `false` | Enable SSL for database connections |

### Redis (BullMQ Job Queue)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `KK_BULLMQ_HOST` | Yes | — | Redis hostname (e.g. `krakenkey-redis-dev` in Docker) |
| `KK_BULLMQ_PORT` | No | `6379` | Redis port |
| `KK_BULLMQ_PASSWORD` | No | — | Redis password (leave empty if no auth) |
| `KK_DEVICE_AUTH_TTL_SEC` | No | `600` | Lifetime of a CLI browser login request (`krakenkey auth login --web`) |
| `KK_DEVICE_AUTH_INTERVAL_SEC` | No | `5` | Minimum seconds between CLI polls for a browser login |

### DNS Provider

Set `KK_DNS_PROVIDER` to select which provider handles DNS-01 ACME challenges. Only configure the credentials for your chosen provider.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `KK_DNS_PROVIDER` | No | `cloudflare` | DNS provider for ACME challenges (`cloudflare` or `route53`) |

#### Cloudflare

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CLOUDFLARE_API_TOKEN` | Yes* | — | Cloudflare API token with DNS edit permissions for your zone |
| `CLOUDFLARE_ACCOUNT_ID` | Yes* | — | Your Cloudflare account ID (found in dashboard URL) |
| `CLOUDFLARE_ZONE_ID` | Yes* | — | Zone ID for the domain used in DNS-01 challenges (found on domain overview page) |

*Required when `KK_DNS_PROVIDER=cloudflare`

#### AWS Route 53

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AWS_ACCESS_KEY_ID` | Yes* | — | IAM access key with Route 53 permissions |
| `AWS_SECRET_ACCESS_KEY` | Yes* | — | IAM secret key |
| `AWS_REGION` | Yes* | `us-east-1` | AWS region |
| `KK_AWS_ROUTE53_HOSTED_ZONE_ID` | Yes* | — | Route 53 hosted zone ID for the ACME challenge domain |

*Required when `KK_DNS_PROVIDER=route53`

### ACME / Let's Encrypt

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `KK_ACME_ACCOUNT_KEY` | Yes | — | RSA 4096-bit private key in PEM format for the ACME account. See [Generating an ACME Account Key](#generating-an-acme-account-key) |
| `KK_ACME_AUTH_ZONE_DOMAIN` | Yes | — | DNS zone used for ACME DNS-01 challenge delegation (e.g. `acme.krakenkey.io`). Can be multi-level since it's DNS-only (no SSL proxy needed) |
| `KK_ACME_CONTACT_EMAIL` | Yes | — | Email registered with the ACME account. Let's Encrypt uses it for account and policy notices |
| `KK_ACME_STAGING` | No | `false` | Set to `true` to use Let's Encrypt Staging. Production is the default |
| `KK_ACME_DIRECTORY_URL` | No | — | Custom ACME directory URL. Overrides `KK_ACME_STAGING` when set |
| `KK_ACME_DNS_RESOLVERS` | No | Cloudflare authoritative nameservers | Comma-separated resolver IPs used to check that the DNS-01 TXT record has propagated before asking the CA to validate |

### Authentication (Authentik OIDC)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `KK_AUTHENTIK_DOMAIN` | Yes | — | Authentik instance domain (e.g. `auth-dev.krakenkey.io`). Use single-level subdomain for Cloudflare proxy |
| `KK_AUTHENTIK_ENROLLMENT_SLUG` | Yes | — | Authentik enrollment flow slug (e.g. `krakenkey`) |
| `KK_AUTHENTIK_ISSUER_URL` | Yes | — | OIDC issuer URL (e.g. `https://auth-dev.krakenkey.io/application/o/krakenkey/`) |
| `KK_AUTHENTIK_CLIENT_ID` | Yes | — | OAuth2 client ID from Authentik provider configuration |
| `KK_AUTHENTIK_CLIENT_SECRET` | Yes | — | OAuth2 client secret from Authentik provider configuration |
| `KK_AUTHENTIK_REDIRECT_URI` | Yes | — | OAuth2 callback URL pointing to your API (e.g. `https://api-dev.krakenkey.io/auth/callback`) |
| `KK_AUTHENTIK_POST_ENROLLMENT_REDIRECT` | Yes | — | Where to redirect after user enrollment (e.g. `https://api-dev.krakenkey.io/auth/login`) |

### API Key Hashing

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `KK_HMAC_SECRET` | Yes | — | 32-byte hex secret used as salt for scrypt hashing of API keys. Generate with `openssl rand -hex 32` |

### Billing (Stripe)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `KK_STRIPE_SECRET_KEY` | Yes* | — | Stripe secret API key |
| `KK_STRIPE_WEBHOOK_SECRET` | Yes* | — | Stripe webhook signing secret for verifying webhook payloads |
| `KK_STRIPE_PRICE_STARTER` | Yes* | — | Stripe Price ID for the Starter plan |
| `KK_STRIPE_PRICE_TEAM` | Yes* | — | Stripe Price ID for the Team plan |
| `KK_STRIPE_PRICE_BUSINESS` | Yes* | — | Stripe Price ID for the Business plan |
| `KK_STRIPE_PRICE_ENTERPRISE` | Yes* | — | Stripe Price ID for the Enterprise plan |

*Required only if billing features are enabled

### Probe Service Keys

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `KK_PROBE_API_KEY` | No | — | Service API key for probe authentication. Auto-seeded on startup if set. Used by external probe instances to authenticate with the API |

---

## Frontend Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `KK_API_URL` | Yes | — | Full URL to the backend API (e.g. `https://dev-api.krakenkey.io`). Use single-level subdomain for Cloudflare Free tier |
| `KK_ACME_AUTH_ZONE_DOMAIN` | Yes | — | Auth zone domain for ACME DNS-01 challenge delegation. Displayed in the UI for user instructions |
| `VITE_ALLOWED_HOST` | No | — | Domain allowed by the Vite dev server for HMR/WebSocket connections |

---

## Setup Instructions

### Generating an ACME Account Key

```bash
# Generate a 4096-bit RSA key
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 -out acme-account.key

# View the key (for copying into .env)
cat acme-account.key
```

When placing the key in your `.env` file, wrap it in single quotes and replace newlines with literal `\n`:

```env
KK_ACME_ACCOUNT_KEY='<paste PEM content with newlines replaced by literal \n>'
```

The backend automatically normalizes PEM formatting (handles literal `\n`, stray quotes, incorrect line wrapping).

### Generating an HMAC Secret

```bash
openssl rand -hex 32
```

### Setting Up for Development

1. Copy the example environment files:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

2. If using the devcontainer, the Docker Compose file provides PostgreSQL and Redis automatically. The default hostnames are:
   - PostgreSQL: `krakenkey-db-dev:5432`
   - Redis: `krakenkey-redis-dev:6379`

3. For local development outside Docker, point `KK_DB_HOST` and `KK_BULLMQ_HOST` to `localhost`.

### Production Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Set `KK_DB_SYNCHRONIZE=false` (use migrations)
- [ ] Set `KK_DB_LOGGING=false`
- [ ] Set `KK_DB_SSL=true`
- [ ] Leave `KK_ACME_STAGING` and `KK_ACME_DIRECTORY_URL` unset so issuance uses Let's Encrypt production
- [ ] Generate a strong `KK_HMAC_SECRET`
- [ ] Configure Stripe with production keys
- [ ] Ensure `KK_AUTHENTIK_REDIRECT_URI` points to your production API domain
- [ ] Set `KK_APP_DOMAIN` to your production web domain
