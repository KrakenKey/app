import { useState, useEffect, useCallback } from 'react';
import { Key, Plus, Ban, Copy, AlertTriangle, Info, X } from 'lucide-react';
import { toast } from '../utils/toast';
import { API_KEY_RESTRICTION_LIMITS } from '@krakenkey/shared';
import type { ApiKey } from '@krakenkey/shared';
import { getKeyExpiry } from '../utils/expiration';
import { fullDateTime, shortDate } from '../utils/dates';
import { formatRelative } from '../utils/connectors';
import { copyToClipboard } from '../utils/clipboard';
import { parseIpList } from '../utils/apiKeyAccess';
import { useActionSet } from '../hooks/useActionSet';
import { useConfirm } from '../hooks/useConfirm';
import { useAccessForm } from '../hooks/useAccessForm';
import * as apiKeyService from '../services/apiKeyService';
import {
  AccessChoiceFields,
  AccessSummary,
  RestrictionFields,
} from './AccessFields';
import { Card, CardHeader } from './ui/Card';
import { Button } from './ui/Button';
import { Input, fieldClass } from './ui/Input';
import { Textarea } from './ui/Textarea';
import { Modal } from './ui/Modal';
import { RowMenu } from './ui/Menu';
import { Table, TableHeader, TableRow, TableHead, TableCell } from './ui/Table';
import { PageHeader } from './ui/PageHeader';
import { EmptyState } from './ui/EmptyState';

