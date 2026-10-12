import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  Connector,
  Domain,
  Endpoint,
  ProbeScanResult,
  TlsCert,
} from '@krakenkey/shared';
import * as certService from '../services/certificateService';
import * as endpointService from '../services/endpointService';
import * as connectorService from '../services/connectorService';
import * as domainService from '../services/domainService';
import type { ProbeOption } from '../services/endpointService';
import { useAuth } from '../hooks/useAuth';
import {
  HEALTH_SOURCES,
  areaLoadStates,
  computeAttention,
  countByArea,
  type AreaCount,
  type AttentionItem,
  type HealthArea,
  type HealthSource,
  type LoadState,
} from '../utils/accountHealth';
import { withTimeout } from '../utils/withTimeout';

export interface HealthData {
  certs: TlsCert[];
  endpoints: Endpoint[];
  latestResults: Record<string, ProbeScanResult[]>;
  /** Endpoints whose latest results could not be loaded. */
  resultsUnavailable: string[];
  probes: ProbeOption[];
  connectors: Connector[];
  domains: Domain[];
}

export interface HealthContextValue {
  /**
   * What has loaded so far. A source that is still loading or failed is
   * empty here: check `status` before reading an empty list as "none".
   */
  data: HealthData | null;
  /** Load state per request. */
  status: Record<HealthSource, LoadState>;
  /** Load state per sidebar area, folded from `status`. */
  areas: Record<HealthArea, LoadState>;
  items: AttentionItem[];
  byArea: Record<HealthArea, AreaCount>;
  loading: boolean;
  checkedAt: Date | null;
  /** Refetch; with `maxAgeMs`, only when the last fetch is older than that. */
  refresh: (maxAgeMs?: number) => Promise<void>;
}

/** A health request that has not answered by then counts as failed. */
export const HEALTH_TIMEOUT_MS = 15_000;

const EMPTY_AREAS = countByArea([]);

function allSources(state: LoadState): Record<HealthSource, LoadState> {
  return Object.fromEntries(HEALTH_SOURCES.map((s) => [s, state])) as Record<
    HealthSource,
    LoadState
  >;
}

const LOADING = allSources('loading');

const EMPTY_DATA: HealthData = {
  certs: [],
  endpoints: [],
  latestResults: {},
  resultsUnavailable: [],
  probes: [],
  connectors: [],
  domains: [],
};

export const HealthContext = createContext<HealthContextValue>({
  data: null,
  status: LOADING,
  areas: areaLoadStates(LOADING),
  items: [],
  byArea: EMPTY_AREAS,
  loading: false,
  checkedAt: null,
  refresh: async () => {},
});

const timed = <T,>(request: () => Promise<T>) =>
  withTimeout(request(), HEALTH_TIMEOUT_MS);

/**
 * Loads what the Overview and the sidebar badges need, once per dashboard
 * session, and again when a caller asks for a refresh. Each source is
 * loaded and reported on its own, so one failed or slow request does not
 * hide the others, and a failed request is never mistaken for an empty
 * list.
 */
export function HealthProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<HealthData>(EMPTY_DATA);
  const [status, setStatus] = useState(LOADING);
  const [loading, setLoading] = useState(true);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const inFlight = useRef(false);
  const lastFetch = useRef(0);

  const refresh = useCallback(async (maxAgeMs?: number) => {
    if (inFlight.current) return;
    if (maxAgeMs != null && Date.now() - lastFetch.current < maxAgeMs) return;
    inFlight.current = true;
    setLoading(true);

    // A failed source is emptied, so nothing stale is shown as current.
    const settle = <K extends 'certs' | 'probes' | 'connectors' | 'domains'>(
      key: K,
      request: () => Promise<HealthData[K]>,
    ) =>
      timed(request).then(
        (value) => {
          setData((d) => ({ ...d, [key]: value }));
          setStatus((s) => ({ ...s, [key]: 'loaded' }));
        },
        () => {
          setData((d) => ({ ...d, [key]: EMPTY_DATA[key] }));
          setStatus((s) => ({ ...s, [key]: 'failed' }));
        },
      );

    // Endpoints and their latest results are committed together, so the
    // endpoint counts never mix a new list with old results.
    const loadEndpoints = async () => {
      let endpoints: Endpoint[];
      try {
        endpoints = await timed(endpointService.fetchEndpoints);
      } catch {
        setData((d) => ({
          ...d,
          endpoints: [],
          latestResults: {},
          resultsUnavailable: [],
        }));
        setStatus((s) => ({
          ...s,
          endpoints: 'failed',
          latestResults: 'failed',
        }));
        return;
      }
      const latestResults: Record<string, ProbeScanResult[]> = {};
      const resultsUnavailable: string[] = [];
      await Promise.all(
        endpoints.map((ep) =>
          timed(() => endpointService.fetchLatestResults(ep.id)).then(
            (results) => {
              latestResults[ep.id] = results;
            },
            () => {
              resultsUnavailable.push(ep.id);
            },
          ),
        ),
      );
      setData((d) => ({ ...d, endpoints, latestResults, resultsUnavailable }));
      setStatus((s) => ({
        ...s,
        endpoints: 'loaded',
        latestResults:
          resultsUnavailable.length === 0
            ? 'loaded'
            : resultsUnavailable.length === endpoints.length
              ? 'failed'
              : 'partial',
      }));
    };

    try {
      await Promise.all([
        settle('certs', certService.fetchCertificates),
        loadEndpoints(),
        settle('probes', endpointService.fetchUserProbes),
        settle('connectors', connectorService.fetchConnectors),
        settle('domains', domainService.fetchDomains),
      ]);
      lastFetch.current = Date.now();
      setCheckedAt(new Date());
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const { user } = useAuth();
  const plan = (user as { plan?: string } | null)?.plan ?? null;
  const items = useMemo(
    () => computeAttention({ ...data, plan }),
    [data, plan],
  );
  const byArea = useMemo(() => countByArea(items), [items]);
  const areas = useMemo(() => areaLoadStates(status), [status]);

  const value = useMemo(
    () => ({
      data,
      status,
      areas,
      items,
      byArea,
      loading,
      checkedAt,
      refresh,
    }),
    [data, status, areas, items, byArea, loading, checkedAt, refresh],
  );

  return (
    <HealthContext.Provider value={value}>{children}</HealthContext.Provider>
  );
}
