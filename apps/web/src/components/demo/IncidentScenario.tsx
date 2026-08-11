// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import React, { useCallback, useRef, useState } from 'react';
import { api } from '../../services/api';
import type { TacticalState } from '../../types';

interface Props {
  token: string;
  state: TacticalState;
  /** Re-reads the tactical state so the map and cards react after each step. */
  onRefresh: () => Promise<void>;
}

type StepStatus = 'pending' | 'running' | 'done' | 'error';

interface StepView {
  id: string;
  title: string;
  narration: string;
  status: StepStatus;
  detail?: string;
}

const BROKEN_MACHINE = 'M01';
const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

const INITIAL: StepView[] = [
  { id: 'locate', title: 'Máy đang gặt ngoài đồng', narration: 'M01 đang chạy ca gặt; vị trí và nhiên liệu cập nhật liên tục từ thiết bị qua MQTT.', status: 'pending' },
  { id: 'incident', title: 'Máy bị hỏng giữa vụ', narration: 'Báo sự cố động cơ quá nóng. Ca gặt bị ảnh hưởng và bản đồ chuyển sang cảnh báo đỏ.', status: 'pending' },
  { id: 'score', title: 'Hệ thống tìm máy thay thế', narration: 'Chấm điểm các máy còn lại theo khoảng cách (Haversine), công suất và tay nghề thợ lái.', status: 'pending' },
  { id: 'approve', title: 'Điều phối viên duyệt phương án', narration: 'Quy trình BPMN ghi nhận phê duyệt; ca cũ được thay bằng ca mới, mọi thứ ghi vào sổ cái.', status: 'pending' },
  { id: 'start', title: 'Máy thay thế xuất phát', narration: 'Ca mới được kích hoạt: máy thay thế chuyển sang trạng thái đang gặt.', status: 'pending' },
  { id: 'drive', title: 'Máy thay thế di chuyển tới ruộng', narration: 'Quan sát bản đồ: máy trượt dần về phía ruộng cần cứu.', status: 'pending' },
  { id: 'audit', title: 'Kiểm chứng sổ cái bất biến', narration: 'Chuỗi băm SHA-256 phải còn nguyên vẹn: không ai có thể sửa lại lịch sử.', status: 'pending' },
];

