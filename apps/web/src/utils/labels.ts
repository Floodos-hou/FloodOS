// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

/**
 * Plain-Vietnamese labels for every backend enum shown on screen.
 * Users must never see raw technical codes such as IN_PROGRESS or ROAD_BLOCKED.
 */

export type Tone = 'good' | 'warn' | 'watch' | 'bad' | 'info' | 'neutral';

/** Chip classes are defined in index.css; colour carries the state, so labels carry no emoji. */
export const TONE_CLASS: Record<Tone, string> = {
  good: 'chip-good',
  warn: 'chip-warn',
  watch: 'chip-watch',
  bad: 'chip-bad',
  info: 'chip-info',
  neutral: 'chip-neutral',
};

export { formatLocalDateTime, formatLocalTime } from './dateTime';

export interface Label {
  text: string;
  tone: Tone;
  icon: string;
}

const L = (text: string, tone: Tone, _icon = ''): Label => ({ text, tone, icon: '' });

const ROLE: Record<string, string> = {
  REPORTER: 'Người báo tin',
  DISPATCHER: 'Điều phối viên',
  FIELD_TEAM: 'Đội cứu hộ hiện trường',
  RESOURCE_MANAGER: 'Quản lý nguồn lực',
  PLATFORM_ADMIN: 'Quản trị hệ thống',
};

const NEED_TYPE: Record<string, Label> = {
  EVACUATION: L('Sơ tán khẩn cấp', 'bad', '🚤'),
  MEDICAL: L('Cứu thương & Y tế', 'bad', '🚑'),
  FOOD_WATER: L('Tiếp tế lương thực / Nước', 'warn', '🍞'),
  PUMPING: L('Bơm tiêu úng', 'info', '💧'),
  ROAD_BLOCKED: L('Đường bị ngập cô lập', 'warn', '⛔'),
};

const REPORT_STATUS: Record<string, Label> = {
  RECEIVED: L('Chờ xác minh', 'info'),
  VERIFIED: L('Đã xác minh, chờ điều phối', 'warn'),
  REJECTED: L('Đã từ chối', 'neutral'),
  DISPATCHED: L('Đã điều lực lượng', 'good'),
  IN_PROGRESS: L('Đang xử lý', 'good'),
  IMPACTED: L('Gián đoạn, đang điều phối lại', 'bad'),
  RESCHEDULED: L('Đã điều phối lại', 'warn'),
  AWAITING_CONFIRMATION: L('Chờ người báo xác nhận', 'watch'),
  RESOLVED: L('Đã xử lý xong', 'good'),
  CANCELLED: L('Đã hủy', 'neutral'),
};

const ORDER_STATUS: Record<string, Label> = {
  CONFIRMED: L('Đã giao, chờ đội xuất phát', 'info'),
  IN_PROGRESS: L('Đang thực hiện', 'good'),
  IMPACTED: L('Gặp sự cố hiện trường', 'bad'),
  SUPERSEDED: L('Đã chuyển cho xe/đội khác', 'warn'),
  COMPLETED: L('Đã hoàn tất', 'good'),
  CANCELLED: L('Đã hủy lệnh', 'neutral'),
};

const VEHICLE_TYPE: Record<string, string> = {
  RESCUE_BOAT: 'Xuồng cứu hộ',
  HIGH_CLEARANCE_TRUCK: 'Xe gầm cao lội nước',
  MOBILE_PUMP: 'Máy bơm di động',
  AMPHIBIOUS_CARRIER: 'Xe lội nước bánh xích',
  SCOUT_DRONE: 'Drone trinh sát tầm nhiệt',
  AMBULANCE_AMPHIBIOUS: 'Xe cấp cứu lội nước',
  COMMAND_VEHICLE: 'Xe chỉ huy tác chiến',
};

