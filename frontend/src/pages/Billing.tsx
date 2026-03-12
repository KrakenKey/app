import { useState, useEffect } from 'react';
import { CreditCard, ExternalLink } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { PlanBadge } from '../components/ui/PlanBadge';
import {
  fetchSubscription,
  createCheckout,
  createPortalSession,
  previewUpgrade,
  upgradeSubscription,
} from '../services/billingService';
import type { Subscription, UpgradePreviewResponse } from '@krakenkey/shared';

export default function Billing() {
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

  const PLAN_LABELS: Record<string, string> = {
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

  if (loading) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <PageHeader
          title="Billing"
          description="Manage your subscription and billing"
          icon={<CreditCard className="w-7 h-7" />}
        />
        <div className="text-zinc-500 text-sm">Loading...</div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <PageHeader
        title="Billing"
        description="Manage your subscription and billing"
        icon={<CreditCard className="w-7 h-7" />}
      />

      {/* Current Plan */}
      <Card className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-zinc-100 mb-1">
              Current Plan
            </h2>
            <div className="flex items-center gap-3">
              <PlanBadge plan={plan} />
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
          </div>
          <div>
            {isPaid && (
              <Button
                variant="secondary"
                icon={<ExternalLink className="w-4 h-4" />}
                onClick={handleManageSubscription}
                disabled={actionLoading}
              >
                Manage Subscription
              </Button>
            )}
          </div>
        </div>

        {isPaid && subscription?.currentPeriodEnd && (
          <p className="text-sm text-zinc-500 mt-4">
            Current period ends {formatDate(subscription.currentPeriodEnd)}
          </p>
        )}
      </Card>

      {/* Plan Comparison */}
      {!isPaid && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <h2 className="text-lg font-semibold text-zinc-100 mb-4">
              Starter — $29/mo
            </h2>
            <ul className="space-y-2 text-sm text-zinc-400 mb-6">
              <li className="flex items-center gap-2">
                <span className="text-cyan-400">&#10003;</span>
                10 domains, 75 active certificates
              </li>
              <li className="flex items-center gap-2">
                <span className="text-cyan-400">&#10003;</span>
                30-day renewal window
              </li>
              <li className="flex items-center gap-2">
                <span className="text-cyan-400">&#10003;</span>
                Double API rate limits
              </li>
            </ul>
            <Button
              variant="primary"
              onClick={() => handleUpgrade('starter')}
              disabled={actionLoading}
              className="w-full"
            >
              Upgrade to Starter
            </Button>
          </Card>

          <Card>
            <h2 className="text-lg font-semibold text-zinc-100 mb-4">
              Team — $79/mo
            </h2>
            <ul className="space-y-2 text-sm text-zinc-400 mb-6">
              <li className="flex items-center gap-2">
                <span className="text-cyan-400">&#10003;</span>
                25 domains, 375 active certificates
              </li>
              <li className="flex items-center gap-2">
                <span className="text-cyan-400">&#10003;</span>
                Organizations with RBAC
              </li>
              <li className="flex items-center gap-2">
                <span className="text-cyan-400">&#10003;</span>
                Higher rate limits (300 reads/min)
              </li>
            </ul>
            <Button
              variant="primary"
              onClick={() => handleUpgrade('team')}
              disabled={actionLoading}
              className="w-full"
            >
              Upgrade to Team
            </Button>
          </Card>
        </div>
      )}

      {/* Upgrade from Starter to Team */}
      {plan === 'starter' && (
        <Card>
          <h2 className="text-lg font-semibold text-zinc-100 mb-4">
            Team — $79/mo
          </h2>
          <ul className="space-y-2 text-sm text-zinc-400 mb-6">
            <li className="flex items-center gap-2">
              <span className="text-cyan-400">&#10003;</span>
              25 domains, 375 active certificates
            </li>
            <li className="flex items-center gap-2">
              <span className="text-cyan-400">&#10003;</span>
              Organizations with RBAC
            </li>
            <li className="flex items-center gap-2">
              <span className="text-cyan-400">&#10003;</span>
              Higher rate limits (300 reads/min)
            </li>
          </ul>
          <Button
            variant="primary"
            onClick={() => handleUpgrade('team')}
            disabled={actionLoading}
          >
            Upgrade to Team
          </Button>
        </Card>
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
