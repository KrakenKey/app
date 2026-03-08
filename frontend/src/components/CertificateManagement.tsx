import { useState, useEffect, useCallback } from 'react';
import {
  Shield,
  Plus,
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
} from 'lucide-react';
import { toast } from '../utils/toast';
import { CertStatus } from '@krakenkey/shared';
import type { TlsCert, TlsCertDetails } from '@krakenkey/shared';
import {
  STATUS_LABEL,
  STATUS_BADGE_VARIANT,
  STATUS_ORDER,
} from '../utils/statusMappings';
import { getCertDomains } from '../utils/certDomains';
import { getExpirationInfo } from '../utils/expiration';
import { copyToClipboard } from '../utils/clipboard';
import { downloadPem } from '../utils/download';
import { usePolling } from '../hooks/usePolling';
import { useActionSet } from '../hooks/useActionSet';
import * as certService from '../services/certificateService';
import CsrGenerator from './CsrGenerator';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';
import { Table, TableHeader, TableRow, TableHead, TableCell } from './ui/Table';
import { PageHeader } from './ui/PageHeader';
import { EmptyState } from './ui/EmptyState';

export default function CertificateManagement() {
  const [certs, setCerts] = useState<TlsCert[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [csrPem, setCsrPem] = useState('');
  const [showCsrGenerator, setShowCsrGenerator] = useState(false);
  const [viewMode, setViewMode] = useState<'card' | 'table'>('card');

  const pollingIds = useActionSet<number>();
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
      await fetchCerts();
    } catch (error) {
      console.error('Failed to submit CSR:', error);
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
      toast.success(`Certificate #${cert.id} renewal initiated!`);
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
    if (
      !confirm(
        `Are you sure you want to revoke certificate #${cert.id}? This cannot be undone.`,
      )
    ) {
      return;
    }

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
    if (
      !confirm(
        `Are you sure you want to delete certificate #${cert.id}? This cannot be undone.`,
      )
    ) {
      return;
    }

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
        description="Submit CSR requests and manage your TLS certificates"
        icon={<Shield className="w-6 h-6" />}
      />

      {/* Submit CSR Form */}
      <Card className="mb-6">
        <h3 className="text-sm font-medium text-zinc-400 mb-4">
          Submit Certificate Signing Request
        </h3>

        {showCsrGenerator ? (
          <CsrGenerator
            onCsrGenerated={handleCsrGenerated}
            onCancel={() => setShowCsrGenerator(false)}
          />
        ) : (
          <>
            <p className="text-sm text-zinc-500 mb-4">
              You can either generate a new CSR (with a new private key) or
              paste an existing CSR.
            </p>
            <div className="flex items-center gap-3 mb-4">
              <Button
                variant="secondary"
                icon={<Plus className="w-3.5 h-3.5" />}
                onClick={() => setShowCsrGenerator(true)}
                disabled={submitting}
              >
                Generate New CSR
              </Button>
              <span className="text-sm text-zinc-600">or</span>
            </div>

            <form onSubmit={handleSubmitCsr}>
              <textarea
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-3 font-mono text-sm text-zinc-300 placeholder-zinc-600 focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600 focus:outline-none resize-y"
                placeholder={
                  '-----BEGIN CERTIFICATE REQUEST-----\nPaste your PEM-encoded CSR here...\n-----END CERTIFICATE REQUEST-----'
                }
                value={csrPem}
                onChange={(e) => setCsrPem(e.target.value)}
                disabled={submitting}
                rows={6}
              />
              <Button
                type="submit"
                variant="primary"
                disabled={submitting}
                className="mt-3"
              >
                {submitting ? 'Submitting...' : 'Submit CSR'}
              </Button>
            </form>
          </>
        )}
      </Card>

      {/* Certificates List */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-zinc-400">
            Your Certificates ({certs.length})
          </h3>
          {certs.length > 0 && (
            <div className="flex rounded-lg border border-zinc-800 overflow-hidden">
              <button
                className={`px-3 py-1 text-xs cursor-pointer transition-colors ${viewMode === 'card' ? 'bg-zinc-800 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300'}`}
                onClick={() => setViewMode('card')}
              >
                Cards
              </button>
              <button
                className={`px-3 py-1 text-xs cursor-pointer transition-colors ${viewMode === 'table' ? 'bg-zinc-800 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300'}`}
                onClick={() => setViewMode('table')}
              >
                Table
              </button>
            </div>
          )}
        </div>

        {certs.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Shield className="w-8 h-8" />}
              title="No certificates yet"
              description="Submit a CSR above to request your first certificate."
            />
          </Card>
        ) : viewMode === 'card' ? (
          <div className="space-y-4">
            {certs.map((cert) => (
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
            certs={certs}
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
      </div>
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

function CertCard({
  cert,
  isPolling,
  isRenewing,
  isRetrying,
  isRevoking,
  isDeleting,
  isTogglingAutoRenew,
  onDownload,
  onCopy,
  onRenew,
  onRetry,
  onRevoke,
  onDelete,
  onToggleAutoRenew,
}: CertCardProps) {
  const [showPem, setShowPem] = useState(false);
  const [showCertDetails, setShowCertDetails] = useState(false);
  const [certDetails, setCertDetails] = useState<TlsCertDetails | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const domains = getCertDomains(cert);
  const expirationInfo = getExpirationInfo(cert);

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

  return (
    <Card>
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <h4 className="text-base font-medium text-zinc-100">
            {domains.length > 0 ? domains[0] : `Certificate #${cert.id}`}
          </h4>
          <Badge variant={STATUS_BADGE_VARIANT[cert.status]} dot>
            {STATUS_LABEL[cert.status] || cert.status}
            {isPolling && (
              <Loader2 className="w-3 h-3 ml-1 inline animate-spin" />
            )}
          </Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          {cert.status === CertStatus.ISSUED && (
            <>
              <Button
                size="sm"
                variant="secondary"
                icon={<RefreshCw className="w-3.5 h-3.5" />}
                onClick={() => onRenew(cert)}
                disabled={isRenewing || isRevoking}
              >
                {isRenewing ? 'Renewing...' : 'Renew'}
              </Button>
              <Button
                size="sm"
                variant="danger"
                icon={<Ban className="w-3.5 h-3.5" />}
                onClick={() => onRevoke(cert)}
                disabled={isRevoking || isRenewing}
              >
                {isRevoking ? 'Revoking...' : 'Revoke'}
              </Button>
            </>
          )}
          {cert.status === CertStatus.FAILED && (
            <>
              <Button
                size="sm"
                variant="secondary"
                icon={<RefreshCw className="w-3.5 h-3.5" />}
                onClick={() => onRetry(cert)}
                disabled={isRetrying || isDeleting}
              >
                {isRetrying ? 'Retrying...' : 'Retry'}
              </Button>
              <Button
                size="sm"
                variant="danger"
                icon={<Trash2 className="w-3.5 h-3.5" />}
                onClick={() => onDelete(cert)}
                disabled={isDeleting || isRetrying}
              >
                {isDeleting ? 'Deleting...' : 'Delete'}
              </Button>
            </>
          )}
          {cert.status === CertStatus.REVOKED && (
            <Button
              size="sm"
              variant="danger"
              icon={<Trash2 className="w-3.5 h-3.5" />}
              onClick={() => onDelete(cert)}
              disabled={isDeleting}
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </Button>
          )}
          {cert.crtPem && (
            <>
              <Button
                size="sm"
                variant="secondary"
                icon={<Download className="w-3.5 h-3.5" />}
                onClick={() => onDownload(cert)}
              >
                Download
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={<Copy className="w-3.5 h-3.5" />}
                onClick={() => onCopy(cert.crtPem!)}
              >
                Copy PEM
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Details */}
      <div className="text-sm space-y-1.5 mb-4">
        <div className="flex gap-2">
          <span className="text-zinc-500">ID:</span>
          <span className="text-zinc-300">#{cert.id}</span>
        </div>
        {domains.length > 0 && (
          <div className="flex gap-2">
            <span className="text-zinc-500">Domains:</span>
            <span className="text-zinc-300">{domains.join(', ')}</span>
          </div>
        )}
        {expirationInfo && (
          <div className="flex gap-2">
            <span className="text-zinc-500">Expiration:</span>
            <span className={expirationInfo.colorClass}>
              {expirationInfo.expiresAt.toLocaleDateString()}
              {expirationInfo.isExpired && ' (Expired)'}
              {!expirationInfo.isExpired &&
                ` (${expirationInfo.daysUntilExpiry} days)`}
            </span>
          </div>
        )}
        {cert.lastRenewedAt && (
          <div className="flex gap-2">
            <span className="text-zinc-500">Last Renewed:</span>
            <span className="text-zinc-300">
              {new Date(cert.lastRenewedAt).toLocaleDateString()}
            </span>
          </div>
        )}
        {cert.revokedAt && (
          <div className="flex gap-2">
            <span className="text-zinc-500">Revoked At:</span>
            <span className="text-red-400">
              {new Date(cert.revokedAt).toLocaleDateString()}
            </span>
          </div>
        )}
        {cert.renewalCount > 0 && (
          <div className="flex gap-2">
            <span className="text-zinc-500">Renewals:</span>
            <span className="text-zinc-300">{cert.renewalCount}</span>
          </div>
        )}
        <div className="flex gap-2 items-center">
          <span className="text-zinc-500">Auto-Renew:</span>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={cert.autoRenew}
              disabled={isTogglingAutoRenew}
              onChange={() => onToggleAutoRenew(cert)}
              className="accent-cyan-500"
            />
            <span className="text-zinc-300 text-sm">
              {cert.autoRenew ? 'Enabled' : 'Disabled'}
            </span>
          </label>
        </div>
      </div>

      {/* Parsed Certificate Details */}
      {cert.crtPem && (
        <div className="border-t border-zinc-800 pt-3 mt-3">
          <button
            onClick={handleToggleCertDetails}
            className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer bg-transparent border-none p-0"
          >
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
              <div className="text-sm space-y-1.5 mt-3">
                <div className="flex gap-2">
                  <span className="text-zinc-500">Serial Number:</span>
                  <span className="text-zinc-300 font-mono text-xs">
                    {certDetails.serialNumber}
                  </span>
                </div>
                <div className="flex gap-2">
                  <span className="text-zinc-500">Issuer:</span>
                  <span className="text-zinc-300">{certDetails.issuer}</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-zinc-500">Subject:</span>
                  <span className="text-zinc-300">{certDetails.subject}</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-zinc-500">Valid From:</span>
                  <span className="text-zinc-300">
                    {new Date(certDetails.validFrom).toLocaleDateString()}
                  </span>
                </div>
                <div className="flex gap-2">
                  <span className="text-zinc-500">Valid To:</span>
                  <span className="text-zinc-300">
                    {new Date(certDetails.validTo).toLocaleDateString()}
                  </span>
                </div>
                <div className="flex gap-2">
                  <span className="text-zinc-500">Key Type:</span>
                  <span className="text-zinc-300">
                    {certDetails.keyType} {certDetails.keySize}-bit
                  </span>
                </div>
                <div className="flex gap-2">
                  <span className="text-zinc-500">Fingerprint:</span>
                  <span className="text-zinc-300 font-mono text-xs">
                    {certDetails.fingerprint}
                  </span>
                </div>
              </div>
            ) : null)}
        </div>
      )}

      {/* PEM display */}
      {cert.crtPem && (
        <div className="border-t border-zinc-800 pt-3 mt-3">
          <button
            onClick={() => setShowPem(!showPem)}
            className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer bg-transparent border-none p-0"
          >
            {showPem ? (
              <EyeOff className="w-4 h-4" />
            ) : (
              <Eye className="w-4 h-4" />
            )}
            {showPem ? 'Hide' : 'View'} certificate PEM
          </button>
          {showPem && (
            <pre className="mt-2 bg-zinc-950 rounded-lg p-4 font-mono text-xs text-zinc-400 overflow-auto max-h-48">
              {cert.crtPem}
            </pre>
          )}
        </div>
      )}
    </Card>
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
  onDownload,
  onCopy,
  onRenew,
  onRetry,
  onRevoke,
  onDelete,
  onToggleAutoRenew,
}: CertTableProps) {
  const [sortField, setSortField] = useState<SortField>('cn');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

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

  const arrow = (field: SortField) =>
    sortField === field ? (sortDir === 'asc' ? ' \u25B2' : ' \u25BC') : '';

  return (
    <Card>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableHead
              className="cursor-pointer select-none"
              onClick={() => handleSort('cn')}
            >
              Common Name{arrow('cn')}
            </TableHead>
            <TableHead
              className="cursor-pointer select-none"
              onClick={() => handleSort('status')}
            >
              Status{arrow('status')}
            </TableHead>
            <TableHead
              className="cursor-pointer select-none"
              onClick={() => handleSort('expiry')}
            >
              Expiry{arrow('expiry')}
            </TableHead>
            <TableHead
              className="cursor-pointer select-none"
              onClick={() => handleSort('autoRenew')}
            >
              Auto-Renew{arrow('autoRenew')}
            </TableHead>
            <TableHead>Actions</TableHead>
          </TableHeader>
          <tbody>
            {sorted.map((cert) => {
              const domains = getCertDomains(cert);
              const expInfo = getExpirationInfo(cert);
              const isRenewing = renewingIds.has(cert.id);
              const isRetrying = retryingIds.has(cert.id);
              const isRevoking = revokingIds.has(cert.id);
              const isDeleting = deletingIds.has(cert.id);

              return (
                <TableRow key={cert.id}>
                  <TableCell className="font-medium text-zinc-200">
                    {domains.length > 0 ? domains[0] : `#${cert.id}`}
                    {pollingIds.has(cert.id) && (
                      <Loader2 className="w-3 h-3 ml-1 inline animate-spin text-cyan-400" />
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_BADGE_VARIANT[cert.status]} dot>
                      {STATUS_LABEL[cert.status] || cert.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {expInfo ? (
                      <span className={expInfo.colorClass}>
                        {expInfo.expiresAt.toLocaleDateString()}
                        {expInfo.isExpired
                          ? ' (Expired)'
                          : ` (${expInfo.daysUntilExpiry}d)`}
                      </span>
                    ) : (
                      <span className="text-zinc-600">&mdash;</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={cert.autoRenew}
                        disabled={togglingAutoRenewIds.has(cert.id)}
                        onChange={() => onToggleAutoRenew(cert)}
                        className="accent-cyan-500"
                      />
                      <span className="text-sm">
                        {cert.autoRenew ? 'On' : 'Off'}
                      </span>
                    </label>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1.5">
                      {cert.status === CertStatus.ISSUED && (
                        <>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => onRenew(cert)}
                            disabled={isRenewing || isRevoking}
                          >
                            {isRenewing ? 'Renewing...' : 'Renew'}
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => onRevoke(cert)}
                            disabled={isRevoking || isRenewing}
                          >
                            {isRevoking ? 'Revoking...' : 'Revoke'}
                          </Button>
                        </>
                      )}
                      {cert.status === CertStatus.FAILED && (
                        <>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => onRetry(cert)}
                            disabled={isRetrying || isDeleting}
                          >
                            {isRetrying ? 'Retrying...' : 'Retry'}
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => onDelete(cert)}
                            disabled={isDeleting || isRetrying}
                          >
                            {isDeleting ? 'Deleting...' : 'Delete'}
                          </Button>
                        </>
                      )}
                      {cert.status === CertStatus.REVOKED && (
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => onDelete(cert)}
                          disabled={isDeleting}
                        >
                          {isDeleting ? 'Deleting...' : 'Delete'}
                        </Button>
                      )}
                      {cert.crtPem && (
                        <>
                          <Button
                            size="sm"
                            variant="secondary"
                            icon={<Download className="w-3 h-3" />}
                            onClick={() => onDownload(cert)}
                          >
                            Download
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={<Copy className="w-3 h-3" />}
                            onClick={() => onCopy(cert.crtPem!)}
                          >
                            Copy
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </tbody>
        </Table>
      </div>
    </Card>
  );
}
