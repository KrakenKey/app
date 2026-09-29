# Billing & Subscriptions

KrakenKey uses Stripe for subscription management with five plan tiers that control feature access and resource limits.

## Plan Tiers

| Feature | Free | Starter | Team | Business | Enterprise |
|---------|------|---------|------|----------|------------|
| **Price** | $0 | — | — | — | Contact us |
| **Domains** | 3 | 10 | 25 | 75 | Unlimited |
| **API Keys** | 2 | 5 | 10 | 25 | Unlimited |
| **Certificates / month** | 5 | 50 | 250 | 1,000 | Unlimited |
| **Active Certificates** | 10 | 75 | 375 | 1,500 | Unlimited |
| **Scan Interval** | 60 min | 30 min | 5 min | 1 min | Custom |
| **Hosted Probe Regions** | — | 2 | 5 | 15 | Unlimited |
| **Hosted Endpoints** | — | 5 | 25 | 100 | Unlimited |
| **Hosted Scan Interval** | — | 30 min | 15 min | 5 min | 1 min |
| **Data Retention** | 5 days | 30 days | 90 days | 90 days | Custom |
| **Auto-Renewal Window** | 5 days | 30 days | 30 days | 30 days | 30 days |
| **Organizations** | — | — | Yes | Yes | Yes |

## API Endpoints

### Create Checkout Session

Start a new subscription by redirecting the user to Stripe Checkout.

```
POST /billing/checkout
```

**Request:**
```json
{
  "plan": "starter"
}
```

**Response:**
```json
{
  "url": "https://checkout.stripe.com/c/pay_..."
}
```

Redirect the user to the returned URL. After payment, Stripe redirects back to KrakenKey and fires a `checkout.session.completed` webhook.

Valid plan values: `starter`, `team`, `business`, `enterprise`

### Get Current Subscription

```
GET /billing/subscription
```

**Response:**
```json
{
  "plan": "team",
  "status": "active",
  "stripeCustomerId": "cus_...",
  "stripeSubscriptionId": "sub_...",
  "currentPeriodStart": "2026-03-01T00:00:00.000Z",
  "currentPeriodEnd": "2026-04-01T00:00:00.000Z"
}
```

Returns `null` for users on the free tier (no active subscription).

### Manage Subscription (Stripe Portal)

Opens the Stripe Customer Portal where users can update payment methods, view invoices, and cancel.

```
POST /billing/portal
```

**Response:**
```json
{
  "url": "https://billing.stripe.com/p/session/..."
}
```

### Preview Upgrade

See the prorated cost before upgrading.

```
POST /billing/upgrade/preview
```

**Request:**
```json
{
  "plan": "business"
}
```

**Response:**
```json
{
  "currentPlan": "team",
  "newPlan": "business",
  "proratedAmount": 4500,
  "currency": "usd"
}
```

The `proratedAmount` is a flat fee difference (not day-based proration) in the smallest currency unit (cents for USD).

### Execute Upgrade

```
POST /billing/upgrade
```

**Request:**
```json
{
  "plan": "business"
}
```

Immediately charges the prorated difference and switches the subscription to the new plan.

### Stripe Webhook

```
POST /billing/webhook
```

Internal endpoint — receives signed webhook events from Stripe. Not called by users directly. See [Integrations](./INTEGRATIONS.md#stripe-billing) for webhook setup.

## Subscription Lifecycle

### New Subscription
1. User selects a plan and clicks upgrade
2. Backend creates a Stripe Checkout Session
3. User completes payment on Stripe
4. `checkout.session.completed` webhook fires
5. Backend creates a `Subscription` record linked to the user (or organization)

### Plan Upgrade
1. User requests upgrade preview to see prorated cost
2. User confirms upgrade
3. Backend charges flat-fee proration via Stripe
4. `customer.subscription.updated` webhook fires
5. Backend updates the local subscription record

### Cancellation
1. User cancels via Stripe Customer Portal
2. `customer.subscription.deleted` webhook fires
3. Backend marks subscription as canceled
4. User reverts to free tier limits

### Failed Payment
1. `invoice.payment_failed` webhook fires
2. Backend marks subscription as `past_due`
3. Stripe retries payment per its dunning settings
4. If retries succeed, `customer.subscription.updated` restores `active` status

## Organization Billing

Organizations have their own billing relationship:

- When a user creates an organization (requires Team+ plan), their personal subscription is converted to an organization subscription
- The organization owner controls billing — non-owners cannot access billing endpoints
- If an organization is downgraded below the Team tier, the organization is automatically dissolved:
  1. Non-owner member resources (domains, certificates) are transferred to the organization owner
  2. Member associations are cleared
  3. The subscription reverts to a personal subscription
  4. The organization is deleted

### Dissolution queue

Dissolution runs as an `orgDissolution` BullMQ job, keyed `dissolve-<organizationId>` so a given organization can only have one in flight. BullMQ silently ignores `add()` for a job ID that already exists, which means a *failed* earlier attempt would otherwise block every retry for that organization forever. A failed job under the same ID is therefore removed before re-queueing, and the removal is logged with the previous failure reason.

The job itself retries 3 times with exponential backoff from a 5-second base.

### Owner subscription conflicts

Step 3 above reassigns the organization's subscription row to the owner. A user may hold only one personal subscription (enforced by the `UQ_subscription_userId_partial` index), and the owner can already have one — for example a member who kept a personal subscription and was later promoted to owner. When both rows exist, the outcome depends on which subscriptions are still live in Stripe:

| Situation | Outcome |
|-----------|---------|
| Dissolution requested with `cancelSubscription` | The org's Stripe subscription is already cancelled, so its row is deleted and the owner keeps their personal subscription |
| Owner's personal subscription is not billing (no Stripe subscription, or `canceled` / `incomplete_expired`) | The owner's inactive row is deleted and the org's paid subscription replaces it |
| Both are billing in Stripe | The job fails with an `UnrecoverableError` and is left for manual review |

The last case is deliberate: deleting either row would orphan a subscription that is still charging the customer. It raises `UnrecoverableError` rather than a plain error so BullMQ does not burn the remaining retries on a conflict that cannot resolve itself. The organization stays in `dissolving` status until an operator resolves the duplicate, and the log line names both subscription IDs and the organization.

## Subscription Statuses

| Status | Description |
|--------|-------------|
| `active` | Subscription is current and payment is up to date |
| `past_due` | Payment failed, Stripe is retrying |
| `canceled` | Subscription has been canceled |
| `incomplete` | Initial payment has not completed |
| `trialing` | Subscription is in a trial period |

## Subscription Entity Schema

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `plan` | varchar | Plan name (starter, team, business, enterprise) |
| `status` | varchar | Subscription status |
| `stripeCustomerId` | varchar | Stripe customer ID |
| `stripeSubscriptionId` | varchar | Stripe subscription ID (unique, indexed) |
| `currentPeriodStart` | timestamp | Current billing period start |
| `currentPeriodEnd` | timestamp | Current billing period end |
| `userId` | varchar | Owner user ID (nullable, indexed) |
| `organizationId` | UUID | Owner organization ID (nullable, indexed) |
| `createdAt` | timestamp | Record creation time |
| `updatedAt` | timestamp | Last update time |
