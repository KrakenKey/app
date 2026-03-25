import { useState, useEffect, useCallback } from 'react';
import {
  Activity,
  Plus,
  Trash2,
  Power,
  PowerOff,
  ChevronDown,
  ChevronRight,
  Download,
  Server,
  Cloud,
} from 'lucide-react';
import { toast } from '../utils/toast';
import type { Endpoint, ProbeScanResult } from '@krakenkey/shared';
import { useActionSet } from '../hooks/useActionSet';
import * as endpointService from '../services/endpointService';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Badge } from './ui/Badge';
import { Table, TableHeader, TableRow, TableHead, TableCell } from './ui/Table';
import { PageHeader } from './ui/PageHeader';
import { EmptyState } from './ui/EmptyState';

function ProbeSourceBadge({ result }: { result: ProbeScanResult }) {
  if (result.probeMode === 'hosted') {
    return (
      <Badge variant="info" dot={false}>
        <Cloud className="w-3 h-3 mr-1" />
        Managed
      </Badge>
    );
  }
  if (result.probeMode === 'connected') {
    return (
      <Badge variant="neutral" dot={false}>
        <Server className="w-3 h-3 mr-1" />
        Connected
      </Badge>
    );
  }
  return <Badge variant="neutral">-</Badge>;
}

function CertExpiryBadge({ days }: { days: number | undefined }) {
  if (days == null) return <span className="text-zinc-500">-</span>;
  if (days <= 7) return <Badge variant="danger">{days}d</Badge>;
  if (days <= 30) return <Badge variant="warning">{days}d</Badge>;
  return <Badge variant="success">{days}d</Badge>;
}

function ScanResultsPanel({ endpointId }: { endpointId: string }) {
  const [results, setResults] = useState<ProbeScanResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 10;

  const fetchPage = useCallback(
    async (p: number) => {
      try {
        setLoading(true);
        const res = await endpointService.fetchResults(endpointId, p, limit);
        setResults(res.data);
        setTotal(res.total);
        setPage(p);
      } catch (error) {
        console.error('Failed to fetch scan results:', error);
      } finally {
        setLoading(false);
      }
    },
    [endpointId],
  );

  useEffect(() => {
    fetchPage(1);
  }, [fetchPage]);

  const totalPages = Math.ceil(total / limit);

  const handleExport = (format: 'json' | 'csv') => {
    const url = endpointService.getExportUrl(endpointId, format);
    const token = localStorage.getItem('access_token');
    // Use fetch with auth header to download
    fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error('Export failed');
        return res.blob();
      })
      .then((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `scan_results.${format}`;
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch(() => toast.error('Failed to export scan results'));
  };

  if (loading && results.length === 0) {
    return (
      <div className="px-4 py-3 text-sm text-zinc-500">
        Loading scan results...
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="px-4 py-3 text-sm text-zinc-500">
        No scan results yet. Results will appear once a probe scans this
        endpoint.
      </div>
    );
  }

  return (
    <div className="px-2 pb-3">
      {/* Export buttons */}
      <div className="flex items-center justify-between mb-3 px-2">
        <span className="text-xs text-zinc-500">
          {total} result{total !== 1 ? 's' : ''}
        </span>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="ghost"
            icon={<Download className="w-3 h-3" />}
            onClick={() => handleExport('csv')}
          >
            CSV
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<Download className="w-3 h-3" />}
            onClick={() => handleExport('json')}
          >
            JSON
          </Button>
        </div>
      </div>

      {/* Results table */}
      <Table>
        <TableHeader>
          <TableHead>Scanned</TableHead>
          <TableHead>Source</TableHead>
          <TableHead>Region</TableHead>
          <TableHead>TLS</TableHead>
          <TableHead>Cert Subject</TableHead>
          <TableHead>Expiry</TableHead>
          <TableHead>Trusted</TableHead>
          <TableHead>Latency</TableHead>
        </TableHeader>
        <tbody>
          {results.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="text-zinc-400 text-xs whitespace-nowrap">
                {new Date(r.scannedAt).toLocaleString()}
              </TableCell>
              <TableCell>
                <ProbeSourceBadge result={r} />
              </TableCell>
              <TableCell className="text-zinc-400 text-xs">
                {r.probeRegion || '-'}
              </TableCell>
              <TableCell>
                {r.connectionSuccess ? (
                  <Badge variant="success" dot={false}>
                    {r.tlsVersion || 'OK'}
                  </Badge>
                ) : (
                  <Badge variant="danger">Failed</Badge>
                )}
              </TableCell>
              <TableCell
                className="text-zinc-300 text-xs max-w-[180px] truncate"
                title={r.certSubject ?? undefined}
              >
                {r.certSubject || '-'}
              </TableCell>
              <TableCell>
                <CertExpiryBadge days={r.certDaysUntilExpiry} />
              </TableCell>
              <TableCell>
                {r.certTrusted == null ? (
                  <span className="text-zinc-500">-</span>
                ) : r.certTrusted ? (
                  <span className="text-emerald-400">Yes</span>
                ) : (
                  <span className="text-red-400">No</span>
                )}
              </TableCell>
              <TableCell className="text-zinc-400 text-xs">
                {r.latencyMs != null ? `${r.latencyMs}ms` : '-'}
              </TableCell>
            </TableRow>
          ))}
        </tbody>
      </Table>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 mt-3">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => fetchPage(page - 1)}
            disabled={page <= 1 || loading}
          >
            Previous
          </Button>
          <span className="text-xs text-zinc-500">
            Page {page} of {totalPages}
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => fetchPage(page + 1)}
            disabled={page >= totalPages || loading}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}

