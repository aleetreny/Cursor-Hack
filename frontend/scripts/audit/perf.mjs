// Load + runtime performance probe. node perf.mjs <url> <outDir>
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const url = process.argv[2] ?? 'http://localhost:8000/';
const out = process.argv[3] ?? 'perf-out';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--enable-precise-memory-info'] });
const report = {};
for (const [tag, u, net] of [['cold-nointro', url + '?nointro', null], ['cold-intro', url, null], ['slow4g-nointro', url + '?nointro', { latency: 150, down: 1.6e6 / 8, up: 750e3 / 8 }]]) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  if (net) await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: net.latency, downloadThroughput: net.down, uploadThroughput: net.up });
  const reqs = new Map();
  cdp.on('Network.responseReceived', (e) => { reqs.set(e.requestId, { url: e.response.url, type: e.type, status: e.response.status, enc: e.response.headers['content-encoding'] ?? e.response.headers['Content-Encoding'] ?? '', bytes: 0 }); });
  cdp.on('Network.loadingFinished', (e) => { const r = reqs.get(e.requestId); if (r) r.bytes = e.encodedDataLength; });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text().slice(0, 200)); });
  page.on('requestfailed', (r) => errors.push('requestfailed: ' + r.url().slice(0, 120) + ' ' + r.failure()?.errorText));
  await page.addInitScript(() => {
    window.__marks = {}; window.__long = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push({ s: Math.round(e.startTime), d: Math.round(e.duration) }); }).observe({ type: 'longtask', buffered: true });
    const iv = setInterval(() => {
      const s = window.__store?.getState(), sc = window.__scene;
      if (s?.loaded && !window.__marks.loaded) window.__marks.loaded = performance.now();
      if (sc?.ready && !window.__marks.ready) window.__marks.ready = performance.now();
      if (s && s.loadMsg === '' && !window.__marks.overlayGone) window.__marks.overlayGone = performance.now();
      if (window.__marks.overlayGone && window.__marks.ready) clearInterval(iv);
    }, 20);
  });
  const t0 = Date.now();
  await page.goto(u, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__marks?.ready && window.__marks?.overlayGone, null, { timeout: 180000 });
  const wall = Date.now() - t0;
  await page.waitForTimeout(tag === 'cold-intro' ? 6000 : 1500);
  const m = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const paint = Object.fromEntries(performance.getEntriesByType('paint').map((p) => [p.name, Math.round(p.startTime)]));
    const sc = window.__scene, info = sc?.renderer?.info;
    return {
      dcl: Math.round(nav.domContentLoadedEventEnd), load: Math.round(nav.loadEventEnd), ...paint,
      storeLoaded: Math.round(window.__marks.loaded), sceneReady: Math.round(window.__marks.ready), overlayGone: Math.round(window.__marks.overlayGone),
      longTasks: window.__long.length, longTaskMs: window.__long.reduce((a, b) => a + b.d, 0), worstLong: window.__long.sort((a, b) => b.d - a.d).slice(0, 6),
      heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
      gl: info ? { calls: info.render.calls, tris: info.render.triangles, points: info.render.points, geos: info.memory.geometries, tex: info.memory.textures, programs: info.programs?.length } : null,
      dpr: devicePixelRatio, canvas: (() => { const c = document.querySelector('canvas'); return c ? [c.width, c.height] : null; })(),
    };
  });
  const list = [...reqs.values()];
  const by = {};
  for (const r of list) {
    const k = /terrarium|elevation-tiles/.test(r.url) ? 'dem-tiles' : /arcgisonline|World_Imagery|server\.arcgis/.test(r.url) ? 'imagery-tiles' : /\.mp4/.test(r.url) ? 'video' : /\/api\/|fixtures|\.json/.test(r.url) ? 'api-json' : /\.js(\?|$)/.test(r.url) ? 'js' : /\.css/.test(r.url) ? 'css' : /woff/.test(r.url) ? 'font' : /\.(jpg|png|webp)/.test(r.url) ? 'img' : 'other';
    by[k] ??= { n: 0, kb: 0 }; by[k].n++; by[k].kb += r.bytes / 1024;
  }
  for (const k in by) by[k].kb = Math.round(by[k].kb);
  const biggest = list.sort((a, b) => b.bytes - a.bytes).slice(0, 10).map((r) => ({ kb: Math.round(r.bytes / 1024), enc: r.enc, url: r.url.replace(/^https?:\/\/[^/]+/, '').slice(0, 90) }));
  // FPS in several states
  const fps = async (label, setup, ms = 2500) => {
    await page.evaluate(setup); await page.waitForTimeout(900);
    const r = await page.evaluate((ms) => new Promise((res) => { const ts = []; const t0 = performance.now(); const f = (t) => { ts.push(t); if (t - t0 < ms) requestAnimationFrame(f); else { const d = ts.slice(1).map((x, i) => x - ts[i]).sort((a, b) => a - b); res({ fps: +(ts.length / (ms / 1000)).toFixed(1), p50: +d[Math.floor(d.length / 2)].toFixed(1), p95: +d[Math.floor(d.length * 0.95)].toFixed(1), max: +d[d.length - 1].toFixed(1) }); } }; requestAnimationFrame(f); }), ms);
    return [label, r];
  };
  const F = [];
  if (tag === 'cold-nointro') {
    F.push(await fps('idle 3D', () => window.__store.getState().set({ playing: false })));
    F.push(await fps('play 8x 3D', () => window.__store.getState().set({ playing: true, speed: 8 })));
    F.push(await fps('2D', () => window.__store.getState().set({ view: '2d' })));
    F.push(await fps('scenario', () => { const s = window.__store.getState(); s.set({ view: '3d', playing: false }); s.setLayer('projection', true); }, 4000));
    F.push(await fps('drones real feed playing', () => { const s = window.__store.getState(); s.setLayer('projection', false); s.set({ mode: 'drones', feedOpen: true, playing: true, speed: 1 }); }));
    F.push(await fps('drones sim feed FT-03', () => window.__store.getState().set({ selectedUnitId: 'FT-03', feedOpen: true, playing: true, speed: 4 })));
    F.push(await fps('resources chase T-910', () => { const s = window.__store.getState(); s.set({ mode: 'resources', selectedUnitId: 'T-910', follow: { id: 'T-910', mode: 'chase' }, playing: true, speed: 8 }); }));
    m.gl2 = await page.evaluate(() => { const i = window.__scene?.renderer?.info; return i ? { calls: i.render.calls, tris: i.render.triangles, geos: i.memory.geometries, tex: i.memory.textures } : null; });
    m.heapAfterMB = await page.evaluate(() => performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null);
  }
  await page.screenshot({ path: `${out}/${tag}.png` });
  report[tag] = { wallMs: wall, ...m, requests: list.length, byType: by, biggest, fps: Object.fromEntries(F), errors: errors.slice(0, 20) };
  console.log(tag, JSON.stringify(report[tag], null, 1));
  await ctx.close();
}
writeFileSync(`${out}/perf.json`, JSON.stringify(report, null, 1));
await browser.close();
