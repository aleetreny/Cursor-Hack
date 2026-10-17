// Headless screenshot helper for visual QA against the reference frames.
// Usage: node scripts/shot.mjs out.png [url] [js-to-run-after-load]
import { chromium } from 'playwright';

const [out = 'shot.png', url = 'http://localhost:5173/', script = ''] = process.argv.slice(2);
const browser = await chromium.launch({ channel: process.env.CHANNEL || undefined, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`${m.type()}: ${m.text().slice(0, 300)}`); });
page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
await page.goto(url);
await page.waitForFunction(() => window.__scene?.ready, null, { timeout: 60000 });
await page.waitForTimeout(1500);
if (script) { await page.evaluate(script); await page.waitForTimeout(1800); }
await page.screenshot({ path: out });
console.log(logs.slice(0, 12).join('\n') || 'no console errors');
await browser.close();
