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
| `KK_ACME_ACCOUNT_KEY` | 4096-bit RSA private key in PEM format |
| `KK_ACME_CONTACT_EMAIL` | Contact email registered with Let's Encrypt |
| `KK_ACME_AUTH_ZONE_DOMAIN` | DNS zone for challenge delegation |
| `KK_ACME_STAGING` | `true` to use Let's Encrypt Staging (default: production) |
| `KK_ACME_DIRECTORY_URL` | Custom ACME directory; overrides `KK_ACME_STAGING` |

### Environments

| Environment | Directory URL | Rate Limits |
|-------------|--------------|-------------|
| **Staging** (`KK_ACME_STAGING=true`) | `https://acme-staging-v02.api.letsencrypt.org/directory` | Generous limits, issues untrusted test certificates |
| **Production** (default) | `https://acme-v02.api.letsencrypt.org/directory` | 50 certs/domain/week, 300 new orders/account/3hrs |

### Setting Up an ACME Account

The ACME account is created automatically on first use. You only need to generate and configure the account key:

```bash
# Generate account key
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 -out acme-account.key

# Copy to .env (replace newlines with \n)
echo "KK_ACME_ACCOUNT_KEY='$(cat acme-account.key | tr '\n' '~' | sed 's/~/\\n/g')'"
```

### Switching to Production

Production is the default. When you're ready to issue real certificates:

1. Remove `KK_ACME_STAGING` (or set it to `false`) and leave `KK_ACME_DIRECTORY_URL` unset
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
| `KK_AUTHENTIK_HEALTH_URL` | Optional. URL the readiness check fetches instead of the issuer's discovery document (e.g. Authentik's `/-/health/ready/` on a private network) |
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
   - Logout redirect URIs: Add the origin of `KK_AUTHENTIK_REDIRECT_URI` (e.g. `https://app.example.com`, no trailing slash). Logout sends users to the provider's end-session endpoint and Authentik only returns them to a registered URI.
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
| `KK_STRIPE_PRICE_PRO_MONTHLY` | Price ID for the Pro plan, monthly |
| `KK_STRIPE_PRICE_BUSINESS_MONTHLY` | Price ID for the Business plan, monthly |

### Setting Up Stripe

1. **Create Products and Prices** in the Stripe Dashboard
   - Create a product for each self-serve plan (Pro, Business)
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
     - `invoice.paid`
   - Copy the signing secret to `KK_STRIPE_WEBHOOK_SECRET`

3. **For local development**, use the Stripe CLI:

```bash
stripe listen --forward-to localhost:8080/billing/webhook
```

### Webhook Events

| Event | Action |
|-------|--------|
| `checkout.session.completed` | Creates subscription record, links to user/org |
| `customer.subscription.updated` | Updates plan, status, billing period; starts the grace period on `past_due`, clears it on `active` |
| `customer.subscription.deleted` | Marks subscription as canceled, resets to free tier |
| `invoice.payment_failed` | Sets status `past_due`, records `pastDueSince` on the first failure and emails the owner |
| `invoice.paid` | Restores `active` and clears `pastDueSince` after a failed payment |

---

## Microsoft Marketplace (Billing)

**Source:** `src/billing/marketplace/`

