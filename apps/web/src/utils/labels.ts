// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

/**
 * Plain-Vietnamese labels for every backend enum shown on screen.
 * Farmers must never see codes such as IN_PROGRESS or READY_HARVEST.
 */

export type Tone = 'good' | 'warn' | 'bad' | 'info' | 'neutral';

export interface Label { text: string; tone: Tone; icon: string }

const L = (text: string, tone: Tone, icon: string): Label => ({ text, tone, icon });

const ROLE: Record<string, string> = {
  FARMER: 'Nông hộ',
  COORDINATOR: 'Điều phối viên HTX',
  OPERATOR: 'Thợ lái máy',
  MACHINE_OWNER: 'Chủ máy',
  REPAIR_TEAM: 'Đội sửa chữa',
  PLATFORM_ADMIN: 'Quản trị hệ thống',
};

const REQUEST_STATUS: Record<string, Label> = {
  SUBMITTED: L('Đã gửi, chờ HTX xếp lịch', 'info', '📨'),
  PENDING_SCHEDULE: L('Chờ HTX xếp lịch', 'info', '⏳'),
  SCHEDULED: L('Đã có lịch gặt', 'good', '📅'),
  IN_PROGRESS: L('Đang gặt', 'good', '🚜'),
  IMPACTED_BY_INCIDENT: L('Máy gặp sự cố, HTX đang xử lý', 'bad', '⚠️'),
  RESCHEDULED: L('Đã đổi lịch', 'warn', '🔁'),
  WAITING_ACCEPTANCE: L('Chờ bác nghiệm thu', 'warn', '✍️'),
  COMPLETED: L('Đã xong', 'good', '✅'),
  CANCELLED: L('Đã hủy', 'neutral', '✖️'),
};

const ASSIGNMENT_STATUS: Record<string, Label> = {
  CONFIRMED: L('Đã chốt lịch', 'good', '📅'),
  IN_PROGRESS: L('Đang làm', 'good', '🚜'),
  IMPACTED: L('Bị ảnh hưởng bởi sự cố', 'bad', '⚠️'),
  SUPERSEDED: L('Đã đổi sang máy khác', 'warn', '🔁'),
  COMPLETED: L('Đã xong', 'good', '✅'),
  CANCELLED: L('Đã hủy', 'neutral', '✖️'),
};

const FIELD_STATUS: Record<string, Label> = {
  GROWING: L('Lúa đang lớn', 'info', '🌱'),
  READY_HARVEST: L('Lúa chín, sẵn sàng gặt', 'good', '🌾'),
  SCHEDULED: L('Đã có lịch gặt', 'good', '📅'),
  HARVESTING: L('Đang gặt', 'good', '🚜'),
  IMPACTED: L('Bị gián đoạn do sự cố', 'bad', '⚠️'),
  COMPLETED: L('Đã gặt xong', 'neutral', '✅'),
};

const MACHINE_STATUS: Record<string, Label> = {
  IDLE: L('Đang rảnh', 'good', '🟢'),
  MOVING: L('Đang di chuyển', 'info', '🔵'),
  WORKING: L('Đang làm việc', 'info', '🚜'),
  BREAKDOWN: L('Bị hỏng', 'bad', '🔴'),
  MAINTENANCE: L('Đang bảo dưỡng', 'warn', '🛠️'),
};

const PRIORITY: Record<string, Label> = {
  LOW: L('Thấp', 'neutral', ''),
  NORMAL: L('Bình thường', 'info', ''),
  HIGH: L('Cao', 'warn', ''),
  URGENT: L('Khẩn cấp', 'bad', ''),
};

const SEVERITY: Record<string, Label> = {
  LOW: L('Nhẹ', 'info', ''),
  MEDIUM: L('Vừa', 'warn', ''),
  HIGH: L('Nặng', 'bad', ''),
  CRITICAL: L('Rất nặng', 'bad', ''),
};

const INCIDENT_STATUS: Record<string, Label> = {
  OPEN_REPLANNING: L('Đang tìm máy thay thế', 'bad', '🔎'),
  REPLAN_APPROVED: L('Đã chọn máy thay thế', 'good', '✅'),
  UNDER_REPAIR: L('Đang sửa chữa', 'warn', '🛠️'),
  RESOLVED: L('Đã khắc phục', 'good', '✅'),
};

const INCIDENT_TYPE: Record<string, string> = {
  ENGINE_OVERHEAT: 'Động cơ quá nhiệt',
  HYDRAULIC_FAILURE: 'Hỏng hệ thống thủy lực',
  BLADE_DAMAGE: 'Hỏng lưỡi cắt',
  TRACK_JAM: 'Kẹt xích / bánh xích',
};

const PROCESS_STATUS: Record<string, Label> = {
  ACTIVE: L('Đang xử lý', 'info', '⏳'),
  COMPLETED: L('Đã xong', 'good', '✅'),
};

