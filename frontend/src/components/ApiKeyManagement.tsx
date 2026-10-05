import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Key,
  Plus,
  Ban,
  Copy,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Info,
} from 'lucide-react';
import { toast } from '../utils/toast';
import {
  API_KEY_PRESETS,
  API_KEY_RESTRICTION_LIMITS,
  API_KEY_SCOPES,
  API_KEY_SCOPE_DESCRIPTIONS,
} from '@krakenkey/shared';
import type {
  ApiKey,
  ApiKeyPreset,
  ApiKeyScope,
  Domain,
  TlsCert,
} from '@krakenkey/shared';
import { getExpirationBadge } from '../utils/expiration';
import { copyToClipboard } from '../utils/clipboard';
import { getCertDomains } from '../utils/certDomains';
import {
  API_KEY_PRESET_DESCRIPTIONS,
  API_KEY_PRESET_LABELS,
  API_KEY_PRESET_ORDER,
  matchPreset,
  parseIpList,
} from '../utils/apiKeyAccess';
import { useActionSet } from '../hooks/useActionSet';
import * as apiKeyService from '../services/apiKeyService';
import * as domainService from '../services/domainService';
import * as certificateService from '../services/certificateService';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Textarea } from './ui/Textarea';
import { Badge } from './ui/Badge';
import { Table, TableHeader, TableRow, TableHead, TableCell } from './ui/Table';
import { PageHeader } from './ui/PageHeader';
import { EmptyState } from './ui/EmptyState';

type AccessChoice = ApiKeyPreset | 'custom';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const certLabel = (cert: TlsCert) =>
  `#${cert.id} ${getCertDomains(cert)[0] ?? 'unknown name'}`;

const choiceCardClass = (selected: boolean) =>
  `flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
    selected
      ? 'border-cyan-500/50 bg-cyan-500/5'
      : 'border-zinc-800 hover:border-zinc-700 hover:bg-zinc-800/30'
  }`;

const legendClass = 'text-sm font-medium text-zinc-300 mb-2';
const checkListClass =
  'max-h-48 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950 p-2 space-y-1';
const checkRowClass =
  'flex items-center gap-2 px-2 py-1 rounded text-sm text-zinc-300 cursor-pointer hover:bg-zinc-800/50';

