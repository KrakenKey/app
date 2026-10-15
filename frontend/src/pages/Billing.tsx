import { useState, useEffect, type ReactNode } from 'react';
import { AlertTriangle, Check, CreditCard, ExternalLink } from 'lucide-react';
import axios from 'axios';
import {
  PLAN_LIST_PRICES_CENTS,
  normalizePlan,
  planLabel as labelFor,
} from '@krakenkey/shared';
import type {
  BillingInterval,
  PurchasablePlan,
  Subscription,
  SubscriptionPlan,
  UpgradePreviewResponse,
} from '@krakenkey/shared';
import { PageHeader } from '../components/ui/PageHeader';
import { Card, CardHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { useAuth } from '../hooks/useAuth';
import { useHealth } from '../hooks/useHealth';
import {
  fetchSubscription,
  fetchPlans,
  createCheckout,
  createPortalSession,
  previewUpgrade,
  upgradeSubscription,
} from '../services/billingService';
import { AZURE_PORTAL_SAAS_URL } from '../services/marketplaceService';
import {
  formatLimit,
  planLimits,
  upgradeHint,
  usageLevel,
  usagePercent,
  usageRows,
  type CountedLimitKey,
  type UsageLevel,
  type UsageRow,
} from '../utils/planUsage';

const PRICING_URL = 'https://krakenkey.io/pricing';

/** Enterprise is sold by quote. */
const CONTACT_URL =
  'mailto:support@krakenkey.io?subject=KrakenKey%20Enterprise';

/** "$29/mo" or "$1,490/yr": the list price of a self-serve plan. */
function planPrice(
  plan: string,
  interval: BillingInterval = 'month',
): string | undefined {
  const cents = PLAN_LIST_PRICES_CENTS[normalizePlan(plan)]?.[interval];
  if (cents === undefined) return undefined;
  const dollars = (cents / 100).toLocaleString('en-US', {
    maximumFractionDigits: 0,
  });
  return `$${dollars}${interval === 'year' ? '/yr' : '/mo'}`;
}

/** Extras each plan adds beyond the numeric limits. */
const PLAN_EXTRAS: Partial<Record<SubscriptionPlan, string[]>> = {
  pro: [
    '30-day renewal window, 30-minute hosted scans',
    'Organizations with up to 3 members',
  ],
  business: [
    'Organizations with unlimited members',
    '5-minute hosted scans, 90-day scan history',
  ],
  enterprise: ['Custom limits', 'Annual invoice or Microsoft Marketplace'],
};

/** Plans the API can switch to from here. */
const UPGRADE_TARGETS: Partial<Record<SubscriptionPlan, SubscriptionPlan[]>> = {
  free: ['pro', 'business'],
  pro: ['business'],
};

/** The plan after the largest self-serve one, sold by quote. */
const NEXT_PLAN: Partial<Record<SubscriptionPlan, SubscriptionPlan>> = {
  business: 'enterprise',
};

function planFeatures(plan: SubscriptionPlan): string[] {
  const l = planLimits(plan);
  const regions = Number.isFinite(l.hostedProbeRegions)
    ? `${formatLimit(l.hostedProbeRegions)} hosted region${l.hostedProbeRegions === 1 ? '' : 's'}`
    : 'every hosted region';
  const lines = [
    `${formatLimit(l.domains)} domains, ${formatLimit(l.totalActiveCerts)} active certificates`,
    `${formatLimit(l.monitoredEndpoints)} monitored endpoints, ${regions}`,
    `${formatLimit(l.connectors)} connectors, ${formatLimit(l.alertChannels)} alert channels`,
  ];
  return [...lines, ...(PLAN_EXTRAS[plan] ?? [])];
}

const BAR_CLASS: Record<UsageLevel, string> = {
  normal: 'bg-zinc-400',
  high: 'bg-amber-400',
  full: 'bg-red-400',
};

function UsageMeter({ row, plan }: { row: UsageRow; plan: string }) {
  const unlimited = !Number.isFinite(row.limit);
  const used = row.used;
  const level = used == null ? 'normal' : usageLevel(used, row.limit);
  const pct = used == null ? 0 : usagePercent(used, row.limit);
  const limitText = unlimited ? 'Unlimited' : formatLimit(row.limit);
  return (
    <div className="px-5 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-text-secondary">{row.label}</span>
        <span className="text-sm tabular-nums whitespace-nowrap">
          <span
            className={`font-semibold ${level === 'full' ? 'text-red-300' : level === 'high' ? 'text-amber-300' : 'text-text'}`}
          >
            {used == null ? '-' : used.toLocaleString('en-US')}
          </span>
          <span className="text-text-muted">
            {unlimited ? ` · ${limitText}` : ` of ${limitText}`}
          </span>
        </span>
      </div>
      <div
        role="meter"
        aria-label={row.label}
        aria-valuemin={0}
        aria-valuemax={unlimited ? undefined : row.limit}
        aria-valuenow={used ?? undefined}
        aria-valuetext={
          used == null
            ? 'Loading'
            : unlimited
              ? `${used} used, unlimited`
              : `${used} of ${row.limit} used`
        }
        data-level={level}
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]"
      >
        {!unlimited && (
          <div
            className={`h-full rounded-full transition-[width] duration-300 ${BAR_CLASS[level]}`}
            style={{ width: `${pct}%` }}
          />
        )}
      </div>
      <p className="mt-1.5 text-xs text-text-muted empty:hidden sm:min-h-4 sm:empty:block">
        {level === 'full' && used != null ? (
          <span className="text-red-300">
            {used > row.limit ? 'Over the plan limit' : 'Limit reached'}
            {upgradeHint(plan, row.key as CountedLimitKey) &&
              `. ${upgradeHint(plan, row.key as CountedLimitKey)}`}
          </span>
        ) : (
          row.hint
        )}
      </p>
    </div>
  );
}

