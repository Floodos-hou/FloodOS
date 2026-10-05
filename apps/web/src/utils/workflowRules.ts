// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import type { DispatchOrder, FloodReport, ReportResolution, RescueTeam, RescueVehicle } from '../types';

const ACTIVE_ORDER_STATUSES = new Set([
  'CONFIRMED', 'IN_PROGRESS', 'IMPACTED',
  // Keep compatibility with older API payloads while deployments migrate.
  'DISPATCHED', 'EN_ROUTE', 'ON_SCENE',
]);

const ACTIVE_INCIDENT_STATUSES = new Set(['REPORTED', 'IN_PROGRESS', 'OPEN_REPLANNING', 'REPLAN_APPROVED', 'UNDER_REPAIR']);

export const isActiveDispatchOrder = (status: string): boolean => ACTIVE_ORDER_STATUSES.has(status);
export const isActiveIncident = (status: string): boolean => ACTIVE_INCIDENT_STATUSES.has(status);

export const reportDepthCm = (report: Pick<FloodReport, 'depth_cm' | 'flood_depth_cm'>): number =>
  report.depth_cm ?? report.flood_depth_cm ?? 0;

export const reportPeopleAffected = (report: Pick<FloodReport, 'people_affected' | 'people_count'>): number =>
  report.people_affected ?? report.people_count ?? 0;

export const isVehicleAvailable = (vehicle: Pick<RescueVehicle, 'vehicle_id' | 'status'>, busyIds: Set<string>): boolean =>
  ['AVAILABLE', 'IDLE', 'READY'].includes(vehicle.status) && !busyIds.has(vehicle.vehicle_id);

export const isTeamAvailable = (team: Pick<RescueTeam, 'team_id' | 'status'>, busyIds: Set<string>): boolean =>
  ['READY', 'AVAILABLE'].includes(team.status) && !busyIds.has(team.team_id);

export const validateReportDescription = (description: string): string | null =>
  description.trim() ? null : 'Vui lòng nhập mô tả tình hình ngập tại hiện trường.';

export const validateRejectionReason = (reason: string): string | null =>
  reason.trim().length >= 3 ? null : 'Từ chối tin báo yêu cầu ghi rõ lý do (ít nhất 3 ký tự).';

export const validateDisputeReason = (reason: string): string | null =>
  reason.trim().length >= 3 ? null : 'Phản đối kết quả cứu nạn yêu cầu nhập lý do (ít nhất 3 ký tự).';

export const resolutionIdForReport = (
  reportId: string,
  resolutions: Pick<ReportResolution, 'report_id' | 'resolution_id'>[],
  orders: Pick<DispatchOrder, 'report_id' | 'order_id'>[],
): string | null => {
  const resolution = resolutions.find((item) => item.report_id === reportId);
  if (resolution?.resolution_id) return resolution.resolution_id;
  const order = orders.find((item) => item.report_id === reportId);
  return order ? `RES-${order.order_id}` : null;
};