export default function ApiKeyManagement() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const revokingIds = useActionSet<string>();
  const confirm = useConfirm();
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyExpiry, setNewKeyExpiry] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<{
    name: string;
    key: string;
  } | null>(null);
  const [ipText, setIpText] = useState('');
  const [ipError, setIpError] = useState<string | null>(null);

  const accessForm = useAccessForm();
  const { loadDomains, domainNames, setRestrictionsOpen } = accessForm;

  const fetchKeys = useCallback(async () => {
    try {
      setLoading(true);
      const data = await apiKeyService.fetchApiKeys();
      setKeys(data);
      // Domain badges show hostnames when we have them.
      if (data.some((k) => k.allowedDomainIds?.length)) {
        void loadDomains();
      }
    } catch (error) {
      console.error('Failed to fetch API keys:', error);
    } finally {
      setLoading(false);
    }
  }, [loadDomains]);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  // The dialog would otherwise focus its close button.
  useEffect(() => {
    if (createOpen) document.getElementById('api-key-name')?.focus();
  }, [createOpen]);

  const closeCreate = () => {
    setCreateOpen(false);
    resetForm();
  };

  const resetForm = () => {
    setNewKeyName('');
    setNewKeyExpiry('');
    setIpText('');
    setIpError(null);
    accessForm.reset();
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newKeyName.trim();
    if (!name) {
      toast.error('Please enter a name for the API key');
      return;
    }

    const resolved = accessForm.resolveScopes();
    if (!resolved) return;

    const { entries: allowedIps, invalid } = parseIpList(ipText);
    if (invalid.length > 0) {
      setIpError(`Not a valid IP address or CIDR range: ${invalid.join(', ')}`);
      setRestrictionsOpen(true);
      return;
    }
    if (allowedIps.length > API_KEY_RESTRICTION_LIMITS.ips) {
      setIpError(
        `Enter at most ${API_KEY_RESTRICTION_LIMITS.ips} addresses or ranges.`,
      );
      setRestrictionsOpen(true);
      return;
    }

    try {
      setCreating(true);
      const data = await apiKeyService.createApiKey(
        name,
        newKeyExpiry || undefined,
        {
          scopes: resolved.scopes,
          allowedDomainIds: accessForm.domainIds,
          allowedCertIds: accessForm.certIds,
          allowedIps,
        },
      );
      setNewlyCreatedKey({ name, key: data.apiKey });
      toast.success(`API key "${name}" created!`);
      resetForm();
      setCreateOpen(false);
      await fetchKeys();
    } catch (error) {
      // The API client already shows the server's message.
      console.error('Failed to create API key:', error);
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (key: ApiKey) => {
    const ok = await confirm({
      title: 'Revoke API key?',
      body: (
        <>
          Anything using <strong className="text-text">{key.name}</strong> stops
          working immediately. This cannot be undone.
        </>
      ),
      confirmLabel: 'Revoke key',
    });
    if (!ok) return;

    try {
      revokingIds.add(key.id);
      await apiKeyService.revokeApiKey(key.id);
      toast.success(`API key "${key.name}" revoked.`);
      const revokedAt = new Date().toISOString();
      setKeys((prev) =>
        prev.map((k) => (k.id === key.id ? { ...k, revokedAt } : k)),
      );
    } catch (error) {
      console.error('Failed to revoke API key:', error);
    } finally {
      revokingIds.remove(key.id);
    }
  };

  const activeCount = keys.filter((k) => k.revokedAt === null).length;

  const ipCount = parseIpList(ipText).entries.length;
  const ipSummary =
    ipCount > 0 ? [`${ipCount} IP ${ipCount === 1 ? 'entry' : 'entries'}`] : [];

  const createButton = (
    <Button
      variant="primary"
      icon={<Plus className="w-4 h-4" />}
      onClick={() => setCreateOpen(true)}
    >
      Create API key
    </Button>
  );

  const header = (
    <PageHeader
      title="API Keys"
      description="Personal access tokens for the CLI, scripts and CI."
      actions={createButton}
    />
  );

  if (loading) {
    return (
      <div>
        {header}
        <p className="text-sm text-text-muted">Loading API keys...</p>
      </div>
    );
  }

  return (
    <div>
      {header}

      <Modal
        open={createOpen}
        onClose={closeCreate}
        title="Create API key"
        description="The key is shown once, right after you create it."
        size="xl"
        footer={
          <>
            <Button type="button" onClick={closeCreate} disabled={creating}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="create-api-key-form"
              variant="primary"
              disabled={creating}
            >
              {creating ? 'Creating...' : 'Create key'}
            </Button>
          </>
        }
      >
        <form
          id="create-api-key-form"
          onSubmit={handleCreate}
          aria-label="Create API key"
          className="space-y-5"
        >
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <Input
              id="api-key-name"
              label="Name"
              placeholder="e.g., ci-deploy"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              disabled={creating}
              autoComplete="off"
            />
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="api-key-expiry"
                className="text-sm font-medium text-text-secondary"
              >
                Expires (optional)
              </label>
              <input
                id="api-key-expiry"
                type="date"
                className={fieldClass}
                value={newKeyExpiry}
                onChange={(e) => setNewKeyExpiry(e.target.value)}
                disabled={creating}
                min={new Date().toISOString().split('T')[0]}
              />
            </div>
          </div>

          <AccessChoiceFields
            form={accessForm}
            idPrefix="api-key"
            disabled={creating}
          />

          <RestrictionFields
            form={accessForm}
            idPrefix="api-key"
            disabled={creating}
            extraSummary={ipSummary}
          >
            <Textarea
              id="api-key-allowed-ips"
              label="Allowed IPs"
              placeholder={'203.0.113.10\n198.51.100.0/24\n2001:db8::/32'}
              rows={3}
              value={ipText}
              onChange={(e) => {
                setIpText(e.target.value);
                setIpError(null);
              }}
              disabled={creating}
              error={ipError ?? undefined}
              aria-invalid={ipError ? true : undefined}
              helpText={`One IPv4 or IPv6 address or CIDR range per line, or separated by commas. Up to ${API_KEY_RESTRICTION_LIMITS.ips}. Requests from other addresses are refused.`}
              className="font-mono"
            />
          </RestrictionFields>

          <p className="text-xs text-text-muted flex items-start gap-1.5">
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            Access and restrictions can't be changed after the key is created.
            To change them, create a new key and revoke the old one.
          </p>
        </form>
      </Modal>

      {newlyCreatedKey && (
        <NewKeyReveal
          name={newlyCreatedKey.name}
          secret={newlyCreatedKey.key}
          onDismiss={() => setNewlyCreatedKey(null)}
        />
      )}

      {keys.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Key className="w-6 h-6" />}
            title="No API keys yet"
            description="Create a key for the CLI, a script or a CI pipeline."
            action={createButton}
          />
        </Card>
      ) : (
        <Card flush>
          <CardHeader title={`Your API Keys (${activeCount})`} />
          <Table className="sm:min-w-[720px]">
            <TableHeader>
              <TableHead className="pl-5">Name</TableHead>
              <TableHead>Access</TableHead>
              <TableHead className="hidden lg:table-cell">Created</TableHead>
              <TableHead className="hidden sm:table-cell">Last used</TableHead>
              <TableHead className="hidden sm:table-cell">Expires</TableHead>
              <TableHead className="text-right pr-5">Actions</TableHead>
            </TableHeader>
            <tbody>
              {keys.map((key) => {
                const revoked = key.revokedAt !== null;
                const revoking = revokingIds.has(key.id);
                const expiry = (
                  <KeyExpiryText
                    expiresAt={key.expiresAt}
                    revokedAt={key.revokedAt}
                  />
                );
                return (
                  <TableRow
                    key={key.id}
                    className={revoked ? 'opacity-60' : undefined}
                  >
                    <TableCell className="pl-5">
                      <span className="font-medium text-text">{key.name}</span>
                      <div className="mt-1 text-xs sm:hidden">{expiry}</div>
                    </TableCell>
                    <TableCell>
                      <AccessSummary
                        scopes={key.scopes}
                        allowedDomainIds={key.allowedDomainIds}
                        allowedCertIds={key.allowedCertIds}
                        allowedIps={key.allowedIps}
                        domainNames={domainNames}
                      />
                    </TableCell>
                    <TableCell className="hidden lg:table-cell whitespace-nowrap">
                      <span title={fullDateTime(key.createdAt)}>
                        {shortDate(key.createdAt)}
                      </span>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell whitespace-nowrap">
                      {key.lastUsedAt ? (
                        <span title={fullDateTime(key.lastUsedAt)}>
                          {formatRelative(key.lastUsedAt)}
                          {key.lastUsedIp && (
                            <span className="block text-xs text-text-muted font-mono">
                              {key.lastUsedIp}
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-text-muted">Never</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {expiry}
                    </TableCell>
                    <TableCell className="pr-5">
                      <div className="flex justify-end">
                        {!revoked && (
                          <RowMenu
                            label={`More actions for ${key.name}`}
                            items={[
                              {
                                label: revoking ? 'Revoking...' : 'Revoke',
                                icon: <Ban className="w-3.5 h-3.5" />,
                                danger: true,
                                disabled: revoking,
                                onClick: () => handleRevoke(key),
                              },
                            ]}
                          />
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </tbody>
          </Table>
          {keys.length > activeCount && (
            <p className="text-xs text-text-muted px-5 py-3 border-t border-border-subtle">
              Revoked keys stay listed for 30 days.
            </p>
          )}
        </Card>
      )}
    </div>
  );
}

/** Expiry date; colored only when 30 days or less remain. */
function KeyExpiryText({
  expiresAt,
  revokedAt,
}: {
  expiresAt: string | null;
  revokedAt: string | null;
}) {
  if (revokedAt) {
    return (
      <span className="text-text-muted whitespace-nowrap">
        Revoked {shortDate(revokedAt)}
      </span>
    );
  }
  const expiry = getKeyExpiry(expiresAt);
  if (!expiry.days) {
    return <span className="text-text-muted">{expiry.label}</span>;
  }
  const tone =
    expiry.tone === 'danger'
      ? 'text-red-300'
      : expiry.tone === 'warning'
        ? 'text-amber-300'
        : 'text-text-faint';
  return (
    <span className="whitespace-nowrap tnum">
      <span className="text-text-secondary">{expiry.label}</span>{' '}
      <span className={tone}>({expiry.days})</span>
    </span>
  );
}

/** The one-time view of a new key's secret. */
function NewKeyReveal({
  name,
  secret,
  onDismiss,
}: {
  name: string;
  secret: string;
  onDismiss: () => void;
}) {
  return (
    <Card
      role="status"
      aria-label="New API key"
      className="mb-6 border-emerald-400/25 bg-emerald-400/[0.04]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text">
            API key <span className="font-mono">{name}</span> created
          </p>
          <p className="text-xs text-amber-300 flex items-center gap-1.5 mt-1">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            Copy this key now. It will not be shown again.
          </p>
        </div>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="text-text-muted hover:text-text p-1 -mr-1 -mt-1 rounded-lg hover:bg-white/[0.06] transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <code className="min-w-0 flex-1 break-all rounded-lg border border-border-subtle bg-bg px-3.5 py-2.5 font-mono text-sm text-text">
          {secret}
        </code>
        <Button
          variant="secondary"
          icon={<Copy className="w-3.5 h-3.5" />}
          onClick={() => copyToClipboard(secret)}
          className="shrink-0"
        >
          Copy key
        </Button>
      </div>
    </Card>
  );
}
