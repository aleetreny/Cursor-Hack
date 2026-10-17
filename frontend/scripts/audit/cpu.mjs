import { chromium } from 'playwright';
const b = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await b.newContext({ viewport: { width: 1600, height: 900 } });
const p = await ctx.newPage(); const cdp = await ctx.newCDPSession(p);
await cdp.send('Performance.enable');
await p.goto('http://localhost:8000/?nointro');
await p.waitForFunction(() => window.__scene?.ready && window.__store?.getState().loaded, null, { timeout: 90000 });
await p.waitForTimeout(1500);
const m = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
for (const [label, setup] of [['idle', () => window.__store.getState().set({ playing: false })], ['playback 8x', () => window.__store.getState().set({ playing: true, speed: 8 })], ['drones+feed playback 1x', () => window.__store.getState().set({ mode: 'drones', feedOpen: true, playing: true, speed: 1 })], ['sim feed FT-02', () => window.__store.getState().set({ selectedUnitId: 'FT-02', playing: true, speed: 4 })]]) {
  await p.evaluate(setup); await p.waitForTimeout(800);
  const a = await m(); await p.waitForTimeout(4000); const z = await m();
  const per = (k) => ((z[k] - a[k]) / 4 * 1000).toFixed(0);
  console.log(label.padEnd(26), 'main-thread task ms/s', per('TaskDuration'), '· script ms/s', per('ScriptDuration'), '· layout ms/s', per('LayoutDuration'), '· style ms/s', per('RecalcStyleDuration'), '· layouts/s', ((z.LayoutCount - a.LayoutCount) / 4).toFixed(0));
}
await b.close();
