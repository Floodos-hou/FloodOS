// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenAgriOS Contributors

/**
 * World layout of the farm game: real field/machine coordinates become game units. Positions keep their real
 * relative geometry (a machine driving to a field really travels that way) but the whole map is rescaled so that
 * neighbouring fields are always a comfortable, readable distance apart. Pure functions, unit-tested.
 */

export interface FieldInput {
  field_id: string;
  center_lat: number;
  center_lng: number;
  area_ha: number;
}

export interface WorldField {
  id: string;
  /** centre in world units */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface World {
  /** game units per real metre */
  scale: number;
  origin: { lat: number; lng: number };
  fields: WorldField[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

const METRES_PER_DEG = 111_320;
/** Minimum distance between neighbouring field centres, in world units. */
export const MIN_FIELD_GAP = 470;
const BOUNDS_MARGIN = 260;

export function toMetres(lat: number, lng: number, origin: { lat: number; lng: number }) {
  return {
    x: (lng - origin.lng) * METRES_PER_DEG * Math.cos((origin.lat * Math.PI) / 180),
    y: -(lat - origin.lat) * METRES_PER_DEG, // screen y grows southwards
  };
}

/** Visual size of a field from its real area (bigger fields look bigger, within readable limits). */
export function fieldSize(areaHa: number): { w: number; h: number } {
  const side = Math.min(300, Math.max(150, 110 + 55 * Math.sqrt(Math.max(areaHa, 0))));
  return { w: Math.round(side * 1.25), h: Math.round(side * 0.9) };
}

function minPairDistance(points: { x: number; y: number }[]): number {
  let best = Infinity;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      best = Math.min(best, Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y));
    }
  }
  return best;
}

function overlaps(a: WorldField, b: WorldField, margin: number): boolean {
  return Math.abs(a.x - b.x) < (a.w + b.w) / 2 + margin && Math.abs(a.y - b.y) < (a.h + b.h) / 2 + margin;
}

export function layoutWorld(fields: FieldInput[]): World {
  if (fields.length === 0) {
    return { scale: 1, origin: { lat: 0, lng: 0 }, fields: [], bounds: { minX: -600, minY: -400, maxX: 600, maxY: 400 } };
  }
  const origin = {
    lat: fields.reduce((s, f) => s + f.center_lat, 0) / fields.length,
    lng: fields.reduce((s, f) => s + f.center_lng, 0) / fields.length,
  };
  const metres = fields.map((f) => toMetres(f.center_lat, f.center_lng, origin));
  const dmin = fields.length > 1 ? minPairDistance(metres) : Infinity;
  const scale = Number.isFinite(dmin) && dmin > 0 ? Math.min(20, Math.max(0.02, MIN_FIELD_GAP / dmin)) : 1;

  const out: WorldField[] = fields.map((f, i) => ({ id: f.field_id, x: metres[i].x * scale, y: metres[i].y * scale, ...fieldSize(f.area_ha) }));

  // Relaxation: rectangles are wider than the centre gap in some layouts; push overlapping pairs apart.
  for (let iter = 0; iter < 80; iter++) {
    let moved = false;
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        if (!overlaps(out[i], out[j], 50)) continue;
        let dx = out[j].x - out[i].x;
        let dy = out[j].y - out[i].y;
        if (dx === 0 && dy === 0) {
          dx = 1;
        }
        const len = Math.hypot(dx, dy);
        out[i].x -= (dx / len) * 8;
        out[i].y -= (dy / len) * 8;
        out[j].x += (dx / len) * 8;
        out[j].y += (dy / len) * 8;
        moved = true;
      }
    }
    if (!moved) break;
  }

  const bounds = {
    minX: Math.min(...out.map((f) => f.x - f.w / 2)) - BOUNDS_MARGIN,
    maxX: Math.max(...out.map((f) => f.x + f.w / 2)) + BOUNDS_MARGIN,
    minY: Math.min(...out.map((f) => f.y - f.h / 2)) - BOUNDS_MARGIN,
    maxY: Math.max(...out.map((f) => f.y + f.h / 2)) + BOUNDS_MARGIN,
  };
  return { scale, origin, fields: out, bounds };
}

/** World position of a real coordinate (same projection and scale as the fields). */
export function worldPoint(world: World, lat: number, lng: number): { x: number; y: number } {
  const m = toMetres(lat, lng, world.origin);
  return { x: m.x * world.scale, y: m.y * world.scale };
}

/** Compass heading in degrees (0 = up/north, clockwise) of a world-space movement vector. */
export function headingFromDelta(dx: number, dy: number): number {
  return ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
}

export interface Padding { top: number; right: number; bottom: number; left: number }

/**
 * Camera that shows the whole world inside the part of the viewport not covered by the HUD: the world is fitted
 * to the free rectangle and centred in it.
 */
export function fitCamera(
  bounds: World['bounds'], viewW: number, viewH: number, pad: Padding = { top: 0, right: 0, bottom: 0, left: 0 }
): { x: number; y: number; zoom: number } {
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;
  const freeW = Math.max(120, viewW - pad.left - pad.right);
  const freeH = Math.max(120, viewH - pad.top - pad.bottom);
  const zoom = Math.max(0.1, Math.min(freeW / w, freeH / h));
  // screen centre of the free rectangle relative to the viewport centre, converted to world units
  const shiftX = (pad.left - pad.right) / 2 / zoom;
  const shiftY = (pad.top - pad.bottom) / 2 / zoom;
  return { x: (bounds.minX + bounds.maxX) / 2 - shiftX, y: (bounds.minY + bounds.maxY) / 2 - shiftY, zoom };
}

/** A machine farther than this from every field is drawn with a compressed distance (world units). */
export const NEAR_RADIUS = 560;
const FAR_SOFTNESS = 260;

/**
 * Keeps a far-away machine in the picture: inside {@link NEAR_RADIUS} of the nearest field the position is exact,
 * beyond it the extra distance is compressed logarithmically. The direction is preserved and the mapping is
 * monotonic and continuous, so a machine still visibly closes in on its field as it drives there.
 */
export function compressFar(world: World, x: number, y: number): { x: number; y: number } {
  if (world.fields.length === 0) return { x, y };
  let best = world.fields[0];
  let bd = Infinity;
  for (const f of world.fields) {
    const d = Math.hypot(x - f.x, y - f.y);
    if (d < bd) { bd = d; best = f; }
  }
  if (bd <= NEAR_RADIUS) return { x, y };
  const d2 = NEAR_RADIUS + FAR_SOFTNESS * Math.log(1 + (bd - NEAR_RADIUS) / FAR_SOFTNESS);
  const k = d2 / bd;
  return { x: best.x + (x - best.x) * k, y: best.y + (y - best.y) * k };
}
