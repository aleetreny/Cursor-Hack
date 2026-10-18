// FireScope 3D service worker: after one visit the demo opens without a connection (handy for presenting).
//  · hashed build assets (assets/*)         cache first (their names change when they change)
//  · terrain + imagery tiles                cache first, kept across versions
//  · page, config, incident data            network first, cache as fallback
//  · video (range requests)                 always network — never cached
//  · in-browser models and WebAssembly      left to the page (transformers.js keeps its own cache: no second copy)
const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const APP = `firescope-app-${VERSION}`, TILES = 'firescope-tiles-v1';
const TILE_HOSTS = ['s3.amazonaws.com', 'server.arcgisonline.com'];

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('firescope-app-') && k !== APP) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function cacheFirst(req, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
  return res;
}
async function networkFirst(req, name) {
  const cache = await caches.open(name);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('range') || /\.mp4($|\?)/.test(req.url)) return;
  const url = new URL(req.url);
  if (TILE_HOSTS.includes(url.hostname)) { e.respondWith(cacheFirst(req, TILES)); return; }
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('/models/') || url.pathname.endsWith('.wasm')) return;
  if (url.pathname.includes('/assets/')) { e.respondWith(cacheFirst(req, APP)); return; }
  e.respondWith(networkFirst(req, APP));
});

// The first visit is not controlled yet: the page sends what it already loaded so it is cached too.
self.addEventListener('message', (e) => {
  if (e.data?.type !== 'warm') return;
  e.waitUntil(Promise.all((e.data.urls || []).map(async (u) => {
    try {
      const url = new URL(u);
      if (/\.(mp4|wasm|onnx)($|\?)/.test(url.pathname) || url.pathname.includes('/models/')) return;
      const tile = TILE_HOSTS.includes(url.hostname);
      if (!tile && url.origin !== self.location.origin) return;
      const cache = await caches.open(tile || url.pathname.includes('/assets/') ? (tile ? TILES : APP) : APP);
      if (await cache.match(u)) return;
      const res = await fetch(u, { mode: 'cors', credentials: 'omit' });
      if (res.ok) await cache.put(u, res);
    } catch { /* best effort */ }
  })));
});
