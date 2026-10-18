// Catalogue views of both incidents + frame rate while playing. node scripts/audit/views.mjs <outDir> [base]
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const out = args[0] ?? 'views-out', base = args[1] ?? 'http://localhost:4173/';
mkdirSync(out, { recursive: true });
const uncapped = process.argv.includes('--uncapped');   // no vsync / frame cap: measures headroom, not the 60 fps display rate
const b = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist', ...(uncapped ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : [])] });
const report = {};
const VIEWS = {
  larouco: [
    ['home', (s) => {}],
    ['front-close', (s) => { s.setTime(Date.parse('2025-08-16T23:00:00Z')); window.__selEv?.(s.events.find((e) => e.title.startsWith('Fast run'))?.event_id); }],
    ['horizon', (s) => { s.setTime(Date.parse('2025-08-17T14:00:00Z')); const sc = window.__scene; sc.setCameraState([...sc.cameraState().slice(0, 3).map((v, i) => i === 1 ? 2500 : v), ...sc.cameraState().slice(3)], 0); }],
    ['night', (s) => { window.__scene.flyHome(); s.setTime(Date.parse('2025-08-17T02:00:00Z')); }],
    ['dusk', (s) => { s.setTime(Date.parse('2025-08-16T19:50:00Z')); }],
    ['trees-close', (s) => { s.setTime(Date.parse('2025-08-17T11:00:00Z')); const f = s.timeline.frames.find((x) => x.timestamp >= '2025-08-17T11:00:00Z' && x.front); const sc = window.__scene; const p = sc.worldAt(f.front.center[0], f.front.center[1]); sc.setCameraState([p.x - 900, p.y + 520, p.z + 1100, p.x, p.y, p.z], 0); }],
    ['2d', (s) => { s.set({ view: '2d' }); }],
    ['overview', (s) => { s.set({ view: '3d' }); s.setTime(Date.parse('2025-08-20T13:00:00Z')); const sc = window.__scene; sc.setCameraState([-38000, 52000, 62000, 0, 0, 0], 0); }],
  ],
  pinhao: [
    ['home', (s) => {}],
    ['horizon', (s) => { const sc = window.__scene; const c = sc.cameraState(); sc.setCameraState([c[0] * 3, 60, c[2] * 3, c[3], c[4], c[5]], 0); }],
  ],
};
for (const [inc, views] of Object.entries(VIEWS)) {
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await p.goto(`${base}?incident=${inc === 'larouco' ? 'larouco-2025-08' : 'pinhao-2019-03-01'}&nointro`);
  await p.waitForFunction(() => window.__scene?.ready && window.__store?.getState().loadMsg === '', null, { timeout: 90000 });
  await p.waitForTimeout(6000);
  report[inc] = {};
  for (const [name, fn] of views) {
    await p.evaluate(`(${fn.toString()})(window.__store.getState())`);
    await p.waitForTimeout(3500);
    await p.screenshot({ path: `${out}/${inc}-${name}.jpg`, type: 'jpeg', quality: 82 });
    // frames per second while the timeline plays (worst case: everything moves)
    const fps = await p.evaluate(async () => { const s = window.__store.getState(); s.set({ playing: true }); let n = 0; const t0 = performance.now(); await new Promise((r) => { const f = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else r(); }; requestAnimationFrame(f); }); s.set({ playing: false }); return Math.round(n / ((performance.now() - t0) / 1000)); });
    report[inc][name] = fps;
    console.log(inc, name, fps, 'fps');
  }
  await p.close();
}
writeFileSync(`${out}/views.json`, JSON.stringify(report, null, 1));
await b.close();