export default function EndpointManagement() {
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const deletingIds = useActionSet<string>();
  const togglingIds = useActionSet<string>();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Latest results per endpoint (for the summary row)
  const [latestResults, setLatestResults] = useState<
    Record<string, ProbeScanResult[]>
  >({});

  // Form state
  const [newHost, setNewHost] = useState('');
  const [newPort, setNewPort] = useState('443');
  const [newLabel, setNewLabel] = useState('');

  const fetchAll = useCallback(async () => {
    try {
      setLoading(true);
      const data = await endpointService.fetchEndpoints();
      setEndpoints(data);

      // Fetch latest results for each endpoint
      const latestMap: Record<string, ProbeScanResult[]> = {};
      await Promise.all(
        data.map(async (ep) => {
          try {
            const latest = await endpointService.fetchLatestResults(ep.id);
            latestMap[ep.id] = latest;
          } catch {
            latestMap[ep.id] = [];
          }
        }),
      );
      setLatestResults(latestMap);
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
      if (expandedId === ep.id) setExpandedId(null);
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

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  /** Derive a summary from the latest scan results for an endpoint */
  const getSummary = (epId: string) => {
    const results = latestResults[epId] ?? [];
    if (results.length === 0) return null;

    const hasHosted = results.some((r) => r.probeMode === 'hosted');
    const hasConnected = results.some((r) => r.probeMode === 'connected');
    const worstExpiry = results.reduce(
      (min, r) =>
        r.certDaysUntilExpiry != null &&
        (min == null || r.certDaysUntilExpiry < min)
          ? r.certDaysUntilExpiry
          : min,
      null as number | null,
    );
    const allTrusted = results.every((r) => r.certTrusted === true);
    const anyFailed = results.some((r) => !r.connectionSuccess);
    const latestScan = results.reduce(
      (latest, r) =>
        !latest || new Date(r.scannedAt) > new Date(latest)
          ? r.scannedAt
          : latest,
      '' as string,
    );

    return {
      hasHosted,
      hasConnected,
      worstExpiry,
      allTrusted,
      anyFailed,
      latestScan,
    };
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
              <TableHead className="w-8" />
              <TableHead>Host</TableHead>
              <TableHead>Port</TableHead>
              <TableHead>Label</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Probe Source</TableHead>
              <TableHead>Cert Expiry</TableHead>
              <TableHead>Last Scan</TableHead>
              <TableHead>Actions</TableHead>
            </TableHeader>
            <tbody>
              {endpoints.map((ep) => {
                const summary = getSummary(ep.id);
                const isExpanded = expandedId === ep.id;

                return (
                  <>
                    <TableRow
                      key={ep.id}
                      className="cursor-pointer"
                      onClick={() => toggleExpand(ep.id)}
                    >
                      <TableCell className="w-8 pr-0">
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4 text-zinc-500" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-zinc-500" />
                        )}
                      </TableCell>
                      <TableCell className="font-medium text-zinc-200">
                        {ep.host}
                      </TableCell>
                      <TableCell>{ep.port}</TableCell>
                      <TableCell className="text-zinc-400">
                        {ep.label || '-'}
                      </TableCell>
                      <TableCell>
                        {summary?.anyFailed ? (
                          <Badge variant="danger">Error</Badge>
                        ) : (
                          <Badge variant={ep.isActive ? 'success' : 'neutral'}>
                            {ep.isActive ? 'Active' : 'Disabled'}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          {summary?.hasHosted && (
                            <Badge variant="info" dot={false}>
                              <Cloud className="w-3 h-3 mr-0.5" />
                              Managed
                            </Badge>
                          )}
                          {summary?.hasConnected && (
                            <Badge variant="neutral" dot={false}>
                              <Server className="w-3 h-3 mr-0.5" />
                              Connected
                            </Badge>
                          )}
                          {!summary && (
                            <span className="text-zinc-500 text-xs">
                              No probes
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {summary ? (
                          <CertExpiryBadge
                            days={summary.worstExpiry ?? undefined}
                          />
                        ) : (
                          <span className="text-zinc-500">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-zinc-400 text-xs whitespace-nowrap">
                        {summary?.latestScan
                          ? new Date(summary.latestScan).toLocaleString()
                          : '-'}
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
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
                            {deletingIds.has(ep.id) ? '...' : 'Delete'}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                    {isExpanded && (
                      <tr key={`${ep.id}-detail`}>
                        <td
                          colSpan={9}
                          className="bg-zinc-900/50 border-b border-zinc-800/50"
                        >
                          <ScanResultsPanel endpointId={ep.id} />
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
