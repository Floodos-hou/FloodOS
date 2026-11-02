// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenAgriOS Contributors

/** Crop growth presentation derived from real field data. Pure functions, unit-tested. */

export type CropStage = 'GROWING' | 'RIPE' | 'HARVESTING' | 'HARVESTED';

export interface CropState {
  stage: CropStage;
  /** share of the field already harvested, 0..1 */
  harvested: number;
  /** the crop is ready but the harvest is blocked by an incident */
  blocked: boolean;
}

export function cropState(readiness: string, progressPct: number): CropState {
  const p = Math.max(0, Math.min(100, Number.isFinite(progressPct) ? progressPct : 0)) / 100;
  switch (readiness) {
    case 'COMPLETED':
      return { stage: 'HARVESTED', harvested: 1, blocked: false };
    case 'HARVESTING':
      return p >= 1 ? { stage: 'HARVESTED', harvested: 1, blocked: false } : { stage: 'HARVESTING', harvested: p, blocked: false };
    case 'IMPACTED':
      return { stage: p > 0 ? 'HARVESTING' : 'RIPE', harvested: p, blocked: true };
    case 'READY_HARVEST':
    case 'SCHEDULED':
      return { stage: 'RIPE', harvested: 0, blocked: false };
    default:
      return { stage: 'GROWING', harvested: 0, blocked: false };
  }
}

/** Exponential smoothing towards a target (frame-rate independent); snaps when very close. */
export function approach(current: number, target: number, dt: number, rate = 2.5): number {
  const k = 1 - Math.exp(-rate * Math.max(0, dt));
  const next = current + (target - current) * k;
  return Math.abs(target - next) < 0.0005 ? target : next;
}

export const READINESS_LABEL: Record<string, string> = {
  GROWING: 'Lúa đang lớn',
  READY_HARVEST: 'Lúa chín, sẵn sàng gặt',
  SCHEDULED: 'Đã xếp lịch gặt',
  HARVESTING: 'Đang thu hoạch',
  IMPACTED: 'Bị ảnh hưởng bởi sự cố',
  COMPLETED: 'Đã gặt xong',
};

export function readinessLabel(readiness: string): string {
  return READINESS_LABEL[readiness] ?? readiness;
}

/** Deterministic pseudo random in [0,1) from an integer seed (stable decorations between frames and reloads). */
export function hash01(seed: number): number {
  let x = (seed | 0) + 0x6d2b79f5;
  x = Math.imul(x ^ (x >>> 15), x | 1);
  x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
}

export function seedFromString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h | 0;
}

/** Light level in [0,1] (0 = deep night, 1 = full day) from an hour of day 0..24 (smooth dawn and dusk). */
export function daylight(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 7.5 && h <= 16.5) return 1;
  if (h > 16.5 && h < 19.5) return 1 - (h - 16.5) / 3;
  if (h >= 4.5 && h < 7.5) return (h - 4.5) / 3;
  return 0;
}

/** Colour multiplier applied over the world for the time of day: white at noon, warm at dusk/dawn, blue at night. */
export function skyTint(hour: number): [number, number, number] {
  const h = ((hour % 24) + 24) % 24;
  const lerp = (a: number[], b: number[], t: number): [number, number, number] => [
    Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t),
  ];
  const DAY = [255, 255, 255];
  const WARM = [255, 196, 150];
  const NIGHT = [58, 76, 138];
  if (h >= 7.5 && h <= 16.5) return [255, 255, 255];
  if (h > 16.5 && h <= 18.2) return lerp(DAY, WARM, (h - 16.5) / 1.7);
  if (h > 18.2 && h < 19.5) return lerp(WARM, NIGHT, (h - 18.2) / 1.3);
  if (h >= 4.5 && h < 6) return lerp(NIGHT, WARM, (h - 4.5) / 1.5);
  if (h >= 6 && h < 7.5) return lerp(WARM, DAY, (h - 6) / 1.5);
  return [58, 76, 138];
}
