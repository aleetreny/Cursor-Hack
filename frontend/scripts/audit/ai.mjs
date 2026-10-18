// In-browser AI checks (phase 7): visual search on both incidents, and the bytes it costs.
//   node scripts/audit/ai.mjs [base=http://localhost:4173/] [out=audit-ai]
// Opens the Evidence panel, turns visual search on, runs queries that should and should not match, and checks the
// match strength the UI reports. Screenshots of each result list go to <out>/.
import { chromium } from 'playwright';
import fs from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:4173/';
const out = process.argv[3] ?? 'audit-ai';
fs.mkdirSync(out, { recursive: true });
const CASES = {
  'pinhao-2019-03-01': [['dense smoke', 'strong'], ['humo denso', 'strong'], ['tall flames', 'strong'], ['burned ground', 'strong'], ['helicopter', 'none'], ['helicóptero', 'none'], ['a car', 'none']],
  'larouco-2025-08': [['smoke plume', 'strong'], ['columna de humo', 'strong'], ['burn scar', 'any'], ['clouds', 'strong'], ['embalse', 'any'], ['helicopter', 'none'], ['a person', 'none']],
};
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
let fails = 0;
for (const [id, cases] of Object.entries(CASES)) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const bytes = { model: 0, wasm: 0, index: 0 };
  page.on('response', async (r) => {
    const u = r.url();
    const len = +(r.headers()['content-length'] ?? 0);
    if (/\/models\//.test(u)) bytes.model += len;
    else if (/\.wasm/.test(u)) bytes.wasm += len;
    else if (/visual_(index|sprite)|\/s2\//.test(u)) bytes.index += len;
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}?incident=${id}&nointro&panel=evidence`);
  await page.waitForFunction(() => !document.querySelector('.loading:not(.done)'), null, { timeout: 60000 });
  const on = page.getByRole('button', { name: /Turn on/ });
  await on.waitFor({ timeout: 20000 });
  const t0 = Date.now();
  await on.click();
  await page.locator('.ai-on').waitFor({ timeout: 240000 });
  console.log(`${id}: visual search ready in ${((Date.now() - t0) / 1000).toFixed(1)} s · model ${(bytes.model / 1e6).toFixed(1)} MB · wasm ${(bytes.wasm / 1e6).toFixed(1)} MB (transfer)`);
  for (const [q, want] of cases) {
    const input = page.locator('.scroll .chat-in input');
    await input.fill(q);
    await input.press('Enter');
    await page.locator('.vres').waitFor({ timeout: 30000 });
    await page.waitForTimeout(300);
    const head = await page.locator('.vres .vh small').innerText();
    const strength = head.startsWith('Clear') ? 'strong' : head.startsWith('Possible') ? 'weak' : 'none';
    const searched = await page.locator('.vres .vmsg').first().innerText().catch(() => '');
    const n = await page.locator('.vres .vhit').count();
    const ok = want === 'any' ? strength !== 'none' : strength === want;
    if (!ok) fails++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} “${q}” → ${strength} (want ${want}), ${n} images ${searched.startsWith('Searched as') ? '· ' + searched : ''}`);
    await page.locator('.vres').screenshot({ path: `${out}/${id}-${q.replace(/\W+/g, '_')}.png` });
  }
  // a satellite hit drapes the pass and outlines the place
  if (id.startsWith('larouco')) {
    await page.locator('.scroll .chat-in input').fill('smoke plume');
    await page.locator('.scroll .chat-in input').press('Enter');
    await page.locator('.vres .vhit').first().click();
    await page.waitForTimeout(3500);
    const pill = await page.locator('.banner .pill.sat').innerText().catch(() => '');
    console.log(`  click → ${pill ? 'ok   banner “' + pill + '”' : 'FAIL no Sentinel-2 banner'}`);
    if (!pill) fails++;
    await page.screenshot({ path: `${out}/${id}-hit.png` });
  }
  if (errors.length) { fails++; console.log('  page errors:', errors); }
  await page.close();
}
await browser.close();
console.log(fails ? `${fails} FAILED` : 'ALL AI CHECKS PASSED');
process.exit(fails ? 1 : 0);
