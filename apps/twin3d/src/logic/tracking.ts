// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenAgriOS Contributors

/** Order-tracking style progress derived from the real workflow status. Pure functions (unit-tested). */

export type StepState = 'done' | 'current' | 'todo' | 'bad';
export interface Step { label: string; state: StepState }

const mk = (labels: string[], current: number, bad = false): Step[] =>
  labels.map((label, i): Step => ({ label, state: i < current ? 'done' : i === current ? (bad ? 'bad' : 'current') : 'todo' }));

/** Service request (what the farmer asked for): from sending to farmer acceptance. */
export function requestSteps(status: string): Step[] {
  const L = ['Đã gửi', 'Đã xếp máy', 'Đang gặt', 'Chờ nghiệm thu', 'Hoàn thành'];
  switch (status) {
    case 'SUBMITTED': case 'PENDING_SCHEDULE': return mk(L, 0);
    case 'SCHEDULED': return mk(L, 1);
    case 'IN_PROGRESS': return mk(L, 2);
    case 'IMPACTED_BY_INCIDENT': case 'RESCHEDULED': return mk(['Đã gửi', 'Đã xếp máy', 'Sự cố, đang xếp máy thay', 'Chờ nghiệm thu', 'Hoàn thành'], 2, true);
    case 'WAITING_ACCEPTANCE': return mk(L, 3);
    case 'COMPLETED': return mk(L, 5);
    case 'CANCELLED': return [{ label: 'Đã hủy', state: 'bad' }];
    default: return mk(L, 0);
  }
}

/** One dispatched shift of a machine. */
export function shiftSteps(status: string | undefined): Step[] {
  const L = ['Đã xếp ca', 'Đang gặt', 'Hoàn thành'];
  switch (status) {
    case 'CONFIRMED': return mk(L, 0);
    case 'IN_PROGRESS': return mk(L, 1);
    case 'COMPLETED': return mk(L, 3);
    case 'IMPACTED': return mk(['Đã xếp ca', 'Máy gặp sự cố', 'Hoàn thành'], 1, true);
    case 'SUPERSEDED': return [{ label: 'Đã chuyển cho máy khác', state: 'bad' }];
    case 'CANCELLED': return [{ label: 'Đã hủy', state: 'bad' }];
    default: return [];
  }
}

const MACHINE_ORDER: Record<string, number> = { BREAKDOWN: 0, WORKING: 1, MOVING: 2, IDLE: 3, MAINTENANCE: 4 };

/** Machines that need attention first, then the ones at work. Stable for equal statuses. */
export function sortMachines<T extends { status: string; machine_id: string }>(ms: T[]): T[] {
  return [...ms].sort((a, b) => (MACHINE_ORDER[a.status] ?? 9) - (MACHINE_ORDER[b.status] ?? 9) || a.machine_id.localeCompare(b.machine_id));
}

/** Fields being harvested or blocked first, finished ones last. */
export function sortFields<T extends { readiness_status: string; field_id: string }>(fs: T[]): T[] {
  const o: Record<string, number> = { IMPACTED: 0, HARVESTING: 1, READY_HARVEST: 2, SCHEDULED: 3, GROWING: 4, COMPLETED: 5 };
  return [...fs].sort((a, b) => (o[a.readiness_status] ?? 9) - (o[b.readiness_status] ?? 9) || a.field_id.localeCompare(b.field_id));
}

/** Colour of a field on the flat map: stage of the crop, red when blocked. */
export function fieldColor(readiness: string, blocked: boolean): string {
  if (blocked) return '#e5484d';
  switch (readiness) {
    case 'GROWING': return '#6cc24a';
    case 'READY_HARVEST': case 'SCHEDULED': return '#e8c547';
    case 'HARVESTING': return '#f0a020';
    case 'COMPLETED': return '#b8a77a';
    default: return '#6cc24a';
  }
}

export function ageText(iso: string, now: number): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 'không rõ';
  const s = Math.max(0, Math.round((now - t) / 1000));
  return s < 90 ? `${s} giây trước` : s < 5400 ? `${Math.round(s / 60)} phút trước` : `${Math.round(s / 3600)} giờ trước`;
}
