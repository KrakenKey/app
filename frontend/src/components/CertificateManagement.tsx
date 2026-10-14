import { useState, useEffect, useCallback, Fragment } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Shield,
  Plus,
  KeyRound,
  ArrowUp,
  ArrowDown,
  Download,
  Copy,
  RefreshCw,
  Ban,
  Trash2,
  Loader2,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Info,
} from 'lucide-react';
import { toast } from '../utils/toast';
import { CertStatus, MAX_REQUESTED_NAMES } from '@krakenkey/shared';
import type { TlsCert, TlsCertDetails } from '@krakenkey/shared';
import {
  STATUS_LABEL,
  STATUS_BADGE_VARIANT,
  STATUS_ORDER,
} from '../utils/statusMappings';
import { getCertDomains, parseNameList } from '../utils/certDomains';
import { getExpirationInfo } from '../utils/expiration';
import { copyToClipboard } from '../utils/clipboard';
import { downloadPem } from '../utils/download';
import { usePolling } from '../hooks/usePolling';
import { useActionSet } from '../hooks/useActionSet';
import { useConfirm } from '../hooks/useConfirm';
import * as certService from '../services/certificateService';
import CsrGenerator from './CsrGenerator';
import { CertificateDeployments } from './connectors/CertificateDeployments';
import { Card } from './ui/Card';
import { Modal } from './ui/Modal';
import { RowMenu, type MenuItem } from './ui/Menu';
import { fieldClass } from './ui/Input';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';
import { Textarea } from './ui/Textarea';
import { Table, TableHeader, TableRow, TableHead, TableCell } from './ui/Table';
import { PageHeader } from './ui/PageHeader';
import { EmptyState } from './ui/EmptyState';
import { Switch } from './ui/Switch';

const requestModeCardClass = (selected: boolean) =>
  `flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
    selected
      ? 'border-cyan-400/50 bg-cyan-400/[0.06] shadow-[inset_0_0_0_1px_rgb(34_211_238/0.15)]'
      : 'border-border-strong/70 hover:border-border-strong hover:bg-white/[0.02]'
  }`;