export default function ApiKeyManagement() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const revokingIds = useActionSet<string>();
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyExpiry, setNewKeyExpiry] = useState('');
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null);

  const [access, setAccess] = useState<AccessChoice>('full');
  const [selectedScopes, setSelectedScopes] = useState<ApiKeyScope[]>([]);
  const [scopeError, setScopeError] = useState<string | null>(null);
  const [restrictionsOpen, setRestrictionsOpen] = useState(false);
  const [domainIds, setDomainIds] = useState<string[]>([]);
  const [certIds, setCertIds] = useState<number[]>([]);
  const [ipText, setIpText] = useState('');
  const [ipError, setIpError] = useState<string | null>(null);

  const [domains, setDomains] = useState<Domain[] | null>(null);
  const [domainsFailed, setDomainsFailed] = useState(false);
  const [certs, setCerts] = useState<TlsCert[] | null>(null);
  const [certsFailed, setCertsFailed] = useState(false);
  const domainsRequested = useRef(false);
  const certsRequested = useRef(false);

  const loadDomains = useCallback(async () => {
    if (domainsRequested.current) return;
    domainsRequested.current = true;
    setDomainsFailed(false);
    try {
      setDomains(await domainService.fetchDomains());
    } catch (error) {
      console.error('Failed to fetch domains:', error);
      domainsRequested.current = false;
      setDomainsFailed(true);
    }
  }, []);

  const loadCerts = useCallback(async () => {
    if (certsRequested.current) return;
    certsRequested.current = true;
    setCertsFailed(false);
    try {
      const data = await certificateService.fetchCertificates();
      setCerts(data.filter((c) => c.status !== 'revoked'));
    } catch (error) {
      console.error('Failed to fetch certificates:', error);
      certsRequested.current = false;
      setCertsFailed(true);
    }
  }, []);

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

  const domainNames = useMemo(
    () => new Map((domains ?? []).map((d) => [d.id, d.hostname])),
    [domains],
  );

  const toggleRestrictions = () => {
    const next = !restrictionsOpen;
    setRestrictionsOpen(next);
    if (next) {
      void loadDomains();
      void loadCerts();
    }
  };

  const chooseAccess = (choice: AccessChoice) => {
    setAccess(choice);
    setScopeError(null);
    if (choice !== 'custom') {
      setSelectedScopes(API_KEY_PRESETS[choice] ?? []);
    }
  };

  const toggleScope = (scope: ApiKeyScope) => {
    setSelectedScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );
    setAccess('custom');
    setScopeError(null);
  };

  const toggleDomain = (id: string) =>
    setDomainIds((prev) =>
      prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id],
    );

  const toggleCert = (id: number) =>
    setCertIds((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
    );

  const resetForm = () => {
    setNewKeyName('');
    setNewKeyExpiry('');
    setAccess('full');
    setSelectedScopes([]);
    setScopeError(null);
    setDomainIds([]);
    setCertIds([]);
    setIpText('');
    setIpError(null);
    setRestrictionsOpen(false);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newKeyName.trim();
    if (!name) {
      toast.error('Please enter a name for the API key');
      return;
    }

    let scopes: ApiKeyScope[] | undefined;
    if (access !== 'full') {
      if (selectedScopes.length === 0) {
        setScopeError('Pick at least one scope, or choose Full access.');
        return;
      }
      scopes = API_KEY_SCOPES.filter((s) => selectedScopes.includes(s));
    }

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
          scopes,
          allowedDomainIds: domainIds,
          allowedCertIds: certIds,
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
  const restrictionSummary = [
    domainIds.length > 0 && plural(domainIds.length, 'domain'),
    certIds.length > 0 && plural(certIds.length, 'cert'),
    ipCount > 0 && `${ipCount} IP ${ipCount === 1 ? 'entry' : 'entries'}`,
  ]
    .filter(Boolean)
    .join(', ');
  const probeWithResourceLimits =
    access !== 'full' &&
    selectedScopes.includes('probes:report') &&
    (domainIds.length > 0 || certIds.length > 0);

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
        <form onSubmit={handleCreate} className="space-y-5">
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

          {/* Access */}
          <fieldset disabled={creating}>
            <legend className={legendClass}>Access</legend>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {API_KEY_PRESET_ORDER.map((preset) => (
                <label
                  key={preset}
                  className={choiceCardClass(access === preset)}
                >
                  <input
                    type="radio"
                    name="api-key-access"
                    value={preset}
                    checked={access === preset}
                    onChange={() => chooseAccess(preset)}
                    className="accent-cyan-500 mt-0.5"
                  />
                  <span>
                    <span className="block text-sm font-medium text-zinc-200">
                      {API_KEY_PRESET_LABELS[preset]}
                    </span>
                    <span className="block text-xs text-zinc-500">
                      {API_KEY_PRESET_DESCRIPTIONS[preset]}
                    </span>
                  </span>
                </label>
              ))}
              <label className={choiceCardClass(access === 'custom')}>
                <input
                  type="radio"
                  name="api-key-access"
                  value="custom"
                  checked={access === 'custom'}
                  onChange={() => chooseAccess('custom')}
                  className="accent-cyan-500 mt-0.5"
                />
                <span>
                  <span className="block text-sm font-medium text-zinc-200">
                    Custom
                  </span>
                  <span className="block text-xs text-zinc-500">
                    Pick the scopes yourself.
                  </span>
                </span>
              </label>
            </div>
          </fieldset>

          {access !== 'full' && (
            <fieldset
              disabled={creating}
              aria-describedby={scopeError ? 'api-key-scope-error' : undefined}
            >
              <legend className={legendClass}>Scopes</legend>
              <div className="grid gap-1 sm:grid-cols-2">
                {API_KEY_SCOPES.map((scope) => (
                  <label
                    key={scope}
                    className="flex items-start gap-2 p-2 rounded-lg cursor-pointer hover:bg-zinc-800/30"
                  >
                    <input
                      type="checkbox"
                      checked={selectedScopes.includes(scope)}
                      onChange={() => toggleScope(scope)}
                      className="accent-cyan-500 mt-0.5"
                    />
                    <span>
                      <span className="block font-mono text-xs text-zinc-200">
                        {scope}
                      </span>
                      <span className="block text-xs text-zinc-500">
                        {API_KEY_SCOPE_DESCRIPTIONS[scope]}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              {scopeError && (
                <p
                  id="api-key-scope-error"
                  role="alert"
                  className="text-xs text-red-400 mt-2"
                >
                  {scopeError}
                </p>
              )}
            </fieldset>
          )}

          {/* Restrictions */}
          <div>
            <button
              type="button"
              onClick={toggleRestrictions}
              aria-expanded={restrictionsOpen}
              aria-controls="api-key-restrictions"
              className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200 cursor-pointer transition-colors"
            >
              {restrictionsOpen ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
              Restrictions (optional)
              {restrictionSummary && (
                <span className="text-xs text-zinc-500">
                  : {restrictionSummary}
                </span>
              )}
            </button>

            {restrictionsOpen && (
              <div id="api-key-restrictions" className="mt-3 space-y-4">
                <p className="text-xs text-zinc-500">
                  Leave a list empty to allow everything of that kind.
                </p>

                <fieldset disabled={creating}>
                  <legend className={legendClass}>Limit to domains</legend>
                  {domains === null ? (
                    <p className="text-xs text-zinc-500">
                      {domainsFailed
                        ? 'Could not load your domains.'
                        : 'Loading domains...'}
                    </p>
                  ) : domains.length === 0 ? (
                    <p className="text-xs text-zinc-500">No domains yet.</p>
                  ) : (
                    <>
                      <div className={checkListClass}>
                        {domains.map((d) => {
                          const checked = domainIds.includes(d.id);
                          return (
                            <label key={d.id} className={checkRowClass}>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleDomain(d.id)}
                                disabled={
                                  !checked &&
                                  domainIds.length >=
                                    API_KEY_RESTRICTION_LIMITS.domains
                                }
                                className="accent-cyan-500"
                              />
                              <span className="font-mono text-xs">
                                {d.hostname}
                              </span>
                              {!d.isVerified && (
                                <span className="text-xs text-zinc-500">
                                  (unverified)
                                </span>
                              )}
                            </label>
                          );
                        })}
                      </div>
                      <p className="text-xs text-zinc-500 mt-1.5">
                        Certificates, domains and endpoints outside these are
                        hidden from the key. {domainIds.length} of up to{' '}
                        {API_KEY_RESTRICTION_LIMITS.domains} selected.
                      </p>
                    </>
                  )}
                </fieldset>

                <fieldset disabled={creating}>
                  <legend className={legendClass}>Limit to certificates</legend>
                  {certs === null ? (
                    <p className="text-xs text-zinc-500">
                      {certsFailed
                        ? 'Could not load your certificates.'
                        : 'Loading certificates...'}
                    </p>
                  ) : certs.length === 0 ? (
                    <p className="text-xs text-zinc-500">
                      No certificates yet.
                    </p>
                  ) : (
                    <>
                      <div className={checkListClass}>
                        {certs.map((c) => {
                          const checked = certIds.includes(c.id);
                          return (
                            <label key={c.id} className={checkRowClass}>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleCert(c.id)}
                                disabled={
                                  !checked &&
                                  certIds.length >=
                                    API_KEY_RESTRICTION_LIMITS.certs
                                }
                                className="accent-cyan-500"
                              />
                              <span className="font-mono text-xs">
                                {certLabel(c)}
                              </span>
                              <span className="text-xs text-zinc-500">
                                ({c.status})
                              </span>
                            </label>
                          );
                        })}
                      </div>
                      <p className="text-xs text-zinc-500 mt-1.5">
                        A key limited to certificates can't request new
                        certificates. Renewing keeps the same certificate, so
                        the limit still applies. {certIds.length} of up to{' '}
                        {API_KEY_RESTRICTION_LIMITS.certs} selected.
                      </p>
                    </>
                  )}
                </fieldset>

                {probeWithResourceLimits && (
                  <p className="text-xs text-amber-400 flex items-start gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    Keys limited to domains or certificates can't use the probe
                    routes, so the probes:report scope won't work with these
                    limits.
                  </p>
                )}

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
              </div>
            )}
          </div>

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
                      <AccessSummary apiKey={key} domainNames={domainNames} />
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

function AccessSummary({
  apiKey,
  domainNames,
}: {
  apiKey: ApiKey;
  domainNames: Map<string, string>;
}) {
  const scopes = apiKey.scopes ?? null;
  const preset = matchPreset(scopes);
  const label = preset
    ? API_KEY_PRESET_LABELS[preset]
    : `Custom (${plural(scopes?.length ?? 0, 'scope')})`;
  const domainIds = apiKey.allowedDomainIds ?? [];
  const certIds = apiKey.allowedCertIds ?? [];
  const ips = apiKey.allowedIps ?? [];

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span
        className="text-zinc-300"
        title={scopes ? scopes.join(', ') : 'All scopes'}
      >
        {label}
      </span>
      {domainIds.length > 0 && (
        <span
          title={domainIds.map((id) => domainNames.get(id) ?? id).join(', ')}
        >
          <Badge variant="info" dot={false}>
            {plural(domainIds.length, 'domain')}
          </Badge>
        </span>
      )}
      {certIds.length > 0 && (
        <span title={certIds.map((id) => `#${id}`).join(', ')}>
          <Badge variant="info" dot={false}>
            {plural(certIds.length, 'cert')}
          </Badge>
        </span>
      )}
      {ips.length > 0 && (
        <span title={ips.join(', ')}>
          <Badge variant="info" dot={false}>
            IP-limited
          </Badge>
        </span>
      )}
    </div>
  );
}
