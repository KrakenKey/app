export const REPORT_QUEUE = 'reportScan';

/** Report jobs one API instance works on at once. */
export const REPORT_JOB_CONCURRENCY = 2;

/** Hosts scanned in parallel within one report. */
export const HOST_CONCURRENCY = 5;

/** Per-host scanner timeout. The probe's own dial timeout is shorter. */
export const HOST_TIMEOUT_MS = 20_000;

/** Hard stop per host (DNS lookup included) if the scanner call hangs. */
export const HOST_DEADLINE_MS = HOST_TIMEOUT_MS + 5_000;

export interface ReportScanJob {
  reportId: string;
}