const PROCESS_NAME: Record<string, string> = {
  harvest_service_request: 'Yêu cầu thuê máy gặt',
  incident_replan: 'Xử lý máy hỏng giữa vụ',
};

const fallback = (code: string | undefined | null): Label => ({
  text: code ? code.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()) : '—',
  tone: 'neutral',
  icon: '',
});

const pick = (table: Record<string, Label>) => (code?: string | null): Label =>
  (code && table[code]) || fallback(code);

export const roleLabel = (code?: string | null): string => (code && ROLE[code]) || fallback(code).text;
export const requestStatus = pick(REQUEST_STATUS);
export const assignmentStatus = pick(ASSIGNMENT_STATUS);
export const fieldStatus = pick(FIELD_STATUS);
export const machineStatus = pick(MACHINE_STATUS);
export const priority = pick(PRIORITY);
export const severity = pick(SEVERITY);
export const incidentStatus = pick(INCIDENT_STATUS);
export const processStatus = pick(PROCESS_STATUS);
export const incidentType = (code?: string | null): string => (code && INCIDENT_TYPE[code]) || fallback(code).text;
export const processName = (key?: string | null): string => (key && PROCESS_NAME[key]) || fallback(key).text;

export const TONE_CLASS: Record<Tone, string> = {
  good: 'bg-emerald-100 text-emerald-900 border-emerald-300',
  warn: 'bg-amber-100 text-amber-900 border-amber-300',
  bad: 'bg-red-100 text-red-900 border-red-300',
  info: 'bg-sky-100 text-sky-900 border-sky-300',
  neutral: 'bg-slate-100 text-slate-700 border-slate-300',
};

/** "Bác Ba Nguyễn Văn (Nông hộ …)" → "Bác Ba Nguyễn Văn" */
export const shortName = (fullName?: string | null): string =>
  (fullName || '').replace(/\s*\(.*$/, '').trim() || 'bạn';

/** Names like "Bác Ba Nguyễn Văn" → "Bác Ba" (first two words) for friendly greetings. */
export const callName = (fullName?: string | null): string => {
  const n = shortName(fullName);
  const parts = n.split(/\s+/);
  const honorifics = ['Bác', 'Chú', 'Anh', 'Chị', 'Cô', 'Ông', 'Bà', 'Đội'];
  if (parts[0] === 'Đội') return parts.slice(0, 3).join(' ');
  return honorifics.includes(parts[0]) && parts.length > 1 ? `${parts[0]} ${parts[1]}` : n;
};

export const greeting = (date = new Date()): string => {
  const h = date.getHours();
  if (h < 11) return 'Chào buổi sáng';
  if (h < 14) return 'Chào buổi trưa';
  if (h < 18) return 'Chào buổi chiều';
  return 'Chào buổi tối';
};

/** Friendly org name: "HTX_CANTHO_01" → fall back to a readable form when no display name is known. */
export const orgLabel = (name?: string | null, id?: string | null): string => {
  if (name && name !== id) return name;
  return (id || '').replace(/_/g, ' ').replace(/\b(\w)(\w*)/g, (_m, a: string, b: string) => a + b.toLowerCase()).replace(/^Htx/, 'HTX');
};

const ACTION: Record<string, string> = {
  OIDC_PKCE_LOGIN_SUCCESS: 'Đăng nhập',
  OIDC_SSO_LOGIN_SUCCESS: 'Đăng nhập',
  OIDC_AUTHORIZATION_CODE_WITH_PKCE: 'Đăng nhập',
  CREATE_SERVICE_REQUEST: 'Gửi yêu cầu gặt',
  CONFIRM_INITIAL_SCHEDULE: 'Chốt lịch gặt',
  CONFIRM_SCHEDULE_ASSIGNMENT: 'Chốt lịch gặt',
  DISPATCH_MACHINE_ASSIGNMENT: 'Điều máy đi gặt',
  REPORT_MACHINE_INCIDENT: 'Báo máy hỏng',
  REPORT_BREAKDOWN_AND_IMPACT_SCAN: 'Báo máy hỏng',
  APPROVE_BPMN_RESCUE_REPLAN: 'Chọn máy thay thế',
  APPROVE_BPMN_RESCUE_REPLACEMENT: 'Chọn máy thay thế',
  CONFIRM_ACCEPTANCE_AND_SEAL_LEDGER: 'Xác nhận gặt xong',
  ASSIGNMENT_STATUS_UPDATED: 'Cập nhật tiến độ gặt',
  COMPLETE_REPAIR_TICKET: 'Hoàn tất sửa chữa',
  REPAIR_TEAM_DIAGNOSIS_UPDATED: 'Cập nhật kết quả sửa chữa',
  RBAC_BLOCKED_UNASSIGNED_OPERATOR: 'Chặn thợ lái chưa được giao ca',
};
export const actionLabel = (code?: string | null): string => (code && ACTION[code]) || fallback(code).text;
