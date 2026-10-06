import { useCallback, useMemo, useRef, useState } from 'react';
import { API_KEY_PRESETS, API_KEY_SCOPES } from '@krakenkey/shared';
import type {
  ApiKeyPreset,
  ApiKeyScope,
  Domain,
  TlsCert,
} from '@krakenkey/shared';
import * as domainService from '../services/domainService';
import * as certificateService from '../services/certificateService';

export type AccessChoice = ApiKeyPreset | 'custom';

/**
 * Form state for the scopes and domain/certificate limits shared by API
 * keys and GitHub Actions trust policies. Domains and certificates are
 * fetched on demand, the first time the restrictions are opened.
 */
export function useAccessForm() {
  const [access, setAccess] = useState<AccessChoice>('full');
  const [selectedScopes, setSelectedScopes] = useState<ApiKeyScope[]>([]);
  const [scopeError, setScopeError] = useState<string | null>(null);
  const [restrictionsOpen, setRestrictionsOpen] = useState(false);
  const [domainIds, setDomainIds] = useState<string[]>([]);
  const [certIds, setCertIds] = useState<number[]>([]);

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

  const reset = () => {
    setAccess('full');
    setSelectedScopes([]);
    setScopeError(null);
    setDomainIds([]);
    setCertIds([]);
    setRestrictionsOpen(false);
  };

  /**
   * The scopes to send, in canonical order: undefined for full access.
   * Returns null, and shows an error, when a custom set is empty.
   */
  const resolveScopes = (): { scopes: ApiKeyScope[] | undefined } | null => {
    if (access === 'full') return { scopes: undefined };
    if (selectedScopes.length === 0) {
      setScopeError('Pick at least one scope, or choose Full access.');
      return null;
    }
    return {
      scopes: API_KEY_SCOPES.filter((s) => selectedScopes.includes(s)),
    };
  };

  return {
    access,
    selectedScopes,
    scopeError,
    chooseAccess,
    toggleScope,
    restrictionsOpen,
    setRestrictionsOpen,
    toggleRestrictions,
    domainIds,
    certIds,
    toggleDomain,
    toggleCert,
    domains,
    domainsFailed,
    certs,
    certsFailed,
    loadDomains,
    domainNames,
    reset,
    resolveScopes,
  };
}

export type AccessForm = ReturnType<typeof useAccessForm>;
