// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

/**
 * Pure helpers behind the live map's visual feedback (heading, KPI strip, event ticker). No React or DOM imports,
 * so they are unit-tested with `node --test` (see apps/web/tests).
 */

export interface MachineLike {
  vehicle_id?: string;
  machine_id?: string;
  name?: string;
  status: string;
  fuel_pct?: number;
  current_lat: number;
  current_lng: number;
}

export interface ZoneLike {
  progress_pct?: number;
  visibility?: string;
}

export interface AssignmentLike {
  status: string;
}

/** Below this distance a position change is GPS noise, not movement (about 2 m). */
export const MIN_MOVE_METRES = 2;

const METRES_PER_DEG_LAT = 111_320;

export function metresBetween(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dy = (lat2 - lat1) * METRES_PER_DEG_LAT;
  const dx = (lng2 - lng1) * METRES_PER_DEG_LAT * Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180);
  return Math.hypot(dx, dy);
}

/** Compass bearing in degrees [0, 360): 0 = north, 90 = east, clockwise. */
export function bearingDegrees(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dy = lat2 - lat1;
  const dx = (lng2 - lng1) * Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180);
  const deg = (Math.atan2(dx, dy) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/**
 * The on-screen rotation of a machine icon (icon faces up = screen north): the compass bearing minus the current map
 * bearing, normalised to (-180, 180] so a CSS transition always takes the short way round.
 */
export function screenRotation(bearing: number, mapBearing: number): number {
  let d = (bearing - mapBearing) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/**
 * Next heading for an icon given its previous heading and a new position. A move smaller than GPS noise keeps the
 * previous heading (a parked machine must not spin around); the first heading defaults to 0 (north).
 */
export function nextHeading(
  previous: { lat: number; lng: number; heading: number } | null,
  lat: number,
  lng: number
): { lat: number; lng: number; heading: number } {
  if (!previous) return { lat, lng, heading: 0 };
  if (metresBetween(previous.lat, previous.lng, lat, lng) < MIN_MOVE_METRES) return previous;
  return { lat, lng, heading: bearingDegrees(previous.lat, previous.lng, lat, lng) };
}

export interface FleetKpis {
  machines: number;
  working: number;
  idle: number;
  broken: number;
  maintenance: number;
  moving: number;
  avgFuelPct: number;
  lowFuel: number;
  avgProgressPct: number;
  activeShifts: number;
}

/** Headline numbers for the KPI strip. */
export function computeKpis(machines: MachineLike[], zones: ZoneLike[], assignments: AssignmentLike[]): FleetKpis {
  const count = (s: string) => machines.filter((m) => m.status === s).length;
  const visible = zones.filter((z) => z.visibility === undefined || z.visibility === 'FULL');
  const avg = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
  return {
    machines: machines.length,
    working: count('WORKING') + count('DISPATCHED'),
    idle: count('IDLE') + count('AVAILABLE'),
    broken: count('BREAKDOWN'),
    maintenance: count('MAINTENANCE'),
    moving: count('MOVING') + count('EN_ROUTE'),
    avgFuelPct: Math.round(avg(machines.map((m) => m.fuel_pct ?? 100)) * 10) / 10,
    lowFuel: machines.filter((m) => (m.fuel_pct ?? 100) < 25).length,
    avgProgressPct: Math.round(avg(visible.map((z) => z.progress_pct ?? 0)) * 10) / 10,
    activeShifts: assignments.filter((a) => a.status === 'IN_PROGRESS' || a.status === 'DISPATCHED' || a.status === 'ON_SCENE').length,
  };
}

export type EventTone = 'danger' | 'info' | 'success' | 'warn';

export interface FleetEvent {
  key: string;
  tone: EventTone;
  icon: string;
  text: string;
}

/** Turns vehicle status changes between two snapshots into short, human readable events. */
export function detectFleetEvents(prev: Map<string, string>, machines: MachineLike[]): FleetEvent[] {
  const events: FleetEvent[] = [];
  for (const m of machines) {
    const id = m.vehicle_id || m.machine_id || 'PT';
    const name = m.name || id;
    const before = prev.get(id);
    if (before === undefined || before === m.status) continue; // first sight is not an event
    const key = `${id}:${before}->${m.status}`;
    if (m.status === 'BREAKDOWN') {
      events.push({ key, tone: 'danger', icon: '⚠️', text: `${name} gặp sự cố, tạm dừng tác chiến` });
    } else if (m.status === 'WORKING' || m.status === 'DISPATCHED') {
      events.push({ key, tone: 'info', icon: '🚤', text: `${name} bắt đầu ca cứu hộ` });
    } else if (m.status === 'MOVING' || m.status === 'EN_ROUTE') {
      events.push({ key, tone: 'info', icon: '🛣️', text: `${name} đang di chuyển tới điểm ngập` });
    } else if (m.status === 'MAINTENANCE') {
      events.push({ key, tone: 'warn', icon: '🛠️', text: `${name} vào bảo dưỡng kỹ thuật` });
    } else if (m.status === 'IDLE' || m.status === 'AVAILABLE') {
      const recovered = before === 'BREAKDOWN' || before === 'MAINTENANCE';
      events.push({
        key,
        tone: 'success',
        icon: '✅',
        text: recovered ? `${name} đã sửa xong, sẵn sàng` : `${name} xong ca, sẵn sàng`,
      });
    }
  }
  return events;
}

export function snapshotStatuses(machines: MachineLike[]): Map<string, string> {
  return new Map(machines.map((m) => [m.vehicle_id || m.machine_id || '', m.status]));
}
