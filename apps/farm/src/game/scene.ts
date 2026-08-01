// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenAgriOS Contributors

/**
 * Translates the Tier-1 tactical state into the farm scene. Pure functions (unit-tested): this is the only place
 * where "what the game shows" is decided, and everything it shows is derived from real data.
 */
import type { FieldView, MachineView } from './renderer.ts';
import type { Quest } from './quests.ts';
import { compressFar, layoutWorld, worldPoint, type World } from './world.ts';

export interface StateField {
  field_id: string;
  name?: string;
  crop: string;
  owner_user_id: string;
  readiness_status: string;
  harvest_progress_pct: number;
  area_ha: number;
  center_lat: number;
  center_lng: number;
  visibility?: string;
}

export interface StateMachine {
  machine_id: string;
  status: string;
  fuel_pct: number;
  current_lat: number;
  current_lng: number;
}

export interface StateAssignment {
  assignment_id: string;
  field_id: string;
  machine_id: string;
  status: string;
  replaces_assignment_id?: string;
}

const ACTIVE = new Set(['IN_PROGRESS', 'CONFIRMED']);
const pt = (p: { x: number; y: number }): [number, number] => [p.x, p.y];

export function visibleFields<T extends { visibility?: string }>(fields: T[]): T[] {
  return fields.filter((f) => f.visibility === undefined || f.visibility === 'FULL');
}

/** Hour of day (0..24) of a simulation timestamp such as "2026-11-20T09:15:00Z". */
export function simHour(simTime: string | undefined): number {
  const d = new Date(simTime ?? '');
  return Number.isNaN(d.getTime()) ? 10 : d.getUTCHours() + d.getUTCMinutes() / 60;
}

export type TimeMode = 'sim' | 'auto' | 'night';

/** Hour shown in the scene: the simulation clock, a cosmetic day/night loop, or fixed night. */
export function sceneHour(mode: TimeMode, simTime: string | undefined, elapsedSeconds: number): number {
  if (mode === 'night') return 22;
  if (mode === 'auto') return (8 + elapsedSeconds / 6) % 24; // one full day in 144 s (cosmetic)
  return simHour(simTime);
}

export function buildWorld(fields: StateField[], machines: StateMachine[]): World {
  const vis = visibleFields(fields);
  const world = layoutWorld(vis);
  // machines that roam outside the field area must stay inside the camera fit
  for (const m of machines) {
    if (!m.current_lat && !m.current_lng) continue;
    const p = compressFar(world, ...pt(worldPoint(world, m.current_lat, m.current_lng)));
    const b = world.bounds;
    b.minX = Math.min(b.minX, p.x - 160); b.maxX = Math.max(b.maxX, p.x + 160);
    b.minY = Math.min(b.minY, p.y - 160); b.maxY = Math.max(b.maxY, p.y + 160);
  }
  return world;
}

export function buildMachines(world: World, machines: StateMachine[], assignments: StateAssignment[]): MachineView[] {
  const out: MachineView[] = [];
  for (const m of machines) {
    if (!m.current_lat && !m.current_lng) continue;
    const p = compressFar(world, ...pt(worldPoint(world, m.current_lat, m.current_lng)));
    const mine = assignments.filter((a) => a.machine_id === m.machine_id && ACTIVE.has(a.status));
    const active = mine.find((a) => a.status === 'IN_PROGRESS') ?? mine[0];
    out.push({
      id: m.machine_id, x: p.x, y: p.y, status: m.status, fuel: m.fuel_pct,
      fieldId: active?.field_id,
      rescuing: !!active?.replaces_assignment_id && m.status !== 'BREAKDOWN',
    });
  }
  return out;
}

export function buildFields(fields: StateField[], quests: Quest[], userId: string): FieldView[] {
  const byField = new Map(quests.map((q) => [q.fieldId, q.state]));
  return visibleFields(fields).map((f) => ({
    id: f.field_id,
    label: f.field_id,
    crop: f.crop,
    readiness: f.readiness_status,
    progress: f.harvest_progress_pct,
    mine: f.owner_user_id === userId,
    quest: byField.get(f.field_id) ?? null,
  }));
}

/** Overall season progress (0..100) of the fields the user can see. */
export function seasonProgress(fields: StateField[]): number {
  const v = visibleFields(fields);
  if (v.length === 0) return 0;
  return Math.round((v.reduce((s, f) => s + Math.max(0, Math.min(100, f.harvest_progress_pct)), 0) / v.length) * 10) / 10;
}
