// Records the ~65 s FireScope 3D promo by driving the real app in Chrome (1920×1080).
// Usage: node scripts/record-demo.mjs <outDir> [url]   → <outDir>/raw.webm + <outDir>/marks.json
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, readdirSync, renameSync } from 'node:fs';
// HQ=1 → no Playwright video; CDP screencast of JPEG frames at DPR 2 (3840×2160) with wall-clock timestamps.
const HQ = process.env.HQ === '1';
// RES=1440 → native 2560×1440 render with the 1920-wide layout (CSS zoom + matching WebGL pixel ratio)
const RES = +(process.env.RES ?? 1080);
const ZOOM = RES / 1080;
const DPR = HQ && RES === 1080 ? 2 : 1;

const out = process.argv[2] ?? 'demo-out';
const url = process.argv[3] ?? 'http://localhost:5174/?nointro';
mkdirSync(out, { recursive: true });
const W = 1920, H = 1080;
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext(HQ ? { viewport: { width: Math.round(W * ZOOM), height: Math.round(H * ZOOM) }, deviceScaleFactor: DPR } : { viewport: { width: W, height: H }, deviceScaleFactor: 1, recordVideo: { dir: out, size: { width: W, height: H } } });
const tPage = Date.now();
const page = await ctx.newPage();
if (ZOOM !== 1) await page.addInitScript((z) => { document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.zoom = String(z); }); }, ZOOM);
await page.goto(url);
await page.waitForFunction(() => window.__scene?.ready && window.__store?.getState().loaded, null, { timeout: 90000 });
if (ZOOM !== 1) await page.evaluate((z) => { window.__scene.renderer.setPixelRatio(z); window.dispatchEvent(new Event('resize')); }, ZOOM);
await page.waitForTimeout(2500);

