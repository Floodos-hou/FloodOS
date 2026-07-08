// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenAgriOS Contributors

import type { ServiceRequest, DispatchAssignment } from '../types';

export const REQUEST_STEPS = ['Đã gửi', 'HTX xếp máy', 'Đang gặt', 'Gặt xong', 'Bác xác nhận'];

/** How many of the 5 request stages are finished, derived from real request/assignment state. */
export function completedSteps(req: ServiceRequest, asg: DispatchAssignment | undefined, accepted: boolean): { done: number; problem: boolean } {
  const problem = req.status === 'IMPACTED_BY_INCIDENT' || asg?.status === 'IMPACTED';
  if (accepted || req.status === 'COMPLETED') return { done: 5, problem: false };
  if (asg?.status === 'COMPLETED' || req.status === 'WAITING_ACCEPTANCE') return { done: 4, problem: false };
  if (asg?.status === 'IN_PROGRESS' || req.status === 'IN_PROGRESS') return { done: 2, problem };
  if (asg || req.status === 'SCHEDULED' || problem) return { done: 2, problem };
  return { done: 1, problem: false };
}
