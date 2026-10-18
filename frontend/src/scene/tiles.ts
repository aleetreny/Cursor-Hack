import { latToTileY, lonToTileX } from './geo';

export const TERRARIUM = (z: number, x: number, y: number) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
export const ESRI_IMAGERY = (z: number, x: number, y: number) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((res) => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => res(im);
    im.onerror = () => res(null);
    im.src = url;
  });
}

export interface Mosaic {
  canvas: HTMLCanvasElement;
  z: number;
  x0: number; // first tile x
  y0: number;
  /** lon/lat -> pixel in the mosaic canvas */
  px: (lon: number, lat: number) => [number, number];
}

/** Fetch all tiles covering bbox into one canvas. */
export async function loadMosaic(bbox: [number, number, number, number], z: number, url: (z: number, x: number, y: number) => string, tileSize = 256): Promise<Mosaic> {
  const [w, s, e, n] = bbox;
  const x0 = Math.floor(lonToTileX(w, z)), x1 = Math.floor(lonToTileX(e, z));
  const y0 = Math.floor(latToTileY(n, z)), y1 = Math.floor(latToTileY(s, z));
  const canvas = document.createElement('canvas');
  canvas.width = (x1 - x0 + 1) * tileSize;
  canvas.height = (y1 - y0 + 1) * tileSize;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const jobs: Promise<void>[] = [];
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++)
      jobs.push(loadImage(url(z, x, y)).then((im) => { if (im) ctx.drawImage(im, (x - x0) * tileSize, (y - y0) * tileSize, tileSize, tileSize); }));
  await Promise.all(jobs);
  return { canvas, z, x0, y0, px: (lon, lat) => [(lonToTileX(lon, z) - x0) * tileSize, (latToTileY(lat, z) - y0) * tileSize] };
}

/** Decode a Terrarium mosaic to metres. */
export function decodeTerrarium(m: Mosaic) {
  const { width, height } = m.canvas;
  const d = m.canvas.getContext('2d')!.getImageData(0, 0, width, height).data;
  const h = new Float32Array(width * height);
  for (let i = 0; i < h.length; i++) h[i] = d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256 - 32768;
  const sample = (px: number, py: number) => {
    const x = Math.min(width - 1.001, Math.max(0, px - 0.5)), y = Math.min(height - 1.001, Math.max(0, py - 0.5));
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, i = yi * width + xi;
    return (h[i] * (1 - fx) + h[i + 1] * fx) * (1 - fy) + (h[i + width] * (1 - fx) + h[i + width + 1] * fx) * fy;
  };
  return { sample };
}

/** Crop a mosaic to a bbox-aligned canvas of the given size (lat treated linearly — fine for a few km). */
export function cropToBBox(m: Mosaic, bbox: [number, number, number, number], size: number): HTMLCanvasElement {
  const [w, s, e, n] = bbox;
  const [ax, ay] = m.px(w, n), [bx, by] = m.px(e, s);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  c.getContext('2d')!.drawImage(m.canvas, ax, ay, bx - ax, by - ay, 0, 0, size, size);
  return c;
}

/** A packaged image covering a lon/lat box (equirectangular, north up), wrapped as a Mosaic. */
export async function imageMosaic(url: string, bbox: [number, number, number, number]): Promise<Mosaic> {
  const im = await loadImage(url);
  if (!im) throw new Error('packaged map file missing: ' + url);
  const canvas = document.createElement('canvas');
  canvas.width = im.naturalWidth; canvas.height = im.naturalHeight;
  canvas.getContext('2d', { willReadFrequently: true })!.drawImage(im, 0, 0);
  const [w, s, e, n] = bbox, W = canvas.width, H = canvas.height;
  return { canvas, z: 0, x0: 0, y0: 0, px: (lon, lat) => [((lon - w) / (e - w)) * W, ((n - lat) / (n - s)) * H] };
}
