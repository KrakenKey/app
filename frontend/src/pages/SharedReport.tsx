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

  return (
    <div className="min-h-screen bg-bg">
      <div className="max-w-5xl mx-auto px-6 py-8 lg:px-8">
        <div className="flex items-center gap-2.5 mb-8">
          <img src="/favicon.svg" alt="" className="w-6 h-6" />
          <span className="text-sm font-semibold text-zinc-300">
            Shared TLS report
          </span>
        </div>

        {missing ? (
          <Card className="text-center">
            <h1 className="text-lg font-semibold text-zinc-100">
              This link has expired or was revoked
            </h1>
            <p className="mt-2 text-sm text-zinc-500">
              Ask the person who shared it for a new link.
            </p>
          </Card>
        ) : !report ? (
          <div className="text-sm text-zinc-500">Loading report...</div>
        ) : (
          <>
            <ReportView
              report={report}
              onDownloadCsv={() =>
                void downloadSharedReportCsv(
                  token,
                  csvFilename(report.name, report.createdAt),
                ).catch(() => toast.error('Download failed'))
              }
            />
            <p className="mt-6 text-xs text-zinc-500">
              Read-only view. This link expires on{' '}
              {formatDate(report.shareExpiresAt)}.
            </p>
          </>
        )}

        <footer className="mt-10 border-t border-zinc-800 pt-4 text-xs text-zinc-500">
          Made with{' '}
          <a
            href="https://krakenkey.io"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:text-accent-hover"
          >
            KrakenKey
          </a>
        </footer>
      </div>
    </div>
  );
}
