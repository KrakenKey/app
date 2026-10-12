import { useState, useEffect, useCallback, useRef, Fragment } from 'react';
import { useSearchParams } from 'react-router-dom';
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
  RefreshCw,
} from 'lucide-react';
import { toast } from '../utils/toast';
import type { Endpoint, ProbeScanResult } from '@krakenkey/shared';
import type { ProbeOption } from '../services/endpointService';
import { useActionSet } from '../hooks/useActionSet';
import { useConfirm } from '../hooks/useConfirm';
import * as endpointService from '../services/endpointService';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Badge, type BadgeVariant } from './ui/Badge';
import { Modal } from './ui/Modal';
import { RowMenu } from './ui/Menu';
import {
  issuerName,
  summarizeEndpoint,
  type EndpointState,
  type EndpointSummary,
} from '../utils/accountHealth';
import { formatRelative } from '../utils/connectors';
import { Table, TableHeader, TableRow, TableHead, TableCell } from './ui/Table';
import { PageHeader } from './ui/PageHeader';
import { EmptyState } from './ui/EmptyState';

function ProbeSourceBadge({ result }: { result: ProbeScanResult }) {
  if (result.probeMode === 'hosted') {
    return (
      <Badge variant="neutral" dot={false}>
        <Cloud className="w-3 h-3" />
        Hosted
      </Badge>
    );
  }
  if (result.probeMode === 'connected') {
    return (
      <Badge variant="neutral" dot={false}>
        <Server className="w-3 h-3" />
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
  return <span className="tnum text-zinc-300">{days}d</span>;
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
                {new Date(r.scannedAt).toLocaleString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </TableCell>
              <TableCell>
                <ProbeSourceBadge result={r} />
              </TableCell>
              <TableCell className="text-zinc-400 text-xs">
                {r.probeRegion || '-'}
              </TableCell>
              <TableCell>
                {r.connectionSuccess ? (
                  <Badge variant="ok" dot={false}>
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
                  <span className="text-zinc-300">Yes</span>
                ) : (
                  <span className="text-red-300">No</span>
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
  const confirm = useConfirm();
  const togglingIds = useActionSet<string>();
  const scanningIds = useActionSet<string>();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scanRequestedRef = useRef<{ endpointId: string; at: Date } | null>(
    null,
  );

  // Latest results per endpoint (for the summary row)
  const [latestResults, setLatestResults] = useState<
    Record<string, ProbeScanResult[]>
  >({});

  // Available connected probes for assignment
  const [availableProbes, setAvailableProbes] = useState<ProbeOption[]>([]);

  // Form state
  const [newHost, setNewHost] = useState('');
  const [newPort, setNewPort] = useState('443');
  const [newLabel, setNewLabel] = useState('');
  const [useManaged, setUseManaged] = useState(true);
  const [selectedProbeIds, setSelectedProbeIds] = useState<string[]>([]);
  const [searchParams, setSearchParams] = useSearchParams();
  const [addOpen, setAddOpen] = useState(() => searchParams.get('add') === '1');

  const fetchAll = useCallback(async () => {
    try {
      setLoading(true);
      const [data, probes] = await Promise.all([
        endpointService.fetchEndpoints(),
        endpointService.fetchUserProbes().catch(() => [] as ProbeOption[]),
      ]);
      setEndpoints(data);
      setAvailableProbes(probes);

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

    if (!useManaged && selectedProbeIds.length === 0) {
      toast.error('Select at least one probe or enable managed monitoring');
      return;
    }

    try {
      setCreating(true);
      const endpoint = await endpointService.createEndpoint({
        host,
        port: parseInt(newPort, 10) || 443,
        label: newLabel.trim() || undefined,
        probeIds: selectedProbeIds.length > 0 ? selectedProbeIds : undefined,
        hostedRegions: useManaged ? ['us-east-1'] : undefined,
      });
      toast.success(`Endpoint ${endpoint.host}:${endpoint.port} added`);
      setNewHost('');
      setNewPort('443');
      setNewLabel('');
      setUseManaged(true);
      setSelectedProbeIds([]);
      setAddOpen(false);
      setEndpoints((prev) => [endpoint, ...prev]);
    } catch (error) {
      console.error('Failed to create endpoint:', error);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (ep: Endpoint) => {
    const ok = await confirm({
      title: 'Delete endpoint?',
      body: (
        <>
          <strong className="text-text">
            {ep.host}:{ep.port}
          </strong>{' '}
          stops being monitored, and all of its scan results are deleted.
        </>
      ),
      confirmLabel: 'Delete endpoint',
    });
    if (!ok) return;

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

  const stopAutoRefresh = useCallback(() => {
    if (refreshTimerRef.current) {
      clearInterval(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
    scanRequestedRef.current = null;
  }, []);

  const startAutoRefresh = useCallback(
    (endpointId: string) => {
      if (refreshTimerRef.current) return;
      const requestedAt = new Date();
      scanRequestedRef.current = { endpointId, at: requestedAt };
      let ticks = 0;
      refreshTimerRef.current = setInterval(() => {
        ticks++;
        fetchAll();
        if (ticks >= 6) {
          stopAutoRefresh();
        }
      }, 10_000);
    },
    [fetchAll, stopAutoRefresh],
  );

  // Stop polling once fresh results arrive for the scanned endpoint
  useEffect(() => {
    const req = scanRequestedRef.current;
    if (!req || !refreshTimerRef.current) return;
    const results = latestResults[req.endpointId] ?? [];
    const hasFreshResult = results.some(
      (r) => r.scannedAt && new Date(r.scannedAt) > req.at,
    );
    if (hasFreshResult) {
      stopAutoRefresh();
    }
  }, [latestResults, stopAutoRefresh]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    };
  }, []);

  const handleRequestScan = async (ep: Endpoint) => {
    try {
      scanningIds.add(ep.id);
      await endpointService.requestScan(ep.id);
      toast.success(`Scan requested for ${ep.host}:${ep.port}`);
      startAutoRefresh(ep.id);
    } catch (error) {
      console.error('Failed to request scan:', error);
    } finally {
      scanningIds.remove(ep.id);
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const getSummary = (ep: Endpoint) =>
    summarizeEndpoint(ep, latestResults[ep.id] ?? []);

  const closeAdd = () => {
    setAddOpen(false);
    if (searchParams.has('add')) {
      searchParams.delete('add');
      setSearchParams(searchParams, { replace: true });
    }
  };

  const addButton = (
    <Button
      variant="primary"
      icon={<Plus className="w-4 h-4" />}
      onClick={() => setAddOpen(true)}
    >
      Add endpoint
    </Button>
  );

  if (loading) {
    return (
      <div>
        <PageHeader title="Endpoints" icon={<Activity className="w-6 h-6" />} />
        <p className="text-zinc-400">Loading endpoints...</p>
      </div>
    );
  }

  const chipClass = (selected: boolean) =>
    `inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
      selected
        ? 'border-cyan-400/50 bg-cyan-400/10 text-cyan-200'
        : 'border-border-strong/70 bg-bg text-zinc-400 hover:border-border-strong hover:text-zinc-200'
    }`;

  const problems = endpoints.filter((ep) => {
    const s = getSummary(ep).state;
    return s === 'unreachable' || s === 'untrusted';
  }).length;

  return (
    <div>
      <PageHeader
        title="Endpoints"
        description="Monitor TLS certificates on your endpoints. Connected and hosted probes scan these automatically."
        icon={<Activity className="w-6 h-6" />}
        actions={addButton}
      />

      {/* Add endpoint (modal) */}
      <Modal
        open={addOpen}
        onClose={closeAdd}
        title="Add endpoint"
        description="A host and port to scan. Hosted probes run from KrakenKey; connected probes run on your network."
      >
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid grid-cols-[1fr_96px] gap-3">
            <Input
              label="Hostname"
              placeholder="example.com"
              value={newHost}
              onChange={(e) => setNewHost(e.target.value)}
              disabled={creating}
            />
            <Input
              label="Port"
              placeholder="443"
              value={newPort}
              onChange={(e) => setNewPort(e.target.value)}
              disabled={creating}
              className="tnum"
            />
          </div>
          <Input
            label="Label"
            placeholder="Optional, e.g. Client portal"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            disabled={creating}
          />

          <div>
            <p className="text-sm font-medium text-zinc-300 mb-2">
              Monitoring source
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setUseManaged((prev) => !prev)}
                disabled={creating}
                aria-pressed={useManaged}
                className={chipClass(useManaged)}
              >
                <Cloud className="w-3.5 h-3.5" />
                Managed probe
              </button>

              {availableProbes.map((probe) => {
                const selected = selectedProbeIds.includes(probe.id);
                return (
                  <button
                    key={probe.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() =>
                      setSelectedProbeIds((prev) =>
                        selected
                          ? prev.filter((id) => id !== probe.id)
                          : [...prev, probe.id],
                      )
                    }
                    disabled={creating}
                    className={chipClass(selected)}
                  >
                    <Server className="w-3.5 h-3.5" />
                    {probe.name}
                    {probe.region && (
                      <span className="text-zinc-500">({probe.region})</span>
                    )}
                    {probe.status === 'stale' && (
                      <span className="text-amber-300 text-[11px]">stale</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={closeAdd}>
              Cancel
            </Button>
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
      </Modal>

      {/* Endpoints List */}
      <Card flush>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-border-subtle">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-semibold text-zinc-100">
              Monitored Endpoints ({endpoints.length})
            </h3>
            {problems > 0 && <Badge variant="danger">{problems} failing</Badge>}
          </div>
          <Button
            size="sm"
            variant="ghost"
            icon={
              <RefreshCw
                className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`}
              />
            }
            onClick={fetchAll}
            disabled={loading}
          >
            Refresh
          </Button>
        </div>

        {endpoints.length === 0 ? (
          <EmptyState
            icon={<Activity className="w-6 h-6" />}
            title="No endpoints yet"
            description="Add an endpoint to start monitoring its TLS certificate."
            action={addButton}
          />
        ) : (
          <Table className="md:min-w-[860px]">
            <TableHeader>
              <TableHead className="w-10 pl-5 pr-0" />
              <TableHead className="pl-1">Endpoint</TableHead>
              <TableHead className="hidden sm:table-cell">Status</TableHead>
              <TableHead className="hidden lg:table-cell">Source</TableHead>
              <TableHead className="hidden md:table-cell text-right">
                Expiry
              </TableHead>
              <TableHead className="hidden md:table-cell">Last scan</TableHead>
              <TableHead className="text-right pr-5">Actions</TableHead>
            </TableHeader>
            <tbody>
              {endpoints.map((ep) => {
                const summary = getSummary(ep);
                const isExpanded = expandedId === ep.id;
                const regions = ep.hostedRegions?.length ?? 0;
                const probes = ep.probeAssignments?.length ?? 0;

                return (
                  <Fragment key={ep.id}>
                    <TableRow
                      className={`cursor-pointer ${isExpanded ? 'bg-white/[0.025]' : ''} ${!ep.isActive ? 'opacity-60' : ''}`}
                      onClick={() => toggleExpand(ep.id)}
                    >
                      <TableCell className="w-10 pl-5 pr-0">
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4 text-zinc-500" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-zinc-500" />
                        )}
                      </TableCell>
                      <TableCell className="pl-1 max-w-[210px] sm:max-w-[320px]">
                        <div
                          className="truncate whitespace-nowrap font-medium text-zinc-100"
                          title={`${ep.host}:${ep.port}`}
                        >
                          <span>{ep.host}</span>
                          {ep.port !== 443 && (
                            <span className="text-zinc-500 font-normal">
                              :{ep.port}
                            </span>
                          )}
                        </div>
                        {ep.label && (
                          <div className="truncate text-xs text-zinc-500">
                            {ep.label}
                          </div>
                        )}
                        <div className="mt-1.5 flex items-center gap-2 text-xs md:hidden">
                          <span className="sm:hidden">
                            <EndpointStatusBadge summary={summary} />
                          </span>
                          {summary.worstExpiry != null && (
                            <ExpiryDays days={summary.worstExpiry} />
                          )}
                          {summary.latestScan && (
                            <span className="whitespace-nowrap text-zinc-500">
                              {formatRelative(summary.latestScan)}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <EndpointStatusBadge summary={summary} />
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <div className="flex items-center gap-3 text-xs text-zinc-400 whitespace-nowrap">
                          {regions > 0 && (
                            <span
                              className="inline-flex items-center gap-1"
                              title={ep.hostedRegions
                                ?.map((r) => r.region)
                                .join(', ')}
                            >
                              <Cloud className="w-3.5 h-3.5 text-zinc-500" />
                              Hosted
                              {regions > 1 && (
                                <span className="tnum text-zinc-500">
                                  x{regions}
                                </span>
                              )}
                            </span>
                          )}
                          {probes > 0 && (
                            <span
                              className="inline-flex items-center gap-1"
                              title={ep.probeAssignments
                                ?.map((a) => a.probe?.name ?? a.probeId)
                                .join(', ')}
                            >
                              <Server className="w-3.5 h-3.5 text-zinc-500" />
                              {probes === 1
                                ? (ep.probeAssignments?.[0]?.probe?.name ??
                                  '1 probe')
                                : `${probes} probes`}
                            </span>
                          )}
                          {regions === 0 && probes === 0 && (
                            <span className="text-zinc-500">None</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-right">
                        {summary.worstExpiry != null ? (
                          <ExpiryDays days={summary.worstExpiry} />
                        ) : (
                          <span className="text-zinc-600">&mdash;</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden md:table-cell whitespace-nowrap text-xs text-zinc-400">
                        {summary.latestScan ? (
                          <span
                            title={new Date(
                              summary.latestScan,
                            ).toLocaleString()}
                          >
                            {formatRelative(summary.latestScan)}
                          </span>
                        ) : (
                          '-'
                        )}
                      </TableCell>
                      <TableCell
                        className="pr-5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            size="sm"
                            variant="secondary"
                            icon={
                              <RefreshCw
                                className={`w-3.5 h-3.5 ${scanningIds.has(ep.id) ? 'animate-spin' : ''}`}
                              />
                            }
                            onClick={() => handleRequestScan(ep)}
                            disabled={scanningIds.has(ep.id) || !ep.isActive}
                            aria-label={`Scan ${ep.host}`}
                          >
                            <span className="hidden sm:inline">Scan</span>
                          </Button>
                          <RowMenu
                            label={`More actions for ${ep.host}`}
                            items={[
                              {
                                label: ep.isActive ? 'Disable' : 'Enable',
                                icon: ep.isActive ? (
                                  <PowerOff className="w-3.5 h-3.5" />
                                ) : (
                                  <Power className="w-3.5 h-3.5" />
                                ),
                                onClick: () => handleToggleActive(ep),
                                disabled: togglingIds.has(ep.id),
                              },
                              {
                                label: deletingIds.has(ep.id)
                                  ? 'Deleting...'
                                  : 'Delete',
                                icon: <Trash2 className="w-3.5 h-3.5" />,
                                onClick: () => handleDelete(ep),
                                danger: true,
                                disabled: deletingIds.has(ep.id),
                              },
                            ]}
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                    {isExpanded && (
                      <tr>
                        <td
                          colSpan={7}
                          className="bg-bg/40 border-b border-border-subtle"
                        >
                          <div className="flex flex-wrap gap-x-6 gap-y-2 px-5 pt-4 pb-1 text-xs">
                            {summary.error && (
                              <span className="text-red-300">
                                {summary.error}
                              </span>
                            )}
                            {summary.untrustedIssuer && (
                              <span className="text-red-300">
                                Untrusted issuer:{' '}
                                {issuerName(summary.untrustedIssuer)}
                              </span>
                            )}
                            {ep.probeAssignments &&
                              ep.probeAssignments.length > 0 && (
                                <span className="flex items-center gap-1.5 text-zinc-500">
                                  Assigned probes:
                                  {ep.probeAssignments.map((a) => (
                                    <Badge
                                      key={a.id}
                                      variant="neutral"
                                      dot={false}
                                    >
                                      <Server className="w-3 h-3" />
                                      {a.probe?.name ?? a.probeId}
                                    </Badge>
                                  ))}
                                </span>
                              )}
                            {ep.hostedRegions &&
                              ep.hostedRegions.length > 0 && (
                                <span className="flex items-center gap-1.5 text-zinc-500">
                                  Hosted regions:
                                  {ep.hostedRegions.map((r) => (
                                    <Badge
                                      key={r.id}
                                      variant="neutral"
                                      dot={false}
                                    >
                                      <Cloud className="w-3 h-3" />
                                      {r.region}
                                    </Badge>
                                  ))}
                                </span>
                              )}
                          </div>
                          <ScanResultsPanel endpointId={ep.id} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

const STATE_BADGE: Record<
  EndpointState,
  { label: string; variant: BadgeVariant }
> = {
  unreachable: { label: 'Unreachable', variant: 'danger' },
  untrusted: { label: 'Untrusted chain', variant: 'danger' },
  expiring: { label: 'Expiring', variant: 'warning' },
  healthy: { label: 'Healthy', variant: 'ok' },
  unscanned: { label: 'Not scanned', variant: 'neutral' },
  disabled: { label: 'Disabled', variant: 'neutral' },
};

function EndpointStatusBadge({ summary }: { summary: EndpointSummary }) {
  const { label, variant } = STATE_BADGE[summary.state];
  const title =
    summary.state === 'unreachable'
      ? (summary.error ?? undefined)
      : summary.state === 'untrusted'
        ? `Issued by ${issuerName(summary.untrustedIssuer) ?? 'an untrusted CA'}`
        : undefined;
  return (
    <Badge variant={variant} title={title}>
      {label}
    </Badge>
  );
}

/** Days left; colored only when it needs attention. */
function ExpiryDays({ days }: { days: number }) {
  const tone =
    days <= 7
      ? 'text-red-300'
      : days <= 30
        ? 'text-amber-300'
        : 'text-zinc-300';
  return <span className={`tnum whitespace-nowrap ${tone}`}>{days}d</span>;
}
