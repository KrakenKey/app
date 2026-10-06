import type { ReactNode } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import {
  API_KEY_RESTRICTION_LIMITS,
  API_KEY_SCOPES,
  API_KEY_SCOPE_DESCRIPTIONS,
} from '@krakenkey/shared';
import type { ApiKeyScope, TlsCert } from '@krakenkey/shared';
import { getCertDomains } from '../utils/certDomains';
import {
  API_KEY_PRESET_DESCRIPTIONS,
  API_KEY_PRESET_LABELS,
  API_KEY_PRESET_ORDER,
  matchPreset,
  plural,
} from '../utils/apiKeyAccess';
import type { AccessForm } from '../hooks/useAccessForm';
import { Badge } from './ui/Badge';

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

/** Access presets plus, unless full access is chosen, the scope checkboxes. */
export function AccessChoiceFields({
  form,
  idPrefix,
  disabled,
}: {
  form: AccessForm;
  idPrefix: string;
  disabled?: boolean;
}) {
  const { access, selectedScopes, scopeError, chooseAccess, toggleScope } =
    form;
  const errorId = `${idPrefix}-scope-error`;

  return (
    <>
      <fieldset disabled={disabled}>
        <legend className={legendClass}>Access</legend>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {API_KEY_PRESET_ORDER.map((preset) => (
            <label key={preset} className={choiceCardClass(access === preset)}>
              <input
                type="radio"
                name={`${idPrefix}-access`}
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
              name={`${idPrefix}-access`}
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
          disabled={disabled}
          aria-describedby={scopeError ? errorId : undefined}
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
            <p id={errorId} role="alert" className="text-xs text-red-400 mt-2">
              {scopeError}
            </p>
          )}
        </fieldset>
      )}
    </>
  );
}

/**
 * Collapsible domain and certificate limits. Extra fields (such as the API
 * key IP list) go in `children`, with their summary text in `extraSummary`.
 */
export function RestrictionFields({
  form,
  idPrefix,
  disabled,
  extraSummary = [],
  children,
}: {
  form: AccessForm;
  idPrefix: string;
  disabled?: boolean;
  extraSummary?: string[];
  children?: ReactNode;
}) {
  const {
    restrictionsOpen,
    toggleRestrictions,
    domains,
    domainsFailed,
    certs,
    certsFailed,
    domainIds,
    certIds,
    toggleDomain,
    toggleCert,
    access,
    selectedScopes,
  } = form;
  const panelId = `${idPrefix}-restrictions`;

  const summary = [
    domainIds.length > 0 && plural(domainIds.length, 'domain'),
    certIds.length > 0 && plural(certIds.length, 'cert'),
    ...extraSummary,
  ]
    .filter(Boolean)
    .join(', ');
  const probeWithResourceLimits =
    access !== 'full' &&
    selectedScopes.includes('probes:report') &&
    (domainIds.length > 0 || certIds.length > 0);

  return (
    <div>
      <button
        type="button"
        onClick={toggleRestrictions}
        aria-expanded={restrictionsOpen}
        aria-controls={panelId}
        className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200 cursor-pointer transition-colors"
      >
        {restrictionsOpen ? (
          <ChevronDown className="w-4 h-4" />
        ) : (
          <ChevronRight className="w-4 h-4" />
        )}
        Restrictions (optional)
        {summary && <span className="text-xs text-zinc-500">: {summary}</span>}
      </button>

      {restrictionsOpen && (
        <div id={panelId} className="mt-3 space-y-4">
          <p className="text-xs text-zinc-500">
            Leave a list empty to allow everything of that kind.
          </p>

          <fieldset disabled={disabled}>
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
                        <span className="font-mono text-xs">{d.hostname}</span>
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
                  Certificates, domains and endpoints outside these are hidden
                  from the key. {domainIds.length} of up to{' '}
                  {API_KEY_RESTRICTION_LIMITS.domains} selected.
                </p>
              </>
            )}
          </fieldset>

          <fieldset disabled={disabled}>
            <legend className={legendClass}>Limit to certificates</legend>
            {certs === null ? (
              <p className="text-xs text-zinc-500">
                {certsFailed
                  ? 'Could not load your certificates.'
                  : 'Loading certificates...'}
              </p>
            ) : certs.length === 0 ? (
              <p className="text-xs text-zinc-500">No certificates yet.</p>
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
                            certIds.length >= API_KEY_RESTRICTION_LIMITS.certs
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
                  A key limited to certificates can't request new certificates.
                  Renewing keeps the same certificate, so the limit still
                  applies. {certIds.length} of up to{' '}
                  {API_KEY_RESTRICTION_LIMITS.certs} selected.
                </p>
              </>
            )}
          </fieldset>

          {probeWithResourceLimits && (
            <p className="text-xs text-amber-400 flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              Keys limited to domains or certificates can't use the probe
              routes, so the probes:report scope won't work with these limits.
            </p>
          )}

          {children}
        </div>
      )}
    </div>
  );
}

/** Access label (Full access, a preset, or Custom) with restriction badges. */
export function AccessSummary({
  scopes,
  allowedDomainIds,
  allowedCertIds,
  allowedIps,
  domainNames,
}: {
  scopes: readonly ApiKeyScope[] | null | undefined;
  allowedDomainIds?: readonly string[] | null;
  allowedCertIds?: readonly number[] | null;
  allowedIps?: readonly string[] | null;
  domainNames: Map<string, string>;
}) {
  const scopeList = scopes ?? null;
  const preset = matchPreset(scopeList);
  const label = preset
    ? API_KEY_PRESET_LABELS[preset]
    : `Custom (${plural(scopeList?.length ?? 0, 'scope')})`;
  const domainIds = allowedDomainIds ?? [];
  const certIds = allowedCertIds ?? [];
  const ips = allowedIps ?? [];

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span
        className="text-zinc-300"
        title={scopeList ? scopeList.join(', ') : 'All scopes'}
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
