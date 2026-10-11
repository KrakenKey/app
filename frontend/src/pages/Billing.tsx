import { useState, useEffect, type ReactNode } from 'react';
import { Check, CreditCard, ExternalLink } from 'lucide-react';
import type {
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
  createCheckout,
  createPortalSession,
  previewUpgrade,
  upgradeSubscription,
} from '../services/billingService';
import {
  formatLimit,
  planLimits,
  usageLevel,
  usagePercent,
  usageRows,
  type UsageLevel,
  type UsageRow,
} from '../utils/planUsage';

const PRICING_URL = 'https://krakenkey.io/pricing';

const PLAN_LABELS: Record<string, string> = {
  free: 'Free',
  starter: 'Starter',
  team: 'Team',
  business: 'Business',
  enterprise: 'Enterprise',
};

const PLAN_PRICES: Record<string, string> = {
  starter: '$29/mo',
  team: '$79/mo',
  business: '$199/mo',
  enterprise: 'Custom',
};

/** Extras each plan adds beyond the numeric limits. */
const PLAN_EXTRAS: Partial<Record<SubscriptionPlan, string[]>> = {
  starter: ['30-day renewal window', 'Double API rate limits'],
  team: ['Organizations with RBAC', 'Higher rate limits (300 reads/min)'],
  business: ['1-minute scan intervals', 'Higher rate limits (600 reads/min)'],
};

/**
 * Plans the API can switch to from here. Business has no self-serve price
 * yet, so Team accounts get a link to the pricing page instead.
 */
const UPGRADE_TARGETS: Record<string, SubscriptionPlan[]> = {
  free: ['starter', 'team'],
  starter: ['team'],
};

const NEXT_PLAN: Record<string, SubscriptionPlan> = {
  team: 'business',
};

function planFeatures(plan: SubscriptionPlan): string[] {
  const l = planLimits(plan);
  const lines = [
    `${formatLimit(l.domains)} domains, ${formatLimit(l.totalActiveCerts)} active certificates`,
    `${formatLimit(l.monitoredEndpoints)} monitored endpoints, ${formatLimit(l.hostedProbeRegions)} hosted regions`,
  ];
  return [...lines, ...(PLAN_EXTRAS[plan] ?? [])];
}

const BAR_CLASS: Record<UsageLevel, string> = {
  normal: 'bg-zinc-400',
  high: 'bg-amber-400',
  full: 'bg-red-400',
};

