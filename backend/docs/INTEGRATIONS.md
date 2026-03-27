# External Integrations

KrakenKey integrates with several external services for authentication, certificate issuance, DNS management, and billing. This guide covers how each integration works and how to configure it.

## Let's Encrypt (ACME)

### Overview

KrakenKey uses the ACME protocol to automate certificate issuance with Let's Encrypt. The backend acts as an ACME client, creating orders, solving DNS-01 challenges, and retrieving signed certificates.

### How It Works

1. Backend creates an ACME order for the domains in a CSR
2. Let's Encrypt returns DNS-01 challenges for each domain
3. Backend creates TXT records via the configured DNS provider
4. Backend notifies Let's Encrypt that challenges are ready
5. Let's Encrypt verifies the TXT records and issues the certificate
6. Backend retrieves the certificate and cleans up TXT records

### Configuration

| Variable | Description |
|----------|-------------|
| `ACME_ACCOUNT_KEY` | 4096-bit RSA private key in PEM format |
| `ACME_CONTACT_EMAIL` | Contact email registered with Let's Encrypt |
| `ACME_DIRECTORY_URL` | ACME directory (defaults to Let's Encrypt Staging) |
| `ACME_AUTH_ZONE_DOMAIN` | DNS zone for challenge delegation |

### Environments

| Environment | Directory URL | Rate Limits |
|-------------|--------------|-------------|
| **Staging** (default) | `https://acme-staging-v02.api.letsencrypt.org/directory` | Generous limits, issues untrusted test certificates |
| **Production** | `https://acme-v02.api.letsencrypt.org/directory` | 50 certs/domain/week, 300 new orders/account/3hrs |

### Setting Up an ACME Account

The ACME account is created automatically on first use. You only need to generate and configure the account key:

```bash
# Generate account key
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 -out acme-account.key

# Copy to .env (replace newlines with \n)
echo "ACME_ACCOUNT_KEY='$(cat acme-account.key | tr '\n' '~' | sed 's/~/\\n/g')'"
```

### Switching to Production

When you're ready to issue real certificates:

1. Set `ACME_DIRECTORY_URL=https://acme-v02.api.letsencrypt.org/directory`
2. Optionally generate a new account key for production (recommended)
3. Ensure your DNS provider is correctly configured
4. Test with a single domain before bulk issuance

---

## Cloudflare DNS

### Overview

Cloudflare is the default DNS provider for solving ACME DNS-01 challenges. KrakenKey creates and deletes TXT records in your Cloudflare zone automatically during certificate issuance.

### How It Works

- TXT records are created at `_acme-challenge.{domain}` within your configured zone
- Dots in hostnames are flattened to dashes (e.g. `sub.example.com` → `_acme-challenge-sub-example-com`)
- Records use a 60-second TTL for fast propagation
- Records are automatically cleaned up after challenge completion

### Configuration

| Variable | Description |
|----------|-------------|
| `CLOUDFLARE_API_TOKEN` | API token with DNS edit permission |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID |
| `CLOUDFLARE_ZONE_ID` | Zone ID for the ACME challenge domain |

### Creating a Cloudflare API Token

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com) → My Profile → API Tokens
2. Click **Create Token**
3. Use the **Edit zone DNS** template, or create a custom token with:
   - **Permissions**: Zone → DNS → Edit
   - **Zone Resources**: Include → Specific zone → your ACME zone
4. Copy the token to `CLOUDFLARE_API_TOKEN`

### Finding Your Zone ID and Account ID

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Select the domain you're using for ACME challenges
3. On the **Overview** page, scroll down to the right sidebar
4. Copy the **Zone ID** and **Account ID**

---

## AWS Route 53

### Overview

Route 53 is an alternative DNS provider for ACME DNS-01 challenges. Select it by setting `KK_DNS_PROVIDER=route53`.

### How It Works

- TXT records are created via the Route 53 `ChangeResourceRecordSets` API
- Uses UPSERT action (creates or updates existing records)
- Dots in hostnames are flattened to dashes
- Record values are wrapped in quotes (Route 53 requirement for TXT records)
- 60-second TTL

### Configuration

| Variable | Description |
|----------|-------------|
| `KK_DNS_PROVIDER` | Set to `route53` |
| `AWS_ACCESS_KEY_ID` | IAM access key |
| `AWS_SECRET_ACCESS_KEY` | IAM secret key |
| `AWS_REGION` | AWS region (e.g. `us-east-1`) |
| `KK_AWS_ROUTE53_HOSTED_ZONE_ID` | Hosted zone ID for the ACME challenge domain |

### IAM Policy

The IAM user or role needs the following minimum permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "route53:ChangeResourceRecordSets",
        "route53:ListResourceRecordSets"
      ],
      "Resource": "arn:aws:route53:::hostedzone/YOUR_HOSTED_ZONE_ID"
    }
  ]
}
```

---

## Authentik (OIDC Authentication)

### Overview

KrakenKey uses Authentik as its identity provider via OpenID Connect (OIDC). Authentik handles user registration, login, and session management. The backend exchanges OIDC authorization codes for JWT tokens and provisions users on first login.

### Authentication Flow

```
User ──▶ KrakenKey Frontend ──▶ Authentik Login Page
                                       │
                              User authenticates
                                       │
                                       ▼
