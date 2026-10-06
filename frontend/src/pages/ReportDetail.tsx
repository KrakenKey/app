import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Copy, Link2, Trash2, X } from 'lucide-react';
import type { Report } from '@krakenkey/shared';
import {
  createShareLink,
  csvFilename,
  deleteReport,
  downloadReportCsv,
  fetchReport,
  revokeShareLink,
} from '../services/reportService';
import { Button, Card } from '../components/ui';
import { ReportView } from '../components/reports/ReportView';
import { formatDate } from '../components/reports/severity';
import { copyToClipboard } from '../utils/clipboard';
import { toast } from '../utils/toast';

const POLL_MS = 3000;

function SharePanel({
  report,
  onChange,
}: {
  report: Report;
  onChange: () => Promise<void>;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    try {
      setBusy(true);
      const res = await createShareLink(report.id);
      setUrl(res.url);
      copyToClipboard(res.url);
      await onChange();
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    try {
      setBusy(true);
      await revokeShareLink(report.id);
      setUrl(null);
      toast.success('Share link revoked');
      await onChange();
    } finally {
      setBusy(false);
    }
  };

  if (!report.share) {
    return (
      <Card className="p-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-zinc-400">
          Share a read-only copy with anyone who has the link, no login needed.
          Links expire after 30 days.
        </p>
        <Button
          size="sm"
          variant="primary"
          disabled={busy}
          icon={<Link2 className="w-3.5 h-3.5" />}
          onClick={create}
        >
          Share
        </Button>
      </Card>
    );
  }

  return (
    <Card className="p-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-zinc-300">
          Shared link active until{' '}
          <span className="font-medium">
            {formatDate(report.share.expiresAt)}
          </span>
          .
        </p>
        <div className="flex gap-2">
          {!url && (
            <Button size="sm" disabled={busy} onClick={create}>
              New link
            </Button>
          )}
          <Button
            size="sm"
            variant="danger"
            disabled={busy}
            icon={<X className="w-3.5 h-3.5" />}
            onClick={revoke}
          >
            Revoke
          </Button>
        </div>
      </div>
      {url ? (
        <div className="flex gap-2">
          <input
            readOnly
            value={url}
            aria-label="Share link"
            onFocus={(e) => e.target.select()}
            className="flex-1 min-w-0 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 font-mono text-xs text-zinc-200"
          />
          <Button
            size="sm"
            icon={<Copy className="w-3.5 h-3.5" />}
            onClick={() => copyToClipboard(url)}
          >
            Copy
          </Button>
        </div>
      ) : (
        <p className="text-xs text-zinc-500">
          The link is only shown when it is created. Use New link to get a fresh
          one; the old link stops working.
        </p>
      )}
    </Card>
  );
}

export default function ReportDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [report, setReport] = useState<Report | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Bumped to refetch after a share change.
  const [version, setVersion] = useState(0);
  const reload = useCallback(async () => setVersion((v) => v + 1), []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const data = await fetchReport(id);
        if (cancelled) return;
        setReport(data);
        if (data.status === 'pending' || data.status === 'running') {
          timer = setTimeout(load, POLL_MS);
        }
      } catch {
        if (!cancelled) setNotFound(true);
      }
    };
    void load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [id, version]);

  const handleDelete = async () => {
    await deleteReport(id);
    toast.success('Report deleted');
    navigate('/dashboard/reports');
  };

  const back = (
    <Link
      to="/dashboard/reports"
      className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-100 mb-6"
    >
      <ArrowLeft className="w-4 h-4" />
      All reports
    </Link>
  );

  if (notFound) {
    return (
      <div>
        {back}
        <p className="text-sm text-zinc-400">This report does not exist.</p>
      </div>
    );
  }
  if (!report) {
    return <div className="text-sm text-zinc-500">Loading report...</div>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>{back}</div>
      <ReportView
        report={report}
        onDownloadCsv={() =>
          void downloadReportCsv(
            report.id,
            csvFilename(report.name, report.createdAt),
          ).catch(() => toast.error('Download failed'))
        }
        actions={
          confirmDelete ? (
            <>
              <Button size="sm" variant="danger" onClick={handleDelete}>
                Confirm delete
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setConfirmDelete(false)}
              >
                Cancel
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              icon={<Trash2 className="w-3.5 h-3.5" />}
              onClick={() => setConfirmDelete(true)}
            >
              Delete
            </Button>
          )
        }
      />
      <SharePanel report={report} onChange={reload} />
      <p className="text-xs text-zinc-500">
        This report is deleted on {formatDate(report.expiresAt)}.
      </p>
    </div>
  );
}
