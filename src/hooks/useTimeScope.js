import { useContext } from 'react';
import { TimeScopeContext } from '../lib/timeScopeContext';

/** `[scopeId, setScopeId]` del período compartido (ver lib/timeScope). */
export default function useTimeScope() {
  return useContext(TimeScopeContext);
}
