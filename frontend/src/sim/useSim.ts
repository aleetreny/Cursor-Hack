import { useMemo } from 'react';
import { useStore } from '../state/store';
import type { SimCtx } from './ops';

/** Simulation context derived from the real incident (centre, planned burn cell, time window). */
export function useSimCtx(): SimCtx | null {
  const incident = useStore((s) => s.incident), t0 = useStore((s) => s.t0), t1 = useStore((s) => s.t1);
  return useMemo(() => {
    const ring = incident?.reference_perimeter?.geometry.coordinates[0] as [number, number][] | undefined;
    return incident && ring ? { t0, t1, center: incident.center as [number, number], cell: ring } : null;
  }, [incident, t0, t1]);
}