Authentik ──▶ Redirect to /auth/callback with authorization code
                                       │
                              Backend exchanges code
                              for access + ID tokens
                                       │
                                       ▼
                              Backend extracts claims,
                              provisions user (JIT),
                              returns JWT session
```

### Configuration

| Variable | Description |
|----------|-------------|
| `KK_AUTHENTIK_DOMAIN` | Authentik instance domain |
| `KK_AUTHENTIK_ENROLLMENT_SLUG` | Enrollment flow slug |
| `KK_AUTHENTIK_ISSUER_URL` | OIDC issuer URL (must match token `iss` claim) |
| `KK_AUTHENTIK_CLIENT_ID` | OAuth2 client ID |
| `KK_AUTHENTIK_CLIENT_SECRET` | OAuth2 client secret |
| `KK_AUTHENTIK_REDIRECT_URI` | Callback URL (e.g. `https://api.example.com/auth/callback`) |
| `KK_AUTHENTIK_POST_ENROLLMENT_REDIRECT` | Redirect after new user enrollment |

### Setting Up Authentik

1. **Create an Application** in Authentik admin
   - Name: `KrakenKey`
   - Slug: `krakenkey`

2. **Create an OAuth2/OIDC Provider**
   - Client type: Confidential
   - Client ID: Copy to `KK_AUTHENTIK_CLIENT_ID`
   - Client Secret: Copy to `KK_AUTHENTIK_CLIENT_SECRET`
   - Redirect URIs: Add your `KK_AUTHENTIK_REDIRECT_URI`
   - Signing Key: Select an RSA key (RS256)
   - Scopes: `openid`, `profile`, `email`

3. **Create an Enrollment Flow** (for self-registration)
   - Slug: Copy to `KK_AUTHENTIK_ENROLLMENT_SLUG`
   - Configure stages: identification, password, email verification (optional)

4. **Assign the provider** to the application

### JWT Validation

The backend validates JWTs using:
- **JWKS endpoint**: Fetched from Authentik's `.well-known/openid-configuration`
- **Algorithm**: RS256
- **Issuer**: Must match `KK_AUTHENTIK_ISSUER_URL`

### User Provisioning

Users are created just-in-time on first OIDC callback:
- User ID: Authentik `sub` claim
- Username: `preferred_username` claim
- Email: `email` claim
- Groups: `groups` claim (used for admin detection)

---

## Stripe (Billing)

### Overview

KrakenKey uses Stripe for subscription billing. The integration supports checkout sessions, customer portal, subscription management, and webhook processing.

### Configuration

| Variable | Description |
|----------|-------------|
| `KK_STRIPE_SECRET_KEY` | Stripe secret API key |
| `KK_STRIPE_WEBHOOK_SECRET` | Webhook signing secret |
| `KK_STRIPE_PRICE_STARTER` | Price ID for Starter plan |
| `KK_STRIPE_PRICE_TEAM` | Price ID for Team plan |
| `KK_STRIPE_PRICE_BUSINESS` | Price ID for Business plan |
| `KK_STRIPE_PRICE_ENTERPRISE` | Price ID for Enterprise plan |

### Setting Up Stripe

1. **Create Products and Prices** in the Stripe Dashboard
   - Create a product for each plan (Starter, Team, Business, Enterprise)
   - Create a recurring price for each product
   - Copy each Price ID (e.g. `price_1ABC...`) to the corresponding env var

2. **Set Up Webhooks**
   - Go to Stripe Dashboard → Developers → Webhooks
   - Add endpoint: `https://api.example.com/billing/webhook`
   - Select events:
     - `checkout.session.completed`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`
     - `invoice.payment_failed`
   - Copy the signing secret to `KK_STRIPE_WEBHOOK_SECRET`

3. **For local development**, use the Stripe CLI:

```bash
stripe listen --forward-to localhost:8080/billing/webhook
```

### Webhook Events

| Event | Action |
|-------|--------|
| `checkout.session.completed` | Creates subscription record, links to user/org |
| `customer.subscription.updated` | Updates plan, status, billing period |
| `customer.subscription.deleted` | Marks subscription as canceled, resets to free tier |
| `invoice.payment_failed` | Updates subscription status to `past_due` |

---

## Probe Service (Internal)

### Overview

KrakenKey supports external probe instances that connect to the API for TLS endpoint monitoring. Probes authenticate using service API keys.

### Configuration

| Variable | Description |
|----------|-------------|
| `KK_PROBE_API_KEY` | Pre-shared service key for probe authentication. Auto-seeded into the database on startup |

### API Key Types

| Prefix | Type | Purpose |
|--------|------|---------|
| `kk_` | User API key | Individual user access to the API |
| `kk_svc_` | Service API key | System-level access for probes and internal services |

### Authentication

Service keys authenticate via the `Authorization: Bearer kk_svc_...` header and are validated using scrypt hash comparison. They support expiration and revocation.
