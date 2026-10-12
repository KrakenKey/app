import { useId, useMemo, useState, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import { API_KEY_RESTRICTION_LIMITS } from '@krakenkey/shared';
import type { AccessForm } from '../../hooks/useAccessForm';
import { getCertDomains } from '../../utils/certDomains';

const checkboxClass =
  'h-4 w-4 shrink-0 rounded accent-cyan-500 cursor-pointer disabled:cursor-not-allowed';
const rowClass =
  'flex items-center gap-3 px-3 py-2 text-sm text-text-secondary cursor-pointer hover:bg-white/[0.04] has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50';

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  issuing: 'Issuing',
  issued: 'Issued',
  renewing: 'Renewing',
  failed: 'Failed',
  revoking: 'Revoking',
  awaiting_csr: 'Awaiting CSR',
};

function matches(query: string, ...values: string[]) {
  return values.some((v) => v.toLowerCase().includes(query));
}

/**
 * One searchable checklist for a connector's certificate and domain
 * restrictions: a filter box over a single scrolling list with a group for
 * each, so the modal never nests two scroll areas.
 */
export function RestrictionPicker({
  form,
  disabled,
  describedBy,
}: {
  form: AccessForm;
  disabled?: boolean;
  describedBy?: string;
}) {
  const filterId = useId();
  const [query, setQuery] = useState('');
  // What was picked when the dialog opened is listed first, so editing a
  // connector shows its current limits without scrolling. The order is
  // fixed at mount, so rows do not jump while you tick boxes.
  const [pinned] = useState(() => ({
    certs: new Set(form.certIds),
    domains: new Set(form.domainIds),
  }));
  const q = query.trim().toLowerCase();
  const {
    certs,
    certsFailed,
    certIds,
    toggleCert,
    domains,
    domainsFailed,
    domainIds,
    toggleDomain,
  } = form;

  const certRows = useMemo(
    () =>
      (certs ?? [])
        .map((c) => ({ cert: c, names: getCertDomains(c) }))
        .filter(({ cert, names }) => !q || matches(q, `#${cert.id}`, ...names))
        .sort(
          (a, b) =>
            Number(pinned.certs.has(b.cert.id)) -
            Number(pinned.certs.has(a.cert.id)),
        ),
    [certs, q, pinned],
  );
  const domainRows = useMemo(
    () =>
      (domains ?? [])
        .filter((d) => !q || matches(q, d.hostname))
        .sort(
          (a, b) =>
            Number(pinned.domains.has(b.id)) - Number(pinned.domains.has(a.id)),
        ),
    [domains, q, pinned],
  );

  const loaded = certs !== null && domains !== null;
  const nothingMatches =
    loaded && q !== '' && certRows.length === 0 && domainRows.length === 0;

  return (
    <fieldset
      disabled={disabled}
      aria-describedby={describedBy}
      className="min-w-0 rounded-lg border border-border-strong/70 bg-bg overflow-hidden"
    >
      <legend className="sr-only">Certificates and domains</legend>
      <div className="relative border-b border-border-subtle">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted"
        />
        <label htmlFor={filterId} className="sr-only">
          Filter certificates and domains
        </label>
        <input
          id={filterId}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            // Enter would submit the surrounding form.
            if (e.key === 'Enter') e.preventDefault();
          }}
          placeholder="Filter certificates and domains"
          autoComplete="off"
          className="w-full bg-transparent py-2.5 pl-9 pr-3 text-sm text-text placeholder:text-zinc-500 focus:outline-none focus-visible:outline-none focus:bg-white/[0.02]"
        />
      </div>

      <div className="max-h-72 overflow-y-auto" data-testid="restriction-list">
        <Group
          title="Certificates"
          count={certIds.length}
          limit={API_KEY_RESTRICTION_LIMITS.certs}
        >
          {certs === null ? (
            <Note>
              {certsFailed
                ? 'Could not load your certificates.'
                : 'Loading certificates...'}
            </Note>
          ) : certs.length === 0 ? (
            <Note>No certificates yet.</Note>
          ) : certRows.length === 0 ? (
            <Note>No certificates match.</Note>
          ) : (
            certRows.map(({ cert, names }) => {
              const checked = certIds.includes(cert.id);
              return (
                <label key={cert.id} className={rowClass}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleCert(cert.id)}
                    disabled={
                      !checked &&
                      certIds.length >= API_KEY_RESTRICTION_LIMITS.certs
                    }
                    className={checkboxClass}
                  />
                  <span
                    className="min-w-0 flex-1 truncate"
                    title={names.join(', ')}
                  >
                    <span className="tnum text-text-muted">#{cert.id}</span>{' '}
                    <span className="text-text">
                      {names[0] ?? 'unknown name'}
                    </span>
                    {names.length > 1 && (
                      <span className="text-text-muted">
                        {' '}
                        +{names.length - 1}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs text-text-muted">
                    {' '}
                    {STATUS_LABEL[cert.status] ?? cert.status}
                  </span>
                </label>
              );
            })
          )}
        </Group>

        <Group
          title="Domains"
          count={domainIds.length}
          limit={API_KEY_RESTRICTION_LIMITS.domains}
        >
          {domains === null ? (
            <Note>
              {domainsFailed
                ? 'Could not load your domains.'
                : 'Loading domains...'}
            </Note>
          ) : domains.length === 0 ? (
            <Note>No domains yet.</Note>
          ) : domainRows.length === 0 ? (
            <Note>No domains match.</Note>
          ) : (
            domainRows.map((d) => {
              const checked = domainIds.includes(d.id);
              return (
                <label key={d.id} className={rowClass}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleDomain(d.id)}
                    disabled={
                      !checked &&
                      domainIds.length >= API_KEY_RESTRICTION_LIMITS.domains
                    }
                    className={checkboxClass}
                  />
                  <span
                    className="min-w-0 flex-1 truncate text-text"
                    title={d.hostname}
                  >
                    {d.hostname}
                  </span>
                  {!d.isVerified && (
                    <span className="shrink-0 text-xs text-text-muted">
                      {' '}
                      Unverified
                    </span>
                  )}
                </label>
              );
            })
          )}
        </Group>
      </div>

      {nothingMatches && (
        <p className="sr-only" role="status">
          Nothing matches {query}.
        </p>
      )}
    </fieldset>
  );
}

function Group({
  title,
  count,
  limit,
  children,
}: {
  title: string;
  count: number;
  limit: number;
  children: ReactNode;
}) {
  return (
    <div role="group" aria-label={title}>
      <div className="sticky top-0 z-[1] flex items-center justify-between gap-2 border-b border-border-subtle bg-bg-sunken/95 px-3 py-1.5 backdrop-blur-sm">
        <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-text-faint">
          {title}
        </span>
        <span className="tnum text-xs text-text-muted">
          {count} of up to {limit} selected
        </span>
      </div>
      <div className="py-1">{children}</div>
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="px-3 py-2 text-xs text-text-muted">{children}</p>;
}
