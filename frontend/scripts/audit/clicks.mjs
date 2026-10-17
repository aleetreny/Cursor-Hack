// Click every clickable element in each app state and record what (if anything) it changed.
// node clicks.mjs <url> <outDir>
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const url = process.argv[2] ?? 'http://localhost:8000/?nointro';
const out = process.argv[3] ?? 'clicks-out';
mkdirSync(out, { recursive: true });
const S = (fn) => `(() => { const s = window.__store.getState(); ${fn} })()`;
const BASES = [
  ['incident-layers', S(`s.set({ mode: 'incident', panel: 'layers', feedOpen: false, selectedUnitId: null, follow: null });`)],
  ['incident-analysis', S(`s.set({ mode: 'incident', panel: 'analysis', feedOpen: false });`)],
  ['incident-evidence', S(`s.set({ mode: 'incident', panel: 'evidence', feedOpen: false });`)],
  ['incident-notes', S(`s.set({ mode: 'incident', panel: 'notes', feedOpen: false });`)],
  ['drones-real', S(`s.set({ mode: 'drones', feedOpen: true, selectedUnitId: null });`)],
  ['drones-sim', S(`s.set({ mode: 'drones', feedOpen: true, selectedUnitId: 'FT-02' });`)],
  ['resources-air', S(`s.set({ mode: 'resources', selectedUnitId: 'T-910' }); s.setTime(s.t0 + 8 * 60000);`)],
  ['resources-ground', S(`s.set({ mode: 'resources', selectedUnitId: 'C-7' }); s.setTime(s.t0 + 8 * 60000);`)],
];
const KEYS = ['mode', 'panel', 'view', 'time', 'playing', 'speed', 'layers', 'exaggeration', 'selectedEventId', 'selectedSourceId', 'selectedUnitId', 'follow', 'feedOpen', 'compare', 'presenting'];
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
page.on('dialog', (d) => d.dismiss());
const results = [];
const load = async () => { await page.goto(url); await page.waitForFunction(() => window.__scene?.ready && window.__store?.getState().loaded, null, { timeout: 90000 }); await page.waitForTimeout(800); };
const snap = () => page.evaluate((KEYS) => {
  const s = window.__store.getState(), c = window.__scene.camera.position;
  return { st: Object.fromEntries(KEYS.map((k) => [k, JSON.stringify(s[k])])), cam: [c.x, c.y, c.z], text: document.querySelector('.app').innerText.length + ':' + [...document.querySelector('.app').innerText].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 0), pops: document.querySelectorAll('.menu-pop, .feed, .pz, .feed.full').length, fs: !!document.fullscreenElement, href: location.href, cls: [...document.querySelectorAll('.on, .sel, .full')].length };
}, KEYS);
const enumerate = () => page.evaluate(() => {
  const vis = (e) => { const r = e.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false; const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || +cs.opacity < 0.1) return false; const p = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return p && (e === p || e.contains(p)); };
  const all = [...document.querySelectorAll('.app *')].filter((e) => {
    if (e.closest('canvas')) return false;
    const tag = e.tagName;
    if (['BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'A'].includes(tag)) return true;
    const cs = getComputedStyle(e); if (cs.cursor !== 'pointer') return false;
    const pc = e.parentElement && getComputedStyle(e.parentElement).cursor; return pc !== 'pointer';
  }).filter(vis);
  const seen = {};
  return all.map((e, i) => { const r = e.getBoundingClientRect(); const base = [e.tagName, (typeof e.className === 'string' ? e.className.replace(/\b(on|sel|future|collide|full)\b/g, '').trim() : ''), (e.innerText || e.value || e.getAttribute('title') || e.placeholder || '').trim().replace(/\s+/g, ' ').replace(/[0-9]+/g, '#').slice(0, 30), (e.closest('.topbar, .right, .bottom, .feed, .mapctl, .compass, .map') ?? {}).className?.split(' ')[0] ?? ''].join('|'); seen[base] = (seen[base] ?? -1) + 1; const key = base + '|' + seen[base]; e.setAttribute('data-audit', key); return { i, key, tag: e.tagName.toLowerCase(), type: e.type ?? '', cls: (typeof e.className === 'string' ? e.className : '').slice(0, 40), text: (e.innerText || e.value || e.getAttribute('title') || e.placeholder || '').trim().replace(/\s+/g, ' ').slice(0, 50), title: e.getAttribute('title') ?? '', region: (e.closest('.topbar, .right, .bottom, .feed, .mapctl, .compass, .map') ?? {}).className?.split(' ')[0] ?? '', w: Math.round(r.width), h: Math.round(r.height) }; });
});
for (const [base, setup] of BASES) {
  await load();
  await page.evaluate(setup); await page.waitForTimeout(1200);
  const cands = await enumerate();
  console.log(base, cands.length, 'candidates');
  const baseline = await page.evaluate((KEYS) => { const s = window.__store.getState(); return Object.fromEntries(KEYS.map((k) => [k, s[k]])); }, KEYS);
  for (const c of cands) {
    if (/Present/.test(c.text) && base !== 'incident-layers') continue;
    // restore
    await page.evaluate((b) => { const s = window.__store.getState(); s.set({ ...b, presenting: false }); }, baseline);
    await page.keyboard.press('Escape').catch(() => {});
    await page.mouse.move(800, 500); await page.waitForTimeout(150);
    await enumerate();
    const loc = page.locator(`[data-audit="${c.key.replace(/"/g, '\\"')}"]`);
    if (!(await loc.count()) || !(await loc.isVisible().catch(() => false))) { results.push({ base, ...c, outcome: 'gone-after-restore' }); continue; }
    const before = await snap();
    const e0 = errors.length;
    try {
      if (c.tag === 'input' && c.type === 'range') { await loc.fill('0.3'); }
      else if (c.tag === 'input' || c.tag === 'textarea') { await loc.click({ timeout: 2000 }); await page.keyboard.type('audit'); await page.keyboard.press('Enter'); }
      else await loc.click({ timeout: 2000 });
    } catch (e) { results.push({ base, ...c, outcome: 'click-failed', err: String(e).split('\n')[0].slice(0, 160) }); continue; }
    await page.waitForTimeout(700);
    const after = await snap();
    const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => '')).catch(() => '');
    const changed = Object.keys(before.st).filter((k) => before.st[k] !== after.st[k]);
    const camMoved = Math.hypot(...before.cam.map((v, i) => v - after.cam[i]));
    const eff = [];
    if (changed.length) eff.push('store:' + changed.join(','));
    if (camMoved > 0.5) eff.push(`camera:${camMoved.toFixed(0)}`);
    if (before.text !== after.text) eff.push('text');
    if (before.pops !== after.pops) eff.push(`overlays:${before.pops}->${after.pops}`);
    if (before.fs !== after.fs) eff.push('fullscreen');
    if (before.href !== after.href) eff.push('url');
    if (before.cls !== after.cls) eff.push('class');
    if (clip && clip !== before.clip) eff.push('clipboard:' + clip.slice(0, 40));
    const newErr = errors.slice(e0);
    results.push({ base, ...c, outcome: eff.length ? 'effect' : 'NO-EFFECT', eff: eff.join(' '), errors: newErr });
    if (after.fs) await page.evaluate(() => document.exitFullscreen().catch(() => {}));
    await page.evaluate(() => navigator.clipboard.writeText('').catch(() => {})).catch(() => {});
  }
}
writeFileSync(`${out}/clicks.json`, JSON.stringify({ results, errors }, null, 1));
const dead = results.filter((r) => r.outcome !== 'effect');
console.log('total', results.length, 'no-effect/failed', dead.length, 'errors', errors.length);
for (const r of dead) console.log(r.outcome.padEnd(18), r.base.padEnd(18), r.region.padEnd(10), `${r.tag}.${r.cls}`.slice(0, 34).padEnd(34), JSON.stringify(r.text), r.err ?? '');
await browser.close();