const frames = [];
let cdp = null, pending = Promise.resolve();
if (HQ) {
  mkdirSync(`${out}/frames`, { recursive: true });
  cdp = await ctx.newCDPSession(page);
  cdp.on('Page.screencastFrame', (f) => {
    const i = frames.length, ts = f.metadata.timestamp;
    frames.push(ts);
    pending = pending.then(() => writeFileSync(`${out}/frames/${String(i).padStart(6, '0')}.jpg`, Buffer.from(f.data, 'base64')));
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
}

// ---------- overlay layer (lower-thirds, fades, end card) ----------
await page.addStyleTag({ content: `
  #promo { position: fixed; inset: 0; pointer-events: none; z-index: 9999; font-family: 'Inter Variable', Inter, sans-serif; }
  #promo .fade { position: absolute; inset: 0; background: #0d0b0a; opacity: 1; transition: opacity .9s ease; }
  #promo .lt { position: absolute; left: 44px; bottom: 300px; opacity: 0; transform: translateY(14px); transition: all .6s cubic-bezier(.2,.8,.2,1); }
  #promo .lt.on { opacity: 1; transform: none; }
  #promo .lt .k { font-size: 13px; font-weight: 750; letter-spacing: .18em; color: #ffb07a; text-transform: uppercase; text-shadow: 0 1px 6px rgba(0,0,0,.6); }
  #promo .lt .t { margin-top: 6px; font-size: 38px; font-weight: 750; letter-spacing: -.02em; color: #fff; text-shadow: 0 2px 18px rgba(0,0,0,.65); max-width: 1200px; white-space: nowrap; line-height: 1.08; }
  #promo .mk { position: absolute; right: 0; bottom: 0; width: 8px; height: 8px; background: #000; }
  #promo .lt .bar { width: 64px; height: 4px; border-radius: 2px; background: linear-gradient(90deg, #d2402a, #f2b33d); margin-top: 14px; }
  #promo .end { position: absolute; inset: 0; display: grid; place-items: center; background: radial-gradient(1200px 700px at 50% 45%, rgba(40,22,14,.86), rgba(10,8,7,.97)); opacity: 0; transition: opacity 1s ease; }
  #promo .end.on { opacity: 1; }
  #promo .end .logo { display: flex; align-items: center; gap: 18px; font-size: 76px; font-weight: 800; letter-spacing: -.03em; color: #fff; }
  #promo .end .tagl { margin-top: 18px; font-size: 26px; color: #f1d9c7; text-align: center; letter-spacing: -.01em; }
  #promo .end .sp { margin-top: 42px; font-size: 15px; color: #b9a99c; text-align: center; letter-spacing: .08em; text-transform: uppercase; }
  #promo .end .note { margin-top: 14px; font-size: 12.5px; color: #8d8075; text-align: center; }
  #promo .vig { position: absolute; inset: 0; background: radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,.35)); opacity: 0; transition: opacity .8s; }
  #promo .vig.on { opacity: 1; }
`});
await page.evaluate(() => {
  const d = document.createElement('div'); d.id = 'promo';
  d.innerHTML = `<div class="vig"></div><div class="mk"></div><div class="lt"><div class="k"></div><div class="t"></div><div class="bar"></div></div>
    <div class="end"><div style="text-align:center"><div class="logo"><svg width="78" height="48" viewBox="0 0 26 16"><path d="M1 15L9 4l4 5 3-4 9 10z" fill="#d2402a"/><path d="M9 4l4 5-2.5 6H1z" fill="#ea7a2c"/><path d="M16 5l9 10h-7.5L14 8z" fill="#f2b33d" opacity=".9"/></svg>FireScope 3D</div>
    <div class="tagl">Drone footage → time-aware 3D wildfire intelligence</div>
    <div class="sp">Built for NVIDIA Cosmos Reason &amp; Cosmos Embed · VAST / VSS · CoreWeave · W&amp;B · Cursor</div>
    <div class="note">Real footage: BurnedAreaUAV (CC-BY-4.0) · Real terrain: AWS Terrain Tiles · Large fire, fleet and resources shown are simulated</div></div></div>
    <div class="fade"></div>`;
  document.body.appendChild(d);
  window.__lt = (k, t) => { const l = d.querySelector('.lt'); if (!k) { l.classList.remove('on'); return; } l.classList.remove('on'); setTimeout(() => { l.querySelector('.k').textContent = k; l.querySelector('.t').textContent = t; l.classList.add('on'); }, 250); };
  window.__fade = (on) => { d.querySelector('.fade').style.opacity = on ? '1' : '0'; };
  window.__end = (on) => d.querySelector('.end').classList.toggle('on', on);
  window.__vig = (on) => d.querySelector('.vig').classList.toggle('on', on);
  window.__mk = (c) => { d.querySelector('.mk').style.background = c; };
});

const marks = {};
const T0 = Date.now();
const at = async (sec) => { const w = T0 + sec * 1000 - Date.now(); if (w > 0) await page.waitForTimeout(w); };
const MK = { start: '#ffffff', s1: '#ff0000', s2: '#00ff00', s3: '#0000ff', s4: '#ffff00', s5: '#ff00ff', endcard: '#00ffff', end: '#000000' };
const mark = async (k) => { marks[k] = HQ ? Date.now() / 1000 : (Date.now() - tPage) / 1000; if (MK[k] && !HQ) await page.evaluate((c) => window.__mk(c), MK[k]); };
const js = (f, a) => page.evaluate(f, a);
const S = () => 'window.__store.getState()';

if (HQ) { await page.evaluate(() => { document.querySelector('#promo .mk').style.display = 'none'; }); await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 93, everyNthFrame: 1, maxWidth: Math.round(W * ZOOM * DPR), maxHeight: Math.round(H * ZOOM * DPR) }); }

// ================= 0:00 THE PROBLEM — real footage, full camera view =================
await js(() => { const s = window.__store.getState(); s.set({ mode: 'drones', feedOpen: true, selectedUnitId: null, speed: 1 }); s.setTime(s.t0 + 222000); window.__scene.flyToDrone(); });
await page.waitForTimeout(700);
await page.locator('.feed-bar button[title="Full camera view"]').click({ timeout: 5000 });
await page.waitForTimeout(400);
await mark('start');
await js(() => { window.__store.getState().set({ playing: true }); window.__fade(false); window.__vig(true); });
await at(0.9); await mark('s1'); await js(() => window.__lt('The problem', 'Hours of drone footage. No map. No answers.'));
await at(7.6); await js(() => window.__lt(null));

