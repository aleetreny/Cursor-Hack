import { useSyncExternalStore } from 'react';

/**
 * Three shells, picked from the viewport:
 *  · phone   — either side under 560 px, or under 700 px wide: full-screen map + bottom sheet
 *  · tablet  — under 1100 px wide: desktop layout, the side panel becomes a drawer over the map
 *  · desktop — everything side by side
 * Exposed on <html data-layout> too, so CSS can follow without re-rendering.
 */
export type Layout = 'phone' | 'tablet' | 'desktop';

export function currentLayout(w = innerWidth, h = innerHeight): Layout {
  if (Math.min(w, h) < 560 || w < 700) return 'phone';
  if (w < 1100) return 'tablet';
  return 'desktop';
}

let value: Layout = currentLayout();
const listeners = new Set<() => void>();
const apply = () => {
  const next = currentLayout();
  document.documentElement.dataset.layout = next;
  document.documentElement.dataset.touch = matchMedia('(pointer: coarse)').matches ? '1' : '0';
  if (next !== value) { value = next; listeners.forEach((f) => f()); }
};
apply();
addEventListener('resize', apply);
addEventListener('orientationchange', apply);

export const useLayout = () => useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => value);
export const getLayout = () => value;
