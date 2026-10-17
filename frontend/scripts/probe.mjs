// Evaluate an expression in the running app (headless) and print the JSON result.
// Usage: node scripts/probe.mjs "<js expression using window.__scene / useStore>"
import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto(process.argv[3] ?? 'http://localhost:5173/');
await p.waitForFunction(() => window.__scene?.ready, null, { timeout: 60000 });
console.log(JSON.stringify(await p.evaluate(process.argv[2]), null, 0));
await b.close();
