// Full QA walk of presentation mode: manual-only advance, numbering, per-chapter state, overlaps, stale actions.
// Usage: URL=http://localhost:5173/?nointro node scripts/present-test.mjs outDir [WxH]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const out = process.argv[2] ?? 'present-test'; mkdirSync(out, { recursive: true });
const [vw, vh] = (process.argv[3] ?? '1920x1080').split('x').map(Number);
const b = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage({ viewport: { width: vw, height: vh } });
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await p.goto(process.env.URL ?? 'http://localhost:5173/?nointro');
await p.waitForFunction(() => window.__scene?.ready && window.__store?.getState().loaded, null, { timeout: 90000 });
await p.waitForTimeout(1200);
const EXPECT = { twin: 'incident', layers: 'incident', observed: 'incident', area: 'incident', ros: 'incident', elev: 'incident', weather: 'incident', truth: 'incident', events: 'incident', live: 'drones', agent: 'incident', search: 'incident', scenario: 'incident', resources: 'resources' };
const fails = []; const ok = (c, m) => { if (!c) fails.push(m); };
const R = (sel) => p.evaluate((s) => { const r = document.querySelector(s)?.getBoundingClientRect(); return r && r.width ? { l: r.left, t: r.top, r: r.right, b: r.bottom } : null; }, sel);
const inter = (a, c) => a && c && Math.max(0, Math.min(a.r, c.r) - Math.max(a.l, c.l)) * Math.max(0, Math.min(a.b, c.b) - Math.max(a.t, c.t));
await p.locator('.tb-tour').click();
const N = await p.evaluate(() => document.querySelectorAll('.pz-dots i').length);
console.log('chapters:', N);
for (let k = 0; k < N; k++) {
  await p.waitForTimeout(6000);
  const info = await p.evaluate(() => ({ id: document.querySelector('.pz')?.getAttribute('data-step'), bar: document.querySelector('.pz-name span')?.textContent, cap: document.querySelector('.pz-no')?.textContent, mode: window.__store.getState().mode }));
  ok(info.bar?.startsWith(`${k + 1} /`), `ch${k + 1} did not stay (bar ${info.bar})`);
  if (info.cap) ok(info.cap === String(k + 1), `ch${k + 1} caption number ${info.cap}`);
  if (EXPECT[info.id]) ok(info.mode === EXPECT[info.id], `ch${k + 1} ${info.id}: mode ${info.mode} ≠ ${EXPECT[info.id]}`);
  const cap = await R('.pz-caption'), bar = await R('.pz-bar'), feed = await R('.feed');
  ok(!(inter(cap, bar) > 0), `ch${k + 1} ${info.id}: caption overlaps bar`);
  ok(!(inter(feed, bar) > 0), `ch${k + 1} ${info.id}: bar overlaps drone feed`);
  ok(!(inter(cap, feed) > 0), `ch${k + 1} ${info.id}: caption overlaps drone feed`);
  if (info.id === 'live') {
    const v = await p.evaluate(async () => { const el = document.querySelector('.feed video'); const a = el.currentTime; await new Promise((r) => setTimeout(r, 1500)); return { a, b: el.currentTime, paused: el.paused, ready: el.readyState }; });
    ok(!v.paused && v.b - v.a > 1.0 && v.b - v.a < 2.2, `live video not playing in real time: ${JSON.stringify(v)}`);
    console.log('   live video advanced', (v.b - v.a).toFixed(2), 's in 1.5 s');
  }
  if (cap) ok(cap.l >= 0 && cap.r <= vw && cap.t >= 0 && cap.b <= vh, `ch${k + 1} caption off-screen`);
  await p.screenshot({ path: `${out}/${String(k + 1).padStart(2, '0')}_${info.id}.png` });
  console.log(`${k + 1}/${N} ${info.id} mode=${info.mode} cap=${info.cap ?? '-'}`);
  if (k < N - 1) await p.keyboard.press('ArrowRight');
}
// stale-action check: jump to 'alert' then immediately to 'agent' and beyond; alert's delayed switch to drones must not fire
await p.keyboard.press('Escape'); await p.waitForTimeout(500);
await p.locator('.tb-tour').click(); await p.waitForTimeout(600);
const idx = await p.evaluate(() => [...document.querySelectorAll('.pz-dots i')].findIndex((e) => e.getAttribute('title') === 'Live drone video'));
await p.locator('.pz-dots i').nth(idx).click(); await p.waitForTimeout(300);
await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowRight');   // → scenario
await p.waitForTimeout(4500);
const after = await p.evaluate(() => ({ id: document.querySelector('.pz')?.getAttribute('data-step'), mode: window.__store.getState().mode, panel: window.__store.getState().panel }));
ok(after.id === 'scenario' && after.mode === 'incident' && after.panel === 'layers', `stale action leaked: ${JSON.stringify(after)}`);
await p.keyboard.press('Escape'); await p.waitForTimeout(400);
ok((await p.locator('.pz').count()) === 0, 'Esc did not exit');
ok(errs.length === 0, 'console errors: ' + errs.slice(0, 3).join(' | '));
console.log(fails.length ? 'FAILURES:\n' + fails.join('\n') : 'ALL CHECKS PASSED');
await b.close();
