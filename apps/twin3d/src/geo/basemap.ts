// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

/**
 * Ground imagery of the twin. Online it is a mosaic of satellite tiles placed by Web-Mercator maths; when the tiles
 * cannot be fetched (offline venue, blocked network) it falls back to a procedural ground built from the same bounds,
 * so the twin always renders. The fallback is clearly labelled as NOT an image of the real area.
 */
import { chooseZoom, enu, geoOfEnu, tileRange, tileToLngLat, type Origin, type P } from './geo.ts';

export interface BasemapConfig {
  urlTemplate: string;
  maxZoom: number;
  attribution: string;
  maxTiles: number;
  timeoutMs: number;
}

export interface Bounds { minX: number; maxX: number; minZ: number; maxZ: number }

export interface BasemapResult {
  canvas: HTMLCanvasElement;
  /** world-space corners of the canvas (north-west and south-east), in metres */
  nw: P;
  se: P;
  mode: 'satellite' | 'offline'; // 'satellite' = a real tile mosaic (map or imagery)
  attribution: string;
  loaded: number;
  total: number;
  zoom: number;
}

const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

/** Default: OpenStreetMap rendered by EOX (same tile host as the flat map), readable at field scale. Deployers may point it at a satellite source they are licensed to use, for example Sentinel-2 cloudless (about 10 m/pixel). */
export function defaultBasemapConfig(): BasemapConfig {
  return {
    urlTemplate: env.VITE_BASEMAP_URL ?? 'https://tiles.maps.eox.at/wmts/1.0.0/osm_3857/default/g/{z}/{y}/{x}.jpg',
    maxZoom: Number(env.VITE_BASEMAP_MAXZ ?? 17),
    attribution: env.VITE_BASEMAP_ATTRIBUTION ?? '© OpenStreetMap contributors, tiles © EOX IT Services GmbH',
    maxTiles: 25,
    timeoutMs: 9000,
  };
}

export function tileUrl(template: string, z: number, x: number, y: number): string {
  return template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
}

function loadTile(url: string, timeoutMs: number): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const timer = window.setTimeout(() => { img.src = ''; resolve(null); }, timeoutMs);
    img.onload = () => { window.clearTimeout(timer); resolve(img); };
    img.onerror = () => { window.clearTimeout(timer); resolve(null); };
    img.src = url;
  });
}

function hash01(seed: number): number {
  let x = (seed | 0) + 0x6d2b79f5;
  x = Math.imul(x ^ (x >>> 15), x | 1);
  x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
}

/** Procedural ground over the given bounds. Not imagery of the area: only a neutral, readable surface. */
export function proceduralGround(b: Bounds): BasemapResult {
  const w = b.maxX - b.minX; const d = b.maxZ - b.minZ;
  const px = 2048; const py = Math.max(256, Math.min(4096, Math.round((px * d) / w)));
  const canvas = document.createElement('canvas');
  canvas.width = px; canvas.height = py;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#6f8f55'; g.fillRect(0, 0, px, py);
  for (let i = 0; i < 260; i++) {
    const x = hash01(i * 3) * px; const y = hash01(i * 3 + 1) * py; const r = 40 + hash01(i * 3 + 2) * 220;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    const light = i % 2 === 0;
    gr.addColorStop(0, light ? 'rgba(150,185,110,0.30)' : 'rgba(70,100,60,0.26)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  g.strokeStyle = 'rgba(40,70,40,0.35)'; g.lineWidth = 1;
  for (let i = 0; i < 5200; i++) {
    const x = hash01(i * 5 + 11) * px; const y = hash01(i * 5 + 12) * py; const l = 3 + hash01(i * 5 + 13) * 6;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (hash01(i + 9) - 0.5) * 3, y - l); g.stroke();
  }
  return { canvas, nw: { x: b.minX, z: b.minZ }, se: { x: b.maxX, z: b.maxZ }, mode: 'offline', attribution: 'Nền ngoại tuyến tự dựng (không phải ảnh thật của khu vực)', loaded: 0, total: 0, zoom: 0 };
}

/** Fetches the satellite mosaic for the bounds; resolves to the procedural ground when too few tiles arrive. */
export async function loadBasemap(origin: Origin, b: Bounds, cfg: BasemapConfig): Promise<BasemapResult> {
  const sw = geoOfEnu(origin, b.minX, b.maxZ);
  const ne = geoOfEnu(origin, b.maxX, b.minZ);
  const z = chooseZoom(sw.lat, ne.lat, sw.lng, ne.lng, cfg.maxZoom, cfg.maxTiles);
  const r = tileRange(sw.lat, ne.lat, sw.lng, ne.lng, z);
  const cols = r.x1 - r.x0 + 1; const rows = r.y1 - r.y0 + 1;
  const canvas = document.createElement('canvas');
  canvas.width = cols * 256; canvas.height = rows * 256;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#5b7347'; g.fillRect(0, 0, canvas.width, canvas.height);

  const jobs: Promise<boolean>[] = [];
  for (let ty = r.y0; ty <= r.y1; ty++) {
    for (let tx = r.x0; tx <= r.x1; tx++) {
      jobs.push(loadTile(tileUrl(cfg.urlTemplate, z, tx, ty), cfg.timeoutMs).then((img) => {
        if (!img) return false;
        g.drawImage(img, (tx - r.x0) * 256, (ty - r.y0) * 256, 256, 256);
        return true;
      }));
    }
  }
  const ok = (await Promise.all(jobs)).filter(Boolean).length;
  const total = cols * rows;
  if (ok / total < 0.5) return proceduralGround(b);

  const nwG = tileToLngLat(r.x0, r.y0, z);
  const seG = tileToLngLat(r.x1 + 1, r.y1 + 1, z);
  return { canvas, nw: enu(origin, nwG.lat, nwG.lng), se: enu(origin, seG.lat, seG.lng), mode: 'satellite', attribution: cfg.attribution, loaded: ok, total, zoom: z };
}
