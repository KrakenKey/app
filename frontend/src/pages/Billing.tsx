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

  async function handleUpgrade() {
    setActionLoading(true);
    try {
      const { sessionUrl } = await createCheckout('starter');
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
            {isPaid ? (
              <Button
                variant="secondary"
                icon={<ExternalLink className="w-4 h-4" />}
                onClick={handleManageSubscription}
                disabled={actionLoading}
              >
                Manage Subscription
              </Button>
            ) : (
              <Button
                variant="primary"
                onClick={handleUpgrade}
                disabled={actionLoading}
              >
                Upgrade to Starter
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
        <Card>
          <h2 className="text-lg font-semibold text-zinc-100 mb-4">
            Starter Plan — $29/mo
          </h2>
          <ul className="space-y-2 text-sm text-zinc-400">
            <li className="flex items-center gap-2">
              <span className="text-cyan-400">&#10003;</span>
              Double API rate limits (120 reads/min, 40 writes/min)
            </li>
            <li className="flex items-center gap-2">
              <span className="text-cyan-400">&#10003;</span>
              10 expensive operations per hour
            </li>
            <li className="flex items-center gap-2">
              <span className="text-cyan-400">&#10003;</span>
              Priority support
            </li>
          </ul>
        </Card>
      )}
    </div>
  );
}
