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
  computeAttention,
  countByArea,
  type AreaCount,
  type AttentionItem,
  type HealthArea,
} from '../utils/accountHealth';

export interface HealthData {
  certs: TlsCert[];
  endpoints: Endpoint[];
  latestResults: Record<string, ProbeScanResult[]>;
  probes: ProbeOption[];
  connectors: Connector[];
  domains: Domain[];
}

export interface HealthContextValue {
  data: HealthData | null;
  items: AttentionItem[];
  byArea: Record<HealthArea, AreaCount>;
  loading: boolean;
  checkedAt: Date | null;
  /** Refetch; with `maxAgeMs`, only when the last fetch is older than that. */
  refresh: (maxAgeMs?: number) => Promise<void>;
}

const EMPTY_AREAS = countByArea([]);

export const HealthContext = createContext<HealthContextValue>({
  data: null,
  items: [],
  byArea: EMPTY_AREAS,
  loading: false,
  checkedAt: null,
  refresh: async () => {},
});

async function loadHealth(): Promise<HealthData> {
  const [certs, endpoints, probes, connectors, domains] = await Promise.all([
    certService.fetchCertificates().catch(() => [] as TlsCert[]),
    endpointService.fetchEndpoints().catch(() => [] as Endpoint[]),
    endpointService.fetchUserProbes().catch(() => [] as ProbeOption[]),
    connectorService.fetchConnectors().catch(() => [] as Connector[]),
    domainService.fetchDomains().catch(() => [] as Domain[]),
  ]);
  const latestResults: Record<string, ProbeScanResult[]> = {};
  await Promise.all(
    endpoints.map(async (ep) => {
      latestResults[ep.id] = await endpointService
        .fetchLatestResults(ep.id)
        .catch(() => []);
    }),
  );
  return { certs, endpoints, latestResults, probes, connectors, domains };
}

/**
 * Loads what the Overview and the sidebar badges need, once per dashboard
 * session, and again when a caller asks for a refresh.
 */
export function HealthProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const inFlight = useRef(false);
  const lastFetch = useRef(0);

  const refresh = useCallback(async (maxAgeMs?: number) => {
    if (inFlight.current) return;
    if (maxAgeMs != null && Date.now() - lastFetch.current < maxAgeMs) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const d = await loadHealth();
      setData(d);
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
    () => (data ? computeAttention({ ...data, plan }) : []),
    [data, plan],
  );
  const byArea = useMemo(() => countByArea(items), [items]);

  const value = useMemo(
    () => ({ data, items, byArea, loading, checkedAt, refresh }),
    [data, items, byArea, loading, checkedAt, refresh],
  );

  return (
    <HealthContext.Provider value={value}>{children}</HealthContext.Provider>
  );
}
