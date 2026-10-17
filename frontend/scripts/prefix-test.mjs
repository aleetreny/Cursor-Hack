// Emulates the workshop Ingress (/app → /) in front of a FireScope container on :8090 and screenshots the app.
import { chromium } from 'playwright';
const out = process.argv[2] ?? 'prefix.png';
const b = await chromium.launch({ channel: process.env.CHANNEL || undefined, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const reqs = [];
await p.route('http://firescope.test/**', async (route) => {
  const u = new URL(route.request().url());
  if (!u.pathname.startsWith('/app')) { reqs.push('OUTSIDE PREFIX ' + u.pathname); return route.fulfill({ status: 404, body: 'outside /app' }); }
  const target = 'http://localhost:8090' + (u.pathname.slice(4) || '/') + u.search;
  reqs.push(u.pathname);
  const resp = await route.fetch({ url: target });
  return route.fulfill({ response: resp });
});
p.on('pageerror', (e) => reqs.push('pageerror ' + e.message));
await p.goto('http://firescope.test/app');
await p.waitForFunction(() => window.__scene?.ready, null, { timeout: 60000 });
await p.waitForTimeout(5000);
await p.screenshot({ path: out });
console.log(p.url(), '\n', [...new Set(reqs)].filter((r) => r.includes('OUTSIDE') || r.includes('error') || r.includes('/api/')).slice(0, 12).join('\n'));
await b.close();
