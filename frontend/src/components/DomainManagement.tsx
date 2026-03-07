import { useState, useEffect } from 'react';
import { Globe, Plus, CheckCircle2, AlertCircle, Trash2, Copy, ChevronDown, ChevronRight } from 'lucide-react';
import api from '../services/api';
import { toast } from '../utils/toast';
import { API_ROUTES } from '@krakenkey/shared';
import type { Domain, CreateDomainRequest } from '@krakenkey/shared';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Badge } from './ui/Badge';
import { PageHeader } from './ui/PageHeader';
import { EmptyState } from './ui/EmptyState';

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
        setDomains(domains.map(d => d.id === domain.id ? response.data : d));
      }
    } catch (error) {
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
      console.error('Failed to delete domain:', error);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard!');
  };

  if (loading) {
    return (
      <div>
        <PageHeader title="Domains" icon={<Globe className="w-6 h-6" />} />
        <p className="text-zinc-400">Loading domains...</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Domains"
        description="Add and verify your domains to request TLS certificates"
        icon={<Globe className="w-6 h-6" />}
      />

      {/* Add Domain Form */}
      <Card className="mb-6">
        <h3 className="text-sm font-medium text-zinc-400 mb-4">Add New Domain</h3>
        <form onSubmit={handleAddDomain} className="flex flex-col sm:flex-row gap-3">
          <Input
            placeholder="example.com"
            value={newHostname}
            onChange={(e) => setNewHostname(e.target.value)}
            disabled={addingDomain}
            className="flex-1"
          />
          <Button type="submit" variant="primary" disabled={addingDomain} icon={<Plus className="w-3.5 h-3.5" />}>
            {addingDomain ? 'Adding...' : 'Add Domain'}
          </Button>
        </form>
      </Card>

      {/* Domains List */}
      <div>
        <h3 className="text-sm font-medium text-zinc-400 mb-4">Your Domains ({domains.length})</h3>

        {domains.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Globe className="w-8 h-8" />}
              title="No domains yet"
              description="Add your first domain above to get started!"
            />
          </Card>
        ) : (
          <div className="space-y-4">
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
    <Card>
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <h4 className="text-base font-medium text-zinc-100">{domain.hostname}</h4>
          {domain.isVerified ? (
            <Badge variant="success" dot><CheckCircle2 className="w-3 h-3 mr-1 inline" />Verified</Badge>
          ) : (
            <Badge variant="warning" dot><AlertCircle className="w-3 h-3 mr-1 inline" />Unverified</Badge>
          )}
        </div>
        <div className="flex gap-2">
          {!domain.isVerified && (
            <Button size="sm" variant="secondary" onClick={() => onVerify(domain)} disabled={isVerifying}>
              {isVerifying ? 'Verifying...' : 'Verify Now'}
            </Button>
          )}
          <Button size="sm" variant="danger" icon={<Trash2 className="w-3.5 h-3.5" />} onClick={() => onDelete(domain)}>
            Delete
          </Button>
        </div>
      </div>

      {/* Details */}
      <div className="text-sm space-y-1 mb-4">
        <div className="flex gap-2">
          <span className="text-zinc-500">Added:</span>
          <span className="text-zinc-300">{new Date(domain.createdAt).toLocaleString()}</span>
        </div>
        {domain.isVerified && (
          <div className="flex gap-2">
            <span className="text-zinc-500">Verified:</span>
            <span className="text-zinc-300">{new Date(domain.updatedAt).toLocaleString()}</span>
          </div>
        )}
      </div>

      {/* Verification Instructions */}
      {!domain.isVerified && (
        <div>
          <button
            onClick={() => setShowInstructions(!showInstructions)}
            className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer bg-transparent border-none p-0"
          >
            {showInstructions ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            How to verify this domain
          </button>

          {showInstructions && (
            <div className="mt-4 space-y-6">
              <p className="text-sm text-zinc-400">
                Add the following two DNS records to your domain. Both are{' '}
                <strong className="text-zinc-300">persistent</strong> — add them once and leave them in place.
              </p>

              {/* Record 1: TXT */}
              <div className="space-y-2">
                <h5 className="text-sm font-medium text-zinc-200">Record 1: TXT — Domain Ownership Verification</h5>
                <p className="text-xs text-zinc-500">
                  This proves you own the domain. Add this TXT record to the root of your domain.
                </p>
                <div className="bg-zinc-950 rounded-lg p-4 border border-zinc-800 space-y-2 text-sm">
                  <div><span className="text-zinc-500">Type:</span> <span className="text-zinc-300">TXT</span></div>
                  <div><span className="text-zinc-500">Name:</span> <code className="text-cyan-400">@</code> <span className="text-zinc-600">(or leave blank for apex domain)</span></div>
                  <div className="flex items-center gap-2">
                    <span className="text-zinc-500">Value:</span>
                    <code className="text-cyan-400 break-all">{domain.verificationCode}</code>
                    <Button size="sm" variant="ghost" icon={<Copy className="w-3 h-3" />} onClick={() => onCopy(domain.verificationCode)} />
                  </div>
                </div>
              </div>

              {/* Record 2: CNAME */}
              <div className="space-y-2">
                <h5 className="text-sm font-medium text-zinc-200">Record 2: CNAME — Automated Certificate Issuance</h5>
                <p className="text-xs text-zinc-500">
                  This delegates ACME DNS-01 challenges so KrakenKey can automatically issue and renew TLS certificates.
                </p>
                <div className="bg-zinc-950 rounded-lg p-4 border border-zinc-800 space-y-2 text-sm">
                  <div><span className="text-zinc-500">Type:</span> <span className="text-zinc-300">CNAME</span></div>
                  <div className="flex items-center gap-2">
                    <span className="text-zinc-500">Name:</span>
                    <code className="text-cyan-400 break-all">_acme-challenge.{domain.hostname}</code>
                    <Button size="sm" variant="ghost" icon={<Copy className="w-3 h-3" />} onClick={() => onCopy(`_acme-challenge.${domain.hostname}`)} />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-zinc-500">Target:</span>
                    <code className="text-cyan-400 break-all">{acmeCnameTarget(domain.hostname)}</code>
                    <Button size="sm" variant="ghost" icon={<Copy className="w-3 h-3" />} onClick={() => onCopy(acmeCnameTarget(domain.hostname))} />
                  </div>
                </div>
              </div>

              <div className="text-sm text-zinc-400">
                <p className="font-medium text-zinc-300 mb-1">After adding both records:</p>
                <ol className="list-decimal list-inside space-y-1 text-zinc-500">
                  <li>Wait a few minutes for DNS to propagate</li>
                  <li>Click "Verify Now" above (this checks the TXT record)</li>
                </ol>
              </div>

              <details className="text-sm">
                <summary className="text-zinc-400 hover:text-zinc-200 cursor-pointer transition-colors">
                  How to add these records (common providers)
                </summary>
                <div className="mt-3 space-y-4 text-zinc-500">
                  <div>
                    <strong className="text-zinc-300">Cloudflare:</strong>
                    <ol className="list-decimal list-inside mt-1 space-y-0.5">
                      <li>Go to DNS settings for your domain</li>
                      <li>Click "Add record"</li>
                      <li>Add TXT record (Type: TXT, Name: @, Content: verification code)</li>
                      <li>Add CNAME record (Name: _acme-challenge, Target: value shown above)</li>
                      <li>Make sure CNAME proxy status is <strong className="text-zinc-300">DNS only</strong> (grey cloud)</li>
                    </ol>
                  </div>
                  <div>
                    <strong className="text-zinc-300">Route 53 / Other DNS:</strong>
                    <ol className="list-decimal list-inside mt-1 space-y-0.5">
                      <li>Go to your DNS provider's control panel</li>
                      <li>Find DNS/Zone records section</li>
                      <li>Add TXT record (Host: @, Value: verification code)</li>
                      <li>Add CNAME record (Host: _acme-challenge, Value: target shown above)</li>
                    </ol>
                  </div>
                </div>
              </details>

              <div className="space-y-2">
                <p className="text-sm font-medium text-zinc-300">Test your DNS records:</p>
                <code className="block bg-zinc-950 rounded-lg px-3 py-2 font-mono text-xs text-zinc-400">
                  dig TXT {domain.hostname} +short
                </code>
                <code className="block bg-zinc-950 rounded-lg px-3 py-2 font-mono text-xs text-zinc-400">
                  dig CNAME _acme-challenge.{domain.hostname} +short
                </code>
                <p className="text-xs text-zinc-600">
                  The first command should show your verification code.
                  The second should show the CNAME target after you add the record.
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