Organizations can buy Pro or Business (and Enterprise through private offers) on their Microsoft invoice through a transactable SaaS offer. Microsoft bills the customer; KrakenKey implements the [SaaS fulfillment API v2](https://learn.microsoft.com/partner-center/marketplace-offers/pc-saas-fulfillment-apis). Everything is off until `KK_MARKETPLACE_ENABLED=true` (see [Configuration](./CONFIGURATION.md#billing-microsoft-marketplace)).

### Partner Center technical configuration

| Field | Value |
|-------|-------|
| Landing page URL | `https://<app domain>/marketplace` (no `#`) |
| Connection webhook | `https://<api domain>/billing/marketplace/webhook` |
| Microsoft Entra tenant ID | `KK_MARKETPLACE_TENANT_ID` |
| Microsoft Entra application ID | `KK_MARKETPLACE_CLIENT_ID` |

The app registration needs a client secret (`KK_MARKETPLACE_CLIENT_SECRET`), and the Marketplace SaaS API's service principal (`20e940b3-4c77-4b0b-9a53-9e16a1b010a7`) must exist in the tenant. Plans are configured with manual activation in mind; auto-activation also works (the `Subscribe` webhook is handled), but the buyer still has to open the landing page once to link the purchase to a KrakenKey account.

### Landing page

1. Microsoft opens `/marketplace?token=...` after a purchase and again when the customer selects "Manage account" in the Azure portal or Microsoft 365 admin center.
2. A signed-out buyer signs in (Microsoft sign-in, or email for an existing password account). The token is kept in session storage across the sign-in and the buyer comes back to the page.
3. `POST /billing/marketplace/resolve` exchanges the token with Microsoft (Resolve) and returns the purchase and what can be done with it: activate it for this account, already active here (a "manage" visit), linked to another account, a conflict with an existing paid plan, not the organization owner, a plan without organizations for an account in one (organizations need Pro or higher, as with Stripe; every plan sold through the Marketplace qualifies, so this doesn't happen with the current plans), an unknown plan, suspended or canceled.
4. `POST /billing/marketplace/activate` resolves the token again on the server, then:
   1. claims the purchase on the user's row, or the organization's for an organization owner, as pending (`status` `incomplete`, Free limits). This is where a live subscription on the account is refused, before Microsoft bills anything;
   2. calls Activate while the purchase is `PendingFulfillmentStart` (billing starts here). If Microsoft refuses, the pending claim stays and opening the page again retries;
   3. reads the subscription from Microsoft again and applies what it reports (a suspension, cancellation or plan change that came in since Resolve is not lost). Right after Activate Microsoft may still report `PendingFulfillmentStart`; that counts as active. If the read fails, the claim stays pending and the next visit finishes it.

While a claim is less than 15 minutes old, `POST /billing/checkout` answers `409` for that account.

When the signed-in user's email is neither the purchaser's nor the beneficiary's, the page asks for an explicit confirmation before activating, so a purchase link sent by someone else isn't applied to an account by accident. Purchases in a status other than `PendingFulfillmentStart` or `Subscribed` are refused.

Both routes need a dashboard session (API keys get `403`) and only the organization owner can activate for an organization.

### Webhook

`POST /billing/marketplace/webhook` checks every call before acting:

1. The `Authorization` bearer token must be an RS256 Entra ID token signed with the tenant's published keys, issued by the tenant (`https://sts.windows.net/<tenant>/` or `https://login.microsoftonline.com/<tenant>/v2.0`, and `tid`), for the app (`aud` = client ID), on behalf of the Marketplace SaaS API (`appid` or `azp` = `20e940b3-4c77-4b0b-9a53-9e16a1b010a7`), and not expired. Otherwise `401`.
2. Operations already handled (by operation ID, table `marketplace_operation`) are acknowledged with `200` and not applied again.
3. `GET .../operations/{id}` must return the same subscription, action, offer, and for `ChangePlan` and `ChangeQuantity` the same plan or quantity. A mismatch or an unknown operation gets `400`; if Microsoft can't be reached the webhook answers `503` so Microsoft retries.
4. The change is applied and the operation recorded in one transaction. Changes Microsoft waits on (`ChangePlan`, `ChangeQuantity`, `Reinstate` still `InProgress`) are applied from the operation. For everything else the API reads the subscription from Microsoft and copies its current status, plan, quantity and term, so a webhook that arrives late or out of order (Microsoft retries for hours) can't undo a newer change. If that read disagrees with what a completed `Subscribe`, `Suspend` or `Reinstate` implies, the read is stale or a newer change happened; the webhook answers `503` without recording anything and Microsoft retries. A completed `Unsubscribe` is applied regardless (it is final). A subscription that reached `Unsubscribed` ignores later operations, and answers `Failure` to ones Microsoft waits on.
5. For `ChangePlan`, `ChangeQuantity` and `Reinstate` operations that are still `InProgress`, the API reports `Success` (or `Failure` for a plan that isn't in `KK_MARKETPLACE_PLAN_MAP`, or a subscription that already ended) with `PATCH .../operations/{id}`. Microsoft accepts plan and quantity changes on its own after 10 seconds without an answer, so all calls to Microsoft for one webhook share an 8-second budget (each request's timeout is cut to what is left).

Subscription and operation ids are GUIDs and are stored and compared in lower case.

| Microsoft status | Stored as |
|------------------|-----------|
| `Subscribed` | `active`, `pastDueSince` cleared |
| `Suspended` | `past_due` with `pastDueSince`; paid limits stay for Microsoft's 30-day grace |
| `Unsubscribed` | Free plan, `canceled`; an organization subscription dissolves the organization |

A plan change to a plan without organizations dissolves the organization, as with Stripe. `ChangeQuantity` only stores the quantity (plans are not per seat). Calls for a purchase that isn't linked to an account yet are recorded and acknowledged. A redelivered operation re-sends the recorded answer while Microsoft still shows the operation `InProgress`, and re-queues the organization dissolution the first delivery recorded (if the organization still exists), in case that delivery failed after recording the operation. A purchase that is still being activated never dissolves an organization.

The tenant's signing keys are downloaded once and kept for a day. A token with an unknown key id triggers at most one download every 5 minutes, and tokens for another tenant or audience never trigger one.

### Fulfillment API client

Client credentials against `https://login.microsoftonline.com/<tenant>/oauth2/v2.0/token` with scope `20e940b3-4c77-4b0b-9a53-9e16a1b010a7/.default`. The access token is cached until 5 minutes before it expires and fetched again once on a `401`. Requests time out after 4 seconds. Tokens, the client secret and purchase tokens are never logged.

### Metered billing

Not implemented. If plans gain a metered dimension (for example connector-managed certificates), the usage report belongs in a scheduled job next to `MarketplaceService`: post to the Marketplace metering API at most hourly, deduplicated by subscription, dimension and hour, with retries and a record of what Microsoft accepted.

### Testing

Use a separate DEV offer in Partner Center with a preview audience and never take it live. Purchases are real charges; cancel test purchases within 72 hours.

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
