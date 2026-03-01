import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../services/api';
import { toast } from '../utils/toast';
import { API_ROUTES, CertStatus } from '@krakenkey/shared';
import type { TlsCert, CreateTlsCertRequest, CreateTlsCertResponse, RenewTlsCertResponse, RetryTlsCertResponse, RevokeTlsCertResponse, RevokeTlsCertRequest, DeleteTlsCertResponse } from '@krakenkey/shared';
import CsrGenerator from './CsrGenerator';
import './CertificateManagement.css';

export default function CertificateManagement() {
  const [certs, setCerts] = useState<TlsCert[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [csrPem, setCsrPem] = useState('');
  const [pollingIds, setPollingIds] = useState<Set<number>>(new Set());
  const [renewingIds, setRenewingIds] = useState<Set<number>>(new Set());
  const [retryingIds, setRetryingIds] = useState<Set<number>>(new Set());
  const [revokingIds, setRevokingIds] = useState<Set<number>>(new Set());
  const [deletingIds, setDeletingIds] = useState<Set<number>>(new Set());
  const [togglingAutoRenewIds, setTogglingAutoRenewIds] = useState<Set<number>>(new Set());
  const pollingTimers = useRef<Map<number, ReturnType<typeof setInterval>>>(new Map());
  const [showCsrGenerator, setShowCsrGenerator] = useState(false);

  const stopPolling = useCallback((certId: number) => {
    const timer = pollingTimers.current.get(certId);
    if (timer) {
      clearInterval(timer);
      pollingTimers.current.delete(certId);
    }
    setPollingIds(prev => {
      const next = new Set(prev);
      next.delete(certId);
      return next;
    });
  }, []);

  const startPolling = useCallback((certId: number) => {
    if (pollingTimers.current.has(certId)) return;

    setPollingIds(prev => new Set(prev).add(certId));

    const timer = setInterval(async () => {
      try {
        const response = await api.get<TlsCert>(
          API_ROUTES.TLS_CERTS.BY_ID(String(certId))
        );
        const updated = response.data;

        // Capture previous status from setState to avoid dependency on certs
        let wasRenewing = false;
        setCerts(prev => {
          const previousCert = prev.find(c => c.id === certId);
          wasRenewing = previousCert?.status === CertStatus.RENEWING;
          return prev.map(c => c.id === certId ? updated : c);
        });

        if (updated.status === CertStatus.ISSUED || updated.status === CertStatus.FAILED) {
          stopPolling(certId);
          if (updated.status === CertStatus.ISSUED) {
            toast.success(wasRenewing
              ? `Certificate #${certId} has been renewed!`
              : `Certificate #${certId} has been issued!`
            );
          } else {
            toast.error(`Certificate #${certId} operation failed.`);
          }
        }
      } catch (error) {
        console.error(`Polling error for cert #${certId}:`, error);
        stopPolling(certId);
      }
    }, 5000);

    pollingTimers.current.set(certId, timer);
  }, [stopPolling]);

  const fetchCerts = useCallback(async () => {
    try {
      setLoading(true);
      const response = await api.get<TlsCert[]>(API_ROUTES.TLS_CERTS.BASE);
      setCerts(response.data);
      response.data.forEach(cert => {
        if (cert.status === CertStatus.PENDING || cert.status === CertStatus.ISSUING || cert.status === CertStatus.RENEWING) {
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
    return () => {
      pollingTimers.current.forEach(timer => clearInterval(timer));
      pollingTimers.current.clear();
    };
  }, [fetchCerts]);

  const handleSubmitCsr = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!csrPem.trim()) {
      toast.error('Please paste a PEM-encoded CSR');
      return;
    }

    try {
      setSubmitting(true);
      const payload: CreateTlsCertRequest = { csrPem: csrPem.trim() };
      const response = await api.post<CreateTlsCertResponse>(
        API_ROUTES.TLS_CERTS.BASE,
        payload
      );
      toast.success(`Certificate request #${response.data.id} submitted!`);
      setCsrPem('');
      await fetchCerts();
    } catch (error) {
      console.error('Failed to submit CSR:', error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDownloadPem = (cert: TlsCert) => {
    if (!cert.crtPem) return;
    const blob = new Blob([cert.crtPem], { type: 'application/x-pem-file' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cert-${cert.id}.pem`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard!');
  };

  const handleRenewCert = async (cert: TlsCert) => {
    try {
      setRenewingIds(prev => new Set(prev).add(cert.id));

      const response = await api.post<RenewTlsCertResponse>(
        API_ROUTES.TLS_CERTS.RENEW(String(cert.id))
      );

      toast.success(`Certificate #${cert.id} renewal initiated!`);

      // Update cert status locally
      setCerts(prev => prev.map(c =>
        c.id === cert.id ? { ...c, status: response.data.status as TlsCert['status'] } : c
      ));

      // Start polling for renewal completion
      startPolling(cert.id);
    } catch (error) {
      console.error('Failed to renew certificate:', error);
    } finally {
      setRenewingIds(prev => {
        const next = new Set(prev);
        next.delete(cert.id);
        return next;
      });
    }
  };

  const handleRetryCert = async (cert: TlsCert) => {
    try {
      setRetryingIds(prev => new Set(prev).add(cert.id));

      const response = await api.post<RetryTlsCertResponse>(
        API_ROUTES.TLS_CERTS.RETRY(String(cert.id))
      );

      toast.success(`Certificate #${cert.id} retry initiated!`);

      setCerts(prev => prev.map(c =>
        c.id === cert.id ? { ...c, status: response.data.status as TlsCert['status'] } : c
      ));

      startPolling(cert.id);
    } catch (error) {
      console.error('Failed to retry certificate:', error);
    } finally {
      setRetryingIds(prev => {
        const next = new Set(prev);
        next.delete(cert.id);
        return next;
      });
    }
  };

  const handleRevokeCert = async (cert: TlsCert) => {
    if (!confirm(`Are you sure you want to revoke certificate #${cert.id}? This cannot be undone.`)) {
      return;
    }

    try {
      setRevokingIds(prev => new Set(prev).add(cert.id));

      const payload: RevokeTlsCertRequest = {};
      const response = await api.post<RevokeTlsCertResponse>(
        API_ROUTES.TLS_CERTS.REVOKE(String(cert.id)),
        payload
      );

      toast.success(`Certificate #${cert.id} has been revoked.`);

      setCerts(prev => prev.map(c =>
        c.id === cert.id ? { ...c, status: response.data.status as TlsCert['status'] } : c
      ));
    } catch (error) {
      console.error('Failed to revoke certificate:', error);
    } finally {
      setRevokingIds(prev => {
        const next = new Set(prev);
        next.delete(cert.id);
        return next;
      });
    }
  };

  const handleDeleteCert = async (cert: TlsCert) => {
    if (!confirm(`Are you sure you want to delete certificate #${cert.id}? This cannot be undone.`)) {
      return;
    }

    try {
      setDeletingIds(prev => new Set(prev).add(cert.id));
      await api.delete<DeleteTlsCertResponse>(
        API_ROUTES.TLS_CERTS.DELETE(String(cert.id))
      );
      toast.success(`Certificate #${cert.id} has been deleted.`);
      setCerts(prev => prev.filter(c => c.id !== cert.id));
    } catch (error) {
      console.error('Failed to delete certificate:', error);
    } finally {
      setDeletingIds(prev => {
        const next = new Set(prev);
        next.delete(cert.id);
        return next;
      });
    }
  };

  const handleToggleAutoRenew = async (cert: TlsCert) => {
    const newValue = !cert.autoRenew;
    setTogglingAutoRenewIds(prev => new Set(prev).add(cert.id));
    // Optimistic update
    setCerts(prev => prev.map(c => c.id === cert.id ? { ...c, autoRenew: newValue } : c));
    try {
      await api.patch(API_ROUTES.TLS_CERTS.BY_ID(String(cert.id)), { autoRenew: newValue });
    } catch (error) {
      console.error('Failed to toggle auto-renew:', error);
      // Revert on failure
      setCerts(prev => prev.map(c => c.id === cert.id ? { ...c, autoRenew: cert.autoRenew } : c));
      toast.error(`Failed to update auto-renew for certificate #${cert.id}`);
    } finally {
      setTogglingAutoRenewIds(prev => {
        const next = new Set(prev);
        next.delete(cert.id);
        return next;
      });
    }
  };

  const handleCsrGenerated = (generatedCsrPem: string) => {
    setCsrPem(generatedCsrPem);
    setShowCsrGenerator(false);
    toast.success('CSR populated! Review and submit when ready.');
  };

  if (loading) {
    return (
      <div className="cert-management">
        <h2>Certificate Management</h2>
        <p>Loading certificates...</p>
      </div>
    );
  }

  return (
    <div className="cert-management">
      <h2>Certificate Management</h2>
      <p className="subtitle">
        Submit CSR requests and manage your TLS certificates
      </p>

      {/* Submit CSR Form */}
      <div className="submit-csr-section">
        <h3>Submit Certificate Signing Request</h3>

        {showCsrGenerator ? (
          <CsrGenerator
            onCsrGenerated={handleCsrGenerated}
            onCancel={() => setShowCsrGenerator(false)}
          />
        ) : (
          <>
            <p className="help-text">
              You can either generate a new CSR (with a new private key) or paste an existing CSR.
            </p>
            <div className="csr-input-options">
              <button
                onClick={() => setShowCsrGenerator(true)}
                className="btn-secondary"
                disabled={submitting}
              >
                Generate New CSR
              </button>
              <span className="option-separator">or</span>
            </div>

            <form onSubmit={handleSubmitCsr} className="csr-form">
              <textarea
                className="csr-textarea"
                placeholder={"-----BEGIN CERTIFICATE REQUEST-----\nPaste your PEM-encoded CSR here...\n-----END CERTIFICATE REQUEST-----"}
                value={csrPem}
                onChange={(e) => setCsrPem(e.target.value)}
                disabled={submitting}
                rows={6}
              />
              <button type="submit" disabled={submitting} className="btn-primary">
                {submitting ? 'Submitting...' : 'Submit CSR'}
              </button>
            </form>
          </>
        )}
      </div>

      {/* Certificates List */}
      <div className="certs-list">
        <h3>Your Certificates ({certs.length})</h3>

        {certs.length === 0 ? (
          <p className="empty-state">
            No certificates yet. Submit a CSR above to request your first certificate.
          </p>
        ) : (
          <div className="certs-table">
            {certs.map(cert => (
              <CertCard
                key={cert.id}
                cert={cert}
                isPolling={pollingIds.has(cert.id)}
                isRenewing={renewingIds.has(cert.id)}
                isRetrying={retryingIds.has(cert.id)}
                isRevoking={revokingIds.has(cert.id)}
                isDeleting={deletingIds.has(cert.id)}
                isTogglingAutoRenew={togglingAutoRenewIds.has(cert.id)}
                onDownload={handleDownloadPem}
                onCopy={copyToClipboard}
                onRenew={handleRenewCert}
                onRetry={handleRetryCert}
                onRevoke={handleRevokeCert}
                onDelete={handleDeleteCert}
                onToggleAutoRenew={handleToggleAutoRenew}
              />
            ))}
          </div>
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

function CertCard({ cert, isPolling, isRenewing, isRetrying, isRevoking, isDeleting, isTogglingAutoRenew, onDownload, onCopy, onRenew, onRetry, onRevoke, onDelete, onToggleAutoRenew }: CertCardProps) {
  const [showPem, setShowPem] = useState(false);

  const getDomains = (): string[] => {
    const parsed = cert.parsedCsr;
    if (!parsed || typeof parsed !== 'object') return [];

    const domains: string[] = [];

    // Extract CN from subject
    const subject = (parsed as unknown as Record<string, unknown>).subject;
    if (Array.isArray(subject)) {
      for (const entry of subject) {
        if (entry && typeof entry === 'object' && 'shortName' in entry && entry.shortName === 'CN') {
          domains.push(String((entry as Record<string, unknown>).value));
        }
      }
    }

    // Extract SANs from extensions
    const extensions = (parsed as unknown as Record<string, unknown>).extensions;
    if (Array.isArray(extensions)) {
      for (const ext of extensions) {
        if (ext && typeof ext === 'object' && 'altNames' in ext) {
          const altNames = (ext as Record<string, unknown>).altNames;
          if (Array.isArray(altNames)) {
            for (const alt of altNames) {
              if (alt && typeof alt === 'object' && 'value' in alt) {
                const val = String((alt as Record<string, unknown>).value);
                if (!domains.includes(val)) domains.push(val);
              }
            }
          }
        }
      }
    }

    return domains;
  };

  const domains = getDomains();

  const statusLabel: Record<CertStatus, string> = {
    [CertStatus.PENDING]: 'Pending',
    [CertStatus.ISSUING]: 'Issuing',
    [CertStatus.ISSUED]: 'Issued',
    [CertStatus.FAILED]: 'Failed',
    [CertStatus.RENEWING]: 'Renewing',
    [CertStatus.REVOKING]: 'Revoking',
    [CertStatus.REVOKED]: 'Revoked',
  };

  const getExpirationInfo = () => {
    if (!cert.expiresAt) return null;

    const expiresAt = new Date(cert.expiresAt);
    const now = new Date();
    const daysUntilExpiry = Math.floor(
      (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    );

    const isExpired = daysUntilExpiry < 0;
    let colorClass = 'healthy';
    if (isExpired) colorClass = 'expired';
    else if (daysUntilExpiry < 7) colorClass = 'expiring-critical';
    else if (daysUntilExpiry <= 30) colorClass = 'expiring-soon';

    return { expiresAt, daysUntilExpiry, isExpired, colorClass };
  };

  const expirationInfo = getExpirationInfo();

  return (
    <div className={`cert-card ${cert.status}`}>
      {/* Header */}
      <div className="cert-header">
        <div className="cert-title">
          <h4>
            {domains.length > 0 ? domains[0] : `Certificate #${cert.id}`}
          </h4>
          <span className={`status-badge ${cert.status}`}>
            {statusLabel[cert.status] || cert.status}
            {isPolling && <span className="polling-indicator" />}
          </span>
        </div>
        <div className="cert-actions">
          {cert.status === CertStatus.ISSUED && (
            <>
              <button
                onClick={() => onRenew(cert)}
                disabled={isRenewing || isRevoking}
                className="btn-secondary btn-small"
              >
                {isRenewing ? 'Renewing...' : 'Renew'}
              </button>
              <button
                onClick={() => onRevoke(cert)}
                disabled={isRevoking || isRenewing}
                className="btn-danger btn-small"
              >
                {isRevoking ? 'Revoking...' : 'Revoke'}
              </button>
            </>
          )}
          {cert.status === CertStatus.FAILED && (
            <>
              <button
                onClick={() => onRetry(cert)}
                disabled={isRetrying || isDeleting}
                className="btn-secondary btn-small"
              >
                {isRetrying ? 'Retrying...' : 'Retry'}
              </button>
              <button
                onClick={() => onDelete(cert)}
                disabled={isDeleting || isRetrying}
                className="btn-danger btn-small"
              >
                {isDeleting ? 'Deleting...' : 'Delete'}
              </button>
            </>
          )}
          {cert.status === CertStatus.REVOKED && (
            <button
              onClick={() => onDelete(cert)}
              disabled={isDeleting}
              className="btn-danger btn-small"
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </button>
          )}
          {cert.crtPem && (
            <>
              <button
                onClick={() => onDownload(cert)}
                className="btn-secondary btn-small"
              >
                Download .pem
              </button>
              <button
                onClick={() => onCopy(cert.crtPem!)}
                className="btn-copy btn-small"
              >
                Copy PEM
              </button>
            </>
          )}
        </div>
      </div>

      {/* Details */}
      <div className="cert-details">
        <div className="detail-row">
          <span className="label">ID:</span>
          <span className="value">#{cert.id}</span>
        </div>
        {domains.length > 0 && (
          <div className="detail-row">
            <span className="label">Domains:</span>
            <span className="value">{domains.join(', ')}</span>
          </div>
        )}
        <div className="detail-row">
          <span className="label">Status:</span>
          <span className="value">{statusLabel[cert.status] || cert.status}</span>
        </div>

        {/* Expiration Information */}
        {expirationInfo && (
          <div className="detail-row">
            <span className="label">Expiration:</span>
            <span className={`value ${expirationInfo.colorClass}`}>
              {expirationInfo.expiresAt.toLocaleDateString()}
              {expirationInfo.isExpired && ' (Expired)'}
              {!expirationInfo.isExpired && ` (${expirationInfo.daysUntilExpiry} days)`}
            </span>
          </div>
        )}

        {cert.lastRenewedAt && (
          <div className="detail-row">
            <span className="label">Last Renewed:</span>
            <span className="value">
              {new Date(cert.lastRenewedAt).toLocaleDateString()}
            </span>
          </div>
        )}

        {cert.revokedAt && (
          <div className="detail-row">
            <span className="label">Revoked At:</span>
            <span className="value expired">
              {new Date(cert.revokedAt).toLocaleDateString()}
            </span>
          </div>
        )}

        {cert.renewalCount > 0 && (
          <div className="detail-row">
            <span className="label">Renewals:</span>
            <span className="value">{cert.renewalCount}</span>
          </div>
        )}

        <div className="detail-row">
          <span className="label">Auto-Renew:</span>
          <label className="auto-renew-toggle">
            <input
              type="checkbox"
              checked={cert.autoRenew}
              disabled={isTogglingAutoRenew}
              onChange={() => onToggleAutoRenew(cert)}
            />
            <span>{cert.autoRenew ? 'Enabled' : 'Disabled'}</span>
          </label>
        </div>
      </div>

      {/* Issued Certificate PEM */}
      {cert.crtPem && (
        <div className="cert-pem-section">
          <button
            onClick={() => setShowPem(!showPem)}
            className="toggle-instructions"
          >
            {showPem ? '\u25BC' : '\u25B6'} View certificate PEM
          </button>

          {showPem && (
            <code className="cert-pem-display">{cert.crtPem}</code>
          )}
        </div>
      )}
    </div>
  );
}
