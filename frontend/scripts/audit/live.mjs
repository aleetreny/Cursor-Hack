// Live analysis checks (phase 7): does the in-browser segmenter agree with the recorded pipeline, and how fast is it?
//   node scripts/audit/live.mjs [base=http://localhost:4173/] [out=audit-live]
// Needs the reference masks from the same ONNX model in Python, on the same frames (data/cache/pinhao/live_ref*.npy,
// written by `python -m pipeline.pinhao.live_ref`). Compares (a) with the published H.264 file the browser plays and
// (b) with the original recording the pipeline used. Also measures frames analysed per second while the video plays.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const base = process.argv[2] ?? 'http://localhost:4173/';
const out = process.argv[3] ?? 'audit-live';
fs.mkdirSync(out, { recursive: true });
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const ref = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/cache/pinhao/live_ref.json')));
const npy = (f) => { const b = fs.readFileSync(f); const hl = b.readUInt16LE(8); return new Uint8Array(b.buffer, b.byteOffset + 10 + hl); };
const refWeb = npy(path.join(ROOT, 'data/cache/pinhao/live_ref.npy')), refOrig = npy(path.join(ROOT, 'data/cache/pinhao/live_ref_original.npy'));
const N = 512 * 288;

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${base}?incident=pinhao-2019-03-01&nointro&mode=drones`);
await page.waitForFunction(() => !document.querySelector('.loading:not(.done)'), null, { timeout: 60000 });
await page.locator('.feed video').waitFor();
await page.getByRole('button', { name: 'Live AI' }).click();
await page.locator('.live-hud .m').waitFor({ timeout: 120000 }).catch(async (e) => { console.log('HUD:', await page.locator('.live-hud').innerText().catch(() => 'none'), errors); throw e; });
// fps while playing at 1×
await page.locator('button[aria-label="Play"]').first().click({ timeout: 5000 }).catch(() => {});
await page.waitForTimeout(8000);
console.log('played 8 s');
const hud = await page.locator('.live-hud').innerText();
await page.locator('.feed').screenshot({ path: `${out}/feed-live.png` });
console.log('screenshot');
await page.locator('button[aria-label="Pause"]').first().click({ timeout: 5000 }).catch(() => {});
console.log(`HUD while playing: ${hud.replace(/\n/g, ' ')}`);

// agreement with the reference masks, frame by frame
const iou = (a, b) => { let i = 0, u = 0; for (let k = 0; k < N; k++) { const x = a[k], y = b[k]; if (x && y) i++; if (x || y) u++; } return u ? i / u : 1; };
const rows = [];
for (let k = 0; k < ref.times.length; k++) {
  const prob = await page.evaluate(async (t) => {
    const v = document.querySelector('.feed video');
    v.pause();
    await Promise.race([new Promise((res) => { v.addEventListener('seeked', res, { once: true }); v.currentTime = t; }), new Promise((res) => setTimeout(res, 4000))]);
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    const f = await window.__live.analyze();
    let bits = '';
    for (let i = 0; i < f.prob.length; i++) bits += f.prob[i] > 0.5 ? '1' : '0';
    return bits;
  }, ref.times[k]);
  const m = Uint8Array.from(prob, (c) => (c === '1' ? 1 : 0));
  process.stdout.write('.');
  rows.push({ t: ref.times[k], web: iou(m, refWeb.subarray(k * N, (k + 1) * N)), orig: iou(m, refOrig.subarray(k * N, (k + 1) * N)) });
}
const mean = (k) => rows.reduce((s, r) => s + r[k], 0) / rows.length, min = (k) => Math.min(...rows.map((r) => r[k]));
const ep = await page.evaluate(() => window.__live.ep);
const res = { frames: rows.length, execution_provider: ep, iou_vs_python_same_file: { mean: +mean('web').toFixed(4), min: +min('web').toFixed(4) },
  iou_vs_recorded_pipeline: { mean: +mean('orig').toFixed(4), min: +min('orig').toFixed(4) }, hud_while_playing: hud.replace(/\n/g, ' ') };
fs.writeFileSync(`${out}/live.json`, JSON.stringify({ ...res, rows }, null, 1));
console.log(JSON.stringify(res, null, 1));
if (errors.length) console.log('page errors:', errors);
await browser.close();
const ok = res.iou_vs_recorded_pipeline.mean >= 0.9 && !errors.length;
console.log(ok ? 'LIVE CHECK PASSED (IoU ≥ 0.9 vs the recorded pipeline)' : 'LIVE CHECK FAILED');
process.exit(ok ? 0 : 1);
