// Visit every UI state at several viewports, screenshot it and run the geometry checks.
// node states.mjs <url> <outDir> [viewport filter]
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
const url = process.argv[2] ?? 'http://localhost:8000/?nointro';
const out = process.argv[3] ?? 'states-out';
const only = process.argv[4];
mkdirSync(out, { recursive: true });
const GEOM = readFileSync(new URL('./geom.js', import.meta.url), 'utf8');
const VIEWPORTS = [[2560, 1440, 1], [1920, 1080, 1], [1440, 900, 2], [1366, 768, 1], [1280, 720, 1], [1024, 768, 1], [768, 1024, 2], [390, 844, 3]].filter(([w, h]) => !only || only.split(',').includes(`${w}x${h}`));
const S = (fn) => `(() => { const s = window.__store.getState(); ${fn} })()`;
const STATES = [
  ['01-incident-layers', S(`s.set({ mode: 'incident', panel: 'layers', feedOpen: false, selectedUnitId: null, follow: null, view: '3d' });`)],
  ['02-incident-layers-scrolled', S(`s.set({ mode: 'incident', panel: 'layers' }); setTimeout(() => { const el = document.querySelector('.right .scroll'); if (el) el.scrollTop = 1e5; }, 50);`)],
  ['03-incident-analysis', S(`s.set({ mode: 'incident', panel: 'analysis' });`)],
  ['04-incident-analysis-answer', S(`s.set({ mode: 'incident', panel: 'analysis' }); setTimeout(() => document.querySelector('.suggest button')?.click(), 100);`), 2500],
  ['05-incident-evidence', S(`s.set({ mode: 'incident', panel: 'evidence' }); setTimeout(() => [...document.querySelectorAll('.btn-sm')].find(b => b.textContent.includes('dense smoke'))?.click(), 100);`), 1500],
  ['06-incident-notes', S(`s.set({ mode: 'incident', panel: 'notes' });`)],
  ['07-view-menu', S(`s.set({ mode: 'incident', panel: 'layers' }); setTimeout(() => [...document.querySelectorAll('.tb-menu')].find(b => b.textContent.includes('View'))?.click(), 50);`)],
  ['08-analysis-menu', S(`setTimeout(() => [...document.querySelectorAll('.tb-menu')].find(b => b.textContent.includes('Analysis'))?.click(), 50);`)],
  ['09-speed-menu', S(`document.querySelector('.tb-menu')?.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true })); setTimeout(() => document.querySelector('.speed')?.click(), 50);`)],
  ['10-2d', S(`document.querySelector('.speed')?.click(); s.set({ view: '2d' });`), 1800],
  ['11-compare', S(`s.set({ view: '3d', compare: { on: true, before: s.t0 + 120000 } });`), 1600],
  ['12-scenario', S(`s.set({ compare: { on: false, before: null } }); s.setLayer('projection', true); s.set({ playing: true, speed: 8 }); setTimeout(() => window.__scene.flyHome(), 50);`), 5000],
  ['13-groundtruth', S(`s.setLayer('projection', false); s.set({ playing: false }); s.setLayer('groundTruth', true);`), 1200],
  ['14-drones-real', S(`s.setLayer('groundTruth', false); s.set({ mode: 'drones', feedOpen: true, selectedUnitId: null, follow: null });`), 1800],
  ['15-drones-real-ir-zoom', `(() => { [...document.querySelectorAll('.feed-bar button')].find(b => b.textContent === 'IR*')?.click(); document.querySelector('.feed-bar button[title="Zoom in"]')?.click(); })()`, 800],
  ['16-drones-real-full', `(() => document.querySelector('.feed-bar button[title="Full camera view"]')?.click())()`, 800],
  ['17-drones-sim-FT-03', S(`document.querySelector('.feed.full .feed-bar button[title="Full camera view"]')?.click(); s.set({ selectedUnitId: 'FT-03', feedOpen: true });`), 2000],
  ['18-drones-sim-follow', `(() => [...document.querySelectorAll('.btn-dark')].find(b => b.textContent.includes('Follow'))?.click())()`, 2500],
  ['19-resources-none', S(`s.set({ mode: 'resources', selectedUnitId: null, follow: null, feedOpen: false }); s.setTime(s.t0 + 8 * 60000); window.__scene.flyHome();`), 1800],
  ['20-resources-T-910-chase', S(`s.set({ selectedUnitId: 'T-910' }); setTimeout(() => [...document.querySelectorAll('.btn-seg')].find(b => b.textContent === 'Chase')?.click(), 200);`), 2500],
  ['21-resources-E-45-ride', S(`s.set({ selectedUnitId: 'E-45', follow: null }); setTimeout(() => [...document.querySelectorAll('.btn-seg')].find(b => b.textContent.includes('Ride'))?.click(), 200);`), 2500],
  ['22-hover-tooltip', S(`s.set({ mode: 'incident', follow: null, selectedUnitId: null }); window.__scene.flyHome();`), 2000, 'hover'],
  ['23-timeline-end', S(`s.setTime(s.t1);`), 900],
  ['24-timeline-start', S(`s.setTime(s.t0);`), 900],
  ['25-presenter-title', S(`s.set({ presenting: true });`), 2500],
];

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const report = {};
for (const [w, h, dpr] of VIEWPORTS) {
  const vp = `${w}x${h}`;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, isMobile: w < 500, hasTouch: w < 800 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  await page.addInitScript(GEOM);
  await page.goto(url);
  try { await page.waitForFunction(() => window.__scene?.ready && window.__store?.getState().loaded, null, { timeout: 90000 }); }
  catch { report[vp] = { error: 'did not load' }; await page.screenshot({ path: `${out}/${vp}__LOADFAIL.png` }); await ctx.close(); continue; }
  await page.waitForTimeout(1500);
  report[vp] = {};
  for (const [name, js, wait = 900, special] of STATES) {
    try {
      await page.evaluate(js);
      await page.waitForTimeout(wait);
      if (special === 'hover') { const m = await page.evaluate(() => { const r = document.querySelector('.map').getBoundingClientRect(); return { x: r.x + r.width * 0.55, y: r.y + r.height * 0.55 }; }); await page.mouse.move(m.x, m.y); await page.waitForTimeout(400); }
      const g = await page.evaluate(() => window.__geom());
      report[vp][name] = g;
      await page.screenshot({ path: `${out}/${vp}__${name}.png` });
      if (special === 'hover') await page.mouse.move(2, 2);
    } catch (e) { report[vp][name] = { error: String(e).slice(0, 300) }; }
  }
  report[vp].__errors = errors.slice(0, 30);
  console.log(vp, 'done', errors.length, 'errors');
  await ctx.close();
}
writeFileSync(`${out}/states.json`, JSON.stringify(report, null, 1));
await browser.close();