export default function CertificateManagement() {
  const [certs, setCerts] = useState<TlsCert[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [csrPem, setCsrPem] = useState('');
  const [showCsrGenerator, setShowCsrGenerator] = useState(false);
  const [viewMode, setViewMode] = useState<'card' | 'table'>('table');
  const [searchParams, setSearchParams] = useSearchParams();
  const [requestOpen, setRequestOpen] = useState(
    () => searchParams.get('request') === '1',
  );
  const [filter, setFilter] = useState<'all' | 'attention' | 'connector'>(
    'all',
  );
  const [requestMode, setRequestMode] = useState<'csr' | 'connector'>('csr');
  const [namesText, setNamesText] = useState('');
  const [namesError, setNamesError] = useState<string | null>(null);

  const pollingIds = useActionSet<number>();
  const confirm = useConfirm();
  const renewing = useActionSet<number>();
  const retrying = useActionSet<number>();
  const revoking = useActionSet<number>();
  const deleting = useActionSet<number>();
  const togglingAutoRenew = useActionSet<number>();

  const { add: addPollingId, remove: removePollingId } = pollingIds;

  const pollFn = useCallback(
    async (certId: number): Promise<boolean> => {
      try {
        const updated = await certService.fetchCertificate(certId);

        let wasRenewing = false;
        setCerts((prev) => {
          const previousCert = prev.find((c) => c.id === certId);
          wasRenewing = previousCert?.status === CertStatus.RENEWING;
          return prev.map((c) => (c.id === certId ? updated : c));
        });

        if (
          updated.status === CertStatus.ISSUED ||
          updated.status === CertStatus.FAILED
        ) {
          removePollingId(certId);
          if (updated.status === CertStatus.ISSUED) {
            toast.success(
              wasRenewing
                ? `Certificate #${certId} has been renewed!`
                : `Certificate #${certId} has been issued!`,
            );
          } else {
            toast.error(`Certificate #${certId} operation failed.`);
          }
          return true; // stop polling
        }
        return false;
      } catch (error) {
        console.error(`Polling error for cert #${certId}:`, error);
        removePollingId(certId);
        return true; // stop polling on error
      }
    },
    [removePollingId],
  );

  const polling = usePolling<number>(pollFn, 5000);

  const startPolling = useCallback(
    (certId: number) => {
      addPollingId(certId);
      polling.start(certId);
    },
    [addPollingId, polling],
  );

  const fetchCerts = useCallback(async () => {
    try {
      setLoading(true);
      const data = await certService.fetchCertificates();
      setCerts(data);
      data.forEach((cert) => {
        if (
          cert.status === CertStatus.PENDING ||
          cert.status === CertStatus.ISSUING ||
          cert.status === CertStatus.RENEWING
        ) {
          startPolling(cert.id);
        }
      });
    } catch (error) {
      console.error('Failed to fetch certificates:', error);
    } finally {
      setLoading(false);
    }
  }, [startPolling]);

  useEffect(() => {
    fetchCerts();
  }, [fetchCerts]);

  const handleSubmitCsr = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!csrPem.trim()) {
      toast.error('Please paste a PEM-encoded CSR');
      return;
    }

    try {
      setSubmitting(true);
      const response = await certService.submitCsr(csrPem.trim());
      toast.success(`Certificate request #${response.id} submitted!`);
      setCsrPem('');
      setRequestOpen(false);
      await fetchCerts();
    } catch (error) {
      console.error('Failed to submit CSR:', error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreatePending = async (e: React.FormEvent) => {
    e.preventDefault();
    const { names, invalid } = parseNameList(namesText);
    if (names.length === 0) {
      setNamesError('Enter at least one name.');
      return;
    }
    if (invalid.length > 0) {
      setNamesError(`Not a valid DNS name: ${invalid.join(', ')}`);
      return;
    }
    if (names.length > MAX_REQUESTED_NAMES) {
      setNamesError(`Enter at most ${MAX_REQUESTED_NAMES} names.`);
      return;
    }

    try {
      setSubmitting(true);
      const response = await certService.createPendingCertificate(names);
      toast.success(
        `Pending certificate #${response.id} created. Add id ${response.id} to the connector's config.`,
      );
      setNamesText('');
      setRequestOpen(false);
      await fetchCerts();
    } catch (error) {
      // The API client already shows the server's message.
      console.error('Failed to create pending certificate:', error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDownload = (cert: TlsCert) => {
    if (!cert.crtPem) return;
    downloadPem(cert.crtPem, `cert-${cert.id}.pem`);
  };

  const handleRenewCert = async (cert: TlsCert) => {
    try {
      renewing.add(cert.id);
      const response = await certService.renewCertificate(cert.id);
      toast.success(
        response.queued
          ? `Certificate #${cert.id} renewal queued. It starts when one of your other requests finishes.`
          : `Certificate #${cert.id} renewal initiated!`,
      );
      setCerts((prev) =>
        prev.map((c) =>
          c.id === cert.id
            ? { ...c, status: response.status as TlsCert['status'] }
            : c,
        ),
      );
      startPolling(cert.id);
    } catch (error) {
      console.error('Failed to renew certificate:', error);
    } finally {
      renewing.remove(cert.id);
    }
  };

  const handleRetryCert = async (cert: TlsCert) => {
    try {
      retrying.add(cert.id);
      const response = await certService.retryCertificate(cert.id);
      toast.success(`Certificate #${cert.id} retry initiated!`);
      setCerts((prev) =>
        prev.map((c) =>
          c.id === cert.id
            ? { ...c, status: response.status as TlsCert['status'] }
            : c,
        ),
      );
      startPolling(cert.id);
    } catch (error) {
      console.error('Failed to retry certificate:', error);
    } finally {
      retrying.remove(cert.id);
    }
  };

  const handleRevokeCert = async (cert: TlsCert) => {
    const ok = await confirm({
      title: 'Revoke certificate?',
      body: (
        <>
          <strong className="text-text">
            {getCertDomains(cert)[0] ?? 'Certificate'}
          </strong>{' '}
          (#{cert.id}) is revoked at the CA, and clients that check revocation
          stop trusting it. This cannot be undone.
        </>
      ),
      confirmLabel: 'Revoke certificate',
    });
    if (!ok) return;

    try {
      revoking.add(cert.id);
      const response = await certService.revokeCertificate(cert.id);
      toast.success(`Certificate #${cert.id} has been revoked.`);
      setCerts((prev) =>
        prev.map((c) =>
          c.id === cert.id
            ? { ...c, status: response.status as TlsCert['status'] }
            : c,
        ),
      );
    } catch (error) {
      console.error('Failed to revoke certificate:', error);
    } finally {
      revoking.remove(cert.id);
    }
  };

  const handleDeleteCert = async (cert: TlsCert) => {
    const ok = await confirm({
      title: 'Delete certificate?',
      body: (
        <>
          <strong className="text-text">
            {getCertDomains(cert)[0] ?? 'Certificate'}
          </strong>{' '}
          (#{cert.id}) is removed from your account. This cannot be undone.
        </>
      ),
      confirmLabel: 'Delete certificate',
    });
    if (!ok) return;

    try {
      deleting.add(cert.id);
      await certService.deleteCertificate(cert.id);
      toast.success(`Certificate #${cert.id} has been deleted.`);
      setCerts((prev) => prev.filter((c) => c.id !== cert.id));
    } catch (error) {
      console.error('Failed to delete certificate:', error);
    } finally {
      deleting.remove(cert.id);
    }
  };

  const handleToggleAutoRenew = async (cert: TlsCert) => {
    const newValue = !cert.autoRenew;
    togglingAutoRenew.add(cert.id);
    setCerts((prev) =>
      prev.map((c) => (c.id === cert.id ? { ...c, autoRenew: newValue } : c)),
    );
    try {
      await certService.updateCertificate(cert.id, { autoRenew: newValue });
    } catch (error) {
      console.error('Failed to toggle auto-renew:', error);
      setCerts((prev) =>
        prev.map((c) =>
          c.id === cert.id ? { ...c, autoRenew: cert.autoRenew } : c,
        ),
      );
      toast.error(`Failed to update auto-renew for certificate #${cert.id}`);
    } finally {
      togglingAutoRenew.remove(cert.id);
    }
  };

  const handleCsrGenerated = (generatedCsrPem: string) => {
    setCsrPem(generatedCsrPem);
    setShowCsrGenerator(false);
    toast.success('CSR populated! Review and submit when ready.');
  };

  const closeRequest = () => {
    setRequestOpen(false);
    setShowCsrGenerator(false);
    if (searchParams.has('request')) {
      searchParams.delete('request');
      setSearchParams(searchParams, { replace: true });
    }
  };

  const attentionCount = certs.filter(certNeedsAttention).length;
  const connectorCount = certs.filter(
    (c) => c.managedBy === 'connector',
  ).length;
  const visibleCerts = certs.filter((c) =>
    filter === 'attention'
      ? certNeedsAttention(c)
      : filter === 'connector'
        ? c.managedBy === 'connector'
        : true,
  );

  const requestButton = (
    <Button
      variant="primary"
      icon={<Plus className="w-4 h-4" />}
      onClick={() => setRequestOpen(true)}
    >
      Request certificate
    </Button>
  );

  if (loading) {
    return (
      <div>
        <PageHeader
          title="Certificates"
          icon={<Shield className="w-6 h-6" />}
        />
        <p className="text-zinc-400">Loading certificates...</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Certificates"
        description="Every certificate on your account, its expiry, and how it renews."
        icon={<Shield className="w-6 h-6" />}
        actions={
          <>
            <Button
              variant="secondary"
              icon={<KeyRound className="w-4 h-4" />}
              onClick={() => {
                setRequestMode('csr');
                setShowCsrGenerator(true);
                setRequestOpen(true);
              }}
            >
              Generate New CSR
            </Button>
            {requestButton}
          </>
        }
      />

      {/* Request a certificate (modal) */}
      <Modal
        open={requestOpen}
        onClose={closeRequest}
        title="Request a Certificate"
        description="The private key stays with you: in this browser, on your own machine, or on a connector's server."
        size="xl"
      >
        <fieldset disabled={submitting} className="mb-5">
          <legend className="sr-only">How the key is created</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className={requestModeCardClass(requestMode === 'csr')}>
              <input
                type="radio"
                name="cert-request-mode"
                value="csr"
                checked={requestMode === 'csr'}
                onChange={() => setRequestMode('csr')}
                className="mt-0.5"
              />
              <span>
                <span className="block text-sm font-medium text-zinc-100">
                  With a CSR
                </span>
                <span className="block text-xs text-zinc-400 mt-0.5">
                  Generate a key and CSR in your browser, or paste a CSR you
                  made yourself.
                </span>
              </span>
            </label>
            <label
              className={requestModeCardClass(requestMode === 'connector')}
            >
              <input
                type="radio"
                name="cert-request-mode"
                value="connector"
                checked={requestMode === 'connector'}
                onChange={() => {
                  setRequestMode('connector');
                  setShowCsrGenerator(false);
                }}
                className="mt-0.5"
              />
              <span>
                <span className="block text-sm font-medium text-zinc-100">
                  Issued by a connector
                </span>
                <span className="block text-xs text-zinc-400 mt-0.5">
                  Give the names. A connector creates the key on its own server
                  and issues the certificate.
                </span>
              </span>
            </label>
          </div>
        </fieldset>

        {requestMode === 'connector' ? (
          <form
            onSubmit={handleCreatePending}
            aria-label="Create pending certificate"
            className="space-y-4"
          >
            <Textarea
              id="pending-cert-names"
              label="Names"
              placeholder={'app.example.com\nwww.example.com'}
              rows={4}
              value={namesText}
              onChange={(e) => {
                setNamesText(e.target.value);
                setNamesError(null);
              }}
              disabled={submitting}
              error={namesError ?? undefined}
              aria-invalid={namesError ? true : undefined}
              helpText={`One per line, or separated by commas. Wildcards such as *.example.com are allowed. Each name must be on one of your verified domains. Up to ${MAX_REQUESTED_NAMES}.`}
              className="font-mono"
            />
            <p className="text-xs text-zinc-400 flex items-start gap-2 rounded-lg border border-border-subtle bg-bg/40 p-3">
              <Info className="w-3.5 h-3.5 mt-0.5 shrink-0 text-violet-300" />
              <span>
                The certificate waits as Awaiting CSR. The connector creates the
                private key, which never leaves its server, and sends a CSR for
                exactly these names; its first pass issues the certificate.
                Nothing is sent to the CA until then. Add the certificate's id
                to the connector's config, and make sure the connector's
                restrictions cover it. A connector limited to the domain covers
                it automatically; otherwise add the certificate under Edit
                restrictions on the connector's page.
              </span>
            </p>
            <div className="flex justify-end">
              <Button type="submit" variant="primary" disabled={submitting}>
                {submitting ? 'Creating...' : 'Create Pending Certificate'}
              </Button>
            </div>
          </form>
        ) : showCsrGenerator ? (
          <CsrGenerator
            onCsrGenerated={handleCsrGenerated}
            onCancel={() => setShowCsrGenerator(false)}
          />
        ) : (
          <form onSubmit={handleSubmitCsr} className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label
                htmlFor="csr-pem"
                className="text-sm font-medium text-zinc-300"
              >
                Certificate signing request
              </label>
              <Button
                variant="secondary"
                size="sm"
                icon={<KeyRound className="w-3.5 h-3.5" />}
                onClick={() => setShowCsrGenerator(true)}
                disabled={submitting}
              >
                Generate New CSR
              </Button>
            </div>
            <textarea
              id="csr-pem"
              className={`${fieldClass} w-full font-mono text-[13px] resize-y`}
              placeholder={
                '-----BEGIN CERTIFICATE REQUEST-----\nPaste your PEM-encoded CSR here...\n-----END CERTIFICATE REQUEST-----'
              }
              value={csrPem}
              onChange={(e) => setCsrPem(e.target.value)}
              disabled={submitting}
              rows={7}
            />
            <p className="text-xs text-zinc-400">
              Paste an existing CSR, or generate a new key and CSR in this
              browser. Issuance usually takes 2 to 5 minutes.
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" onClick={closeRequest}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={submitting}>
                {submitting ? 'Submitting...' : 'Submit CSR'}
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* Certificates List */}
      {certs.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Shield className="w-6 h-6" />}
            title="No certificates yet"
            description="Request your first certificate with a CSR, or let a connector create the key."
            action={requestButton}
          />
        </Card>
      ) : (
        <Card flush>
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-border-subtle">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h3 className="text-sm font-semibold text-zinc-100 whitespace-nowrap">
                Your Certificates ({certs.length})
              </h3>
              <div
                role="group"
                aria-label="Filter certificates"
                className="flex items-center gap-1"
              >
                {(
                  [
                    ['all', 'All', certs.length],
                    ['attention', 'Needs attention', attentionCount],
                    ['connector', 'Connector', connectorCount],
                  ] as const
                ).map(([key, label, n]) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={filter === key}
                    onClick={() => setFilter(key)}
                    className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                      filter === key
                        ? 'bg-white/[0.07] text-zinc-100'
                        : 'text-zinc-400 hover:text-zinc-100'
                    }`}
                  >
                    {label}
                    <span className="tnum text-zinc-500">{n}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="flex rounded-lg border border-border-strong/70 p-0.5">
              {(['table', 'card'] as const).map((mode) => (
                <button
                  key={mode}
                  className={`px-2.5 h-6 rounded-md text-xs cursor-pointer transition-colors ${viewMode === mode ? 'bg-white/[0.08] text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}`}
                  onClick={() => setViewMode(mode)}
                >
                  {mode === 'table' ? 'Table' : 'Cards'}
                </button>
              ))}
            </div>
          </div>

          {visibleCerts.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-zinc-400">
              No certificates match this filter.
            </p>
          ) : viewMode === 'card' ? (
            <div className="space-y-4 p-4 sm:p-5">
              {visibleCerts.map((cert) => (
                <CertCard
                  key={cert.id}
                  cert={cert}
                  isPolling={pollingIds.has(cert.id)}
                  isRenewing={renewing.has(cert.id)}
                  isRetrying={retrying.has(cert.id)}
                  isRevoking={revoking.has(cert.id)}
                  isDeleting={deleting.has(cert.id)}
                  isTogglingAutoRenew={togglingAutoRenew.has(cert.id)}
                  onDownload={handleDownload}
                  onCopy={copyToClipboard}
                  onRenew={handleRenewCert}
                  onRetry={handleRetryCert}
                  onRevoke={handleRevokeCert}
                  onDelete={handleDeleteCert}
                  onToggleAutoRenew={handleToggleAutoRenew}
                />
              ))}
            </div>
          ) : (
            <CertTable
              certs={visibleCerts}
              pollingIds={pollingIds.ids}
              renewingIds={renewing.ids}
              retryingIds={retrying.ids}
              revokingIds={revoking.ids}
              deletingIds={deleting.ids}
              togglingAutoRenewIds={togglingAutoRenew.ids}
              onDownload={handleDownload}
              onCopy={copyToClipboard}
              onRenew={handleRenewCert}
              onRetry={handleRetryCert}
              onRevoke={handleRevokeCert}
              onDelete={handleDeleteCert}
              onToggleAutoRenew={handleToggleAutoRenew}
            />
          )}
        </Card>
      )}
    </div>
  );
}

/** Failed, expiring within 30 days, or waiting on someone. */
function certNeedsAttention(cert: TlsCert): boolean {
  if (cert.status === CertStatus.FAILED) return true;
  if (cert.status !== CertStatus.ISSUED) return false;
  const exp = getExpirationInfo(cert);
  return !!exp && exp.daysUntilExpiry <= 30;
}

function shortDate(d: Date | string): string {
  return new Date(d).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** Expiry as "Dec 12, 2026" plus days left; only near expiry is colored. */
function ExpiryText({ cert }: { cert: TlsCert }) {
  if (cert.status === CertStatus.REVOKED && cert.revokedAt) {
    return (
      <span className="text-zinc-400 whitespace-nowrap">
        Revoked {shortDate(cert.revokedAt)}
      </span>
    );
  }
  const exp = getExpirationInfo(cert);
  if (!exp) return <span className="text-zinc-600">&mdash;</span>;
  const tone = exp.isExpired
    ? 'text-red-300'
    : exp.daysUntilExpiry <= 7
      ? 'text-red-300'
      : exp.daysUntilExpiry <= 30
        ? 'text-amber-300'
        : 'text-zinc-500';
  return (
    <span className="whitespace-nowrap tnum">
      <span className="text-zinc-200">{shortDate(exp.expiresAt)}</span>{' '}
      <span className={tone}>
        {exp.isExpired ? '(Expired)' : `(${exp.daysUntilExpiry}d)`}
      </span>
    </span>
  );
}

function AutoRenewSwitch({
  cert,
  disabled,
  onToggle,
  long = false,
}: {
  cert: TlsCert;
  disabled: boolean;
  onToggle: (cert: TlsCert) => void;
  long?: boolean;
}) {
  const on = cert.autoRenew;
  return (
    <Switch
      checked={on}
      disabled={disabled}
      onChange={() => onToggle(cert)}
      label={long ? (on ? 'Enabled' : 'Disabled') : on ? 'On' : 'Off'}
    />
  );
}

interface CertActionProps {
  cert: TlsCert;
  isRenewing: boolean;
  isRetrying: boolean;
  isRevoking: boolean;
  isDeleting: boolean;
  onDownload: (cert: TlsCert) => void;
  onCopy: (text: string) => void;
  onRenew: (cert: TlsCert) => void;
  onRetry: (cert: TlsCert) => void;
  onRevoke: (cert: TlsCert) => void;
  onDelete: (cert: TlsCert) => void;
}

/**
 * Row actions: the one action that moves the certificate forward (Renew,
 * Retry), Download, then everything else, destructive ones last, in the
 * overflow menu.
 */
function CertActions({
  cert,
  isRenewing,
  isRetrying,
  isRevoking,
  isDeleting,
  onDownload,
  onCopy,
  onRenew,
  onRetry,
  onRevoke,
  onDelete,
}: CertActionProps) {
  const name = getCertDomains(cert)[0] ?? `#${cert.id}`;
  const usable = !!cert.crtPem && cert.status !== CertStatus.REVOKED;
  const menu: MenuItem[] = [];
  // On narrow screens the inline buttons are hidden; the menu has them.
  if (cert.status === CertStatus.ISSUED) {
    menu.push({
      label: isRenewing ? 'Renewing...' : 'Renew',
      icon: <RefreshCw className="w-3.5 h-3.5" />,
      onClick: () => onRenew(cert),
      disabled: isRenewing || isRevoking,
      className: 'sm:hidden',
    });
  }
  if (cert.status === CertStatus.FAILED) {
    menu.push({
      label: isRetrying ? 'Retrying...' : 'Retry',
      icon: <RefreshCw className="w-3.5 h-3.5" />,
      onClick: () => onRetry(cert),
      disabled: isRetrying || isDeleting,
      className: 'sm:hidden',
    });
  }
  if (usable) {
    menu.push({
      label: 'Download',
      icon: <Download className="w-3.5 h-3.5" />,
      onClick: () => onDownload(cert),
      className: 'sm:hidden',
    });
  }
  if (usable) {
    menu.push({
      label: 'Copy PEM',
      icon: <Copy className="w-3.5 h-3.5" />,
      onClick: () => onCopy(cert.crtPem!),
    });
  }
  if (cert.status === CertStatus.ISSUED) {
    menu.push({
      label: isRevoking ? 'Revoking...' : 'Revoke',
      icon: <Ban className="w-3.5 h-3.5" />,
      onClick: () => onRevoke(cert),
      danger: true,
      disabled: isRevoking || isRenewing,
    });
  }
  if (
    cert.status === CertStatus.FAILED ||
    cert.status === CertStatus.REVOKED ||
    cert.status === CertStatus.AWAITING_CSR
  ) {
    menu.push({
      label: isDeleting ? 'Deleting...' : 'Delete',
      icon: <Trash2 className="w-3.5 h-3.5" />,
      onClick: () => onDelete(cert),
      danger: true,
      disabled: isDeleting || isRetrying,
    });
  }

  return (
    <div className="flex items-center justify-end gap-1.5">
      <div className="hidden sm:flex items-center gap-1.5">
        {cert.status === CertStatus.ISSUED && (
          <Button
            size="sm"
            variant="secondary"
            icon={<RefreshCw className="w-3.5 h-3.5" />}
            onClick={() => onRenew(cert)}
            disabled={isRenewing || isRevoking}
          >
            {isRenewing ? 'Renewing...' : 'Renew'}
          </Button>
        )}
        {cert.status === CertStatus.FAILED && (
          <Button
            size="sm"
            variant="secondary"
            icon={<RefreshCw className="w-3.5 h-3.5" />}
            onClick={() => onRetry(cert)}
            disabled={isRetrying || isDeleting}
          >
            {isRetrying ? 'Retrying...' : 'Retry'}
          </Button>
        )}
        {usable && (
          <Button
            size="sm"
            variant="ghost"
            icon={<Download className="w-3.5 h-3.5" />}
            onClick={() => onDownload(cert)}
          >
            Download
          </Button>
        )}
      </div>
      <RowMenu items={menu} label={`More actions for ${name}`} />
    </div>
  );
}

/* ── Details panel (card body and expanded table row) ──────────────────── */

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3 py-1">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="text-zinc-200 min-w-0 break-words">{children}</dd>
    </div>
  );
}

function CertDetailsPanel({
  cert,
  isTogglingAutoRenew,
  onToggleAutoRenew,
}: {
  cert: TlsCert;
  isTogglingAutoRenew: boolean;
  onToggleAutoRenew: (cert: TlsCert) => void;
}) {
  const [showPem, setShowPem] = useState(false);
  const [showCertDetails, setShowCertDetails] = useState(false);
  const [certDetails, setCertDetails] = useState<TlsCertDetails | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const domains = getCertDomains(cert);
  const expirationInfo = getExpirationInfo(cert);
  const revoked = cert.status === CertStatus.REVOKED;

  const fetchCertDetails = useCallback(async () => {
    if (certDetails || loadingDetails) return;
    setLoadingDetails(true);
    try {
      const details = await certService.fetchCertificateDetails(cert.id);
      setCertDetails(details);
    } catch {
      toast.error('Failed to load certificate details');
    } finally {
      setLoadingDetails(false);
    }
  }, [cert.id, certDetails, loadingDetails]);

  const handleToggleCertDetails = () => {
    const next = !showCertDetails;
    setShowCertDetails(next);
    if (next && !certDetails) fetchCertDetails();
  };

  const toggleClass =
    'flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-100 transition-colors cursor-pointer bg-transparent border-none p-0';

  return (
    <div className="text-sm">
      <dl>
        <DetailRow label="ID">
          <span className="tnum">#{cert.id}</span>
        </DetailRow>
        {domains.length > 0 && (
          <DetailRow label="Domains">{domains.join(', ')}</DetailRow>
        )}
        {cert.managedBy === 'connector' && (
          <DetailRow label="Managed by">
            A connector, which renews it with its own keys
          </DetailRow>
        )}
        {cert.status === CertStatus.AWAITING_CSR && (
          <DetailRow label="State">
            Awaiting CSR from connector. The connector creates the key and sends
            a CSR for these names; nothing is sent to the CA until then.
          </DetailRow>
        )}
        {cert.status === CertStatus.FAILED && cert.failureReason && (
          <DetailRow label="Reason">
            <span className="text-red-300">{cert.failureReason}</span>
          </DetailRow>
        )}
        {expirationInfo && !revoked && (
          <DetailRow label="Expiration">
            <ExpiryText cert={cert} />
          </DetailRow>
        )}
        {cert.lastRenewedAt && (
          <DetailRow label="Last renewed">
            {shortDate(cert.lastRenewedAt)}
          </DetailRow>
        )}
        {cert.revokedAt && (
          <DetailRow label="Revoked">{shortDate(cert.revokedAt)}</DetailRow>
        )}
        {cert.renewalCount > 0 && (
          <DetailRow label="Renewals">
            <span className="tnum">{cert.renewalCount}</span>
          </DetailRow>
        )}
        {cert.status !== CertStatus.AWAITING_CSR && !revoked && (
          <DetailRow label="Auto-renew">
            <AutoRenewSwitch
              cert={cert}
              disabled={isTogglingAutoRenew}
              onToggle={onToggleAutoRenew}
              long
            />
          </DetailRow>
        )}
      </dl>

      {cert.managedBy === 'connector' && (
        <CertificateDeployments certificateId={cert.id} />
      )}

      {cert.crtPem && !revoked && (
        <div className="border-t border-border-subtle pt-3 mt-3">
          <button onClick={handleToggleCertDetails} className={toggleClass}>
            {showCertDetails ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
            Certificate Details
          </button>
          {showCertDetails &&
            (loadingDetails ? (
              <p className="text-sm text-zinc-500 mt-2">Loading details...</p>
            ) : certDetails ? (
              <dl className="mt-2">
                <DetailRow label="Serial number">
                  <span className="font-mono text-xs">
                    {certDetails.serialNumber}
                  </span>
                </DetailRow>
                <DetailRow label="Issuer">{certDetails.issuer}</DetailRow>
                <DetailRow label="Subject">{certDetails.subject}</DetailRow>
                <DetailRow label="Valid from">
                  {shortDate(certDetails.validFrom)}
                </DetailRow>
                <DetailRow label="Valid to">
                  {shortDate(certDetails.validTo)}
                </DetailRow>
                <DetailRow label="Key type">
                  {certDetails.keyType} {certDetails.keySize}-bit
                </DetailRow>
                <DetailRow label="Fingerprint">
                  <span className="font-mono text-xs">
                    {certDetails.fingerprint}
                  </span>
                </DetailRow>
              </dl>
            ) : null)}
        </div>
      )}

      {cert.crtPem && !revoked && (
        <div className="border-t border-border-subtle pt-3 mt-3">
          <button onClick={() => setShowPem(!showPem)} className={toggleClass}>
            {showPem ? (
              <EyeOff className="w-4 h-4" />
            ) : (
              <Eye className="w-4 h-4" />
            )}
            {showPem ? 'Hide' : 'View'} certificate PEM
          </button>
          {showPem && (
            <pre className="mt-2 bg-bg border border-border-subtle rounded-lg p-4 font-mono text-xs text-zinc-400 overflow-auto max-h-48">
              {cert.crtPem}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function CertName({ cert, polling }: { cert: TlsCert; polling: boolean }) {
  const domains = getCertDomains(cert);
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        <span className="font-medium text-zinc-100 truncate">
          {domains.length > 0 ? domains[0] : `Certificate #${cert.id}`}
        </span>
        {domains.length > 1 && (
          <span
            className="shrink-0 text-xs text-zinc-500 tnum"
            title={domains.slice(1).join(', ')}
          >
            +{domains.length - 1}
          </span>
        )}
        {polling && (
          <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin text-violet-300" />
        )}
      </div>
      {cert.status === CertStatus.AWAITING_CSR ? (
        <div className="text-xs text-zinc-500">Awaiting CSR from connector</div>
      ) : (
        cert.managedBy === 'connector' && (
          <div className="text-xs text-zinc-500">Managed by a connector</div>
        )
      )}
    </div>
  );
}

// Certificate Card Component
interface CertCardProps {
  cert: TlsCert;
  isPolling: boolean;
  isRenewing: boolean;
  isRetrying: boolean;
  isRevoking: boolean;
  isDeleting: boolean;
  isTogglingAutoRenew: boolean;
  onDownload: (cert: TlsCert) => void;
  onCopy: (text: string) => void;
  onRenew: (cert: TlsCert) => void;
  onRetry: (cert: TlsCert) => void;
  onRevoke: (cert: TlsCert) => void;
  onDelete: (cert: TlsCert) => void;
  onToggleAutoRenew: (cert: TlsCert) => void;
}

function CertCard(props: CertCardProps) {
  const { cert, isPolling, isTogglingAutoRenew, onToggleAutoRenew } = props;
  const domains = getCertDomains(cert);
  return (
    <div className="rounded-xl border border-border-subtle bg-bg/40 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-3 min-w-0">
          <h4 className="text-base font-medium text-zinc-100 truncate">
            {domains.length > 0 ? domains[0] : `Certificate #${cert.id}`}
          </h4>
          <Badge variant={STATUS_BADGE_VARIANT[cert.status]} dot>
            {STATUS_LABEL[cert.status] || cert.status}
            {isPolling && (
              <Loader2 className="w-3 h-3 ml-1 inline animate-spin" />
            )}
          </Badge>
        </div>
        <CertActions {...props} />
      </div>
      <CertDetailsPanel
        cert={cert}
        isTogglingAutoRenew={isTogglingAutoRenew}
        onToggleAutoRenew={onToggleAutoRenew}
      />
    </div>
  );
}

// Certificate Table Component
type SortField = 'cn' | 'status' | 'expiry' | 'autoRenew';

interface CertTableProps {
  certs: TlsCert[];
  pollingIds: Set<number>;
  renewingIds: Set<number>;
  retryingIds: Set<number>;
  revokingIds: Set<number>;
  deletingIds: Set<number>;
  togglingAutoRenewIds: Set<number>;
  onDownload: (cert: TlsCert) => void;
  onCopy: (text: string) => void;
  onRenew: (cert: TlsCert) => void;
  onRetry: (cert: TlsCert) => void;
  onRevoke: (cert: TlsCert) => void;
  onDelete: (cert: TlsCert) => void;
  onToggleAutoRenew: (cert: TlsCert) => void;
}

function CertTable({
  certs,
  pollingIds,
  renewingIds,
  retryingIds,
  revokingIds,
  deletingIds,
  togglingAutoRenewIds,
  onToggleAutoRenew,
  ...handlers
}: CertTableProps) {
  const [sortField, setSortField] = useState<SortField>('cn');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const sorted = [...certs].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1;
    switch (sortField) {
      case 'cn': {
        const aCn = getCertDomains(a)[0] || '';
        const bCn = getCertDomains(b)[0] || '';
        return dir * aCn.localeCompare(bCn);
      }
      case 'status':
        return (
          dir *
          ((STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99))
        );
      case 'expiry': {
        const aTime = a.expiresAt ? new Date(a.expiresAt).getTime() : Infinity;
        const bTime = b.expiresAt ? new Date(b.expiresAt).getTime() : Infinity;
        return dir * (aTime - bTime);
      }
      case 'autoRenew':
        return dir * (Number(b.autoRenew) - Number(a.autoRenew));
      default:
        return 0;
    }
  });

  const sortHead = (field: SortField, label: string, className = '') => (
    <TableHead
      className={`cursor-pointer select-none hover:text-zinc-300 ${className}`}
      onClick={() => handleSort(field)}
      aria-sort={
        sortField === field
          ? sortDir === 'asc'
            ? 'ascending'
            : 'descending'
          : undefined
      }
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {sortField === field &&
          (sortDir === 'asc' ? (
            <ArrowUp className="w-3 h-3" />
          ) : (
            <ArrowDown className="w-3 h-3" />
          ))}
      </span>
    </TableHead>
  );

  return (
    <Table className="sm:min-w-[720px]">
      <TableHeader>
        <TableHead className="w-10 pl-5 pr-0" />
        {sortHead('cn', 'Common Name', 'pl-1')}
        {sortHead('status', 'Status', 'hidden sm:table-cell')}
        {sortHead('expiry', 'Expiry', 'hidden md:table-cell')}
        {sortHead('autoRenew', 'Auto-Renew', 'hidden lg:table-cell')}
        <TableHead className="text-right pr-5">Actions</TableHead>
      </TableHeader>
      <tbody>
        {sorted.map((cert) => {
          const expanded = expandedId === cert.id;
          return (
            <Fragment key={cert.id}>
              <TableRow
                className={`cursor-pointer ${expanded ? 'bg-white/[0.025]' : ''}`}
                onClick={() => setExpandedId(expanded ? null : cert.id)}
              >
                <TableCell className="w-10 pl-5 pr-0">
                  <button
                    type="button"
                    aria-label={expanded ? 'Hide details' : 'Show details'}
                    aria-expanded={expanded}
                    className="flex items-center text-zinc-500 hover:text-zinc-200 cursor-pointer"
                  >
                    {expanded ? (
                      <ChevronDown className="w-4 h-4" />
                    ) : (
                      <ChevronRight className="w-4 h-4" />
                    )}
                  </button>
                </TableCell>
                <TableCell className="pl-1 max-w-[230px] sm:max-w-[340px]">
                  <CertName cert={cert} polling={pollingIds.has(cert.id)} />
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs md:hidden">
                    <span className="sm:hidden">
                      <Badge variant={STATUS_BADGE_VARIANT[cert.status]} dot>
                        {STATUS_LABEL[cert.status] || cert.status}
                      </Badge>
                    </span>
                    <ExpiryText cert={cert} />
                  </div>
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  <Badge variant={STATUS_BADGE_VARIANT[cert.status]} dot>
                    {STATUS_LABEL[cert.status] || cert.status}
                  </Badge>
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <ExpiryText cert={cert} />
                </TableCell>
                <TableCell
                  className="hidden lg:table-cell"
                  onClick={(e) => e.stopPropagation()}
                >
                  {cert.status === CertStatus.AWAITING_CSR ||
                  cert.status === CertStatus.REVOKED ? (
                    <span className="text-zinc-600">&mdash;</span>
                  ) : (
                    <AutoRenewSwitch
                      cert={cert}
                      disabled={togglingAutoRenewIds.has(cert.id)}
                      onToggle={onToggleAutoRenew}
                    />
                  )}
                </TableCell>
                <TableCell
                  className="pr-5"
                  onClick={(e) => e.stopPropagation()}
                >
                  <CertActions
                    cert={cert}
                    isRenewing={renewingIds.has(cert.id)}
                    isRetrying={retryingIds.has(cert.id)}
                    isRevoking={revokingIds.has(cert.id)}
                    isDeleting={deletingIds.has(cert.id)}
                    {...handlers}
                  />
                </TableCell>
              </TableRow>
              {expanded && (
                <tr className="border-b border-border-subtle bg-bg/40">
                  <td className="hidden sm:table-cell" />
                  <td colSpan={5} className="pl-5 sm:pl-1 pr-5 py-4">
                    <CertDetailsPanel
                      cert={cert}
                      isTogglingAutoRenew={togglingAutoRenewIds.has(cert.id)}
                      onToggleAutoRenew={onToggleAutoRenew}
                    />
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </Table>
  );
}
