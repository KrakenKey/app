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
| `KK_STRIPE_PRICE_PRO_MONTHLY`, `KK_STRIPE_PRICE_PRO_YEARLY` | Pro prices, monthly and yearly |
| `KK_STRIPE_PRICE_BUSINESS_MONTHLY`, `KK_STRIPE_PRICE_BUSINESS_YEARLY` | Business prices, monthly and yearly |
| `KK_STRIPE_PORTAL_CONFIGURATION_ID` | Optional billing portal configuration |

### Setting Up Stripe

1. **Create Products and Prices** in the Stripe Dashboard
   - Create a product for each self-serve plan (Pro, Business)
   - Create two recurring prices for each product, monthly and yearly (a year at ten times the monthly price)
   - Copy each Price ID (e.g. `price_1ABC...`) to the corresponding env var
   - In the customer portal settings, let customers switch plans and add the four prices, so the dashboard's monthly/yearly switch works

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

## AWS Marketplace (Billing)

**Source:** `src/billing/aws-marketplace/`

Pro and Business (and Enterprise through private offers) can be bought on an AWS bill through a SaaS contract listing: the buyer picks one tier (contract dimension `pro` or `business`) for a monthly or 12-month term, with no metering and no free trial. AWS bills the customer; KrakenKey resolves the purchase, links it to an account and follows the entitlement. New purchases are off until `KK_AWS_MARKETPLACE_ENABLED=true` and `KK_AWS_MARKETPLACE_PRODUCT_CODES` is set (see [Configuration](./CONFIGURATION.md#billing-aws-marketplace)). The flag only gates new purchases: subscriptions AWS already bills keep being checked by the event consumer and the hourly reconcile whenever their settings are present, and their paid limits always end with their term (see [Entitlements](#entitlements)), so turning the flag off never leaves paid access open.

Purchases are identified by license ARN together with the buyer's AWS account ID. `CustomerIdentifier` is empty for new SaaS products, and with Concurrent Agreements one AWS account can hold several licenses for the product, so nothing is keyed on the account alone.

### Listing settings

| Field | Value |
|-------|-------|
| Fulfillment URL | `https://<api domain>/billing/aws-marketplace/register` |
| Pricing | SaaS contract, one tier per buyer; dimensions match `KK_AWS_MARKETPLACE_DIMENSION_MAP` |
| Product code | `KK_AWS_MARKETPLACE_PRODUCT_CODES` |

Use a separate Limited (hidden) test product for dev and set each environment's product code, so a test purchase never reaches production.

### Fulfillment URL and landing page

1. After a purchase, and whenever the buyer chooses Set up your account in the AWS Marketplace console, the buyer's browser POSTs a form to the fulfillment URL with `x-amzn-marketplace-token` (plus `x-amzn-marketplace-offer-type=free-trial` for trials, which this listing doesn't offer). The route is unauthenticated and rate limited per IP like other public routes.
2. The token must look like an AWS registration token (16 to 4096 characters from `A-Z a-z 0-9 + / = _ . : ~ -`); anything else is refused without calling AWS. The API then calls `ResolveCustomer` right away (8 second timeout, one retry). AWS returns the buyer's account ID, the license ARN, the product code and, when available, the agreement ID. A product code that isn't in `KK_AWS_MARKETPLACE_PRODUCT_CODES` is refused.
3. The purchase is stored in `aws_marketplace_registration` under the SHA-256 of a new random ID, for 24 hours, and the browser gets `303 See Other` to `https://<app domain>/aws-marketplace?registration=<id>`. The AWS token is never stored, logged or put in a URL. If AWS refuses the token (invalid, expired or already used) or can't be reached, the redirect carries `?error=invalid_token|missing_token|unknown_product|unavailable` instead and the page tells the buyer how to start again from the AWS console.
4. The page moves the registration ID from the address bar to session storage (so it isn't left in the URL or browser history, and a reload still works). A signed-out buyer creates an account or signs in, and comes back to the page afterwards. Signing up satisfies AWS's requirement to collect an email address, and existing customers sign in with their usual login.
5. `POST /billing/aws-marketplace/resolve` shows what was bought: the dimension and plan (from `GetEntitlements`), the AWS account, the end of the current term, and what can be done with it: link it, already linked here (active or waiting for AWS), linked to another account, a conflict with an existing paid plan, not the organization owner, a dimension that isn't mapped, or a contract that ended.
6. `POST /billing/aws-marketplace/link` claims the license on the user's subscription row, or the organization's for its owner, as pending (Free limits), and deletes the registration (the setup link is used up; Set up your account in the AWS console starts a new one). This is where an account with a live Stripe, Microsoft or other AWS subscription is refused. It then syncs the license from `GetEntitlements`: with a current entitlement the plan applies at once; without one the link stays pending until a `License Updated` event or the hourly reconcile finds the entitlement. The page says which.

Both landing page routes need a dashboard session (API keys get `403`). While a link is pending, `POST /billing/checkout` answers `409` for that account, however long it waits, so the account is never billed twice. The billing page shows the pending purchase and lets the owner remove it (`DELETE /billing/aws-marketplace/pending`, dashboard session only, works with the flag off too). That only unlinks it in KrakenKey (recorded as `aws-unlink:<uuid>`); nothing is canceled in AWS, and the page says so. A purchase AWS confirmed meanwhile isn't removed (`409`).

### Entitlements

`GetEntitlements` (us-east-1) is always filtered by `LICENSE_ARN` and the product code. An entry counts when its value grants something (a positive integer or double, `true`, or a non-empty string; contract tiers are reported as `1`). With more than one current entry (for example during an upgrade) the highest mapped plan wins.

| What `GetEntitlements` reports | Stored as |
|-------------------------------|-----------|
| A current entitlement for a mapped dimension | `active`, `plan` from the dimension map, `currentPeriodEnd` = `ExpirationDate`, `marketplaceStatus` `active` |
| A dimension that isn't mapped | Plan unchanged, logged as an error |
| Entitlements whose `ExpirationDate` passed more than 24 hours ago | Free plan, `canceled`, `marketplaceStatus` `ended` |
| No entitlement, for an active license | Free plan, `canceled`, `marketplaceStatus` `ended` |
| No entitlement, for a pending link | Stays pending, unless the event ends the agreement or license |

For an auto-renewing contract `ExpirationDate` is the renewal date, so an entitlement keeps counting for 24 hours after it (`AWS_EXPIRATION_GRACE_MS`) while the renewed date shows up.

**Fail closed.** `effectivePlan()` and `entitledSubscriptionSql()` only apply an AWS plan while `currentPeriodEnd` plus 24 hours is in the future, whatever the row's status says. If AWS can't be reached, the seller role breaks or the API stops checking, paid limits still end with the paid term; the next successful check restores them if AWS renewed the contract. An entitlement without an end date (contracts have one) is stored as verified for 24 hours at a time and refreshed by every check. An `ended` license whose entitlement comes back (a new term) is reactivated. Ending a license that backs an organization dissolves the organization, as with a Stripe cancellation.

### Events

AWS Marketplace sends agreement and license events to the seller account's default EventBridge bus in us-east-1 ([Seller Guide](https://docs.aws.amazon.com/marketplace/latest/userguide/saas-eventbridge-integration.html), [event payloads](https://docs.aws.amazon.com/marketplace/latest/userguide/notifications-eventbridge.html)). A rule there forwards them to an SQS queue in each environment's account, and every API process long-polls that queue (`KK_AWS_MARKETPLACE_QUEUE_URL`, 20 second polls, 10 messages, 5 minute visibility timeout) whenever the URL is set, with or without the flag. At startup the consumer logs whether the queue is reachable and warns when it has no dead-letter queue (`RedrivePolicy`).

Handled detail types (source `aws.agreement-marketplace`): `Purchase Agreement Created`, `Purchase Agreement Amended` and `Purchase Agreement Ended` (each `- Proposer` and `- Manufacturer`), `License Updated - Manufacturer` and `License Deprovisioned - Manufacturer`. `Purchase Agreement Advisory Issued - Manufacturer` and `Purchase Agreement Advisory Resolved - Manufacturer` (AWS flags a possible problem with the buyer, such as account closure or fraud) are logged at warn level and recorded, without changing access; an operator decides. Anything else is recorded as ignored and deleted.

- An event is only a hint about which licenses to re-read. License events name the license (`detail.license.arn`); agreement events don't, so they re-read every linked license on that agreement, on the agreement a renewal replaces (`previousAgreementId`), or held by the buyer's AWS account (`detail.acceptor.accountId`). The state applied always comes from `GetEntitlements`, so order and redelivery don't matter.
- An ending event (`Purchase Agreement Ended`, `License Deprovisioned`) only ends a pending link it is about: the license it names, or a license whose stored agreement is the one that ended. Other licenses of the same buyer account are only re-read. An active license ends whenever `GetEntitlements` no longer reports it, whatever the event.
- `License Updated` also records the license's current agreement ID. `Purchase Agreement Amended` for the license's agreement sets `cancelAtPeriodEnd` from `autoRenewalEnabled`.
- License events for a product code that isn't in `KK_AWS_MARKETPLACE_PRODUCT_CODES` are ignored. Events for licenses that aren't linked yet are recorded and deleted; the landing page reads the entitlement itself when the buyer gets there. For `License Updated`, an unlinked license that `GetEntitlements` reports as entitled is logged at warn level and recorded as "entitled, not linked to an account" (usually a buyer who hasn't finished setting up yet).
- Each event is recorded in `marketplace_operation` as `aws:<event id>`, after its licenses are synced. A redelivered event is deleted without being applied again (an organization dissolution it recorded is queued again). A message is deleted only after it was handled; if AWS or the database fails, it stays on the queue and comes back after the visibility timeout. Configure a dead-letter queue (for example after 5 receives). Malformed messages are logged and deleted.

**Several API processes.** Both containers of a blue/green deploy consume the queue. SQS hands each message to one of them at a time. A sync reads `GetEntitlements` first (10 second timeout, plus any STS refresh) with no database transaction or lock held, then applies the result in a short transaction that sets `statement_timeout` (10 s) and `idle_in_transaction_session_timeout` (15 s), takes `pg_advisory_xact_lock(hashtext('aws-marketplace:<license ARN>'))`, re-loads the row with a row lock and skips it if it was unlinked meanwhile. Two events for the same license, or an event and the reconcile job, apply one after the other; two reads made moments apart can land in the opposite order, which the next event or the hourly reconcile corrects. On shutdown the consumer stops polling (the long poll is aborted) and waits up to 45 seconds for the batch in progress.

### Reconcile

`AwsMarketplaceReconciler` runs hourly at :25 through `ScheduledJobLock` (once across API processes), with or without the flag. It re-syncs every license that is `pending` or `active`, records changes in `marketplace_operation` as `aws-reconcile:<uuid>` and keeps going when one license fails. Failures are logged at error level (each license, then a summary) and counted in `aws_marketplace_syncs_total{result="error"}`. If AWS-billed rows exist but `KK_AWS_MARKETPLACE_ROLE_ARN` is unset and the flag is off, it logs an error and skips the run (their limits still end with their term). Before deleting expired registrations it checks each one that was never linked: an entitled license there means a buyer paid and didn't finish setting up, which is logged at warn level and recorded as `aws-unlinked:<uuid>`. It catches lost or delayed events, contracts that expire without one, and links made before AWS granted the entitlement.

### Credentials and IAM

`ResolveCustomer` must be called from the seller account (the account that publishes the product), and both Marketplace APIs are only served in us-east-1. With `KK_AWS_MARKETPLACE_ROLE_ARN` set, the API assumes that role in the seller account with STS (session name `krakenkey-aws-marketplace`, 1 hour) and reuses the credentials until 5 minutes before they expire; the base credentials come from the default chain (the EC2 instance role). SQS is called with the base credentials, since the queue is in the environment's own account.

Role in the seller account (`KK_AWS_MARKETPLACE_ROLE_ARN`), permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "aws-marketplace:ResolveCustomer",
        "aws-marketplace:GetEntitlements"
      ],
      "Resource": "*"
    }
  ]
}
```

Its trust policy names each environment's instance role:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::<environment account id>:role/<api instance role>"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

The environment's instance role:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "sts:AssumeRole",
      "Resource": "arn:aws:iam::<seller account id>:role/<marketplace role>"
    },
    {
      "Effect": "Allow",
      "Action": [
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage",
        "sqs:GetQueueAttributes"
      ],
      "Resource": "arn:aws:sqs:us-east-1:<environment account id>:<queue name>"
    }
  ]
}
```

