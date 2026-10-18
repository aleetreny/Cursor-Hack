// Phones and tablets (touch emulation): screenshots + geometry checks of every shell state.
// node scripts/audit/devices.mjs <url> <outDir> [device filter]
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const url = process.argv[2] ?? 'http://localhost:4173/?nointro';
const out = process.argv[3] ?? 'devices-out';
const only = process.argv[4];
mkdirSync(out, { recursive: true });
const GEOM = readFileSync(new URL('./geom.js', import.meta.url), 'utf8');
const DEVICES = [
  ['iphone-se', 375, 667, 2], ['iphone-14', 390, 844, 3], ['pixel-7', 412, 915, 2.6], ['android-small', 360, 740, 3],
  ['iphone-landscape', 844, 390, 3], ['ipad-mini', 768, 1024, 2], ['ipad-landscape', 1024, 768, 2], ['ipad-air', 820, 1180, 2],
].filter(([n]) => !only || only.split(',').includes(n));
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const report = {};
for (const [name, w, h, dpr] of DEVICES) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, isMobile: w < 1100, hasTouch: true, serviceWorkers: 'block' });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text().slice(0, 160)));
  await p.addInitScript(GEOM);
  await p.goto(url);
  await p.waitForFunction(() => window.__scene?.ready && window.__store?.getState().loadMsg === '', null, { timeout: 90000 });
  await p.waitForTimeout(1200);
  const layout = await p.evaluate(() => document.documentElement.dataset.layout);
  const S = (fn) => p.evaluate(`(() => { const s = window.__store.getState(); ${fn} })()`);
  // landscape phones hide the tab row while the sheet is collapsed: open it with the handle first
  const ensureTabs = async () => { if (!(await p.locator('.sheet-tabs').first().isVisible().catch(() => false)) && await p.locator('.sheet-handle').count()) { await p.locator('.sheet-handle').tap(); await p.waitForTimeout(450); } };
  const tapTab = async (text) => { await ensureTabs(); await tapText('.sheet-tabs button', text); };
  const tapText = async (sel, text) => { const l = text ? p.locator(sel, { hasText: text }).first() : p.locator(sel).first(); if (await l.count()) await l.tap().catch(() => l.click()); };
  const states = layout === 'phone' ? [
    ['01-start', async () => {}],
    ['02-events', async () => tapTab('Events')],
    ['03-charts', async () => tapTab('Charts')],
    ['04-layers', async () => tapTab('Layers')],
    ['05-ask', async () => { await tapTab('Ask'); await p.waitForTimeout(300); await tapText('.suggest button'); await p.waitForTimeout(1200); }],
    ['06-search', async () => { await tapTab('Search'); await p.waitForTimeout(300); await tapText('.btn-sm', 'dense smoke'); }],
    ['07-about', async () => tapTab('About')],
    ['08-collapsed', async () => { await tapText('.sheet-tabs button.on'); }],
    ['09-drones', async () => { await tapText('.phone-bar .seg button[aria-label=Drones]'); }],
    ['10-drones-fleet', async () => tapTab('Fleet')],
    ['11-feed-full', async () => { await tapText('.sheet-tabs button.on'); await p.waitForTimeout(400); await tapText('.feed-bar button[aria-label="Full camera view"]'); }],
    ['12-resources', async () => { await tapText('.feed-bar button[aria-label="Full camera view"]'); await tapText('.phone-bar .seg button[aria-label=Resources]'); await p.waitForTimeout(300); await tapTab('Units'); }],
    ['13-menu', async () => { await tapText('.sheet-tabs button.on'); await tapText('.phone-bar .seg button[aria-label=Incident]'); await tapText('.pb-menu'); }],
    ['14-tap-info', async () => { await p.keyboard.press('Escape'); await p.waitForTimeout(200); const r = await p.evaluate(() => { const m = document.querySelector('.map').getBoundingClientRect(); return { x: m.x + m.width * 0.4, y: m.y + m.height * 0.3 }; }); await p.touchscreen.tap(r.x, r.y); }],
    ['15-tour-title', async () => { await S(`s.set({ presenting: true });`); await p.waitForSelector('.pz-dots i'); await p.waitForTimeout(2200); }],
    ['16-tour-caption', async () => { for (let i = 0; i < 4; i++) { await p.keyboard.press('ArrowRight'); await p.waitForTimeout(200); } await p.waitForTimeout(2500); }],
  ] : [
    ['01-start', async () => {}],
    ['02-drawer', async () => { await tapText('.tb-drawer'); await p.waitForTimeout(500); }],
    ['03-drones', async () => { await S(`s.set({ mode: 'drones', feedOpen: true });`); await p.waitForTimeout(800); }],
    ['04-resources', async () => { await S(`s.set({ mode: 'resources', selectedUnitId: 'T-910' });`); await p.waitForTimeout(800); }],
    ['05-closed', async () => { await S(`s.set({ mode: 'incident', drawer: false, feedOpen: false, selectedUnitId: null });`); await p.waitForTimeout(600); }],
    ['06-tour', async () => { await S(`s.set({ presenting: true });`); await p.waitForSelector('.pz-dots i'); for (let i = 0; i < 4; i++) { await p.keyboard.press('ArrowRight'); await p.waitForTimeout(200); } await p.waitForTimeout(2500); }],
  ];
  report[name] = { layout };
  // the guided tour belongs to the drone incident; a regional fire has none
  const regional = await p.evaluate(() => window.__store.getState().incident?.scale === 'regional');
  for (const [state, run] of states.filter(([st]) => !(regional && /tour/.test(st)))) {
    try {
      await run(); await p.waitForTimeout(700);
      report[name][state] = await p.evaluate(() => window.__geom());
      await p.screenshot({ path: `${out}/${name}__${state}.png` });
    } catch (e) { report[name][state] = { error: String(e).slice(0, 200) }; }
  }
  report[name].__errors = errs.slice(0, 10);
  console.log(name, layout, 'errors', errs.length);
  await ctx.close();
}
writeFileSync(`${out}/devices.json`, JSON.stringify(report, null, 1));
await browser.close();
