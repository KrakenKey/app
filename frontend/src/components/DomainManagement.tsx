import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  Globe,
  Plus,
  Trash2,
  Copy,
  ChevronDown,
  ChevronRight,
  ShieldCheck,
} from 'lucide-react';
import { toast } from '../utils/toast';
import type { Domain } from '@krakenkey/shared';
import { copyToClipboard } from '../utils/clipboard';
import { countCertsByDomain } from '../utils/certDomains';
import { fullDateTime, shortDate } from '../utils/dates';
import * as domainService from '../services/domainService';
import { useConfirm } from '../hooks/useConfirm';
import { useHealth } from '../hooks/useHealth';
import { Card, CardHeader } from './ui/Card';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Badge } from './ui/Badge';
import { Modal } from './ui/Modal';
import { RowMenu } from './ui/Menu';
import { Table, TableHeader, TableRow, TableHead, TableCell } from './ui/Table';
import { PageHeader } from './ui/PageHeader';
import { EmptyState } from './ui/EmptyState';

const ACME_AUTH_ZONE_DOMAIN =
  window.__env__?.KK_ACME_AUTH_ZONE_DOMAIN || 'acme.dev.krakenkey.io';

function acmeCnameTarget(hostname: string): string {
  return `${hostname.replace(/\./g, '-')}.${ACME_AUTH_ZONE_DOMAIN}`;
}

