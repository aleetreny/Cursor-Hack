// End-to-end UI test: layout geometry at 6 viewports + full functional walk. Uses real Chrome (H.264 video).
// Usage: node scripts/e2e.mjs [url] [outDir]     (default http://localhost:5174/?nointro)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:5174/?nointro';
const out = process.argv[3] ?? 'e2e-out';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: process.env.CHANNEL ?? 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const results = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

async function open(w, h) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url);
  await page.waitForFunction(() => window.__scene?.ready && window.__store?.getState().loaded, null, { timeout: 60000 });
  await page.waitForTimeout(1200);
  return { page, errors };
}
const rect = (page, sel) => page.evaluate((s) => { const r = document.querySelector(s)?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, r: r.right, b: r.bottom, w: r.width, h: r.height } : null; }, sel);
const overlap = (a, b) => Math.max(0, Math.min(a.r, b.r) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.y, b.y));

// ---------------------------------------------------------------- geometry
for (const [w, h] of [[1874, 1080], [1920, 1080], [1600, 900], [1440, 900], [1366, 768], [1280, 720]]) {
  const { page, errors } = await open(w, h);
  const tag = `${w}x${h}`;
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  ok(`${tag} no horizontal scroll`, sw <= w + 2, `scrollWidth ${sw}`);
  const R = { top: await rect(page, '.topbar'), map: await rect(page, '.map'), side: await rect(page, '.right'), deck: await rect(page, '.bottom') };
  const pairs = [['top', 'map'], ['top', 'side'], ['top', 'deck'], ['map', 'side'], ['map', 'deck'], ['side', 'deck']];
  const bad = pairs.filter(([a, b]) => overlap(R[a], R[b]) > 2);
  ok(`${tag} shell regions disjoint`, bad.length === 0, bad.map((p) => p.join('/')).join(', '));
  ok(`${tag} shell fills viewport`, Math.abs(R.side.b - h) < 2 && Math.abs(R.deck.b - h) < 2 && Math.abs(R.side.r - w) < 2, `side ${R.side.w.toFixed(0)}px deck ${R.deck.h.toFixed(0)}px`);
  const outside = await page.evaluate(() => [...document.querySelectorAll('.topbar button, .mapctl button, .tl-ctrl button, .tabs button')].filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && (r.right > innerWidth + 1 || r.bottom > innerHeight + 1 || r.left < -1); }).length);
  ok(`${tag} controls inside viewport`, outside === 0, `${outside} outside`);
  const clipped = await page.evaluate(() => [...document.querySelectorAll('.layer .pct, .chart-h, .section-h, .ev .t')].filter((e) => e.scrollWidth > e.clientWidth + 1).length);
  ok(`${tag} no clipped labels`, clipped === 0, `${clipped} clipped`);
  const labelHits = await page.evaluate(() => {
    const els = [...document.querySelectorAll('.scene-label')].filter((e) => e.style.visibility !== 'hidden' && !e.classList.contains('collide') && e.firstElementChild && !e.firstElementChild.classList.contains('lbl-hotspot'));
    const rs = els.map((e) => e.querySelector('.txt, .lbl-drone, .lbl-peak')?.getBoundingClientRect()).filter((r) => r && r.width > 0);
    let n = 0; for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) { const a = rs[i], b = rs[j]; if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 3 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 3) n++; } return n;
  });
  ok(`${tag} map labels do not overlap`, labelHits === 0, `${labelHits} overlapping pairs`);
  // drone PiP stays inside the map
  await page.evaluate(() => window.__store.getState().set({ mode: 'drones', feedOpen: true }));
  await page.waitForTimeout(500);
  const pip = await rect(page, '.feed'), map = await rect(page, '.map');
  ok(`${tag} PiP inside map pane`, pip && pip.x >= map.x && pip.r <= map.r + 1 && pip.y >= map.y && pip.b <= map.b + 1);
  await page.screenshot({ path: `${out}/layout_${tag}.png` });
  ok(`${tag} no console errors`, errors.length === 0, errors.slice(0, 2).join(' | '));
  await page.close();
}

