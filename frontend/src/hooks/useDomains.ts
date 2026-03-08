import { useContext } from 'react';
import { DomainsContext } from '../context/DomainsContext';

export function useDomains() {
  const context = useContext(DomainsContext);
  if (!context) {
    throw new Error('useDomains must be used within a DomainsProvider');
  }
  return context;
}
