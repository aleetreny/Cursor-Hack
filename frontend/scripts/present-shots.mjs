// Screenshots every chapter of presentation mode (QA). Usage: node scripts/present-shots.mjs outDir
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const out = process.argv[2] ?? 'present-out'; mkdirSync(out, { recursive: true });
const b = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await p.goto(process.argv[3] ?? 'http://localhost:5174/?nointro');
await p.waitForFunction(() => window.__scene?.ready && window.__store?.getState().loaded, null, { timeout: 90000 });
await p.waitForTimeout(1500);
await p.locator('.tb-present').click();
for (let k = 0; k < 14; k++) {
  await p.waitForTimeout(k === 0 ? 3500 : 4200);
  const id = await p.evaluate(() => document.querySelector('.pz')?.getAttribute('data-step'));
  await p.screenshot({ path: `${out}/${String(k).padStart(2, '0')}_${id}.png` });
  if (k === 1) { await p.keyboard.press('Space'); await p.waitForTimeout(300); const paused = await p.locator('.pz-name em').count(); console.log('pause works:', paused > 0); await p.keyboard.press('Space'); }
  await p.keyboard.press('ArrowRight');
}
await p.keyboard.press('Escape'); await p.waitForTimeout(500);
console.log('exited:', (await p.locator('.pz').count()) === 0, 'errors:', errs.slice(0, 3));
await b.close();
