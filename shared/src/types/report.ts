import type { SubscriptionPlan } from './subscription';

/**
 * Most hosts one portfolio report may contain, per plan. The backend's
 * PLAN_LIMITS.reportHosts reads these, and the dashboard shows them next to
 * the host list.
 */
export const REPORT_HOST_LIMITS: Record<SubscriptionPlan, number> = {
  free: 25,
  starter: 250,
  team: 250,
  business: 250,
  enterprise: 250,
};

/** Reports are deleted this many days after they are created. */
export const REPORT_RETENTION_DAYS = 90;

/** A share link stops working this many days after it is created. */
export const REPORT_SHARE_TTL_DAYS = 30;

export type ReportStatus = 'pending' | 'running' | 'complete' | 'failed';

/** Per-host scan state. `error` means the scan itself could not run. */
export type ReportHostStatus = 'pending' | 'complete' | 'error';

export type ReportSeverity = 'critical' | 'warning' | 'notice' | 'ok';

export const REPORT_SEVERITIES: readonly ReportSeverity[] = [
  'critical',
  'warning',
  'notice',
  'ok',
] as const;

export type ReportProblemCode =
  | 'unreachable'
  | 'scan_failed'
  | 'no_certificate'
  | 'expired'
  | 'hostname_mismatch'
  | 'untrusted_chain'
  | 'incomplete_chain'
  | 'expires_soon'
  | 'old_tls'
  | 'weak_key'
  | 'expires_within_30_days';

export interface ReportProblem {
  code: ReportProblemCode;
  severity: Exclude<ReportSeverity, 'ok'>;
  message: string;
}

export interface ReportHostResult {
  host: string;
  port: number;
  status: ReportHostStatus;
  /** null while the host has not been scanned yet */
  severity: ReportSeverity | null;
  problems: ReportProblem[];
  reachable: boolean | null;
  error: string | null;
  tlsVersion: string | null;
  notAfter: string | null;
  daysLeft: number | null;
  /** Full issuer DN as presented by the server */
  issuer: string | null;
  /** Issuer organization, or its common name when there is none */
  issuerName: string | null;
  subject: string | null;
  sans: string[];
  hostnameCovered: boolean | null;
  trusted: boolean | null;
  chainDepth: number | null;
  keyType: string | null;
  keySize: number | null;
  letsEncrypt: boolean | null;
  scannedAt: string | null;
}

export interface ReportIssuerCount {
  issuer: string;
  count: number;
}

export interface ReportSummary {
  totalHosts: number;
  scannedHosts: number;
  counts: Record<ReportSeverity, number>;
  issuers: ReportIssuerCount[];
  letsEncryptHosts: number;
  earliestExpiry: {
    host: string;
    port: number;
    notAfter: string;
    daysLeft: number;
  } | null;
}

export interface ReportShareInfo {
  expiresAt: string;
  createdAt: string;
}

/** Row in GET /reports. */
export interface ReportListItem {
  id: string;
  name: string | null;
  status: ReportStatus;
  hostCount: number;
  completedCount: number;
  counts: Record<ReportSeverity, number>;
  share: ReportShareInfo | null;
  createdAt: string;
  completedAt: string | null;
  expiresAt: string;
}

/** GET /reports/:id. Hosts are sorted by severity, then days left. */
export interface Report extends Omit<ReportListItem, 'counts'> {
  summary: ReportSummary;
  hosts: ReportHostResult[];
}

/** GET /public/reports/:token. Holds no ids or owner details. */
export interface PublicReport {
  name: string | null;
  status: ReportStatus;
  hostCount: number;
  completedCount: number;
  createdAt: string;
  completedAt: string | null;
  shareExpiresAt: string;
  summary: ReportSummary;
  hosts: ReportHostResult[];
}

export interface CreateReportRequest {
  name?: string;
  /** Hostnames, optionally with :port (default 443). */
  hosts: string[];
}

export interface CreateReportShareResponse {
  url: string;
  token: string;
  expiresAt: string;
}
