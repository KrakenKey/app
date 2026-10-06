import { useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Download } from 'lucide-react';
import {
  REPORT_SEVERITIES,
  type ReportHostResult,
  type ReportSeverity,
  type ReportStatus,
  type ReportSummary,
} from '@krakenkey/shared';
import {
  Badge,
  Button,
  Card,
  Table,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui';
import {
  SEVERITY_BADGE,
  SEVERITY_LABELS,
  SEVERITY_RANK,
  SEVERITY_TEXT,
  formatDate,
} from './severity';

/** The fields both the owner view and the shared view have. */
export interface ReportViewData {
  name: string | null;
  status: ReportStatus;
  hostCount: number;
  completedCount: number;
  createdAt: string;
  completedAt: string | null;
  summary: ReportSummary;
  hosts: ReportHostResult[];
}

type SortKey = 'severity' | 'host' | 'daysLeft' | 'issuer';
type Filter = ReportSeverity | 'all';

const STATUS_BADGE: Record<
  ReportStatus,
  'neutral' | 'info' | 'success' | 'danger'
> = {
  pending: 'neutral',
  running: 'info',
  complete: 'success',
  failed: 'danger',
};

const STATUS_LABEL: Record<ReportStatus, string> = {
  pending: 'Queued',
  running: 'Scanning',
  complete: 'Complete',
  failed: 'Failed',
};

export function ReportStatusBadge({ status }: { status: ReportStatus }) {
  return <Badge variant={STATUS_BADGE[status]}>{STATUS_LABEL[status]}</Badge>;
}

function rank(h: ReportHostResult): number {
  return h.severity ? SEVERITY_RANK[h.severity] : 4;
}

function compare(a: ReportHostResult, b: ReportHostResult, key: SortKey) {
  const days = (h: ReportHostResult) => h.daysLeft ?? Number.POSITIVE_INFINITY;
  switch (key) {
    case 'host':
      return a.host.localeCompare(b.host) || a.port - b.port;
    case 'daysLeft':
      return days(a) === days(b) ? 0 : days(a) < days(b) ? -1 : 1;
    case 'issuer':
      return (a.issuerName ?? '￿').localeCompare(b.issuerName ?? '￿');
    case 'severity':
    default:
      return (
        rank(a) - rank(b) ||
        (days(a) === days(b) ? 0 : days(a) < days(b) ? -1 : 1) ||
        a.host.localeCompare(b.host)
      );
  }
}

function hostLabel(h: ReportHostResult) {
  return h.port === 443 ? h.host : `${h.host}:${h.port}`;
}

function DaysLeft({ host }: { host: ReportHostResult }) {
  if (host.daysLeft === null) return <span className="text-zinc-600">-</span>;
  const tone =
    host.daysLeft < 0
      ? 'text-red-400'
      : host.daysLeft <= 14
        ? 'text-amber-400'
        : host.daysLeft <= 30
          ? 'text-cyan-400'
          : 'text-zinc-300';
  return (
    <span className={`tabular-nums ${tone}`}>
      {host.daysLeft < 0 ? `${-host.daysLeft}d ago` : `${host.daysLeft}d`}
    </span>
  );
}

interface ReportViewProps {
  report: ReportViewData;
  onDownloadCsv: () => void;
  /** Extra controls next to the CSV button (share, delete). */
  actions?: ReactNode;
}

export function ReportView({
  report,
  onDownloadCsv,
  actions,
}: ReportViewProps) {
  const [filter, setFilter] = useState<Filter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('severity');
  const [ascending, setAscending] = useState(true);
  const { summary } = report;

  const rows = useMemo(() => {
    const filtered =
      filter === 'all'
        ? report.hosts
        : report.hosts.filter((h) => h.severity === filter);
    const sorted = [...filtered].sort((a, b) => compare(a, b, sortKey));
    return ascending ? sorted : sorted.reverse();
  }, [report.hosts, filter, sortKey, ascending]);

  const sortBy = (key: SortKey) => {
    if (key === sortKey) setAscending(!ascending);
    else {
      setSortKey(key);
      setAscending(true);
    }
  };

  const sortHead = (k: SortKey, label: string) => (
    <TableHead
      aria-sort={
        sortKey === k ? (ascending ? 'ascending' : 'descending') : 'none'
      }
    >
      <button
        type="button"
        onClick={() => sortBy(k)}
        className="inline-flex items-center gap-1 uppercase tracking-wider cursor-pointer bg-transparent border-none text-inherit"
      >
        {label}
        {sortKey === k &&
          (ascending ? (
            <ArrowUp className="w-3 h-3" />
          ) : (
            <ArrowDown className="w-3 h-3" />
          ))}
      </button>
    </TableHead>
  );

  const inProgress = report.status === 'pending' || report.status === 'running';

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-zinc-100">
            {report.name || 'TLS report'}
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-zinc-500">
            <ReportStatusBadge status={report.status} />
            <span>
              {report.completedCount} of {report.hostCount} hosts scanned
            </span>
            <span aria-hidden="true">·</span>
            <span>Created {formatDate(report.createdAt)}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            icon={<Download className="w-3.5 h-3.5" />}
            onClick={onDownloadCsv}
          >
            Download CSV
          </Button>
          {actions}
        </div>
      </div>

      {inProgress && (
        <div
          className="h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden"
          role="progressbar"
          aria-label="Scan progress"
          aria-valuemin={0}
          aria-valuemax={report.hostCount}
          aria-valuenow={report.completedCount}
        >
          <div
            className="h-full bg-accent transition-all duration-500"
            style={{
              width: `${report.hostCount ? (report.completedCount / report.hostCount) * 100 : 0}%`,
            }}
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {REPORT_SEVERITIES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setFilter(filter === s ? 'all' : s)}
            aria-pressed={filter === s}
            className={`text-left rounded-xl border p-4 transition-colors cursor-pointer bg-zinc-900 ${
              filter === s
                ? 'border-zinc-500'
                : 'border-zinc-800 hover:border-zinc-700'
            }`}
          >
            <div className="text-xs font-medium uppercase tracking-wider text-zinc-500">
              {SEVERITY_LABELS[s]}
            </div>
            <div
              className={`mt-1 text-2xl font-bold tabular-nums ${
                summary.counts[s] > 0 ? SEVERITY_TEXT[s] : 'text-zinc-600'
              }`}
              data-testid={`count-${s}`}
            >
              {summary.counts[s]}
            </div>
          </button>
        ))}
      </div>

      <Card className="p-4 grid gap-4 sm:grid-cols-3 text-sm">
        <div>
          <div className="text-xs uppercase tracking-wider text-zinc-500">
            Hosts
          </div>
          <div className="mt-1 text-zinc-200">
            {summary.totalHosts} total, {summary.letsEncryptHosts} on Let's
            Encrypt
          </div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wider text-zinc-500">
            Earliest expiry
          </div>
          <div className="mt-1 text-zinc-200">
            {summary.earliestExpiry ? (
              <>
                {summary.earliestExpiry.host} on{' '}
                {formatDate(summary.earliestExpiry.notAfter)}
              </>
            ) : (
              <span className="text-zinc-500">None yet</span>
            )}
          </div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wider text-zinc-500">
            Issuers
          </div>
          <ul className="mt-1 text-zinc-200">
            {summary.issuers.length === 0 && (
              <li className="text-zinc-500">None yet</li>
            )}
            {summary.issuers.slice(0, 4).map((i) => (
              <li key={i.issuer} className="flex justify-between gap-2">
                <span className="truncate">{i.issuer}</span>
                <span className="tabular-nums text-zinc-500">{i.count}</span>
              </li>
            ))}
            {summary.issuers.length > 4 && (
              <li className="text-zinc-500">
                +{summary.issuers.length - 4} more
              </li>
            )}
          </ul>
        </div>
      </Card>

      <div
        className="flex flex-wrap items-center gap-2"
        role="group"
        aria-label="Filter by severity"
      >
        {(['all', ...REPORT_SEVERITIES] as Filter[]).map((f) => (
          <Button
            key={f}
            size="sm"
            variant={filter === f ? 'secondary' : 'ghost'}
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
          >
            {f === 'all' ? `All (${report.hosts.length})` : SEVERITY_LABELS[f]}
          </Button>
        ))}
      </div>

      <Card className="p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <tr>
              {sortHead('host', 'Host')}
              {sortHead('severity', 'Status')}
              {sortHead('daysLeft', 'Days left')}
              {sortHead('issuer', 'Issuer')}
              <TableHead>Problems</TableHead>
            </tr>
          </TableHeader>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-zinc-500">
                  No hosts match this filter.
                </td>
              </tr>
            )}
            {rows.map((h) => (
              <TableRow key={`${h.host}:${h.port}`}>
                <TableCell className="font-mono text-xs text-zinc-200 break-all">
                  {hostLabel(h)}
                  {h.tlsVersion && (
                    <div className="text-zinc-500 font-sans">
                      {h.tlsVersion}
                      {h.keyType &&
                        `, ${h.keyType}${h.keySize ? ` ${h.keySize}` : ''}`}
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  {h.severity ? (
                    <Badge variant={SEVERITY_BADGE[h.severity]}>
                      {SEVERITY_LABELS[h.severity]}
                    </Badge>
                  ) : (
                    <Badge variant="neutral">Pending</Badge>
                  )}
                </TableCell>
                <TableCell>
                  <DaysLeft host={h} />
                </TableCell>
                <TableCell className="text-zinc-400">
                  {h.issuerName ?? <span className="text-zinc-600">-</span>}
                </TableCell>
                <TableCell className="text-zinc-400">
                  {h.problems.length === 0 ? (
                    <span className="text-zinc-600">
                      {h.severity ? 'None' : '-'}
                    </span>
                  ) : (
                    <ul className="flex flex-col gap-0.5">
                      {h.problems.map((p) => (
                        <li key={p.code} className={SEVERITY_TEXT[p.severity]}>
                          {p.message}
                        </li>
                      ))}
                    </ul>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
