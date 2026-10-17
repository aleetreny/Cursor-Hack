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
  await page.locator('.tl-ctrl button[aria-label=Play]').click(); await page.waitForTimeout(700);
  const tp = await st('s.time'); await page.locator('.tl-ctrl button[aria-label=Pause]').click();
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
  await page.locator('.feed-bar button[aria-label="Full camera view"]').click(); await page.waitForTimeout(300);
  const full = await rect(page, '.feed'), map2 = await rect(page, '.map');
  ok('full camera view fills map pane only', full.w > map2.w * 0.95 && full.r <= map2.r + 1 && full.b <= map2.b + 1);
  await page.locator('.feed-bar button[aria-label="Full camera view"]').click();
  await page.screenshot({ path: `${out}/walk_drones.png` });

  // simulated drone: rendered camera view is non-empty
  await page.locator('.fleet-row', { hasText: 'FT-02' }).click(); await page.waitForTimeout(1200);
  const lit = await page.evaluate(() => { const c = document.querySelector('.feed canvas'); if (!c) return 0; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 400) if (d[i] + d[i + 1] + d[i + 2] > 60) n++; return n; });
  ok('sim drone camera renders the 3D twin', lit > 100, `${lit} lit samples`);
  ok('sim drone labelled SIMULATED', /SIMULATED VIEW/.test(await page.locator('.hud').textContent()));

  // resources: select tanker, chase moves the camera, drops logged, ride-along on an engine
  await page.locator('.seg button', { hasText: 'Resources' }).click(); await page.waitForTimeout(500);
  await page.evaluate(() => { const s = window.__store.getState(); s.setTime(s.t0 + 8 * 60000); });
  ok('resources lists 13 units', (await page.locator('.unit-row').count()) === 13);
  await page.locator('.unit-row', { hasText: 'T-910' }).click(); await page.waitForTimeout(400);
  await page.locator('.btn-seg', { hasText: 'Chase' }).click();
  const c0 = await page.evaluate(() => window.__scene.camera.position.toArray());
  await page.evaluate(() => window.__store.getState().set({ playing: true, speed: 4 })); await page.waitForTimeout(1500);
  const c1 = await page.evaluate(() => window.__scene.camera.position.toArray());
  await page.evaluate(() => window.__store.getState().set({ playing: false }));
  ok('chase camera follows aircraft', Math.hypot(c1[0] - c0[0], c1[2] - c0[2]) > 20, `moved ${Math.hypot(c1[0] - c0[0], c1[2] - c0[2]).toFixed(0)} m`);
  const logN = await page.locator('.events .ev').count();
  ok('air ops log has drops', logN > 0, `${logN} entries`);
  await page.locator('.events .ev').first().click();
  ok('log entry selects unit + seeks', !!(await st('s.selectedUnitId')));
  await page.locator('.unit-row', { hasText: 'E-45' }).click(); await page.waitForTimeout(300);
  await page.locator('.btn-seg', { hasText: 'Ride along' }).click(); await page.waitForTimeout(800);
  ok('ride along on ground unit', (await st('s.follow && s.follow.mode')) === 'ride');
  await page.screenshot({ path: `${out}/walk_resources.png` });

  // agent
  await page.locator('.seg button', { hasText: 'Incident' }).click();
  ok('mode switch clears follow', !(await st('s.follow')));
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

  // analyst: different questions get different, data-backed answers (EN + ES)
  await page.locator('.tabs button', { hasText: 'Analysis' }).click();
  const answers = [];
  for (const q of ['When did it grow fastest?', '¿Dónde estaba el dron?', 'What was the wind?', 'Is anyone in danger?']) {
    const n = await page.locator('.msg.bot').count();
    await page.locator('.chat-in input').fill(q); await page.keyboard.press('Enter');
    await page.waitForFunction((n) => document.querySelectorAll('.msg.bot').length > n && !document.querySelector('.msg.bot.muted'), n, { timeout: 10000 });
    answers.push(await page.locator('.msg.bot').last().innerText());
  }
  ok('analyst: 4 questions → 4 distinct answers', new Set(answers).size === 4, answers.map((a) => a.slice(0, 32)).join(' | '));
  ok('analyst answers in Spanish when asked in Spanish', /estacionario|sobre el suelo/.test(answers[1]));
  ok('analyst cites the fastest growth at 05:44', /05:44/.test(answers[0]) && /632/.test(answers[0]));

  // phase 2: menus dismiss, share encodes the view, deep links, restart at the end, real rate of spread
  await page.locator('.tb-menu', { hasText: 'View' }).click(); await page.keyboard.press('Escape');
  ok('menus close with Escape', (await page.locator('.menu-pop').count()) === 0);
  await page.locator('.speed').click(); await page.mouse.click(300, 400); await page.waitForTimeout(150);
  ok('speed menu closes on outside click', (await page.locator('.menu-pop').count()) === 0);
  await page.evaluate(() => { const s = window.__store.getState(); s.set({ mode: 'drones', feedOpen: true }); s.setTime(s.t0 + 300000); });
  await page.waitForTimeout(700);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.locator('.tb-menu', { hasText: 'Share' }).click(); await page.waitForTimeout(300);
  const link = await page.evaluate(() => navigator.clipboard.readText());
  ok('share copies a link with time, mode and camera', /[?&]t=300\b/.test(link) && /mode=drones/.test(link) && /cam=/.test(link), link.slice(-60));
  ok('share shows a confirmation', /copied/i.test(await page.locator('.toast').innerText().catch(() => '')));
  const p2 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await p2.goto(link); await p2.waitForFunction(() => window.__store?.getState().loaded && window.__store.getState().loadMsg === '', null, { timeout: 60000 }); await p2.waitForTimeout(400);
  ok('deep link restores mode and time', await p2.evaluate(() => { const s = window.__store.getState(); return s.mode === 'drones' && Math.abs(s.time - s.t0 - 300000) < 1500; }));
  await p2.close();
  await page.evaluate(() => { const s = window.__store.getState(); s.set({ mode: 'incident', feedOpen: false }); s.setTime(s.t1); });
  await page.locator('.tl-ctrl button[aria-label=Play]').click(); await page.waitForTimeout(300);
  ok('play at the end restarts from the start', await st('s.playing && s.time - s.t0 < 20000'));
  await page.evaluate(() => window.__store.getState().set({ playing: false }));
  ok('rate of spread chart is in metres per minute', /Rate of Spread\s*\(m\/min/.test(await page.locator('.charts').innerText()));
  ok('terrain profile chart present', /Terrain Profile/.test(await page.locator('.charts').innerText()));

  // about: how each part was produced, from the incident manifest
  await page.locator('.tabs button', { hasText: 'About' }).click();
  ok('about lists how each part was made', (await page.locator('.integr').count()) >= 6);
  await page.screenshot({ path: `${out}/walk_about.png` });

  // menus + Escape-free close via outside
  await page.locator('.tb-menu', { hasText: 'View' }).click();
  ok('View menu opens', (await page.locator('.menu-pop').count()) > 0);
  await page.locator('.menu-pop button', { hasText: 'Reset camera' }).click();

  // presentation mode: opens, pauses, steps, exits
  await page.locator('.tb-present').click(); await page.waitForTimeout(1200);
  const s0 = await page.evaluate(() => document.querySelector('.pz')?.getAttribute('data-step'));
  await page.waitForTimeout(4000);
  const stay = await page.evaluate(() => document.querySelector('.pz')?.getAttribute('data-step'));
  await page.keyboard.press('Space'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(1500);
  const s3 = await page.evaluate(() => document.querySelector('.pz')?.getAttribute('data-step'));
  const spot = await page.locator('.pz-spot').count();
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  ok('presentation mode: manual advance, spotlight, exit', s0 === 'title' && stay === 'title' && s3 === 'twin' && spot === 1 && (await page.locator('.pz').count()) === 0, `${s0} → ${s3}`);

  await page.evaluate(() => { window.__store.getState().set({ mode: 'incident', speed: 8, playing: true }); window.__scene.flyHome(); });
  const fps = await page.evaluate(() => new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else r(n / 3); }; requestAnimationFrame(f); }));
  await page.evaluate(() => window.__store.getState().set({ playing: false }));
  ok('render FPS during playback (1440x900)', fps >= 30, `${fps.toFixed(1)} fps`);
  ok('walk: no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await page.close();
}
await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
