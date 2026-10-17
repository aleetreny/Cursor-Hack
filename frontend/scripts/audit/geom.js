// Injected into the page: window.__geom() → overlap / clipping / off-screen report for the current DOM.
window.__geom = function () {
  const vw = innerWidth, vh = innerHeight;
  const eff = (el) => { let o = 1; for (let e = el; e && e.nodeType === 1; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden') return 0; o *= +cs.opacity; } return o; };
  const desc = (el) => {
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    const t = (el.innerText ?? el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
    return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}${t ? ` "${t}"` : ''}`;
  };
  // region an element belongs to (for grouping)
  const region = (el) => { const r = el.closest('.topbar, .right, .bottom, .feed, .mapctl, .banner, .compass, .attribution, .hovertip, .pz-cap, .pz-bar, .pz, .menu-pop, .scene-label, .loading, .map'); return r ? (typeof r.className === 'string' ? r.className.split(' ')[0] : r.tagName) : 'body'; };
  // 1) text boxes
  const boxes = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.textContent.trim()) continue;
    const el = n.parentElement; if (!el) continue;
    const op = eff(el); if (op < 0.15) continue;
    const rg = document.createRange(); rg.selectNodeContents(n);
    for (const r of rg.getClientRects()) {
      if (r.width < 2 || r.height < 2) continue;
      // clip by every overflow-hidden ancestor (visible part only)
      let x0 = r.left, y0 = r.top, x1 = r.right, y1 = r.bottom;
      for (let a = el; a && a !== document.body; a = a.parentElement) { const cs = getComputedStyle(a); if (cs.overflow !== 'visible' || cs.overflowX !== 'visible' || cs.overflowY !== 'visible') { const ar = a.getBoundingClientRect(); x0 = Math.max(x0, ar.left); y0 = Math.max(y0, ar.top); x1 = Math.min(x1, ar.right); y1 = Math.min(y1, ar.bottom); } }
      if (x1 - x0 < 2 || y1 - y0 < 2) continue;
      boxes.push({ el, x0, y0, x1, y1, z: zOf(el) });
    }
  }
  function zOf(el) { let z = 0; for (let e = el; e && e.nodeType === 1; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.position !== 'static' && cs.zIndex !== 'auto') { z = +cs.zIndex; break; } } return z; }
  // Overlays that cover the app by design (dropdowns, tooltip, toasts, presentation slides/cards): text under them is
  // occluded, not overlapping, and they are not reported as covering anything.
  const DESIGNED = '.menu-pop, .hovertip, .toast, .pz-slide, .pz-caption, .pz-bar, .feed.full, .loading:not(.done)';
  const covers0 = [...document.querySelectorAll(DESIGNED)].filter((e) => eff(e) > 0.15).map((e) => ({ e, r: e.getBoundingClientRect() }));
  const occluded = (b) => covers0.some((o) => !o.e.contains(b.el) && (b.x0 + b.x1) / 2 > o.r.left && (b.x0 + b.x1) / 2 < o.r.right && (b.y0 + b.y1) / 2 > o.r.top && (b.y0 + b.y1) / 2 < o.r.bottom);
  const vis = boxes.filter((b) => !occluded(b));
  const textOverlaps = [];
  for (let i = 0; i < vis.length; i++) for (let j = i + 1; j < vis.length; j++) {
    const a = vis[i], b = vis[j];
    if (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el)) continue;
    const ix = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), iy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
    if (ix > 2 && iy > 2) textOverlaps.push({ a: desc(a.el), ra: region(a.el), b: desc(b.el), rb: region(b.el), px: Math.round(ix * iy), at: [Math.round(Math.max(a.x0, b.x0)), Math.round(Math.max(a.y0, b.y0))] });
  }
  // 2) overlay boxes vs text underneath: floating overlays covering text of other regions
  const overlays = [...document.querySelectorAll('.feed:not(.full), .mapctl .ctlgrp, .mapctl .scalebar, .compass, .banner .pill, .scene-label > *, .attribution, .legend')].filter((e) => eff(e) > 0.15 && !e.closest(DESIGNED)).map((e) => ({ e, r: e.getBoundingClientRect() })).filter((o) => o.r.width > 2 && o.r.height > 2 && !covers0.some((c) => !c.e.contains(o.e) && (o.r.left + o.r.right) / 2 > c.r.left && (o.r.left + o.r.right) / 2 < c.r.right && (o.r.top + o.r.bottom) / 2 > c.r.top && (o.r.top + o.r.bottom) / 2 < c.r.bottom));
  const covers = [];
  for (const o of overlays) for (const b of vis) {
    if (o.e.contains(b.el) || b.el.closest(DESIGNED)) continue;   // tooltips/menus sit above everything by design
    if (b.el.closest('.scene-label') && o.e.closest('.scene-label')) { /* label vs label handled by text overlap */ }
    const ix = Math.min(o.r.right, b.x1) - Math.max(o.r.left, b.x0), iy = Math.min(o.r.bottom, b.y1) - Math.max(o.r.top, b.y0);
    if (ix > 3 && iy > 3) {
      // only report when the overlay paints above the text
      const top = document.elementFromPoint(Math.max(o.r.left, b.x0) + ix / 2, Math.max(o.r.top, b.y0) + iy / 2);
      if (top && o.e.contains(top) && !top.contains(b.el)) covers.push({ overlay: desc(o.e), covered: desc(b.el), region: region(b.el), px: Math.round(ix * iy) });
    }
  }
  // overlay vs overlay
  const ovPairs = [];
  for (let i = 0; i < overlays.length; i++) for (let j = i + 1; j < overlays.length; j++) {
    const a = overlays[i], b = overlays[j];
    if (a.e.contains(b.e) || b.e.contains(a.e)) continue;
    const ix = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left), iy = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
    if (ix > 3 && iy > 3) ovPairs.push({ a: desc(a.e), b: desc(b.e), px: Math.round(ix * iy) });
  }
  // 3) clipped / truncated text
  const clipped = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!el.childNodes.length || eff(el) < 0.15) continue;
    const hasText = [...el.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim());
    if (!hasText) continue;
    const cs = getComputedStyle(el);
    const hid = cs.overflowX !== 'visible' || cs.overflow !== 'visible';
    if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && hid) clipped.push({ el: desc(el), region: region(el), how: cs.textOverflow === 'ellipsis' ? 'ellipsis' : 'hard-clip', need: el.scrollWidth, have: el.clientWidth });
    else if (el.scrollHeight > el.clientHeight + 2 && el.clientHeight > 0 && (cs.overflowY === 'hidden' || cs.overflow === 'hidden') && cs.webkitLineClamp === 'none') clipped.push({ el: desc(el), region: region(el), how: 'vertical-clip', need: el.scrollHeight, have: el.clientHeight });
  }
  // 4) interactive elements outside the viewport or tiny / unlabeled
  const inter = [...document.querySelectorAll('button, input, select, textarea, a, [role=button]')].filter((e) => eff(e) > 0.15);
  const offscreen = [], tiny = [], unlabeled = [];
  for (const e of inter) {
    const r = e.getBoundingClientRect(); if (r.width < 1 || r.height < 1) continue;
    // ignore controls inside scroll containers that are simply scrolled out of view
    let inScroll = false; for (let a = e.parentElement; a; a = a.parentElement) { const cs = getComputedStyle(a); if (/(auto|scroll)/.test(cs.overflowY + cs.overflowX)) { inScroll = true; break; } }
    if (!inScroll && (r.right > vw + 1 || r.bottom > vh + 1 || r.left < -1 || r.top < -1)) offscreen.push(desc(e));
    if ((r.width < 22 || r.height < 18) && e.type !== 'checkbox' && e.type !== 'range') tiny.push(`${desc(e)} ${Math.round(r.width)}×${Math.round(r.height)}`);
    const name = (e.getAttribute('aria-label') || e.getAttribute('title') || e.innerText || e.value || e.placeholder || '').trim();
    if (!name && e.type !== 'checkbox' && e.type !== 'range') unlabeled.push(desc(e) + (e.closest('[class]') ? ' in ' + region(e) : ''));
    if ((e.type === 'checkbox' || e.type === 'range') && !e.getAttribute('aria-label') && !e.closest('label') && !e.id) unlabeled.push(`${e.type} ${desc(e.parentElement)}`);
  }
  const sw = document.documentElement.scrollWidth, sh = document.documentElement.scrollHeight;
  const dedupe = (arr, key) => { const m = new Map(); for (const x of arr) { const k = key(x); if (!m.has(k)) m.set(k, { ...x, n: 1 }); else m.get(k).n++; } return [...m.values()]; };
  return {
    vw, vh, pageScroll: { sw, sh, h: sw > vw + 1, v: sh > vh + 1 },
    textOverlaps: dedupe(textOverlaps, (o) => o.a + '|' + o.b).sort((a, b) => b.px - a.px).slice(0, 40),
    covers: dedupe(covers, (o) => o.overlay + '|' + o.covered).sort((a, b) => b.px - a.px).slice(0, 40),
    overlayPairs: dedupe(ovPairs, (o) => o.a + '|' + o.b).slice(0, 30),
    clipped: dedupe(clipped, (o) => o.el).slice(0, 40),
    offscreen: [...new Set(offscreen)].slice(0, 30), tiny: [...new Set(tiny)].slice(0, 40), unlabeled: [...new Set(unlabeled)].slice(0, 40),
  };
};
