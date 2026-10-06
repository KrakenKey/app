import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FileBarChart, Play } from 'lucide-react';
import axios from 'axios';
import {
  REPORT_HOST_LIMITS,
  REPORT_SEVERITIES,
  type ReportListItem,
  type SubscriptionPlan,
} from '@krakenkey/shared';
import { useAuth } from '../hooks/useAuth';
import {
  countDistinctHosts,
  createReport,
  fetchReports,
  hostLines,
} from '../services/reportService';
import {
  Button,
  Card,
  EmptyState,
  Input,
  PageHeader,
  Textarea,
} from '../components/ui';
import { ReportStatusBadge } from '../components/reports/ReportView';
import {
  SEVERITY_LABELS,
  SEVERITY_TEXT,
  formatDate,
} from '../components/reports/severity';

const POLL_MS = 4000;

function hostLimit(plan: string | undefined): number {
  return (
    REPORT_HOST_LIMITS[(plan ?? 'free') as SubscriptionPlan] ??
    REPORT_HOST_LIMITS.free
  );
}

export function ReportCounts({ report }: { report: ReportListItem }) {
  return (
    <div className="flex flex-wrap gap-3 text-xs">
      {REPORT_SEVERITIES.map((s) => (
        <span
          key={s}
          className={report.counts[s] > 0 ? SEVERITY_TEXT[s] : 'text-zinc-600'}
        >
          {report.counts[s]} {SEVERITY_LABELS[s].toLowerCase()}
        </span>
      ))}
    </div>
  );
}

export default function Reports() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [reports, setReports] = useState<ReportListItem[] | null>(null);
  const [hostsText, setHostsText] = useState('');
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const limit = hostLimit(user?.plan);
  const lines = hostLines(hostsText);
  const count = countDistinctHosts(lines);
  const overLimit = count > limit;

  const load = useCallback(async () => {
    try {
      setReports(await fetchReports());
    } catch {
      setReports((prev) => prev ?? []);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const anyRunning = reports?.some(
    (r) => r.status === 'pending' || r.status === 'running',
  );
  useEffect(() => {
    if (!anyRunning) return;
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [anyRunning, load]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (lines.length === 0) {
      setError('Add at least one hostname.');
      return;
    }
    if (overLimit) {
      setError(`Your plan allows ${limit} hosts per report.`);
      return;
    }
    try {
      setSubmitting(true);
      const report = await createReport({
        hosts: lines,
        ...(name.trim() ? { name: name.trim() } : {}),
      });
      navigate(`/dashboard/reports/${report.id}`);
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const msg = err.response?.data?.message;
        setError(Array.isArray(msg) ? msg.join('\n') : (msg ?? null));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Reports"
        description="Check TLS health across a list of sites: expiry, issuer, hostname coverage, chain problems and reachability."
        icon={<FileBarChart className="w-6 h-6" />}
      />

      <Card className="mb-8">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Textarea
            label="Hosts"
            id="report-hosts"
            rows={8}
            placeholder={'example.com\nshop.example.com\napi.example.com:8443'}
            value={hostsText}
            onChange={(e) => setHostsText(e.target.value)}
            className="font-mono"
            helpText="One hostname per line, optionally with :port (default 443)."
          />
          <div
            className={`-mt-2 text-xs ${overLimit ? 'text-red-400' : 'text-zinc-500'}`}
            data-testid="host-count"
          >
            {count} of {limit} hosts
            {overLimit && ' (over your plan limit)'}
          </div>
          <Input
            label="Name (optional)"
            id="report-name"
            maxLength={100}
            placeholder="Client sites, October"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          {error && (
            <p
              className="text-sm text-red-400 whitespace-pre-line"
              role="alert"
            >
              {error}
            </p>
          )}
          <div>
            <Button
              type="submit"
              variant="primary"
              disabled={submitting || count === 0 || overLimit}
              icon={<Play className="w-4 h-4" />}
            >
              {submitting ? 'Starting...' : 'Run report'}
            </Button>
          </div>
        </form>
      </Card>

      <h2 className="text-sm font-medium text-zinc-400 mb-3">Past reports</h2>
      {reports === null ? (
        <div className="text-sm text-zinc-500">Loading reports...</div>
      ) : reports.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FileBarChart className="w-8 h-8" />}
            title="No reports yet"
            description="Paste a list of hostnames above to run your first report. Reports are kept for 90 days."
          />
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {reports.map((r) => (
            <li key={r.id}>
              <Link
                to={`/dashboard/reports/${r.id}`}
                className="block rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 hover:border-zinc-700 transition-colors"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-zinc-100">
                    {r.name || 'TLS report'}
                  </span>
                  <div className="flex items-center gap-2 text-xs text-zinc-500">
                    <span>
                      {r.completedCount}/{r.hostCount} hosts
                    </span>
                    <ReportStatusBadge status={r.status} />
                  </div>
                </div>
                <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                  <ReportCounts report={r} />
                  <span className="text-xs text-zinc-500">
                    {formatDate(r.createdAt)}
                    {r.share && ' · shared'}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
