import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Globe,
  Shield,
  Key,
  Plus,
  AlertTriangle,
  X,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { PageHeader } from '../components/ui/PageHeader';
import api from '../services/api';
import { API_ROUTES } from '@krakenkey/shared';

interface ResourceCounts {
  domains: number;
  certificates: number;
  apiKeys: number;
}

export default function Overview() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [fetchedCounts, setFetchedCounts] = useState<ResourceCounts | null>(
    null,
  );
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const profileCounts = useMemo(() => {
    const profile = user as { resourceCounts?: ResourceCounts } | null;
    return profile?.resourceCounts ?? null;
  }, [user]);

  const fetchCounts = useCallback(() => {
    api
      .get('/auth/profile')
      .then((res) => {
        if (res.data.resourceCounts) {
          setFetchedCounts(res.data.resourceCounts);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!profileCounts) {
      fetchCounts();
    }
  }, [profileCounts, fetchCounts]);

  const counts = profileCounts ?? fetchedCounts;

  // Free-tier auto-renewal confirmation banner
  const autoRenewalConfirmedAt = (
    user as { autoRenewalConfirmedAt?: string | null } | null
  )?.autoRenewalConfirmedAt;
  const isPaidPlan =
    user &&
    (user as { plan?: string }).plan &&
    (user as { plan?: string }).plan !== 'free';
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const fourteenDaysFromLapse = autoRenewalConfirmedAt
    ? new Date(
        new Date(autoRenewalConfirmedAt).getTime() + (6 * 30 - 14) * 86_400_000,
      )
    : null;
  const showBanner =
    !bannerDismissed &&
    !isPaidPlan &&
    (!autoRenewalConfirmedAt ||
      new Date(autoRenewalConfirmedAt) < sixMonthsAgo ||
      (fourteenDaysFromLapse && fourteenDaysFromLapse <= new Date()));

  const daysUntilLapse = autoRenewalConfirmedAt
    ? Math.max(
        0,
        Math.ceil(
          (new Date(autoRenewalConfirmedAt).getTime() +
            6 * 30 * 86_400_000 -
            Date.now()) /
            86_400_000,
        ),
      )
    : 0;

  const handleConfirmAutoRenewal = useCallback(async () => {
    setConfirming(true);
    try {
      await api.post(API_ROUTES.AUTH.CONFIRM_AUTO_RENEWAL);
      setBannerDismissed(true);
    } finally {
      setConfirming(false);
    }
  }, []);

  const resources = [
    {
      label: 'Domains',
      count: counts?.domains ?? 0,
      icon: Globe,
      path: '/dashboard/domains',
      color: 'text-cyan-400',
    },
    {
      label: 'Certificates',
      count: counts?.certificates ?? 0,
      icon: Shield,
      path: '/dashboard/certificates',
      color: 'text-emerald-400',
    },
    {
      label: 'API Keys',
      count: counts?.apiKeys ?? 0,
      icon: Key,
      path: '/dashboard/api-keys',
      color: 'text-amber-400',
    },
  ];

  return (
    <div>
      <PageHeader
        title={`Welcome back, ${user?.displayName || user?.username || 'user'}`}
        description="Here's an overview of your resources."
        icon={<LayoutDashboard className="w-6 h-6" />}
      />

      {/* Auto-renewal confirmation banner */}
      {showBanner && (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <div className="flex-1 text-sm text-amber-200">
            {daysUntilLapse > 0 ? (
              <>
                Auto-renewal re-confirmation required in{' '}
                <strong>{daysUntilLapse} days</strong>. Confirm now to keep
                certificates renewing automatically.
              </>
            ) : (
              <>
                Auto-renewal is <strong>paused</strong>. Your certificates are
                safe but will not renew automatically until you confirm.
              </>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={handleConfirmAutoRenewal}
              disabled={confirming}
            >
              {confirming ? 'Confirming…' : 'Confirm now'}
            </Button>
            <button
              onClick={() => setBannerDismissed(true)}
              className="text-zinc-500 hover:text-zinc-300"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Resource cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        {resources.map(({ label, count, icon: Icon, path, color }) => (
          <Card
            key={label}
            hover
            className="cursor-pointer"
            onClick={() => navigate(path)}
          >
            <div className="flex items-center justify-between mb-3">
              <Icon className={`w-5 h-5 ${color}`} />
              <span className="text-2xl font-bold text-zinc-100">{count}</span>
            </div>
            <p className="text-sm text-zinc-400">{label}</p>
          </Card>
        ))}
      </div>

      {/* Quick actions */}
      <Card>
        <h3 className="text-sm font-medium text-zinc-400 mb-4">
          Quick Actions
        </h3>
        <div className="flex flex-wrap gap-3">
          <Button
            variant="secondary"
            size="sm"
            icon={<Plus className="w-3.5 h-3.5" />}
            onClick={() => navigate('/dashboard/domains')}
          >
            Add Domain
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={<Plus className="w-3.5 h-3.5" />}
            onClick={() => navigate('/dashboard/certificates')}
          >
            Submit CSR
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={<Plus className="w-3.5 h-3.5" />}
            onClick={() => navigate('/dashboard/api-keys')}
          >
            Create API Key
          </Button>
        </div>
      </Card>
    </div>
  );
}