const VEHICLE_STATUS: Record<string, Label> = {
  IDLE: L('Sẵn sàng', 'good'),
  MOVING: L('Đang di chuyển', 'info'),
  WORKING: L('Đang làm nhiệm vụ', 'info'),
  BREAKDOWN: L('Hỏng, không dùng được', 'bad'),
  MAINTENANCE: L('Đang bảo dưỡng', 'warn'),
};

const ZONE_RISK: Record<string, Label> = {
  CRITICAL: L('Nguy hiểm', 'bad'),
  WARNING: L('Cảnh báo', 'warn'),
  WATCH: L('Theo dõi', 'watch'),
  NORMAL: L('An toàn', 'good'),
};

const GAUGE_ALERT: Record<string, Label> = {
  CRITICAL: L('Báo động 3', 'bad'),
  WARNING: L('Báo động 2', 'warn'),
  WATCH: L('Báo động 1', 'watch'),
  NORMAL: L('Dưới báo động', 'good'),
  UNKNOWN: L('Chưa có số liệu', 'neutral'),
};

const SHELTER_STATUS: Record<string, Label> = {
  OPEN: L('Đang tiếp nhận', 'good', '🏠'),
  FULL: L('Đã đầy chỗ', 'bad', '⛔'),
  CLOSED: L('Tạm đóng', 'neutral', '🔒'),
};

const PRIORITY: Record<string, Label> = {
  LOW: L('Thấp', 'neutral'),
  NORMAL: L('Bình thường', 'info'),
  HIGH: L('Cao', 'watch'),
  URGENT: L('Khẩn cấp', 'bad'),
};

const SEVERITY: Record<string, Label> = {
  MINOR: L('Nhẹ', 'info'),
  MAJOR: L('Nặng', 'warn'),
  CRITICAL: L('Rất nặng', 'bad'),
};

const INCIDENT_STATUS: Record<string, Label> = {
  OPEN_REPLANNING: L('Đang tìm phương án chi viện', 'bad', '🔎'),
  REPLAN_APPROVED: L('Đã chọn phương án chi viện', 'good', '✅'),
  UNDER_REPAIR: L('Đang sửa chữa phương tiện', 'warn', '🛠️'),
  RESOLVED: L('Đã khắc phục xong', 'good', '✅'),
};

const INCIDENT_TYPE: Record<string, string> = {
  ENGINE_FAILURE: 'Hỏng / chết máy',
  PROPELLER_FOULED: 'Chân vịt vướng rác, lưới',
  PUMP_CLOGGED: 'Máy bơm bị tắc',
  ROUTE_BLOCKED: 'Đường tiếp cận bị chặn',
  OTHER: 'Sự cố khác',
};

const PROCESS_STATUS: Record<string, Label> = {
  ACTIVE: L('Đang xử lý', 'info', '⏳'),
  COMPLETED: L('Đã xong', 'good', '✅'),
};

const PROCESS_NAME: Record<string, string> = {
  flood_report_lifecycle: 'Vòng đời tin báo ngập (SOP-01)',
  dispatch_replan_workflow: 'Sự cố phương tiện và điều phối lại (SOP-02)',
};

const fallback = (code: string | undefined | null): Label => ({
  text: code || 'Không xác định',
  tone: 'neutral',
  icon: '',
});

type CallableDict<T> = ((k: string | undefined | null) => T) & Record<string, any>;

function makeDict<T>(dict: Record<string, any>, fn: (k: string | undefined | null) => T): CallableDict<T> {
  return Object.assign(fn, dict);
}

export const roleLabel = (role: string | undefined | null): string =>
  (role && ROLE[role]) || role || 'Khách';

export const needType = makeDict(NEED_TYPE, (need) => (need && NEED_TYPE[need]) || fallback(need));

export const reportStatus = makeDict(REPORT_STATUS, (st) => (st && REPORT_STATUS[st]) || fallback(st));

export const orderStatus = makeDict(ORDER_STATUS, (st) => (st && ORDER_STATUS[st]) || fallback(st));

