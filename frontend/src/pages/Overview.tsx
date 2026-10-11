import { useCallback, useMemo, useState, type ComponentType } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Globe,
  Shield,
  Plus,
  AlertTriangle,
  X,
  ArrowRight,
  CheckCircle2,
  Activity,
  Plug,
  ChevronRight,
  RefreshCw,
  Key,
  FileBarChart,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { CertStatus } from '@krakenkey/shared';
import { useAuth } from '../hooks/useAuth';
import { useHealth } from '../hooks/useHealth';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { PageHeader } from '../components/ui/PageHeader';
import api from '../services/api';
import { API_ROUTES } from '@krakenkey/shared';
import {
  SEVERITY_ORDER,
  summarizeEndpoint,
  type AttentionItem,
  type HealthArea,
  type HealthSeverity,
} from '../utils/accountHealth';
import { getExpirationInfo } from '../utils/expiration';
import { connectorStatus } from '../utils/connectors';
import type { HealthData } from '../context/HealthContext';

const AREA_ICON: Record<HealthArea, ComponentType<{ className?: string }>> = {
  certificates: Shield,
  endpoints: Activity,
  connectors: Plug,
  domains: Globe,
};

const AREA_LABEL: Record<HealthArea, string> = {
  certificates: 'Certificate',
  endpoints: 'Endpoint',
  connectors: 'Connector',
  domains: 'Domain',
};

const SEVERITY_META: Record<
  HealthSeverity,
  { label: string; dot: string; text: string; tile: string }
> = {
  critical: {
    label: 'Critical',
    dot: 'bg-red-400',
    text: 'text-red-300',
    tile: 'bg-red-400/10 text-red-300 ring-red-400/20',
  },
  warning: {
    label: 'Warning',
    dot: 'bg-amber-400',
    text: 'text-amber-300',
    tile: 'bg-amber-400/10 text-amber-300 ring-amber-400/20',
  },
  notice: {
    label: 'In progress',
    dot: 'bg-violet-400',
    text: 'text-violet-300',
    tile: 'bg-violet-400/10 text-violet-300 ring-violet-400/20',
  },
};

function plural(n: number, word: string, many = `${word}s`) {
  return `${n} ${n === 1 ? word : many}`;
}

/* ── Health summary ─────────────────────────────────────────────────────── */

