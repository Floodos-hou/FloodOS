// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

/**
 * Plain-Vietnamese labels for every backend enum shown on screen.
 * Users must never see raw technical codes such as IN_PROGRESS or ROAD_BLOCKED.
 */

export type Tone = 'good' | 'warn' | 'bad' | 'info' | 'neutral';

export const TONE_CLASS: Record<Tone, string> = {
  good: 'border-emerald-500/40 bg-emerald-950/80 text-emerald-300',
  warn: 'border-amber-500/40 bg-amber-950/80 text-amber-300',
  bad: 'border-rose-500/40 bg-rose-950/80 text-rose-300',
  info: 'border-sky-500/40 bg-sky-950/80 text-sky-300',
  neutral: 'border-slate-700 bg-slate-800/90 text-slate-300',
};

export { formatLocalDateTime, formatLocalTime } from './dateTime';

export interface Label {
  text: string;
  tone: Tone;
  icon: string;
}

const L = (text: string, tone: Tone, icon: string): Label => ({ text, tone, icon });

const ROLE: Record<string, string> = {
  // FloodOS Roles
  REPORTER: 'Người báo tin / Người dân',
  DISPATCHER: 'Điều phối viên PCTT',
  FIELD_TEAM: 'Đội cứu hộ hiện trường',
  RESOURCE_MANAGER: 'Quản lý nguồn lực & phương tiện',
  PLATFORM_ADMIN: 'Quản trị hệ thống',
  // Legacy Aliases
  FARMER: 'Người báo tin / Người dân',
  COORDINATOR: 'Điều phối viên PCTT',
  OPERATOR: 'Đội cứu hộ hiện trường',
  MACHINE_OWNER: 'Quản lý nguồn lực',
  REPAIR_TEAM: 'Đội sửa chữa kỹ thuật',
};

const NEED_TYPE: Record<string, Label> = {
  EVACUATION: L('Sơ tán khẩn cấp', 'bad', '🚤'),
  MEDICAL: L('Cứu thương & Y tế', 'bad', '🚑'),
  FOOD_WATER: L('Tiếp tế lương thực / Nước', 'warn', '🍞'),
  PUMPING: L('Bơm tiêu úng', 'info', '💧'),
  ROAD_BLOCKED: L('Đường bị ngập cô lập', 'warn', '⛔'),
};

const REPORT_STATUS: Record<string, Label> = {
  RECEIVED: L('Mới tiếp nhận, chờ xác minh', 'info', '📨'),
  VERIFIED: L('Đã xác minh, chờ điều phối', 'warn', '🔍'),
  DISPATCHED: L('Đã điều động lực lượng', 'good', '🚤'),
  IN_PROGRESS: L('Đang triển khai xử lý', 'good', '⏳'),
  RESOLVED: L('Đã xử lý xong, chờ nghiệm thu', 'good', '✅'),
  CANCELLED: L('Đã hủy / Báo tin sai', 'neutral', '✖️'),
  // Legacy aliases
  SUBMITTED: L('Mới tiếp nhận, chờ xác minh', 'info', '📨'),
  PENDING_SCHEDULE: L('Chờ điều phối', 'info', '⏳'),
  SCHEDULED: L('Đã có lịch điều động', 'good', '📅'),
  WAITING_ACCEPTANCE: L('Chờ người dân xác nhận', 'warn', '✍️'),
  COMPLETED: L('Đã hoàn tất', 'good', '✅'),
};

const ORDER_STATUS: Record<string, Label> = {
  CONFIRMED: L('Đã chốt lệnh điều động', 'good', '📋'),
  IN_PROGRESS: L('Đang thực hiện', 'good', '🚤'),
  IMPACTED: L('Gặp sự cố hiện trường', 'bad', '⚠️'),
  SUPERSEDED: L('Đã chuyển cho xe/đội khác', 'warn', '🔁'),
  COMPLETED: L('Đã hoàn tất ca', 'good', '✅'),
  CANCELLED: L('Đã hủy lệnh', 'neutral', '✖️'),
};

const VEHICLE_TYPE: Record<string, string> = {
  RESCUE_BOAT: 'Xuồng cứu hộ',
  HIGH_CLEARANCE_TRUCK: 'Xe gầm cao lội nước',
  MOBILE_PUMP: 'Máy bơm di động',
};

