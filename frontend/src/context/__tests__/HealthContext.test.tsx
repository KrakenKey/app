import { useContext, useEffect } from 'react';
import { act, render, waitFor } from '@testing-library/react';
import type { Endpoint, TlsCert } from '@krakenkey/shared';
import { mockCerts } from '../../test/mocks/data';
import {
  HEALTH_TIMEOUT_MS,
  HealthContext,
  HealthProvider,
  type HealthContextValue,
} from '../HealthContext';

const api = vi.hoisted(() => ({
  fetchCertificates: vi.fn(),
  fetchEndpoints: vi.fn(),
  fetchLatestResults: vi.fn(),
  fetchUserProbes: vi.fn(),
  fetchConnectors: vi.fn(),
  fetchDomains: vi.fn(),
}));

vi.mock('../../services/certificateService', () => ({
  fetchCertificates: api.fetchCertificates,
}));
vi.mock('../../services/endpointService', () => ({
  fetchEndpoints: api.fetchEndpoints,
  fetchLatestResults: api.fetchLatestResults,
  fetchUserProbes: api.fetchUserProbes,
}));
vi.mock('../../services/connectorService', () => ({
  fetchConnectors: api.fetchConnectors,
}));
vi.mock('../../services/domainService', () => ({
  fetchDomains: api.fetchDomains,
}));
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { plan: 'free' } }),
}));

const failedCert = {
  ...mockCerts[0],
  status: 'failed',
} as unknown as TlsCert;
const endpoint = (id: string) =>
  ({ id, host: `${id}.example.com`, port: 443, isActive: true }) as Endpoint;

let current: HealthContextValue;
/** Exposes the provider's latest value to the test. */
function Probe() {
  const value = useContext(HealthContext);
  useEffect(() => {
    current = value;
  });
  return null;
}
const renderProvider = () =>
  render(
    <HealthProvider>
      <Probe />
    </HealthProvider>,
  );

describe('HealthProvider', () => {
  beforeEach(() => {
    api.fetchCertificates.mockResolvedValue([failedCert]);
    api.fetchEndpoints.mockResolvedValue([endpoint('a')]);
    api.fetchLatestResults.mockResolvedValue([]);
    api.fetchUserProbes.mockResolvedValue([]);
    api.fetchConnectors.mockResolvedValue([]);
    api.fetchDomains.mockResolvedValue([]);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('reports every source as loaded when every request succeeds', async () => {
    renderProvider();
    await waitFor(() => expect(current.loading).toBe(false));
    expect(Object.values(current.status)).toEqual(Array(6).fill('loaded'));
    expect(Object.values(current.areas)).toEqual(Array(4).fill('loaded'));
    expect(current.items.map((i) => i.summary)).toEqual(['Issuance failed']);
  });

  it('marks one failed source as failed, not empty, and keeps the rest', async () => {
    api.fetchConnectors.mockRejectedValue(new Error('429'));
    renderProvider();
    await waitFor(() => expect(current.loading).toBe(false));
    expect(current.status).toMatchObject({
      certs: 'loaded',
      endpoints: 'loaded',
      connectors: 'failed',
      domains: 'loaded',
    });
    expect(current.areas.connectors).toBe('failed');
    // What did load still produces its problems.
    expect(current.items).toHaveLength(1);
    expect(current.data?.certs).toEqual([failedCert]);
  });

  it('marks every source as failed when every request fails', async () => {
    for (const fn of Object.values(api)) {
      fn.mockRejectedValue(new Error('down'));
    }
    renderProvider();
    await waitFor(() => expect(current.loading).toBe(false));
    expect(Object.values(current.status)).toEqual(Array(6).fill('failed'));
    expect(Object.values(current.areas)).toEqual(Array(4).fill('failed'));
    expect(current.items).toEqual([]);
  });

  it('gives up on a hanging request after the timeout', async () => {
    vi.useFakeTimers();
    api.fetchDomains.mockReturnValue(new Promise(() => {}));
    renderProvider();
    // Everything else answers right away.
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(current.status.certs).toBe('loaded');
    expect(current.status.domains).toBe('loading');
    expect(current.loading).toBe(true);

    await act(() => vi.advanceTimersByTimeAsync(HEALTH_TIMEOUT_MS - 1));
    expect(current.status.domains).toBe('loading');

    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(current.status.domains).toBe('failed');
    expect(current.areas.domains).toBe('failed');
    expect(current.loading).toBe(false);
  });

  it('treats endpoints as partly loaded when some latest results fail', async () => {
    api.fetchEndpoints.mockResolvedValue([endpoint('a'), endpoint('b')]);
    api.fetchLatestResults.mockImplementation((id: string) =>
      id === 'b'
        ? Promise.reject(new Error('500'))
        : Promise.resolve([
            {
              id: 's',
              probeId: 'p',
              connectionSuccess: true,
              certTrusted: true,
              certDaysUntilExpiry: 60,
              scannedAt: new Date().toISOString(),
            },
          ]),
    );
    renderProvider();
    await waitFor(() => expect(current.loading).toBe(false));
    expect(current.status.latestResults).toBe('partial');
    expect(current.areas.endpoints).toBe('partial');
    expect(current.data?.resultsUnavailable).toEqual(['b']);
  });

  it('recovers a failed source on refresh', async () => {
    api.fetchConnectors.mockRejectedValueOnce(new Error('500'));
    renderProvider();
    await waitFor(() => expect(current.status.connectors).toBe('failed'));
    await act(() => current.refresh());
    expect(current.status.connectors).toBe('loaded');
  });
});
