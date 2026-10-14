# Billing & Subscriptions

KrakenKey uses Stripe for subscription management with four plans that control feature access and resource limits. Pro, Business and Enterprise (through private offers) can also be bought through Microsoft Marketplace (see [Microsoft Marketplace](#microsoft-marketplace)).

## Plans

Plan ids are `free`, `pro`, `business` and `enterprise`. The free plan is called **Starter** everywhere users see it (dashboard, emails, API messages); its id stays `free`. Enterprise is for custom deals and isn't sold self-serve. `PLAN_LABELS` and `PLAN_LIMITS` in `@krakenkey/shared` hold the names and numbers.

| Feature | Starter (`free`) | Pro | Business | Enterprise |
|---------|------------------|-----|----------|------------|
| **Domains** | 3 | 15 | 100 | Custom |
| **API Keys** | 2 | 10 | 50 | Custom |
| **Certificates / month** | 5 | 100 | 1,000 | Custom |
| **Active Certificates** | 10 | 150 | 1,000 | Custom |
| **Concurrent pending** | 2 | 10 | 50 | Custom |
| **Monitored endpoints** | 3 | 50 | 300 | Custom |
| **Hosted Endpoints** | 1 | 25 | 150 | Custom |
| **Hosted Probe Regions** | 1 | All running | All running | All running |
| **Hosted Scan Interval** | 60 min | 30 min | 5 min | 1 min |
| **Connected scan interval (minimum)** | 60 min | 15 min | 1 min | 1 min |
| **Hosts per Report** | 25 | 250 | 1,000 | 1,000 |
| **Scan result retention** | 7 days | 30 days | 90 days | 90 days |
| **Auto-Renewal Window** | 10 days | 30 days | 30 days | 30 days |
| **Organizations** | No | Up to 3 members | Unlimited members | Unlimited members |
| **Connectors** | 1 | 5 | 50 | Custom |
| **Alert channels** | 1 | 5 | 25 | Custom |
| **GitHub OIDC trust policies** | 2 | 10 | 50 | Custom |

"Custom" limits are unlimited in code (`Infinity`) until per-account limits exist. A report takes at most 1,000 hosts on any plan (`CreateReportDto`).

### Per-plan feature limits

Connectors (active, not revoked), alert channels, GitHub OIDC trust policies and organization members are limited by plan (`connectors`, `alertChannels`, `githubOidcTrusts` and `orgMembers` in `PLAN_LIMITS`). `PlanLimitsService` (`src/billing/limits/`) checks them:

- **Pooled like domains.** Connectors, channels and trust policies are counted across every member of the user's organization (`getResourceCountUserIds`), or the user alone. Members are counted per organization, owner included.
- **Only new resources are refused.** An account already over a limit (for example a free account with three alert channels from before the limits) keeps everything working; creating another returns `402`. Deleting down below the limit frees a slot.
- **The error names the next plan.** `402` with `code: "plan_limit_exceeded"`, `limit`, `current`, `plan` and `upgradeTo`, and a message such as `Connector limit reached: the Starter plan includes 1. Upgrade to Pro for 5.` (`Contact us about Enterprise for a higher limit.` on Business). The global exception filter passes these fields on for every plan limit error, so clients no longer only see `message`. Domains, API keys and certificate limits now carry `code: "plan_limit_exceeded"` too.
- **Organization members** are checked when an owner or admin invites someone who isn't a member yet (`POST /organizations/:id/members`); changing an existing member's role isn't. Invites add the member directly; there is no separate accept step. A Business organization that moves to Pro keeps its members, and can't add more until it is under 3.
- **Usage** is returned in `GET /auth/profile` `resourceCounts` (`connectors`, `alertChannels`, `githubOidcTrusts`, `orgMembers`), and the billing page shows a meter for each, with the plan that raises a limit once it is reached.

**Connector renewal window on the free plan.** Connector-managed certificates keep the 30-day minimum renewal window (`CONNECTOR_MIN_RENEWAL_WINDOW_DAYS`) on every plan, the free one included. The connector renews on the customer's own machine, which can be off or offline for days, so it needs the longer lead time to renew safely, and a renewal doesn't count against any certificate limit. What the free plan gets is bounded by its other limits instead: one connector and 10 active certificates.

### Plan ids before the rename

`starter` and `team` were renamed to `pro` and `business` by migration `RenamePlansToProAndBusiness1791600000000`. For the short overlap with the previous release during a deploy, and for Stripe checkouts opened before it, the API still reads the old ids: `normalizePlan()` maps them on every plan lookup, Stripe webhooks rewrite them, `POST /billing/checkout` and `/billing/upgrade` accept them, and `KK_MARKETPLACE_PLAN_MAP` accepts `starter` and `team` as names for `pro` and `business`. `KK_STRIPE_PRICE_STARTER` and `KK_STRIPE_PRICE_TEAM` are no longer read (see [Prices and annual billing](#prices-and-annual-billing)).

## Prices and annual billing

Pro and Business are sold monthly or yearly; a year costs ten months (two months free). Enterprise is sold by quote and has no Stripe price. The list prices shown in the dashboard are `PLAN_LIST_PRICES_CENTS` in `@krakenkey/shared`; Stripe holds the prices that are charged.

The API reads one Stripe price per plan and interval (`src/billing/stripe-prices.ts`):

| Variable | Price |
|----------|-------|
| `KK_STRIPE_PRICE_PRO_MONTHLY` | Pro, monthly |
| `KK_STRIPE_PRICE_PRO_YEARLY` | Pro, yearly |
| `KK_STRIPE_PRICE_BUSINESS_MONTHLY` | Business, monthly |
| `KK_STRIPE_PRICE_BUSINESS_YEARLY` | Business, yearly |
| `KK_STRIPE_PORTAL_CONFIGURATION_ID` | Optional. The billing portal configuration to open; Stripe's default configuration when unset |

There are no fallbacks to the old `KK_STRIPE_PRICE_STARTER` and `KK_STRIPE_PRICE_TEAM`: Team cost less than Business, and Starter's price isn't known to match Pro. A plan and interval without its own variable isn't sold: `GET /billing/plans` leaves it out, the dashboard doesn't offer it, and checkout answers `400`. A warning at startup lists the unset variables. Webhooks only recognize the configured prices; any other price leaves the row's plan as it is and logs a warning naming the price.

The billing portal configuration (Stripe dashboard, Settings, Billing, Customer portal) must let customers switch plans and list the four prices, for the monthly/yearly switch below.

## API Endpoints

### List Purchasable Plans

```
GET /billing/plans
```

The plans and intervals that have a Stripe price on this installation (no price ids):

```json
{
  "plans": [
    { "plan": "pro", "intervals": ["month", "year"] },
    { "plan": "business", "intervals": ["month", "year"] }
  ]
}
```

### Create Checkout Session

Start a new subscription by redirecting the user to Stripe Checkout.

```
POST /billing/checkout
```

**Request:**
```json
{
  "plan": "pro",
  "interval": "year"
}
```

`interval` is `month` (default) or `year`.

**Response:**
```json
{
  "sessionUrl": "https://checkout.stripe.com/c/pay_..."
}
```

Redirect the user to the returned URL. After payment, Stripe redirects back to KrakenKey and fires a `checkout.session.completed` webhook.

Valid plan values: `pro`, `business`, `enterprise` (only plans with a Stripe price can be bought; a missing yearly price answers `400` `Yearly billing for the Pro plan is not available yet`). The legacy `starter` and `team` are read as `pro` and `business`.

Checkout is only for starting a subscription. If the user, or the organization they bill for, already has a subscription that is `active`, `past_due`, `trialing` or `unpaid`, the request fails with `409 Conflict`; use `POST /billing/upgrade` or the billing portal instead. Repeating the same request (same plan and interval) within about a minute returns the same Stripe session.

### Get Current Subscription

```
GET /billing/subscription
```

**Response:**
```json
{
  "id": "uuid",
  "plan": "business",
  "status": "active",
  "interval": "year",
  "currentPeriodEnd": "2027-04-01T00:00:00.000Z",
  "cancelAtPeriodEnd": false,
  "organizationId": null,
  "pastDueSince": null,
  "graceEndsAt": null,
  "source": "stripe",
  "marketplaceStatus": null,
  "createdAt": "2026-03-01T00:00:00.000Z"
}
```

Accounts without a subscription get the same shape with `plan: "free"`. `interval` is `month` or `year` for a Stripe subscription (rows from before annual billing read as `month` until their next Stripe event records it) and `null` on the free plan and for Microsoft Marketplace subscriptions.

While a payment has failed, `status` is `past_due`, `pastDueSince` is the time of the first failure and `graceEndsAt` is when the paid limits stop applying unless the payment goes through. Both are `null` otherwise.

### Manage Subscription (Stripe Portal)

Opens the Stripe Customer Portal where users can update payment methods, view invoices, switch plans and cancel.

```
POST /billing/portal
```

**Request (optional):**
```json
{
  "flow": "switch_interval"
}
```

With `flow: "switch_interval"` the portal opens on confirming a move of the current plan to the other interval (monthly to yearly or back): Stripe shows the prorated amount, takes the payment and sends `customer.subscription.updated`, which records the new interval. `400` when the subscription isn't active, its price isn't one of the configured ones, or the other interval has no price.

**Response:**
```json
{
  "portalUrl": "https://billing.stripe.com/p/session/..."
}
```

### Preview Upgrade

See what an upgrade costs before confirming it.

```
POST /billing/upgrade/preview
```

**Request:**
```json
{
  "plan": "business",
  "interval": "year"
}
```

`interval` defaults to the subscription's current interval.

**Response:**
```json
{
  "immediateAmountCents": 120000,
  "currency": "usd",
  "targetPlan": "business",
  "targetInterval": "year",
  "currentPeriodEnd": "2027-04-01T00:00:00.000Z"
}
```

The amount is Stripe's preview (`invoices.createPreview`) of exactly the change the upgrade makes, so it is what will be charged. Keeping the interval, it is the new price for the rest of the period less the unused time on the current one, and the billing date stays. Changing the interval starts a new billing period today and `currentPeriodEnd` is one new interval from now. The response includes `prorationDate` (Unix time); send it with the upgrade so Stripe prorates from the same moment and charges the amount shown. An upgrade with a missing, future or more than an hour old `prorationDate` is prorated from now.

### Execute Upgrade

```
POST /billing/upgrade
```

**Request:**
```json
{
  "plan": "business",
  "interval": "year"
}
```

Every upgrade is one Stripe subscription update with `proration_behavior: always_invoice` and `payment_behavior: error_if_incomplete` (plus `billing_cycle_anchor: now` when the interval changes), under a new idempotency key per request. Stripe invoices the prorated amount at once, and nothing changes, in Stripe or here, unless that payment succeeds: any `402` from Stripe (a declined card, no payment method) answers `402` with "Your plan hasn't changed", and trying again is a new attempt. When the bank wants the customer to confirm the payment (3D Secure), the answer is a `402` that sends them to the billing portal to make the change there; the update isn't sent `off_session`, because the customer is present when they upgrade. Switching to `pending_if_incomplete` would need `pending_update` checked before the plan is saved.

The portal schedules downgrades and yearly-to-monthly switches for the end of the period (a subscription schedule). An upgrade releases that schedule first (`subscriptionSchedules.release`, which keeps the current phase), so the scheduled change can't undo the upgrade when the period ends; the preview says so (`cancelsScheduledChange`). If the payment then fails, the plan stays and the scheduled change is gone, and the `402` says so. The `switch_interval` portal flow answers `409` while a change is scheduled. The response includes the new `plan` and `interval`.

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

If the record already points at a different subscription that Stripe still reports as live (for example, two checkout tabs were completed), the webhook keeps the existing subscription, cancels the new one immediately, and logs an error with both IDs. The new subscription's first invoice is not refunded automatically; refund it from the Stripe dashboard. A repeated delivery of the same event changes nothing.

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
4. User reverts to the free (Starter) plan limits

### Failed Payment
1. `invoice.payment_failed` (or `customer.subscription.updated` with status `past_due`, whichever arrives first) fires
2. Backend marks the subscription `past_due` and records `pastDueSince`, the time of the first failure. Later failures don't move it.
3. The account owner (the organization owner for an org subscription) gets one "payment failed" email with a link to the billing page and the date the paid limits end. It is a billing notice and ignores email preferences.
4. Stripe retries the payment per its dunning settings. Meanwhile the plan's limits, renewal window, rate limits and scan retention keep applying for a 14-day grace period from `pastDueSince` (`PAST_DUE_GRACE_DAYS` in `src/billing/entitlement.ts`). The billing page shows a banner with that date and a button to the Stripe portal.
5. If a retry succeeds, `invoice.paid` or `customer.subscription.updated` restores `active` status and clears `pastDueSince`
6. The account drops to the free (Starter) limits when the grace period ends, when Stripe marks the subscription `unpaid`, or when it cancels it (`customer.subscription.deleted`)

Every tier lookup goes through `effectivePlan()` in `src/billing/entitlement.ts` (SQL queries use `entitledSubscriptionSql()`), so active subscriptions and past_due ones inside the grace period resolve to their plan and everything else resolves to `free`. Subscriptions that were already `past_due` before `pastDueSince` existed get no grace until the next Stripe event for them records the start.

## Microsoft Marketplace

Off unless `KK_MARKETPLACE_ENABLED=true`. A subscription row has a `source`: `stripe` (default) or `marketplace`. Setup, the landing page and the webhook are described in [Integrations](./INTEGRATIONS.md#microsoft-marketplace-billing).

- **One live subscription per account across both sources.** `POST /billing/checkout` answers `409` while a Marketplace subscription is live (`active` or `past_due`) or being activated, and the landing page refuses to activate a purchase for an account with a live Stripe subscription or another live Marketplace subscription. `POST /billing/portal`, `/billing/upgrade/preview` and `/billing/upgrade` answer `409` for a Marketplace subscription. If a Stripe checkout opened before the Marketplace purchase completes afterwards, the new Stripe subscription is canceled like any duplicate.
- **Entitlement.** Microsoft's `Subscribed` is `active`. `Suspended` is stored as `past_due` with `pastDueSince`, and the paid limits stay for 30 days (`MARKETPLACE_SUSPENDED_GRACE_DAYS`), matching Microsoft's grace before it cancels. `Unsubscribed` drops the account to Free at once. No payment-failed email is sent; Microsoft notifies the purchaser.
- **Billing page.** A live Marketplace subscription shows "Billed through Microsoft" and a link to the Azure portal instead of the Stripe portal and upgrade buttons.
- A later Stripe checkout on an account whose Marketplace subscription ended clears the Marketplace fields and sets `source` back to `stripe`.

`GET /billing/subscription` returns `source` and `marketplaceStatus` (Microsoft's status, `null` for Stripe).

## Organization Billing

Organizations have their own billing relationship:

- When a user creates an organization (requires the Pro plan or higher; Pro allows 3 members, owner included), their personal subscription is converted to an organization subscription
- The organization owner controls billing — non-owners cannot access billing endpoints
- If an organization is downgraded to a plan that can't back one, the organization is automatically dissolved:
  1. Non-owner member resources (domains, certificates) are transferred to the organization owner
  2. Member associations are cleared
  3. The subscription reverts to a personal subscription
  4. The organization is deleted

### Dissolution queue

Dissolution runs as an `orgDissolution` BullMQ job, keyed `dissolve-<organizationId>` so a given organization can only have one in flight. BullMQ silently ignores `add()` for a job ID that already exists, which means a *failed* earlier attempt would otherwise block every retry for that organization forever. A failed job under the same ID is therefore removed before re-queueing, and the removal is logged with the previous failure reason.

The job runs up to 3 attempts (the first try plus 2 retries) with exponential backoff from a 5-second base.

### Owner subscription conflicts

Step 3 above reassigns the organization's subscription row to the owner. A user may hold only one personal subscription (enforced by the `UQ_subscription_userId_partial` index), and the owner can already have one — for example a member who kept a personal subscription and was later promoted to owner. When both rows exist, the outcome depends on which subscriptions are still live in Stripe:

| Situation | Outcome |
|-----------|---------|
| Dissolution requested with `cancelSubscription` (queued by the `customer.subscription.deleted` webhook) | The org's Stripe subscription is already cancelled, so its row is deleted and the owner keeps their personal subscription |
| Owner's personal subscription is not billing (no Stripe subscription, or `canceled` / `incomplete_expired`) | The owner's inactive row is deleted and the org's paid subscription replaces it |
| Both are billing in Stripe | The job fails with an `UnrecoverableError` and is left for manual review |

The last case is deliberate: deleting either row would orphan a subscription that is still charging the customer. It raises `UnrecoverableError` rather than a plain error so BullMQ does not burn the remaining retries on a conflict that cannot resolve itself. The transaction rolls back and the organization stays in `dissolving` status until an operator resolves the duplicate.

The error message names the owner, both subscription IDs and the organization, but nothing logs it when the job fails: the dissolution processor has no failure handler. It is stored as the job's `failedReason` in BullMQ, and only reaches the application log if the dissolution is queued again (the removal of the failed job logs the reason). To catch these, alert on `bullmq_queue_jobs{queue="orgDissolution",state="failed"} > 0` (see [Observability](./OBSERVABILITY.md#queues)) and read the reason from the failed job.

## Subscription Statuses

| Status | Description |
|--------|-------------|
| `active` | Subscription is current and payment is up to date |
| `past_due` | Payment failed, Stripe is retrying. Paid limits apply for 14 days from the first failure |
| `unpaid` | Stripe gave up retrying. Free limits apply |
| `canceled` | Subscription has been canceled |
| `incomplete` | Initial payment has not completed |
| `trialing` | Subscription is in a trial period |

## Subscription Entity Schema

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `plan` | varchar | Plan id (`free`, `pro`, `business`, `enterprise`) |
| `status` | varchar | Subscription status |
| `billingInterval` | varchar | `month` or `year` for a Stripe subscription; null otherwise and for rows from before annual billing |
| `stripeCustomerId` | varchar | Stripe customer ID; null for an account that only bought through Microsoft |
| `stripeSubscriptionId` | varchar | Stripe subscription ID (unique, indexed) |
| `source` | varchar | `stripe` (default) or `marketplace` |
| `marketplaceSubscriptionId` | varchar | Microsoft SaaS subscription ID (unique when set) |
| `marketplaceOfferId` | varchar | Marketplace offer ID |
| `marketplacePlanId` | varchar | Marketplace plan ID; `plan` holds the KrakenKey plan it maps to |
| `marketplaceStatus` | varchar | Microsoft's status: `Subscribed`, `Suspended` or `Unsubscribed` |
| `marketplaceQuantity` | integer | Purchased quantity, if any |
| `currentPeriodStart` | timestamp | Current billing period start |
| `currentPeriodEnd` | timestamp | Current billing period end |
| `userId` | varchar | Owner user ID (nullable, indexed) |
| `organizationId` | UUID | Owner organization ID (nullable, indexed) |
| `createdAt` | timestamp | Record creation time |
| `updatedAt` | timestamp | Last update time |
