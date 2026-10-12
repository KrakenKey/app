import { screen, within } from '@testing-library/react';
import { render } from '../../test/test-utils';
import {
  HealthContext,
  type HealthContextValue,
} from '../../context/HealthContext';
import { MobileTopBar, Sidebar } from '../Sidebar';
import {
  areaLoadStates,
  countByArea,
  type HealthSource,
  type LoadState,
} from '../../utils/accountHealth';

function health(status: Partial<Record<HealthSource, LoadState>>) {
  const full = {
    certs: 'loaded',
    endpoints: 'loaded',
    latestResults: 'loaded',
    probes: 'loaded',
    connectors: 'loaded',
    domains: 'loaded',
    ...status,
  } as Record<HealthSource, LoadState>;
  const value: HealthContextValue = {
    data: null,
    status: full,
    areas: areaLoadStates(full),
    items: [],
    byArea: countByArea([]),
    loading: false,
    checkedAt: null,
    refresh: async () => {},
  };
  return value;
}

const navLink = (name: string) =>
  screen.getByRole('link', { name: new RegExp(`^${name}`) });

describe('Sidebar attention badges', () => {
  it('shows no badge for areas that loaded with nothing to do', () => {
    render(
      <HealthContext.Provider value={health({})}>
        <Sidebar open onClose={() => {}} />
      </HealthContext.Provider>,
    );
    expect(navLink('Connectors')).toHaveTextContent(/^Connectors$/);
  });

  it('shows a neutral "?" instead of a zero for an area that failed', () => {
    render(
      <HealthContext.Provider
        value={health({ connectors: 'failed', latestResults: 'partial' })}
      >
        <Sidebar open onClose={() => {}} />
      </HealthContext.Provider>,
    );
    expect(
      within(navLink('Connectors')).getByLabelText("Couldn't load"),
    ).toHaveTextContent('?');
    // Endpoints loaded, but some of their latest results did not.
    expect(
      within(navLink('Endpoints')).getByLabelText("Couldn't load"),
    ).toBeInTheDocument();
    expect(
      within(navLink('Domains')).queryByLabelText("Couldn't load"),
    ).not.toBeInTheDocument();
  });

  it('tells phone users when something could not be loaded', () => {
    render(
      <HealthContext.Provider value={health({ domains: 'failed' })}>
        <MobileTopBar onMenu={() => {}} />
      </HealthContext.Provider>,
    );
    expect(screen.getByRole('link', { name: "Couldn't load" })).toHaveAttribute(
      'href',
      '/dashboard',
    );
  });
});
