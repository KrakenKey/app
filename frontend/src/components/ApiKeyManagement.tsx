import { useState, useEffect, useCallback } from 'react';
import { Key, Plus, Ban, Copy, AlertTriangle, Info } from 'lucide-react';
import { toast } from '../utils/toast';
import { API_KEY_RESTRICTION_LIMITS } from '@krakenkey/shared';
import type { ApiKey } from '@krakenkey/shared';
import { getExpirationBadge } from '../utils/expiration';
import { copyToClipboard } from '../utils/clipboard';
import { parseIpList } from '../utils/apiKeyAccess';
import { useActionSet } from '../hooks/useActionSet';
import { useAccessForm } from '../hooks/useAccessForm';
import * as apiKeyService from '../services/apiKeyService';
import {
  AccessChoiceFields,
  AccessSummary,
  RestrictionFields,
} from './AccessFields';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Textarea } from './ui/Textarea';
import { Badge } from './ui/Badge';
import { Table, TableHeader, TableRow, TableHead, TableCell } from './ui/Table';
import { PageHeader } from './ui/PageHeader';
import { EmptyState } from './ui/EmptyState';

export default function ApiKeyManagement() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const revokingIds = useActionSet<string>();
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyExpiry, setNewKeyExpiry] = useState('');
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null);
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
      setNewlyCreatedKey(data.apiKey);
      toast.success(`API key "${name}" created!`);
      resetForm();
      await fetchKeys();
    } catch (error) {
      // The API client already shows the server's message.
      console.error('Failed to create API key:', error);
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (key: ApiKey) => {
    if (
      !confirm(
        `Revoke API key "${key.name}"? Anything using it stops working immediately. This cannot be undone.`,
      )
    ) {
      return;
    }

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

  const handleCopyKey = () => {
    if (newlyCreatedKey) {
      copyToClipboard(newlyCreatedKey);
    }
  };

  const ipCount = parseIpList(ipText).entries.length;
  const ipSummary =
    ipCount > 0 ? [`${ipCount} IP ${ipCount === 1 ? 'entry' : 'entries'}`] : [];

  if (loading) {
    return (
      <div>
        <PageHeader title="API Keys" icon={<Key className="w-6 h-6" />} />
        <p className="text-zinc-400">Loading API keys...</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="API Keys"
        description="Create and manage Personal Access Tokens for automation."
        icon={<Key className="w-6 h-6" />}
      />

      {/* Create Key Form */}
      <Card className="mb-6">
        <h3 className="text-sm font-medium text-zinc-400 mb-4">
          Create New API Key
        </h3>
        <form
          onSubmit={handleCreate}
          aria-label="Create API key"
          className="space-y-5"
        >
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <Input
                id="api-key-name"
                label="Name"
                placeholder="e.g., ci-deploy"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                disabled={creating}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="api-key-expiry"
                className="text-sm font-medium text-zinc-300"
              >
                Expires (optional)
              </label>
              <input
                id="api-key-expiry"
                type="date"
                className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-300 focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600 focus:outline-none"
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

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-1">
            <p className="text-xs text-zinc-500 flex items-start gap-1.5">
              <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              Access and restrictions can't be changed after the key is created.
              To change them, create a new key and revoke the old one.
            </p>
            <Button
              type="submit"
              variant="primary"
              disabled={creating}
              icon={<Plus className="w-3.5 h-3.5" />}
              className="shrink-0"
            >
              {creating ? 'Creating...' : 'Create Key'}
            </Button>
          </div>
        </form>
      </Card>

      {/* Newly Created Key Banner */}
      {newlyCreatedKey && (
        <Card className="mb-6 border-emerald-500/20 bg-emerald-500/5">
          <div className="flex flex-col gap-3">
            <p className="text-sm font-medium text-emerald-400">
              Your new API key:
            </p>
            <code className="block bg-zinc-950 rounded-lg px-4 py-3 font-mono text-sm text-zinc-200 break-all">
              {newlyCreatedKey}
            </code>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                icon={<Copy className="w-3.5 h-3.5" />}
                onClick={handleCopyKey}
              >
                Copy
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setNewlyCreatedKey(null)}
              >
                Dismiss
              </Button>
            </div>
            <p className="text-xs text-amber-400 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />
              Copy this key now. It will not be shown again.
            </p>
          </div>
        </Card>
      )}

      {/* Keys List */}
      <Card>
        <h3 className="text-sm font-medium text-zinc-400 mb-4">
          Your API Keys ({activeCount})
        </h3>

        {keys.length === 0 ? (
          <EmptyState
            icon={<Key className="w-8 h-8" />}
            title="No API keys yet"
            description="Create one above to get started."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableHead>Name</TableHead>
              <TableHead>Access</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Last used</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead>Actions</TableHead>
            </TableHeader>
            <tbody>
              {keys.map((key) => {
                const expBadge = getExpirationBadge(key.expiresAt);
                const revoked = key.revokedAt !== null;
                return (
                  <TableRow
                    key={key.id}
                    className={revoked ? 'opacity-60' : undefined}
                  >
                    <TableCell className="font-medium text-zinc-200">
                      {key.name}
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
                    <TableCell>
                      {new Date(key.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      {key.lastUsedAt ? (
                        <span title={new Date(key.lastUsedAt).toLocaleString()}>
                          {new Date(key.lastUsedAt).toLocaleDateString()}
                          {key.lastUsedIp && (
                            <span className="block text-xs text-zinc-500 font-mono">
                              {key.lastUsedIp}
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-zinc-500">Never</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {revoked ? (
                        <Badge variant="danger">
                          Revoked{' '}
                          {new Date(key.revokedAt!).toLocaleDateString()}
                        </Badge>
                      ) : (
                        <Badge variant={expBadge.variant}>
                          {expBadge.label}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {!revoked && (
                        <Button
                          size="sm"
                          variant="danger"
                          icon={<Ban className="w-3.5 h-3.5" />}
                          onClick={() => handleRevoke(key)}
                          disabled={revokingIds.has(key.id)}
                        >
                          {revokingIds.has(key.id) ? 'Revoking...' : 'Revoke'}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </tbody>
          </Table>
        )}
        {keys.length > activeCount && (
          <p className="text-xs text-zinc-500 mt-3">
            Revoked keys stay listed for 30 days.
          </p>
        )}
      </Card>
    </div>
  );
}