export const vehicleType = makeDict(VEHICLE_TYPE, (type) => (type && VEHICLE_TYPE[type]) || type || 'Phương tiện');

export const vehicleStatus = makeDict(VEHICLE_STATUS, (st) => (st && VEHICLE_STATUS[st]) || fallback(st));

export const zoneRisk = makeDict(ZONE_RISK, (risk) => (risk && ZONE_RISK[risk]) || fallback(risk));

export const gaugeAlert = makeDict(GAUGE_ALERT, (alert) => (alert && GAUGE_ALERT[alert]) || fallback(alert));
export const gaugeAlertState = gaugeAlert;

export const shelterStatus = makeDict(SHELTER_STATUS, (st) => (st && SHELTER_STATUS[st]) || fallback(st));

export const priority = makeDict(PRIORITY, (p) => (p && PRIORITY[p]) || fallback(p));

export const severity = makeDict(SEVERITY, (s) => (s && SEVERITY[s]) || fallback(s));

export const incidentStatus = makeDict(INCIDENT_STATUS, (st) => (st && INCIDENT_STATUS[st]) || fallback(st));

export const incidentType = makeDict(INCIDENT_TYPE, (t) => (t && INCIDENT_TYPE[t]) || t || 'Sự cố thiết bị');

export const processStatus = (st: string | undefined | null): Label =>
  (st && PROCESS_STATUS[st]) || fallback(st);

export const processName = (id: string | undefined | null): string =>
  (id && PROCESS_NAME[id]) || id || 'Tiến trình';

export const orgLabel = (orgName: string | undefined | null, orgId: string | undefined | null): string => {
  if (orgName && orgName.trim()) return orgName;
  if (!orgId) return 'Địa bàn thí điểm Hà Nội';
  if (orgId.includes('HN_PILOT') || orgId.includes('ORG_HN')) return 'Địa bàn thí điểm Hà Nội';
  if (orgId.includes('CONTROL')) return 'Khu vực đối chứng (Hà Nội)';
  return orgId;
};

export const avatarInitials = (fullName: string | undefined | null, username: string | undefined | null): string => {
  if (fullName && fullName.trim()) {
    const clean = fullName.replace(/\(.*?\)/g, '').trim();
    const parts = clean.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  if (username && username.trim()) return username.substring(0, 2).toUpperCase();
  return 'ND';
};

export const shortName = (fullName: string | undefined | null, username: string | undefined | null): string => {
  if (fullName && fullName.trim()) return fullName;
  if (username && username.trim()) return username;
  return 'Người dùng';
};

export const greeting = (fullName: string | undefined | null, username: string | undefined | null): string => {
  const name = shortName(fullName, username);
  return `Xin chào, ${name}`;
};

export const callName = (fullName: string | undefined | null, username: string | undefined | null): string =>
  shortName(fullName, username);

export const actionLabel = (action: string | undefined | null): string => {
  if (!action) return 'Giao dịch';
  const MAP: Record<string, string> = {
    CREATE_FLOOD_REPORT: 'Gửi tin báo ngập',
    VERIFY_FLOOD_REPORT: 'Xác minh tin ngập',
    CREATE_DISPATCH_ORDER: 'Ban hành lệnh điều động',
    UPDATE_ORDER_STATUS: 'Cập nhật tiến độ ca',
    REPORT_FIELD_INCIDENT: 'Báo sự cố phương tiện',
    APPROVE_REPLAN: 'Duyệt phương án chi viện',
    UPDATE_REPAIR_TICKET: 'Cập nhật phiếu sửa chữa',
    CONFIRM_RESOLUTION: 'Xác nhận an toàn / đóng vụ',
    UPDATE_SHELTER_OCCUPANCY: 'Cập nhật điểm trú',
    SIM_RESET: 'Khôi phục dữ liệu mô phỏng',
  };
  return MAP[action] || action;
};