function UsageMeter({ row }: { row: UsageRow }) {
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
  action,
}: {
  plan: SubscriptionPlan;
  action: ReactNode;
}) {
  return (
    <Card className="flex flex-col">
      <div className="flex items-baseline justify-between gap-3 mb-4">
        <h3 className="text-base font-semibold text-text">
          {PLAN_LABELS[plan]}
        </h3>
        <span className="text-sm text-text-muted tabular-nums">
          {PLAN_PRICES[plan]}
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
  const { data: health } = useHealth();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [upgradeModal, setUpgradeModal] = useState<{
    plan: string;
    preview: UpgradePreviewResponse;
  } | null>(null);
  const [upgradeError, setUpgradeError] = useState<string | null>(null);

  useEffect(() => {
    loadSubscription();
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

  const plan = subscription?.plan ?? 'free';
  const isPaid = plan !== 'free';
  const isPastDue = subscription?.status === 'past_due';
  const isCanceling = subscription?.cancelAtPeriodEnd === true;
  // The API only lets the owner manage an org's subscription, so other
  // members get a read-only view instead of buttons that would return 403.
  const canManageBilling = !user?.organizationId || user.role === 'owner';

  const counts = (
    user as { resourceCounts?: { domains: number; apiKeys: number } } | null
  )?.resourceCounts;
  const rows = usageRows({
    plan,
    domains: health?.domains.length ?? counts?.domains ?? null,
    apiKeys: counts?.apiKeys ?? null,
    certs: health?.certs ?? null,
    endpoints: health?.endpoints ?? null,
  });

  const upgradeTargets = canManageBilling ? (UPGRADE_TARGETS[plan] ?? []) : [];
  const nextPlan = canManageBilling ? NEXT_PLAN[plan] : undefined;

  async function handleUpgrade(targetPlan: string) {
    setActionLoading(true);
    setUpgradeError(null);
    try {
      if (isPaid) {
        const preview = await previewUpgrade(targetPlan);
        setUpgradeModal({ plan: targetPlan, preview });
      } else {
        const { sessionUrl } = await createCheckout(targetPlan);
        window.location.href = sessionUrl;
        return;
      }
    } catch {
      setUpgradeError('Failed to load upgrade details. Please try again.');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleConfirmUpgrade() {
    if (!upgradeModal) return;
    setActionLoading(true);
    setUpgradeError(null);
    try {
      await upgradeSubscription(upgradeModal.plan);
      setUpgradeModal(null);
      await loadSubscription();
    } catch {
      setUpgradeError('Upgrade failed. Please try again.');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleManageSubscription() {
    setActionLoading(true);
    try {
      const { portalUrl } = await createPortalSession();
      window.location.href = portalUrl;
    } catch {
      setActionLoading(false);
    }
  }

  function formatAmount(cents: number): string {
    return `$${(cents / 100).toFixed(2)}`;
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

  return (
    <div className="space-y-6">
      {header}

      {/* Current plan */}
      <Card>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-xs font-medium text-text-muted mb-1.5">
              Current plan
            </h2>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-lg font-semibold text-text">
                {PLAN_LABELS[plan] ?? plan}
              </span>
              {isPaid && PLAN_PRICES[plan] && (
                <span className="text-sm text-text-muted tabular-nums">
                  {PLAN_PRICES[plan]}
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
            {isPaid && subscription?.currentPeriodEnd && (
              <p className="text-sm text-text-muted mt-2">
                Current period ends {formatDate(subscription.currentPeriodEnd)}
              </p>
            )}
            {!canManageBilling && (
              <p className="text-sm text-text-muted mt-2">
                Billing for your organization is managed by its owner.
              </p>
            )}
          </div>
          {isPaid && canManageBilling && (
            <Button
              variant="secondary"
              icon={<ExternalLink className="w-4 h-4" />}
              onClick={handleManageSubscription}
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
            <UsageMeter key={row.key} row={row} />
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
                action={
                  <Button
                    variant="primary"
                    onClick={() => handleUpgrade(target)}
                    disabled={actionLoading}
                    className="w-full"
                  >
                    Upgrade to {PLAN_LABELS[target]}
                  </Button>
                }
              />
            ))}
            {nextPlan && (
              <PlanCard
                plan={nextPlan}
                action={
                  <a
                    href={PRICING_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-border-strong bg-surface-elevated px-3.5 text-sm font-medium text-text transition-colors hover:border-[#4a5b78] hover:bg-[#2e3c55]"
                  >
                    Compare plans
                    <ExternalLink className="w-4 h-4" />
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
        title={`Upgrade to ${upgradeModal ? PLAN_LABELS[upgradeModal.plan] : ''}`}
      >
        {upgradeModal && (
          <div className="space-y-4">
            <p className="text-sm text-zinc-300">
              You&apos;ll be charged{' '}
              <span className="font-semibold text-zinc-100">
                {formatAmount(upgradeModal.preview.immediateAmountCents)}
              </span>{' '}
              immediately for the remaining days in your current billing period
              (through {formatDate(upgradeModal.preview.currentPeriodEnd)}).
            </p>
            <p className="text-sm text-zinc-300">
              Your subscription will then renew at the{' '}
              <span className="font-semibold text-zinc-100">
                {PLAN_LABELS[upgradeModal.plan]}
              </span>{' '}
              rate of{' '}
              <span className="font-semibold text-zinc-100">
                {PLAN_PRICES[upgradeModal.plan]}
              </span>{' '}
              on your next billing date.
            </p>
            {isCanceling && (
              <p className="text-sm text-amber-400">
                Upgrading will also resume your subscription (scheduled
                cancellation will be cleared).
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
