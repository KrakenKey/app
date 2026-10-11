import { useContext } from 'react';
import { HealthContext } from '../context/HealthContext';

/** Account health from the nearest HealthProvider (empty without one). */
export function useHealth() {
  return useContext(HealthContext);
}