function HealthSummary({
  items,
  loading,
  checkedAt,
  onRefresh,
}: {
  items: AttentionItem[];
  loading: boolean;
  checkedAt: Date | null;
  onRefresh: () => void;
}) {
  const counts = {
    critical: items.filter((i) => i.severity === 'critical').length,
    warning: items.filter((i) => i.severity === 'warning').length,
    notice: items.filter((i) => i.severity === 'notice').length,
  };
  const problems = counts.critical + counts.warning;
  const tone = counts.critical ? 'critical' : counts.warning ? 'warning' : 'ok';

  const headline =
    problems === 0
      ? 'Everything looks healthy'
      : `${plural(problems, 'item')} need${problems === 1 ? 's' : ''} attention`;
  const parts = [
    counts.critical && plural(counts.critical, 'critical issue'),
    counts.warning && plural(counts.warning, 'warning'),
  ].filter(Boolean);
  const sub =
    problems === 0
      ? 'No expiring certificates, failed issuances, endpoint errors or failing deployments.'
      : `${parts.join(' and ')} across your certificates, endpoints, connectors and domains.`;

  return (
    <Card className="relative overflow-hidden" flush>
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-y-0 left-0 w-[3px] ${
          tone === 'critical'
            ? 'bg-red-400'
            : tone === 'warning'
              ? 'bg-amber-400'
              : 'bg-emerald-400'
        }`}
      />
      <div className="flex flex-col gap-5 p-5 sm:p-6 lg:flex-row lg:items-center">
        <div className="flex items-start gap-4 flex-1 min-w-0">
          <div
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ${
              tone === 'critical'
                ? 'bg-red-400/10 text-red-300 ring-red-400/20'
                : tone === 'warning'
                  ? 'bg-amber-400/10 text-amber-300 ring-amber-400/20'
                  : 'bg-emerald-400/10 text-emerald-300 ring-emerald-400/20'
            }`}
          >
            {tone === 'ok' ? (
              <ShieldCheck className="h-5 w-5" />
            ) : (
              <ShieldAlert className="h-5 w-5" />
            )}
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold tracking-tight text-text">
              {headline}
            </h2>
            <p className="mt-1 text-sm text-text-muted">{sub}</p>
            <p className="mt-2 flex items-center gap-2 text-xs text-text-faint">
              {checkedAt
                ? `Checked at ${checkedAt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
                : 'Checking...'}
              <button
                onClick={onRefresh}
                disabled={loading}
                className="inline-flex items-center gap-1 text-cyan-300 hover:text-cyan-200 disabled:opacity-60 cursor-pointer"
              >
                <RefreshCw
                  className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`}
                />
                Refresh
              </button>
            </p>
          </div>
        </div>
        <dl className="grid grid-cols-3 gap-2 lg:w-[360px] shrink-0">
          {SEVERITY_ORDER.map((s) => (
            <div
              key={s}
              className="rounded-lg border border-border-subtle bg-bg/50 px-3 py-2.5"
            >
              <dt className="flex items-center gap-1.5 whitespace-nowrap text-xs text-text-muted">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${SEVERITY_META[s].dot}`}
                />
                {SEVERITY_META[s].label}
              </dt>
              <dd
                className={`mt-1 text-2xl font-semibold tnum ${counts[s] ? SEVERITY_META[s].text : 'text-text-faint'}`}
              >
                {counts[s]}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </Card>
  );
}

/* ── Attention list ─────────────────────────────────────────────────────── */

function AttentionRow({ item }: { item: AttentionItem }) {
  const Icon = AREA_ICON[item.area];
  const meta = SEVERITY_META[item.severity];
  return (
    <li>
      <Link
        to={item.to}
        className="group flex items-center gap-3.5 px-5 py-3 hover:bg-white/[0.025] transition-colors"
      >
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset ${meta.tile}`}
        >
          <Icon className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 min-w-0">
            <span className="truncate text-sm font-medium text-text">
              {item.title}
            </span>
            <span className="shrink-0 text-[11px] text-text-faint">
              {AREA_LABEL[item.area]}
            </span>
          </span>
          <span className="block truncate text-[13px] text-text-muted">
            {item.detail}
          </span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-text-faint group-hover:text-cyan-300 transition-colors" />
      </Link>
    </li>
  );
}

function AttentionList({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) {
    return (
      <Card className="flex items-center gap-3">
        <CheckCircle2 className="h-5 w-5 text-emerald-400" />
        <p className="text-sm text-text-secondary">
          Nothing needs attention right now.
        </p>
      </Card>
    );
  }
  return (
    <Card flush>
      <div className="flex items-center justify-between px-5 pt-4 pb-2">
        <h3 className="text-sm font-semibold text-text">Needs attention</h3>
        <span className="text-xs text-text-faint tnum">
          {plural(items.length, 'item')}
        </span>
      </div>
      {SEVERITY_ORDER.map((s) => {
        const group = items.filter((i) => i.severity === s);
        if (group.length === 0) return null;
        return (
          <section key={s} aria-label={SEVERITY_META[s].label}>
            <h4 className="flex items-center gap-2 px-5 pt-3 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-faint">
              <span
                className={`h-1.5 w-1.5 rounded-full ${SEVERITY_META[s].dot}`}
              />
              {SEVERITY_META[s].label}
              <span className="tnum font-medium">{group.length}</span>
            </h4>
            <ul className="divide-y divide-border-subtle border-y border-border-subtle">
              {group.map((item) => (
                <AttentionRow key={item.id} item={item} />
              ))}
            </ul>
          </section>
        );
      })}
      <div className="h-2" />
    </Card>
  );
}

/* ── KPI tiles ──────────────────────────────────────────────────────────── */

interface Segment {
  label: string;
  value: number;
  color: string;
}

function SegmentBar({ segments }: { segments: Segment[] }) {
  const total = segments.reduce((n, s) => n + s.value, 0);
  if (total === 0) return null;
  return (
    <div className="mt-3">
      <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-full">
        {segments
          .filter((s) => s.value > 0)
          .map((s) => (
            <div
              key={s.label}
              className={s.color}
              style={{ width: `${(s.value / total) * 100}%` }}
            />
          ))}
      </div>
      <ul className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1">
        {segments
          .filter((s) => s.value > 0)
          .map((s) => (
            <li
              key={s.label}
              className="flex items-center gap-1.5 text-xs text-text-muted"
            >
              <span className={`h-1.5 w-1.5 rounded-full ${s.color}`} />
              <span className="truncate">{s.label}</span>
              <span className="ml-auto tnum text-text-secondary">
                {s.value}
              </span>
            </li>
          ))}
      </ul>
    </div>
  );
}

function KpiTile({
  label,
  value,
  icon: Icon,
  to,
  segments,
}: {
  label: string;
  value: number;
  icon: ComponentType<{ className?: string }>;
  to: string;
  segments: Segment[];
}) {
  return (
    <Link
      to={to}
      className="group block rounded-xl border border-border bg-surface p-4 shadow-card hover:border-border-strong hover:bg-surface-hover transition-colors"
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm text-text-muted">
          <Icon className="h-4 w-4 text-text-faint" />
          {label}
        </span>
        <ArrowRight className="h-3.5 w-3.5 text-text-faint opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
      <p className="mt-2 text-[26px] leading-8 font-semibold tracking-tight text-text tnum">
        {value}
      </p>
      <SegmentBar segments={segments} />
    </Link>
  );
}

interface ResourceCounts {
  domains: number;
  certificates: number;
  apiKeys: number;
}

/**
 * Tile numbers. Totals for domains and certificates come from the profile's
 * resource counts when present (pooled across an organization); the
 * breakdowns come from the lists.
 */
function useKpis(data: HealthData | null, counts: ResourceCounts | null) {
  return useMemo(() => {
    if (!data) return null;

    let valid = 0;
    let expiring = 0;
    let inProgress = 0;
    let failed = 0;
    let revoked = 0;
    for (const c of data.certs) {
      const exp = getExpirationInfo(c);
      if (c.status === CertStatus.ISSUED) {
        if (exp && exp.daysUntilExpiry <= 30) expiring++;
        else valid++;
      } else if (c.status === CertStatus.FAILED) failed++;
      else if (
        c.status === CertStatus.REVOKED ||
        c.status === CertStatus.REVOKING
      )
        revoked++;
      else inProgress++;
    }

    let healthy = 0;
    let epExpiring = 0;
    let epProblems = 0;
    let epOff = 0;
    for (const ep of data.endpoints) {
      const s = summarizeEndpoint(ep, data.latestResults[ep.id] ?? []).state;
      if (s === 'disabled') epOff++;
      else if (s === 'unreachable' || s === 'untrusted') epProblems++;
      else if (s === 'expiring') epExpiring++;
      else healthy++;
    }

    const conn = { active: 0, stale: 0, waiting: 0, revoked: 0 };
    for (const c of data.connectors) {
      const s = connectorStatus(c);
      if (s === 'active') conn.active++;
      else if (s === 'stale') conn.stale++;
      else if (s === 'revoked') conn.revoked++;
      else conn.waiting++;
    }

    const verified = data.domains.filter((d) => d.isVerified).length;

    return {
      domains: {
        total: counts?.domains ?? data.domains.length,
        segments: [
          { label: 'Verified', value: verified, color: 'bg-slate-400' },
          {
            label: 'Pending',
            value: data.domains.length - verified,
            color: 'bg-amber-400',
          },
        ],
      },
      certs: {
        total: counts?.certificates ?? data.certs.length,
        segments: [
          { label: 'Valid', value: valid, color: 'bg-slate-400' },
          { label: 'Expiring', value: expiring, color: 'bg-amber-400' },
          { label: 'In progress', value: inProgress, color: 'bg-violet-400' },
          { label: 'Failed', value: failed, color: 'bg-red-400' },
          { label: 'Revoked', value: revoked, color: 'bg-slate-600' },
        ],
      },
      endpoints: {
        total: data.endpoints.length,
        segments: [
          { label: 'Healthy', value: healthy, color: 'bg-slate-400' },
          { label: 'Expiring', value: epExpiring, color: 'bg-amber-400' },
          { label: 'Failing', value: epProblems, color: 'bg-red-400' },
          { label: 'Disabled', value: epOff, color: 'bg-slate-600' },
        ],
      },
      connectors: {
        total: data.connectors.length - conn.revoked,
        segments: [
          { label: 'Active', value: conn.active, color: 'bg-slate-400' },
          { label: 'Stale', value: conn.stale, color: 'bg-amber-400' },
          {
            label: 'Not enrolled',
            value: conn.waiting,
            color: 'bg-violet-400',
          },
        ],
      },
    };
  }, [data, counts]);
}

/* ── Page ───────────────────────────────────────────────────────────────── */

const QUICK_ACTIONS = [
  {
    label: 'Request certificate',
    to: '/dashboard/certificates?request=1',
    icon: Shield,
  },
  { label: 'Add domain', to: '/dashboard/domains', icon: Globe },
  { label: 'Add endpoint', to: '/dashboard/endpoints?add=1', icon: Activity },
  { label: 'Create API key', to: '/dashboard/api-keys', icon: Key },
  { label: 'Run a report', to: '/dashboard/reports', icon: FileBarChart },
];

export default function Overview() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data, items, loading, checkedAt, refresh } = useHealth();
  const counts =
    (user as { resourceCounts?: ResourceCounts } | null)?.resourceCounts ??
    null;
  const kpis = useKpis(data, counts);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [confirming, setConfirming] = useState(false);

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

  const isNewAccount = counts
    ? counts.domains === 0 && counts.certificates === 0
    : !!data && data.domains.length === 0 && data.certs.length === 0;

  return (
    <div>
      <PageHeader
        title={`Welcome back, ${user?.displayName || user?.username || 'user'}`}
        description="Account health across your certificates, endpoints and connectors."
        actions={
          <>
            <Button
              variant="secondary"
              icon={<Plus className="w-4 h-4" />}
              onClick={() => navigate('/dashboard/endpoints?add=1')}
            >
              Add endpoint
            </Button>
            <Button
              variant="primary"
              icon={<Plus className="w-4 h-4" />}
              onClick={() => navigate('/dashboard/certificates?request=1')}
            >
              Request certificate
            </Button>
          </>
        }
      />

      {/* Auto-renewal confirmation banner */}
      {showBanner && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-400/25 bg-amber-400/[0.07] px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <div className="flex-1 text-sm text-amber-100">
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
              aria-label="Dismiss"
              className="text-text-faint hover:text-text-secondary"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {!data ? (
        <div className="space-y-4" aria-busy="true">
          <div className="h-[132px] rounded-xl border border-border bg-surface/60 animate-pulse" />
          <div className="grid gap-4 xl:grid-cols-3">
            <div className="h-80 rounded-xl border border-border bg-surface/60 animate-pulse xl:col-span-2" />
            <div className="h-80 rounded-xl border border-border bg-surface/60 animate-pulse" />
          </div>
        </div>
      ) : isNewAccount ? (
        <Card className="mb-8">
          <h3 className="text-lg font-semibold text-text mb-2">
            Get your first TLS certificate
          </h3>
          <p className="text-sm text-text-muted mb-6">
            Three steps to your first certificate. The whole process takes about
            5 minutes.
          </p>
          <div className="space-y-3">
            {[
              {
                step: 1,
                title: 'Add a domain',
                description:
                  'Register a domain and configure a TXT record and a CNAME record in your DNS.',
                path: '/dashboard/domains',
                buttonLabel: 'Add Domain',
              },
              {
                step: 2,
                title: 'Verify DNS ownership',
                description:
                  'Click "Verify" once your DNS records have propagated (usually 1–5 minutes).',
                path: '/dashboard/domains',
                buttonLabel: 'Go to Domains',
              },
              {
                step: 3,
                title: 'Submit a CSR and get your certificate',
                description:
                  'Generate a CSR in-browser or with OpenSSL, submit it, and receive your certificate in about 4 minutes.',
                path: '/dashboard/certificates?request=1',
                buttonLabel: 'Submit CSR',
              },
            ].map(({ step, title, description, path, buttonLabel }) => (
              <div
                key={step}
                className="flex items-start gap-4 rounded-lg border border-border-subtle bg-bg/40 p-4"
              >
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cyan-400/15 text-xs font-semibold text-cyan-300 tnum">
                  {step}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text">{title}</p>
                  <p className="text-xs text-text-muted mt-1">{description}</p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<ArrowRight className="w-3.5 h-3.5" />}
                  onClick={() => navigate(path)}
                >
                  {buttonLabel}
                </Button>
              </div>
            ))}
          </div>
        </Card>
      ) : (
        <div className="space-y-6">
          <HealthSummary
            items={items}
            loading={loading}
            checkedAt={checkedAt}
            onRefresh={() => refresh()}
          />

          <div className="grid gap-6 xl:grid-cols-3 items-start">
            <div className="min-w-0 xl:col-span-2">
              <AttentionList items={items} />
            </div>

            <div className="min-w-0 space-y-6">
              {kpis && (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2 gap-3">
                  <KpiTile
                    label="Certificates"
                    value={kpis.certs.total}
                    icon={Shield}
                    to="/dashboard/certificates"
                    segments={kpis.certs.segments}
                  />
                  <KpiTile
                    label="Endpoints"
                    value={kpis.endpoints.total}
                    icon={Activity}
                    to="/dashboard/endpoints"
                    segments={kpis.endpoints.segments}
                  />
                  <KpiTile
                    label="Domains"
                    value={kpis.domains.total}
                    icon={Globe}
                    to="/dashboard/domains"
                    segments={kpis.domains.segments}
                  />
                  <KpiTile
                    label="Connectors"
                    value={kpis.connectors.total}
                    icon={Plug}
                    to="/dashboard/connectors"
                    segments={kpis.connectors.segments}
                  />
                </div>
              )}

              <Card flush>
                <h3 className="px-5 pt-4 pb-2 text-sm font-semibold text-text">
                  Quick actions
                </h3>
                <ul className="pb-2">
                  {QUICK_ACTIONS.map(({ label, to, icon: Icon }) => (
                    <li key={label}>
                      <Link
                        to={to}
                        className="group flex items-center gap-3 px-5 py-2 text-sm text-text-secondary hover:bg-white/[0.025] hover:text-text transition-colors"
                      >
                        <Icon className="h-4 w-4 text-text-faint group-hover:text-cyan-300" />
                        {label}
                        <ArrowRight className="ml-auto h-3.5 w-3.5 text-text-faint opacity-0 group-hover:opacity-100 transition-opacity" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
