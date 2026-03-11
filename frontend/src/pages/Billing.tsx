import { useState, useEffect } from 'react';
import { CreditCard, ExternalLink } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { PlanBadge } from '../components/ui/PlanBadge';
import {
  fetchSubscription,
  createCheckout,
  createPortalSession,
} from '../services/billingService';
import type { Subscription } from '@krakenkey/shared';

export default function Billing() {
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

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

  async function handleUpgrade(targetPlan: string) {
    setActionLoading(true);
    try {
      const { sessionUrl } = await createCheckout(targetPlan);
      window.location.href = sessionUrl;
    } catch {
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

  const plan = subscription?.plan ?? 'free';
  const isPaid = plan !== 'free';
  const isPastDue = subscription?.status === 'past_due';
  const isCanceling = subscription?.cancelAtPeriodEnd === true;

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
            Current period ends{' '}
            {new Date(subscription.currentPeriodEnd).toLocaleDateString(
              undefined,
              { year: 'numeric', month: 'long', day: 'numeric' },
            )}
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
    </div>
  );
}
