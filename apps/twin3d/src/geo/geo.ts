// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

/**
 * Geodesy for the true-scale 3D twin. Pure functions (unit-tested). The scene works in a local tangent plane in METRES:
 * +x = east, +y = up, +z = south (so north is -z and a three.js camera looking down -z looks north).
 */

export interface Origin { lat: number; lng: number }
export interface P { x: number; z: number }

const M_PER_DEG = 111_320;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export function enu(o: Origin, lat: number, lng: number): P {
  return { x: (lng - o.lng) * M_PER_DEG * Math.cos(rad(o.lat)), z: -(lat - o.lat) * M_PER_DEG };
}

export function geoOfEnu(o: Origin, x: number, z: number): { lat: number; lng: number } {
  return { lat: o.lat - z / M_PER_DEG, lng: o.lng + x / (M_PER_DEG * Math.cos(rad(o.lat))) };
}

/** GeoJSON ring ([lng, lat] pairs, usually closed) to local points; the closing duplicate is dropped. */
export function ringToLocal(o: Origin, ring: number[][]): P[] {
  const pts = ring.map(([lng, lat]) => enu(o, lat, lng));
  if (pts.length > 1) {
    const a = pts[0]; const b = pts[pts.length - 1];
    if (Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.z - b.z) < 1e-9) pts.pop();
  }
  return pts;
}

export function polygonArea(pts: P[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]; const b = pts[(i + 1) % pts.length];
    s += a.x * b.z - b.x * a.z;
  }
  return Math.abs(s) / 2;
}

export function centroid(pts: P[]): P {
  if (pts.length === 0) return { x: 0, z: 0 };
  let a = 0; let cx = 0; let cz = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]; const q = pts[(i + 1) % pts.length];
    const f = p.x * q.z - q.x * p.z;
    a += f; cx += (p.x + q.x) * f; cz += (p.z + q.z) * f;
  }
  if (Math.abs(a) < 1e-9) {
    return { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, z: pts.reduce((s, p) => s + p.z, 0) / pts.length };
  }
  return { x: cx / (3 * a), z: cz / (3 * a) };
}

/** Sutherland-Hodgman: the part of the polygon with nx*x + nz*z <= d. */
export function clipHalfPlane(pts: P[], nx: number, nz: number, d: number): P[] {
  const out: P[] = [];
  const inside = (p: P) => nx * p.x + nz * p.z <= d + 1e-12;
  for (let i = 0; i < pts.length; i++) {
    const cur = pts[i]; const nxt = pts[(i + 1) % pts.length];
    const ci = inside(cur); const ni = inside(nxt);
    if (ci) out.push(cur);
    if (ci !== ni) {
      const dc = nx * cur.x + nz * cur.z - d;
      const dn = nx * nxt.x + nz * nxt.z - d;
      const t = dc / (dc - dn);
      out.push({ x: cur.x + (nxt.x - cur.x) * t, z: cur.z + (nxt.z - cur.z) * t });
    }
  }
  return out;
}

/** Unit vector along the longest edge: machines cut along the long side of a field. */
export function longEdgeAxis(pts: P[]): P {
  let best = { x: 1, z: 0 }; let bl = -1;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]; const b = pts[(i + 1) % pts.length];
    const l = Math.hypot(b.x - a.x, b.z - a.z);
    if (l > bl) { bl = l; best = { x: (b.x - a.x) / l, z: (b.z - a.z) / l }; }
  }
  return best;
}

/**
 * Splits a polygon by a line perpendicular to `axis` so that the "low" side has the requested share of the area
 * (binary search on the offset). Used to show the harvested share of a real field boundary.
 */
