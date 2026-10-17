import { useStore } from '../state/store';
import { sceneRef, selectEvent } from '../scene/SceneView';

/** Scripted two-minute walkthrough. Any user click on the map/panels cancels it. */
let running = false;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runTour(onStep?: (label: string) => void) {
  if (running) return;
  running = true;
  const cancel = () => { running = false; };
  window.addEventListener('pointerdown', cancel, { once: true, capture: true });
  const st = () => useStore.getState();
  const step = async (label: string, fn: () => void | Promise<void>, wait: number) => {
    if (!running) throw new Error('cancelled');
    onStep?.(label);
    await fn();
    await sleep(wait);
  };
  try {
    await step('Real terrain, real drone pose', () => { st().set({ mode: 'incident', panel: 'layers', view: '3d', feedOpen: false, compare: { on: false, before: null } }); st().setTime(st().t0 + 60000); sceneRef.current?.flyHome(); }, 3500);
    await step('Replaying the observed progression', () => st().set({ speed: 32, playing: true }), 9000);
    await step('Model alert: rapid growth', () => {
      st().set({ playing: false });
      const e = st().events.find((x) => x.severity === 'alert' && x.event_type === 'visible_fire_expansion') ?? st().events.find((x) => x.severity === 'alert');
      if (e) selectEvent(e.event_id);
    }, 3000);
    await step('Drone evidence at that second', () => st().set({ mode: 'drones', feedOpen: true }), 6000);
    await step('Ask the video agent', () => st().set({ mode: 'incident', panel: 'analysis', feedOpen: true }), 1200);
    await step('Ask the video agent', () => { (document.querySelector('.suggest button') as HTMLButtonElement | null)?.click(); }, 7000);
    await step('Compare against ground truth', () => {
      st().set({ feedOpen: false, view: '2d', panel: 'layers', compare: { on: true, before: st().time - 180000 } });
      st().setLayer('groundTruth', true);
    }, 6500);
    await step('Integrations & provenance', () => st().set({ view: '3d', panel: 'notes', compare: { on: false, before: null } }), 4000);
    onStep?.('');
  } catch {
    onStep?.('');
  } finally {
    running = false;
    window.removeEventListener('pointerdown', cancel, { capture: true });
  }
}
