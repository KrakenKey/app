import { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import { toast } from '../utils/toast';
import { API_ROUTES } from '@krakenkey/shared';
import type { ApiKey, CreateApiKeyResponse } from '@krakenkey/shared';
import './ApiKeyManagement.css';

export default function ApiKeyManagement() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyExpiry, setNewKeyExpiry] = useState('');
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null);

  const fetchKeys = useCallback(async () => {
    try {
      setLoading(true);
      const response = await api.get<ApiKey[]>(API_ROUTES.API_KEYS.BASE);
      setKeys(response.data);
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
      const payload: { name: string; expiresAt?: string } = { name };
      if (newKeyExpiry) {
        payload.expiresAt = new Date(newKeyExpiry + 'T23:59:59Z').toISOString();
      }
      const response = await api.post<CreateApiKeyResponse>(
        API_ROUTES.API_KEYS.BASE,
        payload,
      );
      setNewlyCreatedKey(response.data.apiKey);
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
    if (!confirm(`Are you sure you want to delete API key "${key.name}"? This cannot be undone.`)) {
      return;
    }

    try {
      setDeletingIds((prev) => new Set(prev).add(key.id));
      await api.delete(API_ROUTES.API_KEYS.BY_ID(key.id));
      toast.success(`API key "${key.name}" deleted.`);
      setKeys((prev) => prev.filter((k) => k.id !== key.id));
    } catch (error) {
      console.error('Failed to delete API key:', error);
    } finally {
      setDeletingIds((prev) => {
        const next = new Set(prev);
        next.delete(key.id);
        return next;
      });
    }
  };

  const handleCopyKey = () => {
    if (newlyCreatedKey) {
      navigator.clipboard.writeText(newlyCreatedKey);
      toast.success('API key copied to clipboard!');
    }
  };

  const getExpirationStatus = (expiresAt: string | null): { label: string; className: string } => {
    if (!expiresAt) return { label: 'Never', className: '' };
    const expiry = new Date(expiresAt);
    const now = new Date();
    const daysLeft = Math.floor((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    if (daysLeft < 0) return { label: `Expired ${Math.abs(daysLeft)}d ago`, className: 'expired' };
    if (daysLeft < 7) return { label: `${daysLeft}d remaining`, className: 'expiring-critical' };
    if (daysLeft <= 30) return { label: `${daysLeft}d remaining`, className: 'expiring-soon' };
    return { label: expiry.toLocaleDateString(), className: 'healthy' };
  };

  if (loading) {
    return (
      <div className="apikey-management">
        <h2>API Key Management</h2>
        <p>Loading API keys...</p>
      </div>
    );
  }

  return (
    <div className="apikey-management">
      <h2>API Key Management</h2>
      <p className="subtitle">Create and manage Personal Access Tokens for automation.</p>

      {/* Create Key Form */}
      <div className="create-key-section">
        <h3>Create New API Key</h3>
        <form onSubmit={handleCreate} className="create-key-form">
          <div className="form-row">
            <input
              type="text"
              className="key-name-input"
              placeholder="Key name (e.g., ci-deploy)"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              disabled={creating}
            />
            <input
              type="date"
              className="key-expiry-input"
              value={newKeyExpiry}
              onChange={(e) => setNewKeyExpiry(e.target.value)}
              disabled={creating}
              min={new Date().toISOString().split('T')[0]}
            />
            <button type="submit" disabled={creating} className="btn-primary">
              {creating ? 'Creating...' : 'Create Key'}
            </button>
          </div>
        </form>
      </div>

      {/* Newly Created Key Banner */}
      {newlyCreatedKey && (
        <div className="new-key-banner">
          <strong>Your new API key:</strong>
          <code className="key-display">{newlyCreatedKey}</code>
          <div className="new-key-actions">
            <button onClick={handleCopyKey} className="btn-secondary btn-small">
              Copy
            </button>
            <button
              onClick={() => setNewlyCreatedKey(null)}
              className="btn-secondary btn-small"
            >
              Dismiss
            </button>
          </div>
          <p className="key-warning">
            Copy this key now. It will not be shown again.
          </p>
        </div>
      )}

      {/* Keys List */}
      <div className="keys-list">
        <h3>Your API Keys ({keys.length})</h3>

        {keys.length === 0 ? (
          <p className="empty-state">
            No API keys yet. Create one above to get started.
          </p>
        ) : (
          <table className="keys-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Created</th>
                <th>Expires</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => {
                const expStatus = getExpirationStatus(key.expiresAt);
                return (
                  <tr key={key.id}>
                    <td className="key-name">{key.name}</td>
                    <td>{new Date(key.createdAt).toLocaleDateString()}</td>
                    <td className={expStatus.className}>{expStatus.label}</td>
                    <td>
                      <button
                        onClick={() => handleDelete(key)}
                        disabled={deletingIds.has(key.id)}
                        className="btn-danger btn-small"
                      >
                        {deletingIds.has(key.id) ? 'Deleting...' : 'Delete'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