export function splitByFraction(pts: P[], fraction: number, axis: P): { low: P[]; high: P[]; threshold: number } {
  const f = Math.max(0, Math.min(1, fraction));
  const total = polygonArea(pts);
  const proj = pts.map((p) => axis.x * p.x + axis.z * p.z);
  let lo = Math.min(...proj); let hi = Math.max(...proj);
  if (f <= 0) return { low: [], high: pts, threshold: lo };
  if (f >= 1) return { low: pts, high: [], threshold: hi };
  const start = lo;
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2;
    const a = polygonArea(clipHalfPlane(pts, axis.x, axis.z, mid));
    if (a < f * total) lo = mid; else hi = mid;
  }
  const t = (lo + hi) / 2;
  void start;
  return { low: clipHalfPlane(pts, axis.x, axis.z, t), high: clipHalfPlane(pts, -axis.x, -axis.z, -t), threshold: t };
}

/** Compass bearing (0 = north, 90 = east, clockwise) of a movement given in local metres (+x east, +z south). */
export function bearingDeg(dx: number, dz: number): number {
  return (deg(Math.atan2(dx, -dz)) + 360) % 360;
}

/** three.js rotation.y for a model that faces -z (north) to face the given compass bearing. */
export function yawForBearing(bearing: number): number {
  return -rad(bearing);
}

/** Shortest-path interpolation between two angles in degrees. */
export function lerpAngle(a: number, b: number, t: number): number {
  const d = ((b - a + 540) % 360) - 180;
  return (a + d * t + 360) % 360;
}

// ------------------------------------------------------------------ web-mercator tiles
export function lngLatToTile(lng: number, lat: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const x = ((lng + 180) / 360) * n;
  const y = ((1 - Math.log(Math.tan(rad(lat)) + 1 / Math.cos(rad(lat))) / Math.PI) / 2) * n;
  return { x, y };
}

export function tileToLngLat(x: number, y: number, z: number): { lng: number; lat: number } {
  const n = 2 ** z;
  const lng = (x / n) * 360 - 180;
  const lat = deg(Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))));
  return { lng, lat };
}

export function metersPerPixel(lat: number, z: number): number {
  return (156_543.03392 * Math.cos(rad(lat))) / 2 ** z;
}

export interface TileRange { z: number; x0: number; x1: number; y0: number; y1: number }

/** Smallest tile block covering the box; `count` is the number of tiles. */
export function tileRange(minLat: number, maxLat: number, minLng: number, maxLng: number, z: number): TileRange {
  const a = lngLatToTile(minLng, maxLat, z);
  const b = lngLatToTile(maxLng, minLat, z);
  return { z, x0: Math.floor(a.x), x1: Math.floor(b.x), y0: Math.floor(a.y), y1: Math.floor(b.y) };
}

export const tileCount = (r: TileRange) => (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1);

/** Highest zoom (<= maxZoom) whose covering block needs at most maxTiles tiles. */
export function chooseZoom(minLat: number, maxLat: number, minLng: number, maxLng: number, maxZoom: number, maxTiles: number): number {
  for (let z = maxZoom; z >= 1; z--) {
    if (tileCount(tileRange(minLat, maxLat, minLng, maxLng, z)) <= maxTiles) return z;
  }
  return 1;
}

// ------------------------------------------------------------------ sun
/** Simple solar model (cosmetic lighting, not an ephemeris): sunrise 06:00, noon elevation 78 deg, sunset 18:00. */
export function sunPosition(hour: number): { azimuthDeg: number; elevationDeg: number } {
  const h = ((hour % 24) + 24) % 24;
  const t = (h - 6) / 12; // 0 at sunrise, 1 at sunset
  const elevationDeg = 78 * Math.sin(Math.PI * t);
  const azimuthDeg = 90 + 180 * t; // east at sunrise, south at noon, west at sunset
  return { azimuthDeg: azimuthDeg % 360, elevationDeg: t >= 0 && t <= 1 ? elevationDeg : -Math.abs(elevationDeg) * 0.4 };
}

/** Unit vector pointing TOWARDS the sun in scene coordinates (+x east, +y up, +z south). */
export function sunVector(azimuthDeg: number, elevationDeg: number): { x: number; y: number; z: number } {
  const az = rad(azimuthDeg); const el = rad(elevationDeg);
  const horiz = Math.cos(el);
  return { x: Math.sin(az) * horiz, y: Math.sin(el), z: -Math.cos(az) * horiz };
}
