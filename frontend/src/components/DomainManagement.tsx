import { useState, useEffect } from 'react';
import api from '../services/api';
import { toast } from '../utils/toast';
import { API_ROUTES } from '@krakenkey/shared';
import type { Domain, CreateDomainRequest } from '@krakenkey/shared';
import './DomainManagement.css';

const ACME_AUTH_ZONE_DOMAIN =
  window.__env__?.KK_ACME_AUTH_ZONE_DOMAIN || 'acme.dev.krakenkey.io';

function acmeCnameTarget(hostname: string): string {
  return `${hostname.replace(/\./g, '-')}.${ACME_AUTH_ZONE_DOMAIN}`;
}

export default function DomainManagement() {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingDomain, setAddingDomain] = useState(false);
  const [newHostname, setNewHostname] = useState('');
  const [verifyingId, setVerifyingId] = useState<string | null>(null);

  // Fetch domains on mount
  useEffect(() => {
    fetchDomains();
  }, []);

  const fetchDomains = async () => {
    try {
      setLoading(true);
      const response = await api.get<Domain[]>(API_ROUTES.DOMAINS.BASE);
      setDomains(response.data);
    } catch (error) {
      console.error('Failed to fetch domains:', error);
      // Error toast is shown by interceptor
    } finally {
      setLoading(false);
    }
  };

  const handleAddDomain = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!newHostname.trim()) {
      toast.error('Please enter a hostname');
      return;
    }

    try {
      setAddingDomain(true);
      const payload: CreateDomainRequest = { hostname: newHostname.trim() };
      const response = await api.post<Domain>(API_ROUTES.DOMAINS.BASE, payload);

      toast.success(`Domain ${response.data.hostname} added successfully!`);
      setDomains([...domains, response.data]);
      setNewHostname('');
    } catch (error) {
      // Error toast is shown by interceptor
      console.error('Failed to add domain:', error);
    } finally {
      setAddingDomain(false);
    }
  };

  const handleVerifyDomain = async (domain: Domain) => {
    try {
      setVerifyingId(domain.id);
      const response = await api.post<Domain>(API_ROUTES.DOMAINS.VERIFY(domain.id));

      if (response.data.isVerified) {
        toast.success(`Domain ${domain.hostname} verified successfully!`);
        // Update the domain in the list
        setDomains(domains.map(d => d.id === domain.id ? response.data : d));
      }
    } catch (error) {
      // Error toast is shown by interceptor
      console.error('Failed to verify domain:', error);
    } finally {
      setVerifyingId(null);
    }
  };

  const handleDeleteDomain = async (domain: Domain) => {
    if (!confirm(`Are you sure you want to delete ${domain.hostname}?`)) {
      return;
    }

    try {
      await api.delete(API_ROUTES.DOMAINS.DELETE(domain.id));
      toast.success(`Domain ${domain.hostname} deleted`);
      setDomains(domains.filter(d => d.id !== domain.id));
    } catch (error) {
      // Error toast is shown by interceptor
      console.error('Failed to delete domain:', error);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard!');
  };

  if (loading) {
    return (
      <div className="domain-management">
        <h2>Domain Management</h2>
        <p>Loading domains...</p>
      </div>
    );
  }

  return (
    <div className="domain-management">
      <h2>Domain Management</h2>
      <p className="subtitle">
        Add and verify your domains to request TLS certificates
      </p>

      {/* Add Domain Form */}
      <div className="add-domain-section">
        <h3>Add New Domain</h3>
        <form onSubmit={handleAddDomain} className="add-domain-form">
          <input
            type="text"
            placeholder="example.com"
            value={newHostname}
            onChange={(e) => setNewHostname(e.target.value)}
            disabled={addingDomain}
            className="domain-input"
          />
          <button type="submit" disabled={addingDomain} className="btn-primary">
            {addingDomain ? 'Adding...' : 'Add Domain'}
          </button>
        </form>
      </div>

      {/* Domains List */}
      <div className="domains-list">
        <h3>Your Domains ({domains.length})</h3>

        {domains.length === 0 ? (
          <p className="empty-state">
            No domains yet. Add your first domain above to get started!
          </p>
        ) : (
          <div className="domains-table">
            {domains.map((domain) => (
              <DomainCard
                key={domain.id}
                domain={domain}
                onVerify={handleVerifyDomain}
                onDelete={handleDeleteDomain}
                onCopy={copyToClipboard}
                isVerifying={verifyingId === domain.id}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Domain Card Component
interface DomainCardProps {
  domain: Domain;
  onVerify: (domain: Domain) => void;
  onDelete: (domain: Domain) => void;
  onCopy: (text: string) => void;
  isVerifying: boolean;
}

function DomainCard({ domain, onVerify, onDelete, onCopy, isVerifying }: DomainCardProps) {
  const [showInstructions, setShowInstructions] = useState(false);

  return (
    <div className={`domain-card ${domain.isVerified ? 'verified' : 'unverified'}`}>
      {/* Header */}
      <div className="domain-header">
        <div className="domain-title">
          <h4>{domain.hostname}</h4>
          <span className={`status-badge ${domain.isVerified ? 'verified' : 'unverified'}`}>
            {domain.isVerified ? '✓ Verified' : '⚠ Unverified'}
          </span>
        </div>
        <div className="domain-actions">
          {!domain.isVerified && (
            <button
              onClick={() => onVerify(domain)}
              disabled={isVerifying}
              className="btn-secondary btn-small"
            >
              {isVerifying ? 'Verifying...' : 'Verify Now'}
            </button>
          )}
          <button
            onClick={() => onDelete(domain)}
            className="btn-danger btn-small"
          >
            Delete
          </button>
        </div>
      </div>

      {/* Details */}
      <div className="domain-details">
        <div className="detail-row">
          <span className="label">Added:</span>
          <span className="value">{new Date(domain.createdAt).toLocaleString()}</span>
        </div>
        {domain.isVerified && (
          <div className="detail-row">
            <span className="label">Verified:</span>
            <span className="value">{new Date(domain.updatedAt).toLocaleString()}</span>
          </div>
        )}
      </div>

      {/* Verification Instructions (for unverified domains) */}
      {!domain.isVerified && (
        <div className="verification-section">
          <button
            onClick={() => setShowInstructions(!showInstructions)}
            className="toggle-instructions"
          >
            {showInstructions ? '▼' : '▶'} How to verify this domain
          </button>

          {showInstructions && (
            <div className="instructions">
              <p>
                Add the following two DNS records to your domain. Both are{' '}
                <strong>persistent</strong> — add them once and leave them in place.
              </p>

              {/* Record 1: TXT for ownership verification */}
              <div className="dns-record-section">
                <h5>Record 1: TXT — Domain Ownership Verification</h5>
                <p className="record-purpose">
                  This proves you own the domain. Add this TXT record to the
                  root of your domain (not a subdomain). KrakenKey checks it
                  when you click "Verify Now" and periodically re-validates.
                </p>
                <div className="verification-code-box">
                  <div className="code-label">
                    <strong>Type:</strong> TXT
                  </div>
                  <div className="code-label">
                    <strong>Name:</strong> <code>@</code> (or leave blank for apex domain)
                  </div>
                  <div className="code-label">
                    <strong>Value:</strong>
                  </div>
                  <div className="code-value">
                    <code>{domain.verificationCode}</code>
                    <button
                      onClick={() => onCopy(domain.verificationCode)}
                      className="btn-copy"
                      title="Copy verification code"
                    >
                      Copy
                    </button>
                  </div>
                </div>
              </div>

              {/* Record 2: CNAME for ACME challenge delegation */}
              <div className="dns-record-section">
                <h5>Record 2: CNAME — Automated Certificate Issuance</h5>
                <p className="record-purpose">
                  This delegates ACME DNS-01 challenges so KrakenKey can
                  automatically issue and renew TLS certificates for your domain.
                  The record is persistent, but it only resolves during the brief
                  window when a certificate is being issued.
                </p>
                <div className="verification-code-box">
                  <div className="code-label">
                    <strong>Type:</strong> CNAME
                  </div>
                  <div className="code-label">
                    <strong>Name:</strong>
                  </div>
                  <div className="code-value">
                    <code>_acme-challenge.{domain.hostname}</code>
                    <button
                      onClick={() => onCopy(`_acme-challenge.${domain.hostname}`)}
                      className="btn-copy"
                      title="Copy CNAME name"
                    >
                      Copy
                    </button>
                  </div>
                  <div className="code-label" style={{ marginTop: '8px' }}>
                    <strong>Target:</strong>
                  </div>
                  <div className="code-value">
                    <code>{acmeCnameTarget(domain.hostname)}</code>
                    <button
                      onClick={() => onCopy(acmeCnameTarget(domain.hostname))}
                      className="btn-copy"
                      title="Copy CNAME target"
                    >
                      Copy
                    </button>
                  </div>
                </div>
              </div>

              <p><strong>After adding both records:</strong></p>
              <ol>
                <li>Wait a few minutes for DNS to propagate</li>
                <li>Click "Verify Now" above (this checks the TXT record)</li>
              </ol>

              <details className="dns-help">
                <summary>How to add these records (common providers)</summary>
                <div className="provider-examples">
                  <div className="provider">
                    <strong>Cloudflare:</strong>
                    <ol>
                      <li>Go to DNS settings for your domain</li>
                      <li>Click "Add record"</li>
                      <li>Add the TXT record (Type: TXT, Name: @, Content: verification code)</li>
                      <li>Add the CNAME record (Type: CNAME, Name: _acme-challenge, Target: value shown above)</li>
                      <li>Make sure the CNAME proxy status is <strong>DNS only</strong> (grey cloud)</li>
                      <li>Click "Save" for each</li>
                    </ol>
                  </div>
                  <div className="provider">
                    <strong>Route 53 / Other DNS:</strong>
                    <ol>
                      <li>Go to your DNS provider's control panel</li>
                      <li>Find DNS/Zone records section</li>
                      <li>Add the TXT record (Host: @, Value: verification code)</li>
                      <li>Add the CNAME record (Host: _acme-challenge, Value: target shown above)</li>
                      <li>Save both records</li>
                    </ol>
                  </div>
                </div>
              </details>

              <div className="test-dns">
                <p><strong>Test your DNS records:</strong></p>
                <code className="dns-command">
                  dig TXT {domain.hostname} +short
                </code>
                <code className="dns-command">
                  dig CNAME _acme-challenge.{domain.hostname} +short
                </code>
                <p className="help-text">
                  The first command should show your verification code.
                  The second should show the CNAME target after you add the record.
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
