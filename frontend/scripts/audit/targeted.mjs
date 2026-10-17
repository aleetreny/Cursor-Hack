// Targeted behaviour checks for things a generic click sweep cannot judge.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const url = process.argv[2] ?? 'http://localhost:8000/?nointro';
const out = process.argv[3] ?? 'targeted-out';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
const R = [];
const note = (k, v) => { R.push([k, v]); console.log(k.padEnd(48), typeof v === 'string' ? v : JSON.stringify(v)); };
const st = (e) => page.evaluate(`(() => { const s = window.__store.getState(); return ${e}; })()`);
await page.goto(url);
await page.waitForFunction(() => window.__scene?.ready && window.__store?.getState().loaded, null, { timeout: 90000 });
await page.waitForTimeout(1000);
const pops = () => page.locator('.menu-pop').count();

// menus
await page.locator('.tb-menu', { hasText: 'View' }).click();
await page.mouse.click(700, 500); await page.waitForTimeout(200);
note('View menu closes on map click', (await pops()) === 0);
await page.locator('.tb-menu', { hasText: 'View' }).click();
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
note('View menu closes on Escape', (await pops()) === 0);
await page.mouse.move(700, 600); await page.waitForTimeout(200);
note('View menu closes when mouse leaves top bar', (await pops()) === 0);
await page.locator('.speed').click(); await page.mouse.click(700, 500); await page.waitForTimeout(200);
note('Speed menu closes on outside click', (await pops()) === 0);
await page.locator('.speed').click(); await page.keyboard.press('Escape'); await page.waitForTimeout(150);
note('Speed menu closes on Escape', (await pops()) === 0);
if (await pops()) await page.locator('.speed').click();

// affordances that look interactive
const aff = await page.evaluate(() => {
  const q = (s) => { const e = document.querySelector(s); return e ? { cursor: getComputedStyle(e).cursor, text: e.textContent.trim().slice(0, 30) } : null; };
  return { incidentChevron: q('.tb-incident'), overviewEdit: q('.section-h .act'), chartDots: q('.chart-h .muted'), gear: (() => { const b = [...document.querySelectorAll('.tb-right .tb-menu')].pop(); return b ? { title: b.title, aria: b.getAttribute('aria-label') } : null; })() };
});
note('Fake affordances (cursor)', aff);

// share
await page.locator('.tb-menu', { hasText: 'Share' }).click(); await page.waitForTimeout(300);
const clip = await page.evaluate(() => navigator.clipboard.readText());
const toast = await page.evaluate(() => document.body.innerText.match(/copied|copiado/i)?.[0] ?? null);
note('Share: clipboard', clip); note('Share: visible feedback', toast ?? 'none');
await page.evaluate(() => { const s = window.__store.getState(); s.set({ mode: 'drones', view: '2d' }); s.setTime(s.t0 + 400000); });
await page.waitForTimeout(500);
await page.locator('.tb-menu', { hasText: 'Share' }).click();
note('Share URL encodes state (mode/time/view)', /mode|t=|view/.test(await page.evaluate(() => navigator.clipboard.readText())));
await page.evaluate(() => window.__store.getState().set({ mode: 'incident', view: '3d' }));

// deep link
const p2 = await ctx.newPage();
await p2.goto(url + '&t=600&mode=drones');
await p2.waitForFunction(() => window.__store?.getState().loaded, null, { timeout: 60000 });
note('Deep link ?t=&mode= honoured', await p2.evaluate(() => window.__store.getState().mode));
await p2.close();

// history / back button
note('history length after mode changes', await page.evaluate(() => history.length));

// keyboard
await page.mouse.click(700, 500);
const t0 = await st('s.time');
await page.keyboard.press('ArrowRight'); await page.waitForTimeout(100);
note('ArrowRight seeks +8 s', ((await st('s.time')) - t0) / 1000);
await page.keyboard.press('Space'); await page.waitForTimeout(300);
note('Space toggles play', await st('s.playing'));
await page.keyboard.press('Space');
await page.keyboard.press('2'); await page.waitForTimeout(900);
note('key 2 → 2D', await st('s.view'));
await page.keyboard.press('3'); await page.waitForTimeout(500);
// Tab focus ring visible?
await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
note('focus-visible outline on focused control', await page.evaluate(() => { const e = document.activeElement; const cs = getComputedStyle(e); return { el: e.tagName + '.' + e.className, outline: cs.outlineStyle + ' ' + cs.outlineWidth, shadow: cs.boxShadow.slice(0, 40) }; }));

