import { useState, useEffect, useCallback } from 'react';
import { Key, Plus, Trash2, Copy, AlertTriangle } from 'lucide-react';
import { toast } from '../utils/toast';
import type { ApiKey } from '@krakenkey/shared';
import { getExpirationBadge } from '../utils/expiration';
import { copyToClipboard } from '../utils/clipboard';
import { useActionSet } from '../hooks/useActionSet';
import * as apiKeyService from '../services/apiKeyService';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Badge } from './ui/Badge';
import { Table, TableHeader, TableRow, TableHead, TableCell } from './ui/Table';
import { PageHeader } from './ui/PageHeader';
import { EmptyState } from './ui/EmptyState';

export default function ApiKeyManagement() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const deletingIds = useActionSet<string>();
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyExpiry, setNewKeyExpiry] = useState('');
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null);

  const fetchKeys = useCallback(async () => {
    try {
      setLoading(true);
      const data = await apiKeyService.fetchApiKeys();
      setKeys(data);
    } catch (error) {
      console.error('Failed to fetch API keys:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newKeyName.trim();
    if (!name) {
      toast.error('Please enter a name for the API key');
      return;
    }

    try {
      setCreating(true);
      const data = await apiKeyService.createApiKey(
        name,
        newKeyExpiry || undefined,
      );
      setNewlyCreatedKey(data.apiKey);
      toast.success(`API key "${name}" created!`);
      setNewKeyName('');
      setNewKeyExpiry('');
      await fetchKeys();
    } catch (error) {
      console.error('Failed to create API key:', error);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (key: ApiKey) => {
    if (
      !confirm(
        `Are you sure you want to delete API key "${key.name}"? This cannot be undone.`,
      )
    ) {
      return;
    }

    try {
      deletingIds.add(key.id);
      await apiKeyService.deleteApiKey(key.id);
      toast.success(`API key "${key.name}" deleted.`);
      setKeys((prev) => prev.filter((k) => k.id !== key.id));
    } catch (error) {
      console.error('Failed to delete API key:', error);
    } finally {
      deletingIds.remove(key.id);
    }
  };

  const handleCopyKey = () => {
    if (newlyCreatedKey) {
      copyToClipboard(newlyCreatedKey);
    }
  };

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
        <form onSubmit={handleCreate}>
          <div className="flex flex-col sm:flex-row gap-3">
            <Input
              placeholder="Key name (e.g., ci-deploy)"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              disabled={creating}
              className="flex-1"
            />
            <input
              type="date"
              className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-300 focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600 focus:outline-none"
              value={newKeyExpiry}
              onChange={(e) => setNewKeyExpiry(e.target.value)}
              disabled={creating}
              min={new Date().toISOString().split('T')[0]}
            />
            <Button
              type="submit"
              variant="primary"
              disabled={creating}
              icon={<Plus className="w-3.5 h-3.5" />}
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
          Your API Keys ({keys.length})
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
              <TableHead>Created</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead>Actions</TableHead>
            </TableHeader>
            <tbody>
              {keys.map((key) => {
                const expBadge = getExpirationBadge(key.expiresAt);
                return (
                  <TableRow key={key.id}>
                    <TableCell className="font-medium text-zinc-200">
                      {key.name}
                    </TableCell>
                    <TableCell>
                      {new Date(key.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Badge variant={expBadge.variant}>{expBadge.label}</Badge>
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="danger"
                        icon={<Trash2 className="w-3.5 h-3.5" />}
                        onClick={() => handleDelete(key)}
                        disabled={deletingIds.has(key.id)}
                      >
                        {deletingIds.has(key.id) ? 'Deleting...' : 'Delete'}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