function PlanCard({
  plan,
  interval = 'month',
  action,
}: {
  plan: SubscriptionPlan;
  interval?: BillingInterval;
  action: ReactNode;
}) {
  return (
    <Card className="flex flex-col">
      <div className="flex items-baseline justify-between gap-3 mb-4">
        <h3 className="text-base font-semibold text-text">{labelFor(plan)}</h3>
        <span className="text-sm text-text-muted tabular-nums">
          {planPrice(plan, interval) ?? 'Contact us'}
        </span>
      </div>
      <ul className="space-y-2 text-sm text-text-secondary mb-6 flex-1">
        {planFeatures(plan).map((f) => (
          <li key={f} className="flex items-start gap-2">
            <Check className="w-4 h-4 mt-0.5 shrink-0 text-cyan-400" />
            {f}
          </li>
        ))}
      </ul>
      {action}
    </Card>
  );
}

export default function Billing() {
  const { user } = useAuth();
  const { data: health, status: healthStatus } = useHealth();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [upgradeModal, setUpgradeModal] = useState<{
    plan: string;
    interval: BillingInterval;
    preview: UpgradePreviewResponse;
  } | null>(null);
  const [upgradeError, setUpgradeError] = useState<string | null>(null);
  // Plans with a Stripe price here, to offer yearly billing only once it is set up
  const [purchasable, setPurchasable] = useState<PurchasablePlan[]>([]);
  const [chosenInterval, setChosenInterval] = useState<BillingInterval | null>(
    null,
  );

  useEffect(() => {
    loadSubscription();
    fetchPlans()
      .then((res) => setPurchasable(res.plans))
      .catch(() => setPurchasable([]));
  }, []);

  async function loadSubscription() {
    try {
      const sub = await fetchSubscription();
      setSubscription(sub);
    } catch {
      // Defaults to free plan display
    } finally {
      setLoading(false);
    }
  }

  const plan = normalizePlan(subscription?.plan);
  const isPaid = plan !== 'free';
  const isPastDue = subscription?.status === 'past_due';
  // Stripe retries a failed payment for a while; the paid limits keep
  // applying until graceEndsAt. After that (or once Stripe marks the
  // subscription unpaid) the account is on the free (Starter) limits.
  const paymentFailed =
    isPaid && (isPastDue || subscription?.status === 'unpaid');
  const graceEndsAt =
    isPastDue && subscription?.graceEndsAt
      ? new Date(subscription.graceEndsAt)
      : null;
  const inGrace = graceEndsAt !== null && graceEndsAt.getTime() > Date.now();
  const isCanceling = subscription?.cancelAtPeriodEnd === true;
  // A downgrade or interval switch made in the Stripe portal that waits for
  // the end of the period. A pending cancellation is shown on its own.
  const scheduledChange =
    subscription?.source !== 'marketplace' && !isCanceling
      ? (subscription?.scheduledChange ?? null)
      : null;
  // Microsoft bills Marketplace subscriptions: plan changes, payment and
  // cancellation happen in the Azure portal, not in Stripe.
  const billedByMicrosoft =
    subscription?.source === 'marketplace' &&
    (subscription.status === 'active' || subscription.status === 'past_due');
  // The API only lets the owner manage an org's subscription, so other
  // members get a read-only view instead of buttons that would return 403.
  const canManageBilling = !user?.organizationId || user.role === 'owner';

  const counts = (
    user as {
      resourceCounts?: Partial<Record<CountedLimitKey, number>> & {
        domains: number;
        apiKeys: number;
      };
    } | null
  )?.resourceCounts;
  const rows = usageRows({
    plan,
    // Only sources that loaded: a failed request is not an empty account.
    domains:
      health && healthStatus.domains === 'loaded'
        ? health.domains.length
        : (counts?.domains ?? null),
    apiKeys: counts?.apiKeys ?? null,
    certs: health && healthStatus.certs === 'loaded' ? health.certs : null,
    endpoints:
      health && healthStatus.endpoints === 'loaded' ? health.endpoints : null,
    connectors: counts?.connectors ?? null,
    alertChannels: counts?.alertChannels ?? null,
    githubOidcTrusts: counts?.githubOidcTrusts ?? null,
    orgMembers: user?.organizationId ? (counts?.orgMembers ?? null) : undefined,
  });

  const canChangePlanHere = canManageBilling && !billedByMicrosoft;
  // Only plans with a Stripe price here: a plan without one can't be bought
  const upgradeTargets = canChangePlanHere
    ? (UPGRADE_TARGETS[plan] ?? []).filter((p) =>
        purchasable.some((x) => x.plan === p),
      )
    : [];
  const currentInterval: BillingInterval = subscription?.interval ?? 'month';
  const sellsYearly = (p: string) =>
    purchasable.some((x) => x.plan === p && x.intervals.includes('year'));
  const offerYearly = upgradeTargets.some(sellsYearly);
  // The toggle starts on the account's own interval
  const interval: BillingInterval = offerYearly
    ? (chosenInterval ?? currentInterval)
    : 'month';
  const otherInterval: BillingInterval =
    currentInterval === 'month' ? 'year' : 'month';
  // Not while a change is scheduled: the portal handles that subscription
  const canSwitchInterval =
    isPaid &&
    !scheduledChange &&
    canManageBilling &&
    !billedByMicrosoft &&
    subscription?.status === 'active' &&
    !!subscription?.interval &&
    purchasable.some(
      (x) => x.plan === plan && x.intervals.includes(otherInterval),
    );
  const nextPlan = canChangePlanHere ? NEXT_PLAN[plan] : undefined;

  async function handleUpgrade(targetPlan: string) {
    setActionLoading(true);
    setUpgradeError(null);
    try {
      if (isPaid) {
        const preview = await previewUpgrade(targetPlan, interval);
        setUpgradeModal({ plan: targetPlan, interval, preview });
      } else {
        const { sessionUrl } = await createCheckout(targetPlan, interval);
        window.location.href = sessionUrl;
        return;
      }
    } catch (err) {
      // 409 means a paid subscription already exists; the API says what to do.
      const msg =
        axios.isAxiosError(err) && err.response?.status === 409
          ? err.response.data?.message
          : null;
      setUpgradeError(
        typeof msg === 'string'
          ? msg
          : 'Failed to load upgrade details. Please try again.',
      );
    } finally {
      setActionLoading(false);
    }
  }

  async function handleConfirmUpgrade() {
    if (!upgradeModal) return;
    setActionLoading(true);
    setUpgradeError(null);
    try {
      await upgradeSubscription(
        upgradeModal.plan,
        upgradeModal.interval,
        upgradeModal.preview.prorationDate,
      );
      setUpgradeModal(null);
      await loadSubscription();
    } catch (err) {
      // 402: the payment didn't go through; the API says what to do
      const msg =
        axios.isAxiosError(err) && err.response?.status === 402
          ? err.response.data?.message
          : null;
      setUpgradeError(
        typeof msg === 'string' ? msg : 'Upgrade failed. Please try again.',
      );
    } finally {
      setActionLoading(false);
    }
  }

  async function handleManageSubscription(flow?: 'switch_interval') {
    setActionLoading(true);
    try {
      const { portalUrl } = await createPortalSession(flow);
      window.location.href = portalUrl;
    } catch {
      setActionLoading(false);
    }
  }

  function formatAmount(cents: number): string {
    return `$${(cents / 100).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }

  function formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }

  const header = (
    <PageHeader
      title="Billing"
      description="Your plan, what you are using, and upgrade options"
      icon={<CreditCard className="w-7 h-7" />}
    />
  );

  if (loading) {
    return (
      <div>
        {header}
        <div className="text-zinc-500 text-sm">Loading...</div>
      </div>
    );
  }

  const planLabel = labelFor(plan);
  const freeLabel = labelFor('free');

  return (
    <div className="space-y-6">
      {header}

      {paymentFailed && (
        <div
          role="alert"
          className="flex flex-col gap-4 rounded-xl border border-red-500/30 bg-red-500/10 p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
            <div className="space-y-1 text-sm">
              <p className="font-medium text-red-200">
                {billedByMicrosoft
                  ? inGrace && graceEndsAt
                    ? `Microsoft couldn't collect the payment for your subscription. Update the payment method in the Azure portal by ${formatDate(graceEndsAt.toISOString())} to keep ${planLabel} limits.`
                    : `Microsoft couldn't collect the payment for your subscription. Your account is on ${freeLabel} limits until the payment goes through in the Azure portal.`
                  : inGrace && graceEndsAt
                    ? `Your last payment failed. Update your payment method by ${formatDate(graceEndsAt.toISOString())} to keep ${planLabel} limits.`
                    : `Your last payment failed. Your account is on ${freeLabel} limits until you update your payment method and the ${planLabel} payment goes through.`}
              </p>
              {!canManageBilling && (
                <p className="text-red-200/80">
                  Ask your organization owner to update the payment method.
                </p>
              )}
            </div>
          </div>
          {canManageBilling && billedByMicrosoft && (
            <a
              href={AZURE_PORTAL_SAAS_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 shrink-0 items-center justify-center gap-2 self-start rounded-lg bg-accent px-3.5 text-sm font-semibold text-bg hover:bg-accent-hover sm:self-auto"
            >
              Open the Azure portal
              <ExternalLink className="w-4 h-4" />
            </a>
          )}
          {canManageBilling && !billedByMicrosoft && (
            <Button
              variant="primary"
              icon={<ExternalLink className="w-4 h-4" />}
              onClick={() => handleManageSubscription()}
              disabled={actionLoading}
              className="shrink-0 self-start sm:self-auto"
            >
              Update payment method
            </Button>
          )}
        </div>
      )}

      {/* Current plan */}
      <Card>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-xs font-medium text-text-muted mb-1.5">
              Current plan
            </h2>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-lg font-semibold text-text">
                {planLabel}
              </span>
              {isPaid &&
                !billedByMicrosoft &&
                planPrice(plan, currentInterval) && (
                  <span className="text-sm text-text-muted tabular-nums">
                    {planPrice(plan, currentInterval)}
                  </span>
                )}
              {isPastDue && (
                <span className="text-xs text-red-400 font-medium">
                  Payment past due
                </span>
              )}
              {isCanceling && (
                <span className="text-xs text-amber-400 font-medium">
                  Cancels at period end
                </span>
              )}
            </div>
            {billedByMicrosoft && (
              <p className="text-sm text-text-secondary mt-2">
                Billed through Microsoft. Change your plan, payment method or
                cancel in the Azure portal.
              </p>
            )}
            {isPaid && subscription?.currentPeriodEnd && (
              <p className="text-sm text-text-muted mt-2">
                {subscription.interval === 'year'
                  ? 'Billed yearly. '
                  : subscription.interval === 'month'
                    ? 'Billed monthly. '
                    : ''}
                Current period ends {formatDate(subscription.currentPeriodEnd)}
              </p>
            )}
            {isPaid && scheduledChange && (
              <p className="mt-2 text-sm text-amber-300">
                Changes to {labelFor(scheduledChange.plan)},{' '}
                {scheduledChange.interval === 'year' ? 'yearly' : 'monthly'} on{' '}
                {formatDate(scheduledChange.effectiveAt)}
              </p>
            )}
            {canSwitchInterval && (
              <button
                type="button"
                onClick={() => handleManageSubscription('switch_interval')}
                disabled={actionLoading}
                className="mt-2 cursor-pointer border-none bg-transparent p-0 text-sm text-cyan-300 hover:text-cyan-200"
              >
                {otherInterval === 'year'
                  ? 'Switch to yearly billing (2 months free)'
                  : 'Switch to monthly billing'}
              </button>
            )}
            {!canManageBilling && (
              <p className="text-sm text-text-muted mt-2">
                Billing for your organization is managed by its owner.
              </p>
            )}
          </div>
          {billedByMicrosoft && canManageBilling && (
            <a
              href={AZURE_PORTAL_SAAS_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center justify-center gap-2 self-start rounded-lg border border-border-strong bg-surface-elevated px-3.5 text-sm font-medium text-text transition-colors hover:border-[#4a5b78] hover:bg-[#2e3c55] sm:self-auto"
            >
              <ExternalLink className="w-4 h-4" />
              Manage in Azure portal
            </a>
          )}
          {isPaid && canManageBilling && !billedByMicrosoft && (
            <Button
              variant="secondary"
              icon={<ExternalLink className="w-4 h-4" />}
              onClick={() => handleManageSubscription()}
              disabled={actionLoading}
              className="self-start sm:self-auto"
            >
              Manage Subscription
            </Button>
          )}
        </div>
      </Card>

      {/* Usage against the plan's limits */}
      <Card flush>
        <CardHeader
          title="Usage"
          description={
            user?.organizationId
              ? 'Counted across everyone in your organization.'
              : 'What your account uses against the plan limits.'
          }
        />
        <div className="grid grid-cols-1 py-1 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((row) => (
            <UsageMeter key={row.key} row={row} plan={plan} />
          ))}
        </div>
      </Card>

      {/* Upgrade paths */}
      {(upgradeTargets.length > 0 || nextPlan) && (
        <section>
          <div className="flex items-center justify-between gap-3 mb-3">
            <h2 className="text-sm font-semibold text-text">
              {upgradeTargets.length > 0 ? 'Upgrade' : 'Need more room?'}
            </h2>
            {offerYearly && (
              <div
                role="radiogroup"
                aria-label="Billing interval"
                className="inline-flex rounded-lg border border-border-strong p-0.5 text-sm"
              >
                {(['month', 'year'] as const).map((i) => (
                  <button
                    key={i}
                    type="button"
                    role="radio"
                    aria-checked={interval === i}
                    onClick={() => setChosenInterval(i)}
                    className={`cursor-pointer rounded-md border-none px-3 py-1 ${interval === i ? 'bg-surface-elevated text-text' : 'bg-transparent text-text-muted hover:text-text'}`}
                  >
                    {i === 'month' ? 'Monthly' : 'Yearly, 2 months free'}
                  </button>
                ))}
              </div>
            )}
            {upgradeTargets.length > 0 && (
              <a
                href={PRICING_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-cyan-300 hover:text-cyan-200 transition-colors"
              >
                Compare plans
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {upgradeTargets.map((target) => (
              <PlanCard
                key={target}
                plan={target}
                interval={interval}
                action={
                  <Button
                    variant="primary"
                    onClick={() => handleUpgrade(target)}
                    disabled={actionLoading}
                    className="w-full"
                  >
                    Upgrade to {labelFor(target)}
                  </Button>
                }
              />
            ))}
            {nextPlan && (
              <PlanCard
                plan={nextPlan}
                action={
                  <a
                    href={CONTACT_URL}
                    className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-border-strong bg-surface-elevated px-3.5 text-sm font-medium text-text transition-colors hover:border-[#4a5b78] hover:bg-[#2e3c55]"
                  >
                    Contact us
                  </a>
                }
              />
            )}
          </div>
          {upgradeError && !upgradeModal && (
            <p className="mt-3 text-sm text-red-400">{upgradeError}</p>
          )}
        </section>
      )}

      {/* Upgrade Confirmation Modal */}
      <Modal
        open={upgradeModal !== null}
        onClose={() => {
          setUpgradeModal(null);
          setUpgradeError(null);
        }}
        title={`Upgrade to ${upgradeModal ? labelFor(upgradeModal.plan) : ''}`}
      >
        {upgradeModal && (
          <div className="space-y-4">
            <p className="text-sm text-zinc-300">
              You&apos;ll be charged{' '}
              <span className="font-semibold text-zinc-100">
                {formatAmount(upgradeModal.preview.immediateAmountCents)}
              </span>{' '}
              {upgradeModal.interval === currentInterval ? (
                <>
                  immediately for the remaining days in your current billing
                  period (through{' '}
                  {formatDate(upgradeModal.preview.currentPeriodEnd)}).
                </>
              ) : (
                <>
                  immediately: a new{' '}
                  {upgradeModal.interval === 'year' ? 'yearly' : 'monthly'}{' '}
                  billing period starts today (through{' '}
                  {formatDate(upgradeModal.preview.currentPeriodEnd)}), less a
                  credit for the unused time on your current plan.
                </>
              )}
            </p>
            <p className="text-sm text-zinc-300">
              Your subscription will then renew at the{' '}
              <span className="font-semibold text-zinc-100">
                {labelFor(upgradeModal.plan)}
              </span>{' '}
              rate of{' '}
              <span className="font-semibold text-zinc-100">
                {planPrice(upgradeModal.plan, upgradeModal.interval)}
              </span>{' '}
              on your next billing date.
            </p>
            {isCanceling && (
              <p className="text-sm text-amber-400">
                Upgrading will also resume your subscription (scheduled
                cancellation will be cleared).
              </p>
            )}
            {upgradeModal.preview.cancelsScheduledChange && (
              <p className="text-sm text-amber-400">
                Upgrading also cancels the change scheduled for the end of your
                billing period.
              </p>
            )}
            {upgradeError && (
              <p className="text-sm text-red-400">{upgradeError}</p>
            )}
            <div className="flex gap-3 justify-end pt-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setUpgradeModal(null);
                  setUpgradeError(null);
                }}
                disabled={actionLoading}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleConfirmUpgrade}
                disabled={actionLoading}
              >
                {actionLoading ? 'Upgrading...' : 'Confirm Upgrade'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
