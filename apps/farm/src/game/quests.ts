// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenAgriOS Contributors

/**
 * Quests are NOT invented game content: each one is the current step of the real service-request workflow of a
 * field (the same statuses the operations portal shows). Pure functions, unit-tested.
 */

export interface QuestField {
  field_id: string;
  owner_user_id: string;
  readiness_status: string;
  harvest_progress_pct: number;
  visibility?: string;
}

export interface QuestRequest {
  request_id: string;
  field_id: string;
  status: string;
  created_at?: string;
}

export interface QuestAssignment {
  assignment_id: string;
  field_id: string;
  status: string;
  machine_id: string;
}

export interface QuestAcceptance {
  assignment_id: string;
}

export type QuestState = 'alert' | 'todo' | 'active' | 'waiting' | 'done';
export type QuestAction = 'CALL_HARVESTER' | 'CONFIRM_DONE';

export interface Quest {
  id: string;
  fieldId: string;
  state: QuestState;
  icon: string;
  title: string;
  hint: string;
  progress?: number;
  action?: QuestAction;
  assignmentId?: string;
}

const ORDER: Record<QuestState, number> = { alert: 0, todo: 1, active: 2, waiting: 3, done: 4 };

function latest<T extends { created_at?: string }>(items: T[]): T | undefined {
  return [...items].sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''))).pop();
}

export function deriveQuests(
  fields: QuestField[],
  requests: QuestRequest[],
  assignments: QuestAssignment[],
  acceptances: QuestAcceptance[],
  userId: string,
  role: string
): Quest[] {
  const accepted = new Set(acceptances.map((a) => a.assignment_id));
  const farmer = role === 'FARMER';
  const quests: Quest[] = [];

  for (const f of fields) {
    if (f.visibility === 'FOG_OF_WAR') continue;
    const mine = f.owner_user_id === userId;
    if (farmer && !mine) continue;

    const reqs = requests.filter((r) => r.field_id === f.field_id && r.status !== 'CANCELLED');
    const open = latest(reqs.filter((r) => r.status !== 'COMPLETED'));
    const base = { id: `Q-${f.field_id}`, fieldId: f.field_id };

    const waitingAcceptance = assignments.find(
      (a) => a.field_id === f.field_id && a.status === 'COMPLETED' && !accepted.has(a.assignment_id)
    );
    if (waitingAcceptance || open?.status === 'WAITING_ACCEPTANCE') {
      quests.push({
        ...base, state: 'todo', icon: '🌾', title: `Xác nhận gặt xong ruộng ${f.field_id}`,
        hint: 'Máy đã gặt xong. Chấm sao để nghiệm thu và niêm phong sổ cái.',
        action: mine || !farmer ? 'CONFIRM_DONE' : undefined, assignmentId: waitingAcceptance?.assignment_id,
      });
      continue;
    }

    if (open) {
      switch (open.status) {
        case 'SUBMITTED':
        case 'PENDING_SCHEDULE':
          quests.push({ ...base, state: 'waiting', icon: '⏳', title: `Chờ HTX xếp máy cho ruộng ${f.field_id}`, hint: 'Yêu cầu đã gửi. Điều phối viên đang chọn máy và thợ lái.' });
          break;
        case 'SCHEDULED':
          quests.push({ ...base, state: 'active', icon: '🚜', title: `Máy sắp tới ruộng ${f.field_id}`, hint: 'Lịch gặt đã được chốt.' });
          break;
        case 'IN_PROGRESS':
          quests.push({ ...base, state: 'active', icon: '🌾', title: `Đang gặt ruộng ${f.field_id}`, hint: 'Máy đang làm việc ngoài đồng.', progress: f.harvest_progress_pct });
          break;
        case 'IMPACTED_BY_INCIDENT':
          quests.push({ ...base, state: 'alert', icon: '⚠️', title: `Máy hỏng ở ruộng ${f.field_id}`, hint: 'Hệ thống đang tìm máy thay thế gần nhất.' });
          break;
        case 'RESCHEDULED':
          quests.push({ ...base, state: 'active', icon: '🆘', title: `Máy thay thế tới ruộng ${f.field_id}`, hint: 'Ca gặt đã được xếp lại cho máy khác.', progress: f.harvest_progress_pct });
          break;
        default:
          quests.push({ ...base, state: 'waiting', icon: '📋', title: `Ruộng ${f.field_id}: ${open.status}`, hint: '' });
      }
      continue;
    }

    if (f.readiness_status === 'COMPLETED' || f.harvest_progress_pct >= 100) {
      quests.push({ ...base, state: 'done', icon: '✅', title: `Ruộng ${f.field_id} đã gặt xong`, hint: 'Hoàn thành mùa vụ cho thửa này.', progress: 100 });
    } else if (f.readiness_status === 'READY_HARVEST' || f.readiness_status === 'HARVESTING') {
      quests.push({
        ...base, state: 'todo', icon: '📣', title: `Gọi máy gặt cho ruộng ${f.field_id}`, hint: 'Lúa đã chín. Gửi yêu cầu cho HTX.',
        action: farmer && mine ? 'CALL_HARVESTER' : undefined, progress: f.harvest_progress_pct,
      });
    } else {
      quests.push({ ...base, state: 'waiting', icon: '🌱', title: `Ruộng ${f.field_id}: lúa đang lớn`, hint: 'Chưa tới lúc thu hoạch.' });
    }
  }
  return quests.sort((a, b) => ORDER[a.state] - ORDER[b.state] || a.fieldId.localeCompare(b.fieldId));
}

export interface QuestEvent {
  key: string;
  tone: 'info' | 'success' | 'warn' | 'danger';
  icon: string;
  text: string;
}

/** What changed between two quest lists, as short notifications. The first list is a baseline, not news. */
export function diffQuests(prev: Quest[] | null, next: Quest[]): QuestEvent[] {
  if (prev === null) return [];
  const before = new Map(prev.map((q) => [q.fieldId, q]));
  const events: QuestEvent[] = [];
  for (const q of next) {
    const p = before.get(q.fieldId);
    if (!p || p.state === q.state && p.title === q.title) continue;
    const key = `${q.fieldId}:${p.state}->${q.state}:${q.title}`;
    if (q.state === 'done') events.push({ key, tone: 'success', icon: '🎉', text: `Hoàn thành: ${q.title}` });
    else if (q.state === 'alert') events.push({ key, tone: 'danger', icon: '⚠️', text: q.title });
    else if (q.state === 'todo') events.push({ key, tone: 'warn', icon: '❗', text: `Nhiệm vụ mới: ${q.title}` });
    else events.push({ key, tone: 'info', icon: q.icon, text: q.title });
  }
  return events;
}

export function questSummary(quests: Quest[]): { done: number; total: number } {
  return { done: quests.filter((q) => q.state === 'done').length, total: quests.length };
}