const VEHICLE_STATUS: Record<string, Label> = {
  IDLE: L('Sẵn sàng / Đang rảnh', 'good', '🟢'),
  MOVING: L('Đang di chuyển', 'info', '🔵'),
  WORKING: L('Đang làm nhiệm vụ', 'info', '🚤'),
  BREAKDOWN: L('Gặp sự cố / Hỏng hóc', 'bad', '🔴'),
  MAINTENANCE: L('Đang bảo dưỡng', 'warn', '🛠️'),
};

const ZONE_RISK: Record<string, Label> = {
  CRITICAL: L('Nguy hiểm khẩn cấp (Ngập sâu)', 'bad', '🚨'),
  WARNING: L('Cảnh báo ngập lụt', 'warn', '⚠️'),
  WATCH: L('Theo dõi mực nước', 'info', '👀'),
  NORMAL: L('Mức an toàn', 'good', '✅'),
};

const GAUGE_ALERT: Record<string, Label> = {
  CRITICAL: L('Báo động 3 (Rất nguy hiểm)', 'bad', '🔴'),
  WARNING: L('Báo động 2 (Nguy hiểm)', 'warn', '🟠'),
  NORMAL: L('Báo động 1 (Bình thường)', 'good', '🟢'),
  UNKNOWN: L('Chưa có số liệu', 'neutral', '⚪'),
};

const SHELTER_STATUS: Record<string, Label> = {
  OPEN: L('Đang tiếp nhận', 'good', '🏠'),
  FULL: L('Đã đầy chỗ', 'bad', '⛔'),
  CLOSED: L('Tạm đóng', 'neutral', '🔒'),
};

const PRIORITY: Record<string, Label> = {
  LOW: L('Thấp', 'neutral', ''),
  NORMAL: L('Bình thường', 'info', ''),
  HIGH: L('Cao', 'warn', ''),
  URGENT: L('Khẩn cấp', 'bad', '🚨'),
};

const SEVERITY: Record<string, Label> = {
  LOW: L('Nhẹ', 'info', ''),
  MEDIUM: L('Vừa', 'warn', ''),
  HIGH: L('Nặng', 'bad', ''),
  CRITICAL: L('Rất nặng / Khẩn cấp', 'bad', ''),
};

const INCIDENT_STATUS: Record<string, Label> = {
  OPEN_REPLANNING: L('Đang tìm phương án chi viện', 'bad', '🔎'),
  REPLAN_APPROVED: L('Đã chọn phương án chi viện', 'good', '✅'),
  UNDER_REPAIR: L('Đang sửa chữa phương tiện', 'warn', '🛠️'),
  RESOLVED: L('Đã khắc phục xong', 'good', '✅'),
};

const INCIDENT_TYPE: Record<string, string> = {
  PROPELLER_FOULED: 'Chân vịt vướng rác/cỏ',
  ENGINE_OVERHEAT: 'Động cơ quá nhiệt',
  ENGINE_FAILURE: 'Chết máy giữa dòng',
  PUMP_CLOGGED: 'Kẹt rác đường ống bơm',
  HULL_DAMAGE: 'Hỏng vỏ xuồng / va chạm',
  ROAD_IMPASSABLE: 'Đường ngập sâu không thể qua',
};

const PROCESS_STATUS: Record<string, Label> = {
  ACTIVE: L('Đang xử lý', 'info', '⏳'),
  COMPLETED: L('Đã xong', 'good', '✅'),
};

const PROCESS_NAME: Record<string, string> = {
  flood_report_lifecycle: 'Quy trình Tiếp nhận & Xử lý tin ngập (SOP-01)',
  dispatch_replan_workflow: 'Quy trình Sự cố phương tiện & Chi viện (SOP-02)',
  harvest_service_request: 'Quy trình Tiếp nhận tin báo (SOP-01)',
  incident_replan: 'Quy trình Chi viện khẩn cấp (SOP-02)',
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

// Legacy compatibility aliases
export const requestStatus = reportStatus;
export const assignmentStatus = orderStatus;
export const fieldStatus = zoneRisk;
export const machineStatus = vehicleStatus;
