import { useMemo } from 'react';
import { useStore } from '../state/store';
import type { SimCtx } from './ops';
import type { Incident, TimelineResponse } from '../api/types';

/** Simulation context derived from the real incident: centre and planned burn cell (drone view), or the reconstructed
 *  front of each hour (regional fire). */
export function simCtxFor(incident: Incident | null, timeline: TimelineResponse | null, t0: number, t1: number): SimCtx | null {
  if (!incident) return null;
  if (incident.scale === 'regional') {
    const fronts = (timeline?.frames ?? []).filter((f) => f.front).map((f) => ({ t: Date.parse(f.timestamp), c: f.front!.center, r: f.front!.radius_m, b: f.front_bearing_deg?.value ?? null }));
    const scar: [number, number] = [incident.center[0], incident.center[1]];
    const scarR = Math.sqrt(((incident.summary?.burned_ha ?? 1000) * 1e4) / Math.PI);
    return { t0, t1, center: scar, cell: [], regional: { fronts, scar, scarR } };
  }
  const ring = incident.reference_perimeter?.geometry.coordinates[0] as [number, number][] | undefined;
  return ring ? { t0, t1, center: incident.center as [number, number], cell: ring } : null;
}

export function useSimCtx(): SimCtx | null {
  const incident = useStore((s) => s.incident), timeline = useStore((s) => s.timeline), t0 = useStore((s) => s.t0), t1 = useStore((s) => s.t1);
  return useMemo(() => simCtxFor(incident, timeline, t0, t1), [incident, timeline, t0, t1]);
}