// agent: arbitrary questions
await page.evaluate(() => window.__store.getState().set({ panel: 'analysis', mode: 'incident' }));
await page.waitForTimeout(300);
for (const q of ['Where is the drone?', '¿Cuánto se quemó?', 'What was the wind?', 'Is anyone in danger?']) {
  await page.locator('.chat-in input').fill(q); await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  note('Agent: ' + q, (await page.locator('.msg.bot').last().innerText()).replace(/\s+/g, ' ').slice(0, 220));
}
// evidence: free search + click result
await page.evaluate(() => window.__store.getState().set({ panel: 'evidence' }));
await page.waitForTimeout(300);
for (const q of ['flames', 'helicopter', 'humo', 'burned ground near the road']) {
  await page.locator('.right .chat-in input').fill(q); await page.keyboard.press('Enter');
  await page.waitForTimeout(1000);
  note('Search: ' + q, `${await page.locator('.result').count()} results · ` + ((await page.locator('.result .cap').allInnerTexts()).slice(0, 3).join(' | ').slice(0, 160)));
}
if (await page.locator('.result').count()) {
  const b = await st('s.time');
  await page.locator('.result').first().click(); await page.waitForTimeout(500);
  note('Search result click seeks + opens feed', { moved: (await st('s.time')) !== b, feed: await st('s.feedOpen') });
}

// compare handle drag
await page.evaluate(() => { const s = window.__store.getState(); s.set({ compare: { on: true, before: s.t0 + 60000 } }); s.setTime(s.t0 + 500000); });
await page.waitForTimeout(400);
const h = await page.locator('.handle.before').boundingBox();
if (h) { await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2); await page.mouse.down(); await page.mouse.move(h.x + 200, h.y + h.height / 2, { steps: 5 }); await page.mouse.up(); }
note('Compare handle drag moves "before"', await st('s.compare.before !== s.t0 + 60000'));
note('Compare banner', (await page.locator('.banner').innerText()).replace(/\s+/g, ' '));
note('Compare: map visual (scene compare uniform)', await page.evaluate(() => { const u = window.__scene.uniforms; return Object.keys(u).filter((k) => /comp|before/i.test(k)).map((k) => k + '=' + JSON.stringify(u[k].value)).join(' '); }));
await page.evaluate(() => window.__store.getState().set({ compare: { on: false, before: null } }));

// map click on drone / events
await page.evaluate(() => window.__scene.flyHome()); await page.waitForTimeout(2600);
const lbl = await page.evaluate(() => { const e = [...document.querySelectorAll('.scene-label')].find((x) => x.textContent.includes('Phantom') && x.style.visibility !== 'hidden'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
if (lbl) { await page.mouse.click(lbl.x, lbl.y); await page.waitForTimeout(500); note('Click drone label → drones mode', await st('s.mode')); } else note('Drone label visible at home view', false);
await page.evaluate(() => window.__store.getState().set({ mode: 'incident', feedOpen: false }));

// feed full + Escape
await page.evaluate(() => window.__store.getState().set({ mode: 'drones', feedOpen: true }));
await page.waitForTimeout(600);
await page.locator('.feed-bar button[aria-label="Full camera view"]').click(); await page.waitForTimeout(200);
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
note('Escape exits full camera view', !(await page.locator('.feed.full').count()));
if (await page.locator('.feed.full').count()) await page.locator('.feed-bar button[aria-label="Full camera view"]').click();
// feed hides map labels underneath?
note('Feed drag handle exists (real)', await page.evaluate(() => getComputedStyle(document.querySelector('.feed-bar')).cursor));
await page.evaluate(() => window.__store.getState().set({ selectedUnitId: 'FT-04' })); await page.waitForTimeout(800);
note('Sim feed draggable', await page.evaluate(() => getComputedStyle(document.querySelector('.feed-bar')).cursor));
note('Sim feed has zoom', await page.locator('.feed-bar button[title="Zoom in"]').count());

// time end behaviour
await page.evaluate(() => { const s = window.__store.getState(); s.set({ mode: 'incident', selectedUnitId: null, feedOpen: false }); s.setTime(s.t1 - 2000); s.set({ playing: true, speed: 8 }); });
await page.waitForTimeout(1200);
note('Playback stops at end (no loop)', { playing: await st('s.playing'), atEnd: await st('s.time === s.t1') });
await page.locator('.tl-ctrl button[aria-label=Play]').click(); await page.waitForTimeout(500);
note('Play at end restarts from start?', { playing: await st('s.playing'), t: await st('Math.round((s.time - s.t0)/1000)') });

// resize robustness
await page.setViewportSize({ width: 1100, height: 700 }); await page.waitForTimeout(600);
await page.setViewportSize({ width: 1600, height: 900 }); await page.waitForTimeout(600);
note('Canvas follows resize', await page.evaluate(() => { const c = document.querySelector('.map canvas'), m = document.querySelector('.map'); return [c.clientWidth, m.clientWidth]; }));

// WebGL context loss: does the scene recover?
const ext = await page.evaluateHandle(() => window.__scene.renderer.getContext().getExtension('WEBGL_lose_context'));
await page.evaluate((e) => e && e.loseContext(), ext); await page.waitForTimeout(800);
await page.evaluate((e) => e && e.restoreContext(), ext); await page.waitForTimeout(1500);
note('Context restored and rendering', await page.evaluate(() => !window.__scene.renderer.getContext().isContextLost()));
await page.screenshot({ path: `${out}/after-context-restore.png` });
note('errors', errors.slice(0, 10));
writeFileSync(`${out}/targeted.json`, JSON.stringify(R, null, 1));
await browser.close();
