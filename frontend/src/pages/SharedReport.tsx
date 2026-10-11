import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { PublicReport } from '@krakenkey/shared';
import {
  csvFilename,
  downloadSharedReportCsv,
  fetchSharedReport,
} from '../services/reportService';
import { Card } from '../components/ui';
import { ReportView } from '../components/reports/ReportView';
import { formatDate } from '../components/reports/severity';
import { toast } from '../utils/toast';
import '../components/reports/report-print.css';

const POLL_MS = 5000;

/** Read-only shared report at /r/:token. Works without login. */
export default function SharedReport() {
  const { token = '' } = useParams();
  const [report, setReport] = useState<PublicReport | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    // Keep the token out of Referer headers on any outbound request.
    const meta = document.createElement('meta');
    meta.name = 'referrer';
    meta.content = 'no-referrer';
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const data = await fetchSharedReport(token);
        if (cancelled) return;
        setReport(data);
        if (data.status === 'pending' || data.status === 'running') {
          timer = setTimeout(load, POLL_MS);
        }
      } catch {
        if (!cancelled) setMissing(true);
      }
    };
    void load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [token]);

  const generatedAt = report ? (report.completedAt ?? report.createdAt) : null;

  return (
    <div className="report-print min-h-screen bg-bg flex flex-col">
      <header className="border-b border-border bg-sidebar">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          <div className="flex items-center gap-2.5">
            <img src="/favicon.svg" alt="" className="w-9 h-9" />
            <span className="text-lg font-bold tracking-tight text-text">
              KrakenKey
            </span>
          </div>
          <div className="text-left sm:text-right">
            <h1 className="text-sm font-semibold text-text">
              Shared TLS report
            </h1>
            {generatedAt && (
              <p className="text-xs text-text-muted">
                Generated {formatDate(generatedAt)}
              </p>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-6xl mx-auto px-5 sm:px-8 py-8">
        {missing ? (
          <Card className="text-center">
            <h2 className="text-lg font-semibold text-zinc-100">
              This link has expired or was revoked
            </h2>
            <p className="mt-2 text-sm text-zinc-500">
              Ask the person who shared it for a new link.
            </p>
          </Card>
        ) : !report ? (
          <div className="text-sm text-zinc-500">Loading report...</div>
        ) : (
          <ReportView
            report={report}
            onDownloadCsv={() =>
              void downloadSharedReportCsv(
                token,
                csvFilename(report.name, report.createdAt),
              ).catch(() => toast.error('Download failed'))
            }
          />
        )}
      </main>

      <footer className="border-t border-border">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-xs text-text-muted">
          <p className="flex items-center gap-2">
            <img src="/favicon.svg" alt="" className="w-4 h-4" />
            <span>
              Generated with{' '}
              <a
                href="https://krakenkey.io"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-accent-text hover:text-accent-high"
              >
                KrakenKey
              </a>
            </span>
          </p>
          {report && !missing && (
            <p>
              Read-only view. This link expires on{' '}
              {formatDate(report.shareExpiresAt)}.
            </p>
          )}
        </div>
      </footer>
    </div>
  );
}