export default function DomainManagement() {
  const confirm = useConfirm();
  // Certificates come from the account health data the sidebar already
  // loads; without it the count column is left out.
  const { data: health, status: healthStatus } = useHealth();
  const [domains, setDomains] = useState<Domain[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [addingDomain, setAddingDomain] = useState(false);
  const [newHostname, setNewHostname] = useState('');
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    fetchDomains();
  }, []);

  // The dialog would otherwise focus its close button.
  useEffect(() => {
    if (addOpen) document.getElementById('domain-hostname')?.focus();
  }, [addOpen]);

  const fetchDomains = async () => {
    try {
      setLoading(true);
      const data = await domainService.fetchDomains();
      setDomains(data);
    } catch (error) {
      console.error('Failed to fetch domains:', error);
    } finally {
      setLoading(false);
    }
  };

  const certCounts = useMemo(
    () =>
      health && healthStatus.certs === 'loaded'
        ? countCertsByDomain(domains, health.certs)
        : null,
    [domains, health, healthStatus.certs],
  );

  const closeAdd = () => {
    setAddOpen(false);
    setNewHostname('');
  };

  const handleAddDomain = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!newHostname.trim()) {
      toast.error('Please enter a hostname');
      return;
    }

    try {
      setAddingDomain(true);
      const newDomain = await domainService.addDomain(newHostname.trim());

      toast.success(`Domain ${newDomain.hostname} added successfully!`);
      setDomains((prev) => [...prev, newDomain]);
      // Show the DNS records to add next.
      setExpandedId(newDomain.id);
      closeAdd();
    } catch (error) {
      console.error('Failed to add domain:', error);
    } finally {
      setAddingDomain(false);
    }
  };

  const handleVerifyDomain = async (domain: Domain) => {
    try {
      setVerifyingId(domain.id);
      const updatedDomain = await domainService.verifyDomain(domain.id);

      if (updatedDomain.isVerified) {
        toast.success(`Domain ${domain.hostname} verified successfully!`);
        setDomains((prev) =>
          prev.map((d) => (d.id === domain.id ? updatedDomain : d)),
        );
        setExpandedId((id) => (id === domain.id ? null : id));
      }
    } catch (error) {
      console.error('Failed to verify domain:', error);
    } finally {
      setVerifyingId(null);
    }
  };

  const handleDeleteDomain = async (domain: Domain) => {
    const ok = await confirm({
      title: 'Delete domain?',
      body: (
        <>
          <strong className="text-text">{domain.hostname}</strong> is removed
          from your account. To request certificates for it again, you'll have
          to add and verify it again.
        </>
      ),
      confirmLabel: 'Delete domain',
    });
    if (!ok) return;

    try {
      await domainService.deleteDomain(domain.id);
      toast.success(`Domain ${domain.hostname} deleted`);
      setDomains((prev) => prev.filter((d) => d.id !== domain.id));
    } catch (error) {
      console.error('Failed to delete domain:', error);
    }
  };

  const addButton = (
    <Button
      variant="primary"
      icon={<Plus className="w-4 h-4" />}
      onClick={() => setAddOpen(true)}
    >
      Add domain
    </Button>
  );

  const header = (
    <PageHeader
      title="Domains"
      description="Add and verify your domains to request TLS certificates."
      actions={addButton}
    />
  );

  if (loading) {
    return (
      <div>
        {header}
        <p className="text-sm text-text-muted">Loading domains...</p>
      </div>
    );
  }

  const pendingCount = domains.filter((d) => !d.isVerified).length;

  return (
    <div>
      {header}

      <Modal
        open={addOpen}
        onClose={closeAdd}
        title="Add a domain"
        description="After adding it, you'll get two DNS records to create: one proves you own the domain, the other lets KrakenKey answer certificate challenges."
        footer={
          <>
            <Button type="button" onClick={closeAdd} disabled={addingDomain}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="add-domain-form"
              variant="primary"
              disabled={addingDomain || !newHostname.trim()}
            >
              {addingDomain ? 'Adding...' : 'Add domain'}
            </Button>
          </>
        }
      >
        <form id="add-domain-form" onSubmit={handleAddDomain}>
          <Input
            id="domain-hostname"
            label="Domain"
            placeholder="example.com"
            value={newHostname}
            onChange={(e) => setNewHostname(e.target.value)}
            disabled={addingDomain}
            autoComplete="off"
            spellCheck={false}
            helpText="Certificates can cover this domain and any of its subdomains."
          />
        </form>
      </Modal>

      {domains.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Globe className="w-6 h-6" />}
            title="No domains yet"
            description="Add a domain and verify it with two DNS records to start requesting certificates."
            action={addButton}
          />
        </Card>
      ) : (
        <Card flush>
          <CardHeader
            title={`Your Domains (${domains.length})`}
            description={
              pendingCount > 0
                ? `${pendingCount} waiting for DNS verification`
                : undefined
            }
          />
          <Table className="sm:min-w-[640px]">
            <TableHeader>
              <TableHead className="w-10 pl-5 pr-0" />
              <TableHead className="pl-1">Domain</TableHead>
              <TableHead className="hidden sm:table-cell">Status</TableHead>
              {certCounts && (
                <TableHead className="hidden md:table-cell text-right">
                  Certificates
                </TableHead>
              )}
              <TableHead className="hidden md:table-cell">Added</TableHead>
              <TableHead className="text-right pr-5">Actions</TableHead>
            </TableHeader>
            <tbody>
              {domains.map((domain) => {
                const pending = !domain.isVerified;
                const expanded = pending && expandedId === domain.id;
                const toggle = () => setExpandedId(expanded ? null : domain.id);
                const verifying = verifyingId === domain.id;
                return (
                  <Fragment key={domain.id}>
                    <TableRow
                      className={`${pending ? 'cursor-pointer' : ''} ${expanded ? 'bg-white/[0.025]' : ''}`}
                      onClick={pending ? toggle : undefined}
                    >
                      <TableCell className="w-10 pl-5 pr-0">
                        {pending && (
                          <button
                            type="button"
                            aria-label={`${expanded ? 'Hide' : 'Show'} DNS records for ${domain.hostname}`}
                            aria-expanded={expanded}
                            aria-controls={`dns-${domain.id}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggle();
                            }}
                            className="flex items-center text-text-muted hover:text-text cursor-pointer"
                          >
                            {expanded ? (
                              <ChevronDown className="w-4 h-4" />
                            ) : (
                              <ChevronRight className="w-4 h-4" />
                            )}
                          </button>
                        )}
                      </TableCell>
                      <TableCell className="pl-1 max-w-[230px] sm:max-w-[360px]">
                        <span
                          className="block truncate font-medium text-text"
                          title={domain.hostname}
                        >
                          {domain.hostname}
                        </span>
                        {pending && (
                          <span className="block text-xs text-text-muted mt-0.5">
                            Add two DNS records, then verify
                          </span>
                        )}
                        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs sm:hidden">
                          <StatusBadge verified={domain.isVerified} />
                        </div>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <StatusBadge verified={domain.isVerified} />
                      </TableCell>
                      {certCounts && (
                        <TableCell className="hidden md:table-cell text-right tnum">
                          {certCounts.get(domain.id) ? (
                            <span className="text-text-secondary">
                              {certCounts.get(domain.id)}
                            </span>
                          ) : (
                            <span className="text-text-faint">0</span>
                          )}
                        </TableCell>
                      )}
                      <TableCell className="hidden md:table-cell whitespace-nowrap">
                        <span title={fullDateTime(domain.createdAt)}>
                          {shortDate(domain.createdAt)}
                        </span>
                      </TableCell>
                      <TableCell
                        className="pr-5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-end gap-1.5">
                          {pending && (
                            <Button
                              size="sm"
                              variant="primary"
                              icon={<ShieldCheck className="w-3.5 h-3.5" />}
                              onClick={() => handleVerifyDomain(domain)}
                              disabled={verifying}
                              className="max-sm:hidden"
                            >
                              {verifying ? 'Verifying...' : 'Verify'}
                            </Button>
                          )}
                          <RowMenu
                            label={`More actions for ${domain.hostname}`}
                            items={[
                              // On narrow screens Verify lives in the menu.
                              ...(pending
                                ? [
                                    {
                                      label: verifying
                                        ? 'Verifying...'
                                        : 'Verify',
                                      icon: (
                                        <ShieldCheck className="w-3.5 h-3.5" />
                                      ),
                                      disabled: verifying,
                                      className: 'sm:hidden',
                                      onClick: () => handleVerifyDomain(domain),
                                    },
                                  ]
                                : []),
                              {
                                label: 'Delete',
                                icon: <Trash2 className="w-3.5 h-3.5" />,
                                danger: true,
                                onClick: () => handleDeleteDomain(domain),
                              },
                            ]}
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                    {expanded && (
                      <tr className="border-b border-border-subtle bg-bg/40">
                        <td className="hidden sm:table-cell" />
                        <td
                          id={`dns-${domain.id}`}
                          colSpan={certCounts ? 5 : 4}
                          className="pl-5 sm:pl-1 pr-5 py-5"
                        >
                          <DnsInstructions
                            domain={domain}
                            onCopy={copyToClipboard}
                            verifying={verifying}
                            onVerify={() => handleVerifyDomain(domain)}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}

function StatusBadge({ verified }: { verified: boolean }) {
  return verified ? (
    <Badge variant="ok">Verified</Badge>
  ) : (
    <Badge variant="warning">Pending</Badge>
  );
}

/** One DNS record: a labeled row per field, values in mono with copy. */
function DnsRecord({
  kind,
  title,
  description,
  rows,
  onCopy,
}: {
  kind: string;
  title: string;
  description: string;
  rows: { label: string; value: string; note?: string; copy?: boolean }[];
  onCopy: (text: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div>
        <h5 className="text-sm font-medium text-text">{title}</h5>
        <p className="text-xs text-text-muted mt-0.5">{description}</p>
      </div>
      <dl className="rounded-lg border border-border-subtle bg-bg/60 divide-y divide-border-subtle text-sm">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex flex-col gap-1 px-3.5 py-2.5 sm:flex-row sm:items-center sm:gap-4"
          >
            <dt className="w-16 shrink-0 text-xs text-text-muted">
              {row.label}
            </dt>
            <dd className="flex min-w-0 flex-1 items-center gap-2">
              <code className="min-w-0 break-all font-mono text-[13px] text-text">
                {row.value}
              </code>
              {row.note && (
                <span className="text-xs text-text-faint">{row.note}</span>
              )}
              {row.copy && (
                <button
                  type="button"
                  aria-label={`Copy ${kind} ${row.label.toLowerCase()}`}
                  title="Copy"
                  onClick={() => onCopy(row.value)}
                  className="ml-auto inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-muted hover:text-text hover:bg-white/[0.06] transition-colors cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function DnsInstructions({
  domain,
  onCopy,
  verifying,
  onVerify,
}: {
  domain: Domain;
  onCopy: (text: string) => void;
  verifying: boolean;
  onVerify: () => void;
}) {
  const challengeName = `_acme-challenge.${domain.hostname}`;
  const target = acmeCnameTarget(domain.hostname);
  return (
    <div className="max-w-3xl space-y-5">
      <p className="text-sm text-text-secondary">
        Add the following two DNS records to your domain. Both are{' '}
        <strong className="text-text">persistent</strong>: add them once and
        leave them in place.
      </p>

      <DnsRecord
        title="Record 1: TXT, domain ownership verification"
        description="This proves you own the domain. Add this TXT record to the root of your domain."
        onCopy={onCopy}
        kind="TXT"
        rows={[
          { label: 'Type', value: 'TXT' },
          {
            label: 'Name',
            value: '@',
            note: '(or leave blank for apex domain)',
          },
          { label: 'Value', value: domain.verificationCode, copy: true },
        ]}
      />

      <DnsRecord
        title="Record 2: CNAME, automated certificate issuance"
        description="This delegates ACME DNS-01 challenges so KrakenKey can automatically issue and renew TLS certificates."
        onCopy={onCopy}
        kind="CNAME"
        rows={[
          { label: 'Type', value: 'CNAME' },
          { label: 'Name', value: challengeName, copy: true },
          { label: 'Target', value: target, copy: true },
        ]}
      />

      <div className="text-sm">
        <p className="font-medium text-text mb-1">After adding both records:</p>
        <ol className="list-decimal list-inside space-y-1 text-text-muted">
          <li>Wait a few minutes for DNS to propagate</li>
          <li>Click "Verify" (this checks the TXT record)</li>
        </ol>
        <Button
          size="sm"
          variant="primary"
          icon={<ShieldCheck className="w-3.5 h-3.5" />}
          onClick={onVerify}
          disabled={verifying}
          className="mt-3 sm:hidden"
        >
          {verifying ? 'Verifying...' : 'Verify'}
        </Button>
      </div>

      <details className="text-sm">
        <summary className="text-text-muted hover:text-text cursor-pointer transition-colors">
          How to add these records (common providers)
        </summary>
        <div className="mt-3 space-y-4 text-text-muted">
          <div>
            <strong className="text-text-secondary">Cloudflare:</strong>
            <ol className="list-decimal list-inside mt-1 space-y-0.5">
              <li>Go to DNS settings for your domain</li>
              <li>Click "Add record"</li>
              <li>
                Add TXT record (Type: TXT, Name: @, Content: verification code)
              </li>
              <li>
                Add CNAME record (Name: _acme-challenge, Target: value shown
                above)
              </li>
              <li>
                Make sure CNAME proxy status is{' '}
                <strong className="text-text-secondary">DNS only</strong> (grey
                cloud)
              </li>
            </ol>
          </div>
          <div>
            <strong className="text-text-secondary">
              Route 53 / Other DNS:
            </strong>
            <ol className="list-decimal list-inside mt-1 space-y-0.5">
              <li>Go to your DNS provider's control panel</li>
              <li>Find DNS/Zone records section</li>
              <li>Add TXT record (Host: @, Value: verification code)</li>
              <li>
                Add CNAME record (Host: _acme-challenge, Value: target shown
                above)
              </li>
            </ol>
          </div>
        </div>
      </details>

      <div className="space-y-2">
        <p className="text-sm font-medium text-text">Test your DNS records:</p>
        {[
          `dig TXT ${domain.hostname} +short`,
          `dig CNAME ${challengeName} +short`,
        ].map((cmd) => (
          <div
            key={cmd}
            className="flex items-center gap-2 rounded-lg border border-border-subtle bg-bg/60 pl-3 pr-1.5 py-1.5"
          >
            <code className="min-w-0 flex-1 break-all font-mono text-xs text-text-secondary">
              {cmd}
            </code>
            <button
              type="button"
              aria-label={`Copy command ${cmd}`}
              title="Copy"
              onClick={() => onCopy(cmd)}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-muted hover:text-text hover:bg-white/[0.06] transition-colors cursor-pointer"
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        <p className="text-xs text-text-faint">
          The first command should show your verification code. The second
          should show the CNAME target after you add the record.
        </p>
      </div>
    </div>
  );
}