Use SSE-SQS (or no encryption) on the queue; with a customer managed KMS key the EventBridge role needs `kms:GenerateDataKey` and `kms:Decrypt`, and the instance role `kms:Decrypt`, on it.

### Forwarding events from the seller account

EventBridge delivers to an SQS queue in another account only in the same region, so each environment's queue is in us-east-1. In the seller account, on the default event bus in us-east-1, create one rule per environment with this pattern:

```json
{
  "source": ["aws.agreement-marketplace"],
  "detail-type": [
    "Purchase Agreement Created - Proposer",
    "Purchase Agreement Created - Manufacturer",
    "Purchase Agreement Amended - Proposer",
    "Purchase Agreement Amended - Manufacturer",
    "Purchase Agreement Ended - Proposer",
    "Purchase Agreement Ended - Manufacturer",
    "License Updated - Manufacturer",
    "License Deprovisioned - Manufacturer",
    "Purchase Agreement Advisory Issued - Manufacturer",
    "Purchase Agreement Advisory Resolved - Manufacturer"
  ]
}
```

The target is the environment's queue ("Target in another AWS account"), sent as is (no input transformer), with an execution role in the seller account that `events.amazonaws.com` can assume and that allows `sqs:SendMessage` on that queue ARN. The queue's resource policy allows that role to send:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::<seller account id>:role/<eventbridge execution role>"
      },
      "Action": "sqs:SendMessage",
      "Resource": "arn:aws:sqs:us-east-1:<environment account id>:<queue name>"
    }
  ]
}
```

Agreement events don't carry a product code, so both environments see each other's agreement events. That is harmless: they only re-read licenses linked in that environment, and license events for other products are ignored.

### Turning it on

1. Deploy the release with the flag off, and wait until the deploy has fully replaced the old containers. The migration only adds nullable columns and a table, so the previous release keeps running beside it, but the previous release doesn't know AWS-billed rows: while it still serves traffic it could start a Stripe checkout for an account AWS bills, and it doesn't end AWS plans at the end of their term. Turn the flag on only once no container of the previous release is left.
2. Create the role in the seller account, the queue (with a dead-letter queue) in the environment account, the EventBridge rule, and grant the instance role `sts:AssumeRole` and the SQS permissions.
3. Set `KK_AWS_MARKETPLACE_ROLE_ARN`, `KK_AWS_MARKETPLACE_PRODUCT_CODES`, `KK_AWS_MARKETPLACE_DIMENSION_MAP` and `KK_AWS_MARKETPLACE_QUEUE_URL`, then `KK_AWS_MARKETPLACE_ENABLED=true`, and restart. Startup logs name any setting that is missing or malformed; without product codes the flag stays off with an error. The consumer logs whether the queue is reachable and warns when it has no dead-letter queue.
4. Set the product's fulfillment URL and make a test purchase on the Limited test product.
5. To stop selling later, turn the flag off but keep the role and queue settings for as long as AWS-billed subscriptions exist, so they keep being followed.

### Testing

Use the Limited test product (test prices) with an allowlisted buyer account, and never make it public. Cancel test agreements with a refund request.

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
