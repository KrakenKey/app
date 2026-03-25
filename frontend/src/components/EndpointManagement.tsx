import { useState, useEffect, useCallback } from 'react';
import { Activity, Plus, Trash2, Power, PowerOff } from 'lucide-react';
import { toast } from '../utils/toast';
import type { Endpoint } from '@krakenkey/shared';
import { useActionSet } from '../hooks/useActionSet';
import * as endpointService from '../services/endpointService';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Badge } from './ui/Badge';
import { Table, TableHeader, TableRow, TableHead, TableCell } from './ui/Table';
import { PageHeader } from './ui/PageHeader';
import { EmptyState } from './ui/EmptyState';

export default function EndpointManagement() {
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const deletingIds = useActionSet<string>();
  const togglingIds = useActionSet<string>();

  // Form state
  const [newHost, setNewHost] = useState('');
  const [newPort, setNewPort] = useState('443');
  const [newLabel, setNewLabel] = useState('');

  const fetchAll = useCallback(async () => {
    try {
      setLoading(true);
      const data = await endpointService.fetchEndpoints();
      setEndpoints(data);
    } catch (error) {
      console.error('Failed to fetch endpoints:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const host = newHost.trim();
    if (!host) {
      toast.error('Please enter a hostname');
      return;
    }

    try {
      setCreating(true);
      const endpoint = await endpointService.createEndpoint({
        host,
        port: parseInt(newPort, 10) || 443,
        label: newLabel.trim() || undefined,
      });
      toast.success(`Endpoint ${endpoint.host}:${endpoint.port} added`);
      setNewHost('');
      setNewPort('443');
      setNewLabel('');
      setEndpoints((prev) => [endpoint, ...prev]);
    } catch (error) {
      console.error('Failed to create endpoint:', error);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (ep: Endpoint) => {
    if (
      !confirm(
        `Delete endpoint ${ep.host}:${ep.port}? This will remove all associated scan results.`,
      )
    ) {
      return;
    }

    try {
      deletingIds.add(ep.id);
      await endpointService.deleteEndpoint(ep.id);
      toast.success(`Endpoint ${ep.host}:${ep.port} deleted`);
      setEndpoints((prev) => prev.filter((e) => e.id !== ep.id));
    } catch (error) {
      console.error('Failed to delete endpoint:', error);
    } finally {
      deletingIds.remove(ep.id);
    }
  };

  const handleToggleActive = async (ep: Endpoint) => {
    try {
      togglingIds.add(ep.id);
      const updated = await endpointService.updateEndpoint(ep.id, {
        isActive: !ep.isActive,
      });
      setEndpoints((prev) =>
        prev.map((e) => (e.id === updated.id ? updated : e)),
      );
      toast.success(
        `Endpoint ${ep.host} ${updated.isActive ? 'enabled' : 'disabled'}`,
      );
    } catch (error) {
      console.error('Failed to toggle endpoint:', error);
    } finally {
      togglingIds.remove(ep.id);
    }
  };

  if (loading) {
    return (
      <div>
        <PageHeader title="Endpoints" icon={<Activity className="w-6 h-6" />} />
        <p className="text-zinc-400">Loading endpoints...</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Endpoints"
        description="Monitor TLS certificates on your endpoints. Connected and hosted probes scan these automatically."
        icon={<Activity className="w-6 h-6" />}
      />

      {/* Create Endpoint Form */}
      <Card className="mb-6">
        <h3 className="text-sm font-medium text-zinc-400 mb-4">Add Endpoint</h3>
        <form onSubmit={handleCreate}>
          <div className="flex flex-col sm:flex-row gap-3">
            <Input
              placeholder="Hostname (e.g., example.com)"
              value={newHost}
              onChange={(e) => setNewHost(e.target.value)}
              disabled={creating}
              className="flex-1"
            />
            <Input
              placeholder="Port"
              value={newPort}
              onChange={(e) => setNewPort(e.target.value)}
              disabled={creating}
              className="w-24"
            />
            <Input
              placeholder="Label (optional)"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              disabled={creating}
              className="flex-1"
            />
            <Button
              type="submit"
              variant="primary"
              disabled={creating}
              icon={<Plus className="w-3.5 h-3.5" />}
            >
              {creating ? 'Adding...' : 'Add'}
            </Button>
          </div>
        </form>
      </Card>

      {/* Endpoints List */}
      <Card>
        <h3 className="text-sm font-medium text-zinc-400 mb-4">
          Monitored Endpoints ({endpoints.length})
        </h3>

        {endpoints.length === 0 ? (
          <EmptyState
            icon={<Activity className="w-8 h-8" />}
            title="No endpoints yet"
            description="Add an endpoint above to start monitoring its TLS certificate."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableHead>Host</TableHead>
              <TableHead>Port</TableHead>
              <TableHead>Label</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Regions</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Actions</TableHead>
            </TableHeader>
            <tbody>
              {endpoints.map((ep) => (
                <TableRow key={ep.id}>
                  <TableCell className="font-medium text-zinc-200">
                    {ep.host}
                  </TableCell>
                  <TableCell>{ep.port}</TableCell>
                  <TableCell className="text-zinc-400">
                    {ep.label || '-'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={ep.isActive ? 'success' : 'danger'}>
                      {ep.isActive ? 'Active' : 'Disabled'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-zinc-400">
                    {ep.hostedRegions && ep.hostedRegions.length > 0
                      ? ep.hostedRegions.map((r) => r.region).join(', ')
                      : '-'}
                  </TableCell>
                  <TableCell>
                    {new Date(ep.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={
                          ep.isActive ? (
                            <PowerOff className="w-3.5 h-3.5" />
                          ) : (
                            <Power className="w-3.5 h-3.5" />
                          )
                        }
                        onClick={() => handleToggleActive(ep)}
                        disabled={togglingIds.has(ep.id)}
                      >
                        {ep.isActive ? 'Disable' : 'Enable'}
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        icon={<Trash2 className="w-3.5 h-3.5" />}
                        onClick={() => handleDelete(ep)}
                        disabled={deletingIds.has(ep.id)}
                      >
                        {deletingIds.has(ep.id) ? 'Deleting...' : 'Delete'}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
