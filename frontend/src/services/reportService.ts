import axios from 'axios';
import api, { API_URL } from './api';
import { API_ROUTES } from '@krakenkey/shared';
import type {
  CreateReportRequest,
  CreateReportShareResponse,
  PublicReport,
  Report,
  ReportListItem,
} from '@krakenkey/shared';

export async function fetchReports(): Promise<ReportListItem[]> {
  const response = await api.get<ReportListItem[]>(API_ROUTES.REPORTS.BASE);
  return response.data;
}

export async function fetchReport(id: string): Promise<Report> {
  const response = await api.get<Report>(API_ROUTES.REPORTS.BY_ID(id));
  return response.data;
}

export async function createReport(req: CreateReportRequest): Promise<Report> {
  const response = await api.post<Report>(API_ROUTES.REPORTS.BASE, req);
  return response.data;
}

export async function deleteReport(id: string): Promise<void> {
  await api.delete(API_ROUTES.REPORTS.BY_ID(id));
}

export async function createShareLink(
  id: string,
): Promise<CreateReportShareResponse> {
  const response = await api.post<CreateReportShareResponse>(
    API_ROUTES.REPORTS.SHARE(id),
  );
  return response.data;
}

export async function revokeShareLink(id: string): Promise<void> {
  await api.delete(API_ROUTES.REPORTS.SHARE(id));
}

/**
 * The shared view is public: it uses a bare client so a stale dashboard
 * token is never sent and a 404 does not trigger the global error toasts.
 */
const publicApi = axios.create({ baseURL: API_URL });

export async function fetchSharedReport(token: string): Promise<PublicReport> {
  const response = await publicApi.get<PublicReport>(
    API_ROUTES.REPORTS.PUBLIC(token),
  );
  return response.data;
}

async function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function filenameFrom(disposition: unknown, fallback: string): string {
  const match =
    typeof disposition === 'string' && disposition.match(/filename="([^"]+)"/);
  return match ? match[1] : fallback;
}

/** Filename for a report download, e.g. `client-sites-2026-10-05.csv`. */
export function csvFilename(name: string | null, createdAt: string): string {
  const slug = (name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${slug || 'tls-report'}-${createdAt.slice(0, 10)}.csv`;
}

export async function downloadReportCsv(
  id: string,
  filename: string,
): Promise<void> {
  const response = await api.get<Blob>(API_ROUTES.REPORTS.EXPORT(id), {
    params: { format: 'csv' },
    responseType: 'blob',
  });
  await saveBlob(
    response.data,
    filenameFrom(response.headers['content-disposition'], filename),
  );
}

export async function downloadSharedReportCsv(
  token: string,
  filename: string,
): Promise<void> {
  const response = await publicApi.get<Blob>(
    API_ROUTES.REPORTS.PUBLIC_EXPORT(token),
    { params: { format: 'csv' }, responseType: 'blob' },
  );
  await saveBlob(
    response.data,
    filenameFrom(response.headers['content-disposition'], filename),
  );
}

/** Splits the textarea into non-empty lines. */
export function hostLines(text: string): string[] {
  return text
    .split(/[\r\n,]+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/** Distinct host:port count, matching the API's dedupe for the counter. */
export function countDistinctHosts(lines: string[]): number {
  const keys = new Set(
    lines.map((l) => {
      const bare = l
        .toLowerCase()
        .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
        .replace(/[/?#].*$/, '')
        .replace(/\.$/, '');
      return /:\d+$/.test(bare) ? bare : `${bare}:443`;
    }),
  );
  return keys.size;
}