// ================= 0:08 FIRESCOPE 3D — cinematic terrain + simulated large fire =================
await at(8.2);
await js(() => {
  const s = window.__store.getState();
  document.querySelector('.feed-bar button[title="Full camera view"]')?.click();
  s.set({ playing: false, feedOpen: false, mode: 'incident', panel: 'layers', speed: 48 });
  s.setLayer('projection', true);
  s.setTime(s.t0 + (s.t1 - s.t0) * 0.08);
  const sc = window.__scene, t = sc.focusPoint();
  sc.camera.position.set(t.x + 4300, t.y + 1900, t.z + 3300); sc.controls.target.set(t.x + 400, t.y, t.z - 700); sc.controls.update();
  sc.flyTo(new window.__THREE_V(t.x + 300, t.y, t.z - 500), undefined, 9000, new window.__THREE_V(2300, 1050, 2600));
});
await at(8.6); await mark('s2'); await js(() => { window.__store.getState().set({ playing: true }); window.__lt('FireScope 3D', 'A living 3D map of the fire — on real terrain'); });
await at(17.5);
await js(() => { const sc = window.__scene; sc.controls.autoRotate = true; sc.controls.autoRotateSpeed = 0.9; });
await at(22.4); await js(() => { window.__lt(null); });

// ================= 0:23 VIDEO UNDERSTANDING — real footage, evidence, agent =================
await at(23.0);
await js(() => {
  const s = window.__store.getState(), sc = window.__scene;
  sc.controls.autoRotate = false;
  s.set({ playing: false, speed: 8 });
  s.setLayer('projection', false);
  const e = s.events.find((x) => x.event_type === 'visible_fire_expansion' && x.severity === 'alert') ?? s.events[1];
  window.__selEv(e.event_id);
});
await mark('s3');
await js(() => window.__lt('Real footage, on the map', 'Every frame segmented and projected onto the ground'));
await at(28.3);
await js(() => { window.__store.getState().set({ mode: 'drones', feedOpen: true }); window.__lt('Evidence-linked alerts', 'One click to the exact second of video'); });
await at(32.2);
await js(() => { const s = window.__store.getState(); s.set({ mode: 'incident', panel: 'analysis', feedOpen: true }); });
await page.waitForTimeout(500);
await page.locator('.suggest button').first().click({ timeout: 2500 }).catch(() => {});
await js(() => window.__lt('Ask the video agent', 'Answers cite clips — built for NVIDIA Cosmos'));
await at(37.9); await js(() => window.__lt(null));

// ================= 0:38 DRONES & RESOURCES — simulated fleet + aircraft chase =================
await at(38.4);
await js(() => { const s = window.__store.getState(); s.set({ mode: 'drones', feedOpen: true, panel: 'layers' }); s.set({ selectedUnitId: 'FT-02', feedOpen: true }); });
await mark('s4');
await js(() => window.__lt('Simulated fleet', 'Six drones, live camera views from the 3D twin'));
await page.waitForTimeout(1600);
await page.locator('.feed-bar button', { hasText: 'IR*' }).click({ timeout: 2500 }).catch(() => {});
await at(44.0);
await js(() => {
  const s = window.__store.getState();
  s.set({ mode: 'resources', feedOpen: false, playing: false });
  s.setTime(s.t0 + 7.2 * 60000);
  s.set({ selectedUnitId: 'T-910' });
  setTimeout(() => window.__store.getState().set({ follow: { id: 'T-910', mode: 'chase' }, playing: true, speed: 3 }), 900);
  window.__lt('Response operations', 'Chase air tankers · drops · fire lines (simulated)');
});
await at(50.6); await js(() => window.__lt(null));

// ================= 0:51 IMPACT — whole interface, end card =================
await at(51.0);
await js(() => {
  const s = window.__store.getState(), sc = window.__scene;
  s.set({ follow: null, mode: 'incident', panel: 'layers', speed: 40, playing: true });
  s.setLayer('projection', true);
  s.setTime(s.t0 + (s.t1 - s.t0) * 0.45);
  const t = sc.focusPoint();
  sc.camera.position.set(t.x - 3600, t.y + 2100, t.z + 2600); sc.controls.target.set(t.x + 500, t.y, t.z - 800); sc.controls.update();
  sc.controls.autoRotate = true; sc.controls.autoRotateSpeed = -0.7;
});
await mark('s5');
await js(() => window.__lt('Impact', 'From raw footage to spatial intelligence'));
await at(57.2); await js(() => window.__lt(null));
await at(58.2); await js(() => window.__end(true)); await mark('endcard');
await at(65.5); await mark('end');
if (HQ) { await cdp.send('Page.stopScreencast'); await pending; writeFileSync(`${out}/frames.json`, JSON.stringify(frames)); }
await page.close();
await ctx.close();
await browser.close();
const vid = readdirSync(out).find((f) => f.endsWith('.webm') && f !== 'raw.webm');
if (vid) renameSync(`${out}/${vid}`, `${out}/raw.webm`);
writeFileSync(`${out}/marks.json`, JSON.stringify(marks, null, 1));
console.log(marks);
