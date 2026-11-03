// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

/**
 * What each map marker looks like and why. One spec per object, built from real fields only; the map draws it and the
 * legend draws the very same spec, so the legend can never drift from the map.
 *   shape  = what kind of object   (drop = incident, circle = vehicle, square = shelter, diamond = gauge)
 *   glyph  = what it is / needs    (lifebuoy = evacuation, cross = medical, ... boat, truck, pump, wrench, house, staff)
 *   colour = its state             (red = urgent/danger/broken, amber = waiting or warning, green = ready/safe, blue = busy)
 *   chip   = the number that matters (flood depth, water level)
 *   fill   = how full (shelters)
 * Pure data and strings, no DOM, so it runs under `node --test`.
 */

export type MarkerShape = 'drop' | 'circle' | 'square' | 'diamond';
export type GlyphName = 'lifebuoy' | 'medical' | 'supply' | 'pump' | 'blocked' | 'alert' | 'boat' | 'truck' | 'wrench' | 'house' | 'staff';

export interface MarkerSpec {
  shape: MarkerShape;
  glyph: GlyphName;
  /** CSS colour value (a design-token variable) */
  color: string;
  chip?: string;
  /** 0..100: shelter occupancy bar */
  fill?: number;
  pulse?: boolean;
  dim?: boolean;
}

export const COLOR = {
  crit: 'var(--color-crit)',
  warn: 'var(--color-warn)',
  watch: 'var(--color-watch)',
  safe: 'var(--color-safe)',
  river: 'var(--color-river)',
  mute: 'var(--color-ink-3)',
} as const;

/** 24x24 line pictograms (stroke = currentColor). */
export const GLYPH: Record<GlyphName, string> = {
  lifebuoy: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/><path d="M5.6 5.6l3.9 3.9M14.5 14.5l3.9 3.9M18.4 5.6l-3.9 3.9M9.5 14.5l-3.9 3.9"/>',
  medical: '<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/>',
  supply: '<path d="M3 8l9-5 9 5v8l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  pump: '<path d="M12 3v11M7.5 7.5L12 3l4.5 4.5"/><path d="M3 18c1.5-1.2 3-1.2 4.5 0s3 1.2 4.5 0 3-1.2 4.5 0 3 1.2 4.500 0"/>',
  blocked: '<circle cx="12" cy="12" r="9"/><path d="M6.5 12h11" stroke-width="3.2"/>',
  alert: '<path d="M12 3 2.5 20h19L12 3z"/><path d="M12 10v4M12 17.2v.1" stroke-width="2.4"/>',
  boat: '<path d="M3 17h18l-2 4H5l-2-4zM7 17V9h10v8M12 4v5"/>',
  truck: '<path d="M2 6h11v10H2zM13 9h5l3 3v4h-8z"/><circle cx="7" cy="18" r="1.8" fill="currentColor"/><circle cx="17" cy="18" r="1.8" fill="currentColor"/>',
  wrench: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.300a4 4 0 0 0 5.4-5.4l-2.600 2.600-2.400-.6-.6-2.400z"/>',
  house: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-5h4v5"/>',
  staff: '<path d="M8 3v18M8 6h4M8 10h3M8 14h4M8 18h3"/><path d="M13 13c1.200-1 2.400-1 3.600 0s2.400 1 3.400 0"/>',
};

const NEED_GLYPH: Record<string, GlyphName> = {
  EVACUATION: 'lifebuoy',
  MEDICAL: 'medical',
  FOOD_WATER: 'supply',
  PUMPING: 'pump',
  ROAD_BLOCKED: 'blocked',
};

export const needGlyph = (need: string | undefined): GlyphName => (need && NEED_GLYPH[need]) || 'alert';

export const vehicleGlyph = (type: string | undefined): GlyphName =>
  type === 'RESCUE_BOAT' ? 'boat' : type === 'MOBILE_PUMP' ? 'pump' : 'truck';

const CLOSED_REPORT = ['RESOLVED', 'REJECTED', 'CANCELLED'];

export interface ReportLike { need_type?: string; priority?: string; status: string; depth_cm?: number | null }
export function reportSpec(r: ReportLike): MarkerSpec {
  const closed = CLOSED_REPORT.includes(r.status);
  const urgent = (r.priority === 'URGENT' || r.priority === 'CRITICAL') && !closed;
  const color = closed ? COLOR.mute : urgent ? COLOR.crit : r.status === 'RECEIVED' ? COLOR.watch : COLOR.warn;
  return {
    shape: 'drop', glyph: needGlyph(r.need_type), color, pulse: urgent, dim: closed,
    chip: r.depth_cm == null ? undefined : String(Math.round(r.depth_cm)),
  };
}

export interface VehicleLike { vehicle_type?: string; status: string }
export function vehicleSpec(v: VehicleLike): MarkerSpec {
  if (v.status === 'BREAKDOWN') return { shape: 'circle', glyph: 'wrench', color: COLOR.crit, pulse: true };
  if (v.status === 'MAINTENANCE') return { shape: 'circle', glyph: 'wrench', color: COLOR.warn };
  const busy = v.status === 'MOVING' || v.status === 'WORKING';
  return { shape: 'circle', glyph: vehicleGlyph(v.vehicle_type), color: busy ? COLOR.river : COLOR.safe };
}

export interface ShelterLike { capacity: number; occupancy?: number; current_occupancy?: number; status?: string }
export function shelterSpec(s: ShelterLike): MarkerSpec {
  const occ = s.occupancy ?? s.current_occupancy ?? 0;
  const pct = s.capacity > 0 ? Math.min(100, Math.round((occ / s.capacity) * 100)) : 0;
  const color = s.status === 'CLOSED' ? COLOR.mute : s.status === 'FULL' || pct >= 100 ? COLOR.crit : pct >= 80 ? COLOR.warn : COLOR.safe;
  return { shape: 'square', glyph: 'house', color, fill: pct, dim: s.status === 'CLOSED' };
}

export interface GaugeLike { alert_state?: string; level_cm?: number | null }
export function gaugeSpec(g: GaugeLike): MarkerSpec {
  const color =
    g.alert_state === 'CRITICAL' ? COLOR.crit
    : g.alert_state === 'WARNING' ? COLOR.warn
    : g.alert_state === 'WATCH' ? COLOR.watch
    : g.level_cm == null ? COLOR.mute : COLOR.safe;
  return { shape: 'diamond', glyph: 'staff', color, chip: g.level_cm == null ? undefined : String(Math.round(g.level_cm)) };
}

/** Markup shared by the map marker and the legend swatch. `label` is shown on hover (escaped by the caller). */
export function markerInnerHtml(spec: MarkerSpec, labelHtml = ''): string {
  const svg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${GLYPH[spec.glyph]}</svg>`;
  const chip = spec.chip ? `<span class="fo-chip">${spec.chip}</span>` : '';
  const bar = spec.fill != null ? `<span class="fo-bar"><i style="width:${spec.fill}%"></i></span>` : '';
  const label = labelHtml ? `<span class="fo-pin-label">${labelHtml}</span>` : '';
  return `<span class="fo-body">${svg}</span>${chip}${bar}${label}`;
}

export function markerClassName(spec: MarkerSpec, extra = ''): string {
  return ['fo-pin', `fo-${spec.shape}`, spec.pulse ? 'is-pulse' : '', spec.dim ? 'is-dim' : '', extra].filter(Boolean).join(' ');
}
