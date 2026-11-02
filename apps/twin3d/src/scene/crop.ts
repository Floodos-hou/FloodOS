// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenAgriOS Contributors

/** Crop presentation derived from real field data. Pure functions (unit-tested). */

export type CropStage = 'GROWING' | 'RIPE' | 'HARVESTING' | 'HARVESTED';

export interface CropState {
  stage: CropStage;
  /** share of the field area already harvested, 0..1 */
  harvested: number;
  /** harvest is blocked by an incident */
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

/** Real rice stands about 0.9 m tall; after the combine passes about 15 cm of stubble remains. */
export const CROP_HEIGHT_M = 0.9;
export const STUBBLE_HEIGHT_M = 0.15;

export const READINESS_LABEL: Record<string, string> = {
  GROWING: 'Lúa đang lớn',
  READY_HARVEST: 'Lúa chín, sẵn sàng gặt',
  SCHEDULED: 'Đã xếp lịch gặt',
  HARVESTING: 'Đang thu hoạch',
  IMPACTED: 'Bị ảnh hưởng bởi sự cố',
  COMPLETED: 'Đã gặt xong',
};

export const readinessLabel = (r: string) => READINESS_LABEL[r] ?? r;

export const MACHINE_STATUS_LABEL: Record<string, string> = {
  WORKING: 'Đang gặt', IDLE: 'Sẵn sàng', BREAKDOWN: 'Bị hỏng', MAINTENANCE: 'Bảo trì', MOVING: 'Đang di chuyển',
};

/** Share of declared area that the drawn boundary really covers; flags seed/real data that disagree. */
export function areaConsistency(declaredHa: number, polygonM2: number): { ratio: number; ok: boolean } {
  const drawn = polygonM2 / 10_000;
  if (!(declaredHa > 0)) return { ratio: 0, ok: false };
  const ratio = drawn / declaredHa;
  return { ratio, ok: ratio > 0.85 && ratio < 1.15 };
}
