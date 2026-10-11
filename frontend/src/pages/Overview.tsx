import {
  useCallback,
  useMemo,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
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
  RadioTower,
  RefreshCw,
  RotateCcw,
  ShieldX,
  Loader2,
  ShieldCheck,
} from 'lucide-react';
import { API_ROUTES } from '@krakenkey/shared';
import type { Connector } from '@krakenkey/shared';
import { useAuth } from '../hooks/useAuth';
import { useHealth } from '../hooks/useHealth';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { PageHeader } from '../components/ui/PageHeader';
import api from '../services/api';
import * as certService from '../services/certificateService';
import * as endpointService from '../services/endpointService';
import type { ProbeOption } from '../services/endpointService';
import { toast } from '../utils/toast';
import {
  SEVERITY_ORDER,
  expiryTimeline,
  fleetCounts,
  renewalWindowDays,
  type AttentionItem,
  type AttentionKind,
  type FleetCounts,
  type HealthSeverity,
  type TimelineRow,
} from '../utils/accountHealth';
import { connectorStatus, formatRelative } from '../utils/connectors';

type Icon = ComponentType<{ className?: string }>;

const KIND_ICON: Record<AttentionKind, Icon> = {
  Certificate: Shield,
  Endpoint: Activity,
  Probe: RadioTower,
  Connector: Plug,
  Domain: Globe,
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

/* ── Shared panel pieces ────────────────────────────────────────────────── */

function CountPill({ n }: { n: number }) {
  return (
    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-white/[0.06] px-1.5 text-[11px] font-medium text-text-muted tnum">
      {n}
    </span>
  );
}

function PanelHeader({
  title,
  count,
  actions,
}: {
  title: string;
  count?: number;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-5 py-3.5">
      <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-text">
        <span className="truncate">{title}</span>
        {count != null && <CountPill n={count} />}
      </h2>
      {actions && (
        <div className="flex shrink-0 items-center gap-3">{actions}</div>
      )}
    </div>
  );
}

function PanelLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="group inline-flex items-center gap-1 text-xs text-text-muted transition-colors hover:text-cyan-300"
    >
      {children}
      <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

/* ── KPI strip ──────────────────────────────────────────────────────────── */

type Tone = 'critical' | 'warning' | null;

interface Kpi {
  label: string;
  icon: Icon;
  value: number;
  sub: ReactNode;
  tone: Tone;
  to: string;
}

function buildKpis(
  f: FleetCounts,
  totals: { certificates?: number; domains?: number },
): Kpi[] {
  const next = f.certs.expiring[0];
  const epProblems = f.endpoints.failing;
  const epActive = f.endpoints.total - f.endpoints.inactive;
  const { stale, failingTargets } = f.connectors;
  return [
    {
      label: 'Certificates',
      icon: Shield,
      value: totals.certificates ?? f.certs.total,
      sub: `${f.certs.issued} issued${f.certs.renewing ? `, ${f.certs.renewing} renewing` : ''}`,
      tone: null,
      to: '/dashboard/certificates',
    },
    {
      label: 'Expiring in 30 days',
      icon: AlertTriangle,
      value: f.certs.expiring.length,
      sub: next ? (
        <>
          Next in <span className="text-text-secondary tnum">{next.days}d</span>
          , {next.name}
        </>
      ) : (
        'Nothing due'
      ),
      tone: !next ? null : next.days <= 7 ? 'critical' : 'warning',
      to: '/dashboard/certificates',
    },
    {
      label: 'Failed',
      icon: ShieldX,
      value: f.certs.failed,
      sub: f.certs.failed ? 'Issuance needs a fix' : 'No failed issuance',
      tone: f.certs.failed ? 'critical' : null,
      to: '/dashboard/certificates',
    },
    {
      label: 'Endpoints',
      icon: Activity,
      value: f.endpoints.total,
      sub: epProblems
        ? `${epProblems} failing, ${epActive - epProblems} ok`
        : `${epActive} monitored`,
      tone: epProblems ? 'critical' : f.endpoints.expiring ? 'warning' : null,
      to: '/dashboard/endpoints',
    },
    {
      label: 'Connectors',
      icon: Plug,
      value: f.connectors.total,
      sub:
        [
          failingTargets && `${plural(failingTargets, 'failing target')}`,
          stale && `${stale} stale`,
        ]
          .filter(Boolean)
          .join(', ') || (f.connectors.total ? 'All checking in' : 'None yet'),
      tone: failingTargets ? 'critical' : stale ? 'warning' : null,
      to: '/dashboard/connectors',
    },
    {
      label: 'Domains',
      icon: Globe,
      value: totals.domains ?? f.domains.total,
      sub: f.domains.pending
        ? `${f.domains.pending} pending verification`
        : 'All verified',
      tone: f.domains.pending ? 'warning' : null,
      to: '/dashboard/domains',
    },
  ];
}

function KpiStrip({ kpis }: { kpis: Kpi[] }) {
  return (
    <Card flush className="overflow-hidden">
      <ul className="grid grid-cols-2 gap-px bg-border-subtle sm:grid-cols-3 xl:grid-cols-6">
        {kpis.map(({ label, icon: Icon, value, sub, tone, to }) => (
          <li key={label} className="min-w-0 bg-surface">
            <Link
              to={to}
              className="group relative block h-full px-4 py-3.5 transition-colors hover:bg-surface-hover"
            >
              {tone && (
                <span
                  aria-hidden="true"
                  className={`absolute inset-x-4 top-0 h-0.5 rounded-b-full xl:inset-x-0 xl:rounded-none ${tone === 'critical' ? 'bg-red-400' : 'bg-amber-400'}`}
                />
              )}
              <span className="flex items-center gap-1.5 text-[13px] text-text-muted">
                <Icon className="h-3.5 w-3.5 shrink-0 text-text-faint" />
                <span className="truncate">{label}</span>
              </span>
              <span
                className={`mt-1.5 block text-[26px] leading-8 font-semibold tracking-tight tnum ${
                  tone === 'critical'
                    ? 'text-red-300'
                    : tone === 'warning'
                      ? 'text-amber-300'
                      : 'text-text'
                }`}
              >
                {value}
              </span>
              <span className="mt-1 block truncate text-xs text-text-muted">
                {sub}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ── Needs attention ────────────────────────────────────────────────────── */

const ACTION_LABEL = { renew: 'Renew', retry: 'Retry', scan: 'Scan' } as const;

function AttentionRow({
  item,
  busy,
  onAction,
}: {
  item: AttentionItem;
  busy: boolean;
  onAction: (item: AttentionItem) => void;
}) {
  const Icon = KIND_ICON[item.kind];
  const meta = SEVERITY_META[item.severity];
  return (
    <li className="flex items-center gap-3.5 px-5 py-3">
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset ${meta.tile}`}
      >
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-baseline gap-2">
          <Link
            to={item.to}
            className="truncate text-sm font-medium text-text transition-colors hover:text-cyan-300"
          >
            {item.title}
          </Link>
          <span className="hidden shrink-0 text-[11px] text-text-faint sm:inline">
            {item.kind}
          </span>
        </p>
        <p className="flex min-w-0 items-baseline gap-2 text-[13px]">
          <span className="line-clamp-2 text-text-secondary sm:max-w-full sm:shrink-0 sm:truncate">
            {item.summary}
          </span>
          {item.detail && (
            <span
              className="hidden min-w-0 truncate text-xs text-text-muted sm:inline"
              title={item.detail}
            >
              {item.detail}
            </span>
          )}
        </p>
        {item.detail && (
          <p
            className="truncate text-xs text-text-muted sm:hidden"
            title={item.detail}
          >
            {item.detail}
          </p>
        )}
      </div>
      {item.action ? (
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() => onAction(item)}
          aria-label={`${ACTION_LABEL[item.action.kind]} ${item.title}`}
          icon={
            busy ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : item.action.kind === 'scan' ? (
              <RefreshCw className="h-3 w-3" />
            ) : (
              <RotateCcw className="h-3 w-3" />
            )
          }
        >
          {ACTION_LABEL[item.action.kind]}
        </Button>
      ) : (
        <Link
          to={item.to}
          aria-label={`${item.linkLabel} ${item.title}`}
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg px-2.5 text-xs font-medium text-text-muted transition-colors hover:bg-white/[0.05] hover:text-text"
        >
          {item.linkLabel}
          <ArrowRight className="h-3 w-3" />
        </Link>
      )}
    </li>
  );
}

function AttentionPanel({
  items,
  loading,
  checkedAt,
  onRefresh,
}: {
  items: AttentionItem[];
  loading: boolean;
  checkedAt: Date | null;
  onRefresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  const runAction = async (item: AttentionItem) => {
    const a = item.action;
    if (!a) return;
    setBusy(item.id);
    try {
      if (a.kind === 'renew') {
        await certService.renewCertificate(a.certId);
        toast.success(`Renewal started for ${item.title}`);
      } else if (a.kind === 'retry') {
        await certService.retryCertificate(a.certId);
        toast.success(`Retrying ${item.title}`);
      } else {
        await endpointService.requestScan(a.endpointId);
        toast.success(`Scan requested for ${item.title}`);
      }
      await onRefresh();
    } catch {
      // The API client already shows the server's message.
    } finally {
      setBusy(null);
    }
  };

  const tally = (s: HealthSeverity) =>
    items.filter((i) => i.severity === s).length;

  return (
    <Card flush>
      <PanelHeader
        title="Needs attention"
        count={items.length}
        actions={
          <>
            <span className="hidden items-center gap-3 text-xs text-text-muted md:flex">
              {SEVERITY_ORDER.map((s) => (
                <span key={s} className="inline-flex items-center gap-1.5">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${SEVERITY_META[s].dot}`}
                  />
                  <span className="text-text-secondary tnum">{tally(s)}</span>
                  {SEVERITY_META[s].label.toLowerCase()}
                </span>
              ))}
            </span>
            <button
              type="button"
              onClick={() => void onRefresh()}
              disabled={loading}
              title={
                checkedAt
                  ? `Checked at ${checkedAt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
                  : undefined
              }
              aria-label="Refresh"
              className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-white/[0.05] hover:text-text disabled:opacity-60"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`}
              />
            </button>
          </>
        }
      />
      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-5 py-12 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-400/10 text-emerald-300 ring-1 ring-inset ring-emerald-400/20">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <p className="mt-1 text-sm font-medium text-text">All clear</p>
          <p className="text-[13px] text-text-muted">
            No certificate, endpoint, connector or domain needs you right now.
          </p>
        </div>
      ) : (
        <div className="pb-2">
          {SEVERITY_ORDER.map((s) => {
            const group = items.filter((i) => i.severity === s);
            if (group.length === 0) return null;
            return (
              <section key={s} aria-label={SEVERITY_META[s].label}>
                <h3 className="flex items-center gap-2 px-5 pt-3 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-faint">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${SEVERITY_META[s].dot}`}
                  />
                  {SEVERITY_META[s].label}
                  <span className="font-medium tnum">{group.length}</span>
                </h3>
                <ul className="divide-y divide-border-subtle border-y border-border-subtle">
                  {group.map((item) => (
                    <AttentionRow
                      key={item.id}
                      item={item}
                      busy={busy === item.id}
                      onAction={runAction}
                    />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </Card>
  );
}

/* ── Expiry timeline ───────────────────────────────────────────────────── */

const HORIZON = 90;
const TICKS = [0, 30, 60, 90];

/** "Nov 10" for a day offset from today. */
function dateAt(days: number) {
  return new Date(Date.now() + days * 86_400_000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

function pct(days: number) {
  return `${(Math.max(0, Math.min(days, HORIZON)) / HORIZON) * 100}%`;
}

function expiryTone(days: number) {
  if (days <= 7) return { bar: 'bg-red-400', text: 'text-red-300' };
  if (days <= 30) return { bar: 'bg-amber-400', text: 'text-amber-300' };
  return { bar: 'bg-slate-500', text: 'text-text-muted' };
}

/*
 * Name | bar | days on wider screens. On phones the name and days share a
 * line and the bar gets the full width below them.
 */
const TIMELINE_COLS =
  'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,9rem)_1fr_2rem]';
const TIMELINE_BAR = 'order-last col-span-2 sm:order-none sm:col-span-1';

function ExpiryTimeline({
  rows,
  windowDays,
}: {
  rows: TimelineRow[];
  windowDays: number;
}) {
  return (
    <Card flush>
      <PanelHeader
        title="Expiring in the next 90 days"
        count={rows.length}
        actions={
          <PanelLink to="/dashboard/certificates">Certificates</PanelLink>
        }
      />
      <div className="px-5 pt-3 pb-4">
        {rows.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-text-muted">
            Nothing expires in the next 90 days.
          </p>
        ) : (
          <>
            <div className={`${TIMELINE_COLS} pb-2`} aria-hidden="true">
              <span className="hidden sm:block" />
              <div className={`relative h-8 ${TIMELINE_BAR}`}>
                {TICKS.map((t) => (
                  <span
                    key={t}
                    className={`absolute bottom-0 flex flex-col whitespace-nowrap text-[11px] leading-tight text-text-faint ${
                      t === 0
                        ? 'items-start'
                        : t === HORIZON
                          ? 'items-end -translate-x-full'
                          : 'items-center -translate-x-1/2'
                    }`}
                    style={{ left: pct(t) }}
                  >
                    <span className="font-medium text-text-muted">
                      {t === 0 ? 'Today' : `${t}d`}
                    </span>
                    <span>{dateAt(t)}</span>
                  </span>
                ))}
              </div>
              <span className="hidden sm:block" />
            </div>
            <ul className="space-y-2.5 sm:space-y-0">
              {rows.map((r) => {
                const tone = expiryTone(r.days);
                const label = `${r.name} expires in ${r.days} days${
                  r.renewInDays != null
                    ? `, auto-renews in ${r.renewInDays} days`
                    : ''
                }${r.renewing ? ', renewal in progress' : ''}`;
                return (
                  <li key={r.id} className={TIMELINE_COLS}>
                    <Link
                      to="/dashboard/certificates"
                      className="truncate text-[13px] text-text-secondary transition-colors hover:text-cyan-300"
                      title={r.name}
                    >
                      {r.name}
                    </Link>
                    <div
                      className={`relative h-5 sm:h-[26px] ${TIMELINE_BAR}`}
                      role="img"
                      aria-label={label}
                    >
                      <div
                        className="absolute inset-y-0 left-0 bg-amber-400/[0.07]"
                        style={{ width: pct(windowDays) }}
                      />
                      {TICKS.slice(1, -1).map((t) => (
                        <div
                          key={t}
                          className="absolute inset-y-0 w-px bg-border-subtle"
                          style={{ left: pct(t) }}
                        />
                      ))}
                      <div className="absolute inset-x-0 top-1/2 h-px bg-border-subtle" />
                      <div
                        className={`absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full ${tone.bar}`}
                        style={{ width: pct(r.days) }}
                      />
                      <div
                        className={`absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface ${tone.bar}`}
                        style={{ left: pct(r.days) }}
                      />
                      {r.renewInDays != null && (
                        <div
                          title={`Auto-renews around ${dateAt(r.renewInDays)}`}
                          className="absolute top-1/2 h-3 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-violet-300"
                          style={{ left: pct(r.renewInDays) }}
                        />
                      )}
                    </div>
                    <span
                      className={`text-right text-xs font-medium tnum ${tone.text}`}
                    >
                      {r.days}d
                    </span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border-subtle pt-3 text-xs text-text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-3 rounded-full bg-red-400" />7 days or less
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-3 rounded-full bg-amber-400" />
            30 days or less
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm bg-amber-400/20" />
            Renewal window
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-0.5 rounded-full bg-violet-300" />
            Scheduled auto-renewal
          </span>
        </div>
      </div>
    </Card>
  );
}

/* ── Connectors ────────────────────────────────────────────────────────── */

const CONNECTOR_DOT = {
  active: 'bg-emerald-400',
  stale: 'bg-amber-400',
  waiting: 'bg-violet-400',
  expired: 'bg-amber-400',
  revoked: 'bg-red-400',
} as const;

function ConnectorsPanel({ connectors }: { connectors: Connector[] }) {
  const live = connectors.filter((c) => connectorStatus(c) !== 'revoked');
  return (
    <Card flush>
      <PanelHeader
        title="Connectors"
        count={live.length}
        actions={
          <PanelLink to="/dashboard/connectors">All connectors</PanelLink>
        }
      />
      {live.length === 0 ? (
        <p className="px-5 py-6 text-center text-[13px] text-text-muted">
          No connectors yet. A connector renews and deploys certificates with
          keys that stay on your servers.
        </p>
      ) : (
        <ul className="divide-y divide-border-subtle">
          {live.map((c) => {
            const status = connectorStatus(c);
            const s = c.deploymentSummary;
            return (
              <li key={c.id}>
                <Link
                  to={`/dashboard/connectors/${c.id}`}
                  className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-white/[0.025]"
                >
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${CONNECTOR_DOT[status]}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span className="truncate text-sm font-medium text-text">
                        {c.name}
                      </span>
                      {c.clientLabel && (
                        <span className="truncate text-xs text-text-muted">
                          {c.clientLabel}
                        </span>
                      )}
                    </span>
                    <span className="block truncate text-xs text-text-muted">
                      {s && s.targets > 0 ? (
                        <>
                          {plural(s.targets, 'target')}
                          {s.failing > 0 ? (
                            <span className="text-red-300">
                              , {s.failing} failing
                            </span>
                          ) : (
                            ', all deployed'
                          )}
                        </>
                      ) : status === 'waiting' || status === 'expired' ? (
                        'Not enrolled yet'
                      ) : (
                        'No deployments reported'
                      )}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span
                      className={`block text-xs ${status === 'stale' ? 'text-amber-300' : 'text-text-secondary'}`}
                    >
                      {c.lastSeenAt
                        ? formatRelative(c.lastSeenAt)
                        : status === 'waiting'
                          ? 'Waiting'
                          : 'Never'}
                    </span>
                    {c.version && (
                      <span className="block font-mono text-[11px] text-text-faint">
                        v{c.version}
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/* ── Endpoints and probes ──────────────────────────────────────────────── */

function EndpointsPanel({
  counts,
  probes,
}: {
  counts: FleetCounts['endpoints'];
  probes: ProbeOption[];
}) {
  const segments = [
    { label: 'healthy', value: counts.healthy, color: 'bg-slate-400' },
    { label: 'expiring', value: counts.expiring, color: 'bg-amber-400' },
    { label: 'failing', value: counts.failing, color: 'bg-red-400' },
    { label: 'inactive', value: counts.inactive, color: 'bg-slate-600' },
  ];
  const total = counts.total || 1;
  return (
    <Card flush>
      <PanelHeader
        title="Endpoints"
        count={counts.total}
        actions={<PanelLink to="/dashboard/endpoints">All endpoints</PanelLink>}
      />
      <div className="px-5 py-4">
        <div
          className="flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-white/[0.04]"
          role="img"
          aria-label={segments.map((s) => `${s.value} ${s.label}`).join(', ')}
        >
          {segments
            .filter((s) => s.value > 0)
            .map((s) => (
              <span
                key={s.label}
                className={s.color}
                style={{ width: `${(s.value / total) * 100}%` }}
              />
            ))}
        </div>
        <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
          {segments.map((s) => (
            <li key={s.label} className="inline-flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 rounded-full ${s.color}`} />
              <span className="text-text-secondary tnum">{s.value}</span>
              {s.label}
            </li>
          ))}
        </ul>
      </div>
      {probes.length > 0 && (
        <section aria-label="Probes">
          <h3 className="border-t border-border-subtle px-5 pt-3 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-faint">
            Probe check-ins
          </h3>
          <ul className="divide-y divide-border-subtle pb-1">
            {probes.map((p) => {
              const stale = p.status === 'stale';
              return (
                <li
                  key={p.id}
                  className="flex items-center justify-between gap-3 px-5 py-2.5"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${stale ? 'bg-amber-400' : 'bg-emerald-400'}`}
                    />
                    <span className="truncate text-sm font-medium text-text">
                      {p.name}
                    </span>
                    {p.region && (
                      <span className="truncate text-xs text-text-muted">
                        {p.region}
                      </span>
                    )}
                  </span>
                  <span
                    className={`shrink-0 text-xs ${stale ? 'text-amber-300' : 'text-text-secondary'}`}
                  >
                    {p.lastSeenAt ? formatRelative(p.lastSeenAt) : 'Never'}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </Card>
  );
}

/* ── Page ───────────────────────────────────────────────────────────────── */

interface ResourceCounts {
  domains: number;
  certificates: number;
  apiKeys: number;
}

const ONBOARDING_STEPS = [
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
      'Click "Verify" once your DNS records have propagated (usually 1 to 5 minutes).',
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
];

export default function Overview() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data, items, loading, checkedAt, refresh } = useHealth();
  const counts =
    (user as { resourceCounts?: ResourceCounts } | null)?.resourceCounts ??
    null;
  const plan = (user as { plan?: string } | null)?.plan;
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const fleet = useMemo(() => (data ? fleetCounts(data) : null), [data]);
  const kpis = useMemo(
    () =>
      fleet
        ? buildKpis(fleet, {
            certificates: counts?.certificates,
            domains: counts?.domains,
          })
        : null,
    [fleet, counts],
  );
  const timeline = useMemo(
    () => (data ? expiryTimeline(data.certs, HORIZON) : []),
    [data],
  );

  // Free-tier auto-renewal confirmation banner
  const autoRenewalConfirmedAt = (
    user as { autoRenewalConfirmedAt?: string | null } | null
  )?.autoRenewalConfirmedAt;
  const isPaidPlan = !!plan && plan !== 'free';
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
            <span className="hidden sm:contents">
              <Button
                variant="secondary"
                icon={<Plus className="w-4 h-4" />}
                onClick={() => navigate('/dashboard/domains')}
              >
                Add domain
              </Button>
            </span>
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

      {!data || !fleet || !kpis ? (
        <div className="space-y-6" aria-busy="true">
          <div className="h-[104px] rounded-xl border border-border bg-surface/60 animate-pulse" />
          <div className="grid gap-6 xl:grid-cols-12">
            <div className="h-96 rounded-xl border border-border bg-surface/60 animate-pulse xl:col-span-7" />
            <div className="h-96 rounded-xl border border-border bg-surface/60 animate-pulse xl:col-span-5" />
          </div>
        </div>
      ) : isNewAccount ? (
        <Card className="mb-8">
          <h2 className="text-lg font-semibold text-text mb-2">
            Get your first TLS certificate
          </h2>
          <p className="text-sm text-text-muted mb-6">
            Three steps to your first certificate. The whole process takes about
            5 minutes.
          </p>
          <div className="space-y-3">
            {ONBOARDING_STEPS.map(
              ({ step, title, description, path, buttonLabel }) => (
                <div
                  key={step}
                  className="flex items-start gap-4 rounded-lg border border-border-subtle bg-bg/40 p-4"
                >
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cyan-400/15 text-xs font-semibold text-cyan-300 tnum">
                    {step}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-text">{title}</p>
                    <p className="text-xs text-text-muted mt-1">
                      {description}
                    </p>
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
              ),
            )}
          </div>
          <p className="mt-5 flex items-center gap-1.5 text-xs text-text-muted">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
            Private keys never leave your device.
          </p>
        </Card>
      ) : (
        <div className="space-y-6">
          <KpiStrip kpis={kpis} />

          <div className="grid items-start gap-6 xl:grid-cols-12">
            <div className="min-w-0 xl:col-span-7">
              <AttentionPanel
                items={items}
                loading={loading}
                checkedAt={checkedAt}
                onRefresh={() => refresh()}
              />
            </div>
            <div className="min-w-0 space-y-6 xl:col-span-5">
              <ExpiryTimeline
                rows={timeline}
                windowDays={renewalWindowDays(plan)}
              />
              <ConnectorsPanel connectors={data.connectors} />
              <EndpointsPanel counts={fleet.endpoints} probes={data.probes} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
