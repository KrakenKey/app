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
  CalendarClock,
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
  balancePanels,
  estimatePanelHeight,
  fleetCounts,
  greetingName,
  renewalSchedule,
  type AttentionItem,
  type AttentionKind,
  type FleetCounts,
  type HealthSeverity,
  type OverviewPanel,
  type RenewalSchedule,
  type ScheduleRow,
} from '../utils/accountHealth';
import {
  CONNECTOR_HEALTH_DOT,
  CONNECTOR_HEALTH_LABEL,
  CONNECTOR_DOCS_URL,
  connectorHealth,
  formatRelative,
} from '../utils/connectors';
import { fullDateTime } from '../utils/dates';

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

/** A panel with nothing in it yet: what it is for, and how to start. */
function PanelEmpty({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon: Icon;
  title: string;
  children: ReactNode;
  action: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-8 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-bg/60 text-text-muted">
        <Icon className="h-5 w-5" />
      </span>
      <p className="mt-3 text-sm font-medium text-text">{title}</p>
      <p className="mt-1 max-w-sm text-[13px] text-text-muted">{children}</p>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        {action}
      </div>
    </div>
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

function buildKpis(f: FleetCounts, totals: { domains?: number }): Kpi[] {
  const next = f.certs.expiring[0];
  const c = f.certs;
  const epProblems = f.endpoints.failing;
  const epActive = f.endpoints.total - f.endpoints.inactive;
  const { stale, failingTargets } = f.connectors;
  return [
    {
      label: 'Certificates',
      icon: Shield,
      // Live certificates only; revoked ones are history, not inventory.
      value: c.live,
      sub:
        c.live || c.revoked
          ? [
              `${c.issued} issued`,
              // Renewing or on the way to issuance.
              c.renewing + c.inProgress &&
                `${c.renewing + c.inProgress} in progress`,
              c.revoked && `${c.revoked} revoked`,
            ]
              .filter(Boolean)
              // Keep each count with its word when the line wraps.
              .map((part) => String(part).replace(' ', '\u00a0'))
              .join(', ')
          : 'None yet',
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
              <span
                className="mt-1 line-clamp-2 text-xs text-text-muted"
                title={typeof sub === 'string' ? sub : undefined}
              >
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
          {item.ref && (
            <span className="shrink-0 font-mono text-[11px] text-text-faint">
              {item.ref}
            </span>
          )}
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

/* ── Renewal schedule ──────────────────────────────────────────────────── */

/** "Dec 8" */
function dayLabel(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

const SEVERITY_TEXT = {
  critical: 'text-red-300',
  warning: 'text-amber-300',
} as const;

/** What happens to the certificate next, in a few words. */
function scheduleNote(r: ScheduleRow): string {
  switch (r.state) {
    case 'scheduled':
      return 'Renews automatically';
    case 'connector':
      return r.connectorName
        ? `Renewed by ${r.connectorName}`
        : 'Connector-managed';
    case 'manual':
      return 'Auto-renew is off';
    case 'overdue':
      return r.days < 0
        ? 'Expired'
        : r.connectorName
          ? `${r.connectorName} has not renewed it`
          : 'Renewal has not started';
    case 'replace':
      return 'The CA asked for early replacement';
    case 'renewing':
      return 'Renewal in progress';
  }
}

/** The "Renews" cell: a date when one is scheduled, otherwise the state. */
function RenewCell({ r }: { r: ScheduleRow }) {
  const tone = r.severity ? SEVERITY_TEXT[r.severity] : 'text-text-secondary';
  if (r.state === 'renewing') {
    return <span className="text-xs font-medium text-violet-300">Now</span>;
  }
  if (r.state === 'manual' || !r.renewAt || r.renewInDays == null) {
    return <span className={`text-xs font-medium ${tone}`}>Off</span>;
  }
  return (
    <span
      className="flex flex-col leading-tight"
      title={fullDateTime(r.renewAt)}
    >
      <span className={`text-xs font-medium tnum ${tone}`}>
        {r.state === 'overdue'
          ? 'Overdue'
          : r.renewInDays < 0
            ? 'Due'
            : dayLabel(r.renewAt)}
      </span>
      <span className="text-[11px] text-text-faint tnum">
        {r.renewInDays < 0
          ? `since ${dayLabel(r.renewAt)}`
          : r.renewInDays === 0
            ? 'today'
            : `in ${r.renewInDays}d`}
      </span>
    </span>
  );
}

const SCHEDULE_COLS =
  'grid grid-cols-[minmax(0,1fr)_4.25rem_4.25rem] items-center gap-x-3 sm:grid-cols-[minmax(0,1fr)_5rem_5rem] sm:gap-x-4';

function RenewalSchedulePanel({ schedule }: { schedule: RenewalSchedule }) {
  const navigate = useNavigate();
  const { rows, total } = schedule;
  const more = total - rows.length;
  return (
    <Card flush>
      <PanelHeader
        title="Renewal schedule"
        count={total}
        actions={
          <PanelLink to="/dashboard/certificates">Certificates</PanelLink>
        }
      />
      {rows.length === 0 ? (
        <PanelEmpty
          icon={CalendarClock}
          title="Nothing to renew yet"
          action={
            <Button
              size="sm"
              variant="secondary"
              icon={<Plus className="h-3.5 w-3.5" />}
              onClick={() => navigate('/dashboard/certificates?request=1')}
            >
              Request certificate
            </Button>
          }
        >
          Issued certificates show up here with the day they renew and the day
          they expire.
        </PanelEmpty>
      ) : (
        <>
          <div
            className={`${SCHEDULE_COLS} px-5 pt-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-faint`}
            aria-hidden="true"
          >
            <span>Certificate</span>
            <span>Renews</span>
            <span>Expires</span>
          </div>
          <ul className="divide-y divide-border-subtle border-t border-border-subtle">
            {rows.map((r) => {
              const tone = r.severity ? SEVERITY_TEXT[r.severity] : null;
              const label = [
                `${r.name} #${r.id}`,
                scheduleNote(r),
                r.renewAt &&
                  r.state !== 'manual' &&
                  r.state !== 'renewing' &&
                  `renews ${dayLabel(r.renewAt)}`,
                `expires ${dayLabel(r.expiresAt)}`,
              ]
                .filter(Boolean)
                .join(', ');
              return (
                <li
                  key={r.id}
                  className={`${SCHEDULE_COLS} px-5 py-2.5`}
                  aria-label={label}
                >
                  <div className="min-w-0">
                    <p className="flex min-w-0 items-center gap-1.5">
                      <span
                        aria-hidden="true"
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                          r.severity === 'critical'
                            ? 'bg-red-400'
                            : r.severity === 'warning'
                              ? 'bg-amber-400'
                              : r.state === 'renewing'
                                ? 'bg-violet-400'
                                : 'bg-slate-600'
                        }`}
                      />
                      <Link
                        to="/dashboard/certificates"
                        className="min-w-0 truncate text-[13px] text-text-secondary transition-colors hover:text-cyan-300"
                        title={r.name}
                      >
                        {r.name}
                      </Link>
                      {r.extraNames > 0 && (
                        <span
                          className="shrink-0 rounded bg-white/[0.06] px-1 text-[10px] text-text-muted tnum"
                          title={`Covers ${r.extraNames} more name${r.extraNames === 1 ? '' : 's'}`}
                        >
                          +{r.extraNames}
                        </span>
                      )}
                      <span className="shrink-0 font-mono text-[11px] text-text-faint">
                        #{r.id}
                      </span>
                    </p>
                    <p
                      className={`truncate pl-3 text-xs ${tone ?? (r.state === 'renewing' ? 'text-violet-300' : 'text-text-muted')}`}
                    >
                      {r.state === 'connector' && (
                        <Plug className="mr-1 inline h-3 w-3 -translate-y-px text-text-faint" />
                      )}
                      {scheduleNote(r)}
                    </p>
                  </div>
                  <RenewCell r={r} />
                  <span
                    className="flex flex-col leading-tight"
                    title={fullDateTime(r.expiresAt)}
                  >
                    <span
                      className={`text-xs font-medium tnum ${tone ?? 'text-text-secondary'}`}
                    >
                      {dayLabel(r.expiresAt)}
                    </span>
                    <span className="text-[11px] text-text-faint tnum">
                      {r.days < 0 ? `${-r.days}d ago` : `${r.days}d`}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
          {more > 0 && (
            <div className="border-t border-border-subtle px-5 py-2.5 text-xs text-text-muted">
              <Link
                to="/dashboard/certificates"
                className="group inline-flex items-center gap-1 transition-colors hover:text-cyan-300"
              >
                {more} more in Certificates
                <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

/* ── Connectors ────────────────────────────────────────────────────────── */

function ConnectorsPanel({ connectors }: { connectors: Connector[] }) {
  const navigate = useNavigate();
  const live = connectors.filter((c) => !c.revokedAt);
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
        <PanelEmpty
          icon={Plug}
          title="Run a connector to renew and deploy with your own keys"
          action={
            <>
              <Button
                size="sm"
                variant="secondary"
                icon={<Plus className="h-3.5 w-3.5" />}
                onClick={() => navigate('/dashboard/connectors')}
              >
                Set up a connector
              </Button>
              <a
                href={CONNECTOR_DOCS_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 items-center px-2 text-xs text-text-muted transition-colors hover:text-cyan-300"
              >
                How it works
              </a>
            </>
          }
        >
          A connector runs on your servers, makes a new key and CSR for each
          renewal, and installs the certificate where it is used.
        </PanelEmpty>
      ) : (
        <ul className="divide-y divide-border-subtle">
          {live.map((c) => {
            const health = connectorHealth(c);
            const s = c.deploymentSummary;
            return (
              <li key={c.id}>
                <Link
                  to={`/dashboard/connectors/${c.id}`}
                  className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-white/[0.025]"
                >
                  <span
                    role="img"
                    aria-label={CONNECTOR_HEALTH_LABEL[health]}
                    title={CONNECTOR_HEALTH_LABEL[health]}
                    className={`h-2 w-2 shrink-0 rounded-full ${CONNECTOR_HEALTH_DOT[health]}`}
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
                      ) : health === 'waiting' || health === 'expired' ? (
                        'Not enrolled yet'
                      ) : (
                        'No deployments reported'
                      )}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span
                      className={`block text-xs ${health === 'stale' ? 'text-amber-300' : 'text-text-secondary'}`}
                    >
                      {c.lastSeenAt
                        ? formatRelative(c.lastSeenAt)
                        : health === 'waiting'
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
  const navigate = useNavigate();
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
      {counts.total === 0 ? (
        <PanelEmpty
          icon={Activity}
          title="Monitor your first endpoint"
          action={
            <Button
              size="sm"
              variant="secondary"
              icon={<Plus className="h-3.5 w-3.5" />}
              onClick={() => navigate('/dashboard/endpoints?add=1')}
            >
              Add endpoint
            </Button>
          }
        >
          Check expiry, chain trust and reachability on any TLS host, including
          ones that serve certificates from another CA.
        </PanelEmpty>
      ) : (
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
      )}
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

/** Single-column order, below the two-column breakpoint. */
const PANEL_ORDER: Record<OverviewPanel, string> = {
  attention: 'order-1',
  schedule: 'order-2',
  connectors: 'order-3',
  endpoints: 'order-4',
};

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
            domains: counts?.domains,
          })
        : null,
    [fleet, counts],
  );
  const schedule = useMemo(
    () =>
      data
        ? renewalSchedule(data.certs, { plan, connectors: data.connectors })
        : { rows: [], total: 0 },
    [data, plan],
  );
  const layout = useMemo(() => {
    if (!data || !fleet) return null;
    return balancePanels({
      attention: estimatePanelHeight('attention', {
        rows: items.length,
        groups: new Set(items.map((i) => i.severity)).size,
      }),
      schedule: estimatePanelHeight('schedule', {
        rows: schedule.rows.length,
        extra: schedule.total - schedule.rows.length,
      }),
      connectors: estimatePanelHeight('connectors', {
        rows: data.connectors.filter((c) => !c.revokedAt).length,
      }),
      endpoints: estimatePanelHeight('endpoints', {
        rows: fleet.endpoints.total,
        extra: data.probes.length,
      }),
    });
  }, [data, fleet, items, schedule]);

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
        title={`Welcome back, ${greetingName(user)}`}
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

          {/*
            One column on smaller screens, in a fixed order. On wide screens,
            two columns balanced by content (see balancePanels): the column
            wrappers are display: contents below xl, so the order classes
            apply to the panels themselves.
          */}
          <div className="flex flex-col gap-6 xl:grid xl:grid-cols-12 xl:items-start">
            {(['left', 'right'] as const).map((side) => (
              <div
                key={side}
                className={`contents xl:flex xl:min-w-0 xl:flex-col xl:gap-6 ${side === 'left' ? 'xl:col-span-7' : 'xl:col-span-5'}`}
              >
                {layout?.[side].map((panel) => (
                  <div
                    key={panel}
                    className={`min-w-0 ${PANEL_ORDER[panel]} xl:order-none`}
                  >
                    {panel === 'attention' ? (
                      <AttentionPanel
                        items={items}
                        loading={loading}
                        checkedAt={checkedAt}
                        onRefresh={() => refresh()}
                      />
                    ) : panel === 'schedule' ? (
                      <RenewalSchedulePanel schedule={schedule} />
                    ) : panel === 'connectors' ? (
                      <ConnectorsPanel connectors={data.connectors} />
                    ) : (
                      <EndpointsPanel
                        counts={fleet.endpoints}
                        probes={data.probes}
                      />
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