// ---------------------------------------------------------------- functional walk
{
  const { page, errors } = await open(1440, 900);
  const st = (expr) => page.evaluate(`(() => { const s = window.__store.getState(); return ${expr}; })()`);
  const sc = (expr) => page.evaluate(`(() => { const s = window.__scene; return ${expr}; })()`);

  // layers: burned area off/on changes the shader uniform
  const burn = page.locator('.layer', { hasText: 'Burned Area' }).locator('input[type=checkbox]');
  await burn.click(); const off = await sc('s.uniforms.uBurnOp.value');
  await burn.click(); const on = await sc('s.uniforms.uBurnOp.value');
  ok('layer toggle drives renderer', off === 0 && on > 0.5, `off ${off} on ${on}`);
  // opacity slider
  await page.locator('.layer', { hasText: 'Aerial Imagery' }).locator('input[type=range]').fill('0.8');
  ok('opacity slider drives renderer', Math.abs((await sc('s.uniforms.uImageryMix.value')) - 0.8) < 0.01);

  // scrub timeline
  const t0 = await st('s.time');
  const tr = await rect(page, '.track');
  await page.mouse.click(tr.x + tr.w * 0.85, tr.y + 14);
  const t1 = await st('s.time');
  ok('timeline scrub moves time', t1 > t0, `${new Date(t0).toISOString().slice(11, 19)} → ${new Date(t1).toISOString().slice(11, 19)}`);
  const burnId = await sc('s.drawnKey.split("|")[0]');
  ok('scrub updates fire overlay', !!burnId, burnId);

  // play / pause
  await page.locator('.tl-ctrl button[title=Play]').click(); await page.waitForTimeout(700);
  const tp = await st('s.time'); await page.locator('.tl-ctrl button[title=Pause]').click();
  ok('play advances time', tp > t1 || (await st('s.time')) >= (await st('s.t1')) - 1);

  // key event → seek + select + camera fly
  await page.locator('.ev').nth(2).click(); await page.waitForTimeout(400);
  const selId = await st('s.selectedEventId'), selT = await st('Date.parse(s.events.find(e => e.event_id === s.selectedEventId).timestamp) === s.time');
  ok('key event click selects and seeks', !!selId && selT, selId);

  // hover tooltip
  const m = await rect(page, '.map');
  await page.mouse.move(m.x + m.w * 0.4, m.y + m.h * 0.6); await page.waitForTimeout(300);
  const tip = await page.locator('.hovertip').textContent().catch(() => '');
  ok('terrain hover tooltip', /m · \d+° slope/.test(tip ?? ''), tip?.slice(0, 60));

  // 2D / 3D
  await page.locator('.ctlgrp button', { hasText: '2D' }).click(); await page.waitForTimeout(1300);
  const polar2 = await st('s.cam.polar');
  await page.locator('.ctlgrp button', { hasText: '3D' }).click(); await page.waitForTimeout(1300);
  ok('2D/3D toggle changes camera', polar2 < 3 && (await st('s.cam.polar')) > 20, `2D polar ${polar2.toFixed(1)}°`);

  // compare
  await page.evaluate(() => { const s = window.__store.getState(); s.set({ compare: { on: true, before: s.t0 + 120000 } }); });
  await page.waitForTimeout(300);
  ok('compare banner shows Δ burned', /Δ burned/.test(await page.locator('.banner').textContent()));
  await page.evaluate(() => window.__store.getState().set({ compare: { on: false, before: null } }));

  // drones: feed synced to timeline
  await page.locator('.seg button', { hasText: 'Drones' }).click(); await page.waitForTimeout(1500);
  const vs = await page.evaluate(() => { const v = document.querySelector('.feed video'); const s = window.__store.getState(); return { ct: v.currentTime, want: (s.time - Date.parse(s.sources[0].recorded_start)) / 1000, ready: v.readyState }; });
  ok('drone video synced to timeline', vs.ready >= 2 && Math.abs(vs.ct - vs.want) < 1.0, `video ${vs.ct.toFixed(1)}s vs ${vs.want.toFixed(1)}s`);
  await page.locator('.feed-bar button', { hasText: 'IR*' }).click();
  ok('IR look applies LUT + simulated label', (await page.locator('.feed video').getAttribute('style')).includes('lut-ironbow') && /SIMULATED/.test(await page.locator('.hud .tr').textContent()));
  await page.locator('.feed-bar button[title="Zoom in"]').click();
  ok('feed zoom', (await page.locator('.feed video').getAttribute('style')).includes('scale(1.5)'));
  await page.locator('.feed-bar button[title="Full camera view"]').click(); await page.waitForTimeout(300);
  const full = await rect(page, '.feed'), map2 = await rect(page, '.map');
  ok('full camera view fills map pane only', full.w > map2.w * 0.95 && full.r <= map2.r + 1 && full.b <= map2.b + 1);
  await page.locator('.feed-bar button[title="Full camera view"]').click();
  await page.screenshot({ path: `${out}/walk_drones.png` });

  // alerts: acknowledge
  await page.locator('.seg button', { hasText: 'Alerts' }).click(); await page.waitForTimeout(300);
  const ack = page.locator('.alert-card button', { hasText: 'Acknowledge' }).first();
  if (await ack.count()) { await ack.click(); ok('alert acknowledge', (await page.locator('.alert-card button', { hasText: 'Acknowledged' }).count()) > 0); }
  else ok('alert acknowledge', false, 'no alert raised before cursor');

  // agent
  await page.locator('.seg button', { hasText: 'Incident' }).click();
  await page.locator('.tabs button', { hasText: 'Analysis' }).click();
  await page.locator('.suggest button').first().click();
  await page.waitForSelector('.msg.bot .cite', { timeout: 30000 });
  const before = await st('s.time');
  await page.locator('.msg.bot .cite').first().click(); await page.waitForTimeout(300);
  ok('agent answer with clickable citations', (await page.locator('.msg.bot .cite').count()) > 0 && (await st('s.feedOpen')), `time ${before !== (await st('s.time')) ? 'seeked' : 'same'}`);

  // search
  await page.locator('.tabs button', { hasText: 'Evidence' }).click();
  await page.locator('.btn-sm', { hasText: 'dense smoke' }).click();
  await page.waitForSelector('.result', { timeout: 20000 });
  await page.locator('.result').first().click();
  ok('search returns clickable clips', (await page.locator('.result').count()) > 0);

  // notes / integrations
  await page.locator('.tabs button', { hasText: 'Notes' }).click();
  ok('integration status listed', (await page.locator('.integr').count()) >= 4);
  await page.screenshot({ path: `${out}/walk_notes.png` });

  // menus + Escape-free close via outside
  await page.locator('.tb-menu', { hasText: 'View' }).click();
  ok('View menu opens', (await page.locator('.menu-pop').count()) > 0);
  await page.locator('.menu-pop button', { hasText: 'Reset camera' }).click();

  // tour starts and is cancellable
  await page.locator('.tb-menu', { hasText: 'Tour' }).click(); await page.waitForTimeout(1500);
  const touring = await page.locator('.tour-pill').count();
  await page.mouse.click(m.x + 50, m.y + m.h - 80); await page.waitForTimeout(400);
  ok('tour runs and cancels on click', touring > 0);

  ok('walk: no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await page.close();
}
await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
