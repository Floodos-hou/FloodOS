// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

/**
 * The five stations a flood report passes through. States come only from the real report status
 * (flood_reports.status); nothing here is invented client-side.
 */
export type StageState = 'done' | 'current' | 'todo' | 'bad';

export interface Stage {
  key: 'RECEIVED' | 'VERIFIED' | 'DISPATCHED' | 'IN_PROGRESS' | 'CONFIRMED';
  label: string;
  state: StageState;
}

const ORDER: Stage['key'][] = ['RECEIVED', 'VERIFIED', 'DISPATCHED', 'IN_PROGRESS', 'CONFIRMED'];
const LABEL: Record<Stage['key'], string> = {
  RECEIVED: 'Tiếp nhận',
  VERIFIED: 'Xác minh',
  DISPATCHED: 'Điều phối',
  IN_PROGRESS: 'Xử lý',
  CONFIRMED: 'Xác nhận',
};

/** index of the stage the report is currently at, or -1 when it ended outside the happy path */
const POSITION: Record<string, number> = {
  RECEIVED: 0,
  VERIFIED: 1,
  DISPATCHED: 2,
  RESCHEDULED: 2,
  IN_PROGRESS: 3,
  IMPACTED: 3,
  AWAITING_CONFIRMATION: 4,
  RESOLVED: 5,
};

export function reportStages(status: string): Stage[] {
  const rejected = status === 'REJECTED' || status === 'CANCELLED';
  const pos = POSITION[status] ?? (rejected ? 1 : 0);
  return ORDER.map((key, i) => {
    let state: StageState = i < pos ? 'done' : i === pos ? 'current' : 'todo';
    if (rejected && i === 1) state = 'bad';
    if (rejected && i > 1) state = 'todo';
    if (status === 'IMPACTED' && i === 3) state = 'bad';
    return { key, label: LABEL[key], state };
  });
}
