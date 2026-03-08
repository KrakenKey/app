import {
  createContext,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';
import api from '../services/api';
import { API_ROUTES, type Domain } from '@krakenkey/shared';

/**
 * DomainsContext provides shared state for user domains across the application.
 * This prevents duplicate API calls and ensures consistent domain data.
 */

interface DomainsContextValue {
  domains: Domain[];
  verifiedDomains: Domain[];
  loading: boolean;
  error: string | null;
  fetchDomains: () => Promise<void>;
  refetchDomains: () => Promise<void>;
}

export const DomainsContext = createContext<DomainsContextValue | undefined>(
  undefined,
);

interface DomainsProviderProps {
  children: ReactNode;
}

export function DomainsProvider({ children }: DomainsProviderProps) {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetched, setFetched] = useState(false);

  const fetchDomains = useCallback(async () => {
    // Only fetch if not already fetched (prevents duplicate calls on mount)
    if (fetched) return;

    try {
      setLoading(true);
      setError(null);
      const response = await api.get<Domain[]>(API_ROUTES.DOMAINS.BASE);
      setDomains(response.data);
      setFetched(true);
    } catch (err) {
      console.error('Failed to fetch domains:', err);
      setError('Failed to load domains');
    } finally {
      setLoading(false);
    }
  }, [fetched]);

  const refetchDomains = useCallback(async () => {
    // Force refetch (used after domain operations like verify, delete)
    try {
      setLoading(true);
      setError(null);
      const response = await api.get<Domain[]>(API_ROUTES.DOMAINS.BASE);
      setDomains(response.data);
      setFetched(true);
    } catch (err) {
      console.error('Failed to refetch domains:', err);
      setError('Failed to reload domains');
    } finally {
      setLoading(false);
    }
  }, []);

  const verifiedDomains = useMemo(
    () => domains.filter((d) => d.isVerified),
    [domains],
  );

  const value = useMemo(
    () => ({
      domains,
      verifiedDomains,
      loading,
      error,
      fetchDomains,
      refetchDomains,
    }),
    [domains, verifiedDomains, loading, error, fetchDomains, refetchDomains],
  );

  return (
    <DomainsContext.Provider value={value}>{children}</DomainsContext.Provider>
  );
}