/** Coordinator-only storyline that drives the real API, so the map reacts exactly as it would in production. */
export const IncidentScenario: React.FC<Props> = ({ token, state, onRefresh }) => {
  const [steps, setSteps] = useState<StepView[]>(INITIAL);
  const [phase, setPhase] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const runId = useRef(0);

  const patch = useCallback((id: string, p: Partial<StepView>) => {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...p } : s)));
  }, []);

  const reset = useCallback(async () => {
    setPhase('running');
    setMessage('Đang khôi phục dữ liệu mặc định…');
    try {
      await api.simReset(token);
      await onRefresh();
      setSteps(INITIAL);
      setPhase('idle');
      setMessage(null);
    } catch (e: any) {
      setPhase('error');
      setMessage(e?.message ?? 'Không thể khôi phục dữ liệu.');
    }
  }, [token, onRefresh]);

  const run = useCallback(async () => {
    const id = ++runId.current;
    setSteps(INITIAL);
    setPhase('running');
    setMessage(null);

    const step = async (stepId: string, fn: () => Promise<string | void>) => {
      patch(stepId, { status: 'running' });
      try {
        const detail = await fn();
        patch(stepId, { status: 'done', detail: detail ?? undefined });
      } catch (e: any) {
        patch(stepId, { status: 'error', detail: e?.message ?? 'Lỗi không xác định' });
        throw e;
      }
      await sleep(900);
    };

    let incidentId = '';
    let optionId = '';
    let rescueMachine = '';
    let newAssignmentId = '';

    try {
      await step('locate', async () => {
        const m = state.machines.find((x) => x.machine_id === BROKEN_MACHINE);
        if (!m) throw new Error(`Không thấy máy ${BROKEN_MACHINE}. Bấm “Đặt lại dữ liệu” rồi chạy lại.`);
        if (m.status === 'BREAKDOWN') throw new Error(`${BROKEN_MACHINE} đang ở trạng thái sự cố từ lần chạy trước. Bấm “Đặt lại dữ liệu”.`);
        return `${m.machine_id} · ${m.name} · nhiên liệu ${m.fuel_pct.toFixed(1)}%`;
      });

      await step('incident', async () => {
        const res: any = await api.reportIncident(token, {
          machine_id: BROKEN_MACHINE,
          severity: 'CRITICAL',
          incident_type: 'Động cơ quá nóng',
          description: 'Kịch bản demo: động cơ quá nóng giữa ca gặt, cần máy khác đến thay.',
          estimated_downtime_hours: 24,
          evidence_filename: 'demo_dong_co_qua_nong.jpg',
        });
        incidentId = res.incident_id;
        const options: any[] = res.candidate_options ?? [];
        if (res.no_feasible_option || options.length === 0) {
          throw new Error('Không có máy nào thỏa khung giờ. Kịch bản dừng ở đây (đúng như hệ thống sẽ làm).');
        }
        optionId = options[0].option_id;
        rescueMachine = options[0].machine_id;
        await onRefresh();
        return `Sự cố ${incidentId} · ${res.impacted_assignment_ids?.length ?? 0} ca gặt bị ảnh hưởng`;
      });
      if (runId.current !== id) return;

      await step('score', async () => {
        const res: any = await api.getTacticalState(token);
        const inc = res.incidents?.find((i: any) => i.incident_id === incidentId);
        const top = inc?.candidate_options?.[0];
        if (!top) throw new Error('Không đọc được danh sách máy thay thế.');
        const others = (inc.candidate_options.length ?? 1) - 1;
        return `Chọn ${top.machine_id} · ${top.score} điểm · cách ruộng ${top.distance_km} km${others > 0 ? ` (hơn ${others} phương án khác)` : ''}`;
      });

      await step('approve', async () => {
        const res: any = await api.approveReplan(token, incidentId, { option_id: optionId });
        newAssignmentId = res.new_assignment_id;
        await onRefresh();
        return `Ca ${res.superseded_assignment_id} → ${newAssignmentId} · bản ghi ${res.audit?.event_id ?? ''}`;
      });

      await step('start', async () => {
        await api.updateAssignmentStatus(token, newAssignmentId, {
          status: 'IN_PROGRESS',
          progress_pct: 5,
          note: 'Kịch bản demo: máy thay thế xuất phát',
        });
        await onRefresh();
        return `${rescueMachine} bắt đầu ca ${newAssignmentId}`;
      });

      await step('drive', async () => {
        for (let i = 1; i <= 4; i++) {
          if (runId.current !== id) return;
          await api.simTick(token);
          await onRefresh();
          patch('drive', { detail: `Bước di chuyển ${i}/4…` });
          await sleep(2_000);
        }
        return `${rescueMachine} đã tiến sát ruộng`;
      });

      await step('audit', async () => {
        const proof: any = await api.verifyAuditChain(token);
        if (!proof.chain_valid) throw new Error('Chuỗi băm KHÔNG hợp lệ!');
        return `Chuỗi băm hợp lệ · ${proof.total_blocks} khối · ${String(proof.latest_hash).slice(0, 16)}…`;
      });

      setPhase('done');
      setMessage('Hoàn tất. Mọi thao tác trên đều đi qua cùng API, phân quyền và sổ cái như hệ thống thật.');
    } catch (e: any) {
      setPhase('error');
      setMessage(e?.message ?? 'Kịch bản bị gián đoạn.');
    }
  }, [token, state, onRefresh, patch]);

  const running = phase === 'running';

  return (
    <section className="rounded-3xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-white p-5 shadow-sm" aria-label="Demo tự động">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-extrabold text-indigo-950">⚡ Demo tự động: máy gặt hỏng giữa vụ</h3>
          <p className="text-sm text-slate-600">
            Chạy các thao tác thật qua API ({BROKEN_MACHINE} hỏng → hệ thống tìm máy thay → điều phối duyệt). Mở tab “Bản đồ” để xem trực tiếp.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={run}
            disabled={running}
            className="rounded-xl bg-indigo-700 px-4 py-2 text-sm font-bold text-white shadow transition hover:bg-indigo-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {running ? 'Đang chạy…' : '▶ Chạy kịch bản'}
          </button>
          <button
            type="button"
            onClick={reset}
            disabled={running}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            ↺ Đặt lại dữ liệu
          </button>
        </div>
      </div>

      <ol className="mt-4 space-y-2" aria-live="polite">
        {steps.map((s, i) => (
          <li
            key={s.id}
            className={`flex gap-3 rounded-xl border px-3 py-2 text-sm transition ${
              s.status === 'running'
                ? 'border-amber-300 bg-amber-50'
                : s.status === 'done'
                  ? 'border-emerald-200 bg-emerald-50/60'
                  : s.status === 'error'
                    ? 'border-red-300 bg-red-50'
                    : 'border-slate-200 bg-white'
            }`}
          >
            <span
              className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-extrabold ${
                s.status === 'done'
                  ? 'bg-emerald-600 text-white'
                  : s.status === 'running'
                    ? 'animate-pulse bg-amber-500 text-white'
                    : s.status === 'error'
                      ? 'bg-red-600 text-white'
                      : 'bg-slate-200 text-slate-600'
              }`}
            >
              {s.status === 'done' ? '✓' : s.status === 'error' ? '!' : i + 1}
            </span>
            <div className="min-w-0">
              <div className="font-bold text-slate-900">{s.title}</div>
              <div className="text-slate-600">{s.narration}</div>
              {s.detail && <div className="mt-0.5 break-words font-mono text-xs text-indigo-800">{s.detail}</div>}
            </div>
          </li>
        ))}
      </ol>

      {message && (
        <p
          role="status"
          className={`mt-3 rounded-xl px-3 py-2 text-sm font-semibold ${
            phase === 'error' ? 'bg-red-100 text-red-900' : 'bg-emerald-100 text-emerald-900'
          }`}
        >
          {message}
        </p>
      )}
    </section>
  );
};
