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

const BROKEN_VEHICLE = 'V02';
const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

const INITIAL: StepView[] = [
  {
    id: 'locate',
    title: 'Xuồng cứu hộ đang tác chiến trên hiện trường',
    narration: 'Xuồng cứu hộ V02 đang thực hiện ca cứu hộ; vị trí và trạng thái cập nhật liên tục qua bộ mô phỏng IoT/MQTT.',
    status: 'pending',
  },
  {
    id: 'incident',
    title: 'Phát sinh sự cố kỹ thuật chân vịt',
    narration: 'V02 mắc kẹt rác trôi nổi cuốn chân vịt; động cơ quá nhiệt không thể di chuyển tiếp. Kích hoạt báo sự cố hiện trường.',
    status: 'pending',
  },
  {
    id: 'score',
    title: 'Hệ thống tính toán & xếp hạng phương án chi viện',
    narration: 'Tính điểm các phương tiện sẵn sàng theo khoảng cách (Haversine đường chim bay), dung tích nhiên liệu và loại phương tiện lội nước.',
    status: 'pending',
  },
  {
    id: 'approve',
    title: 'Điều phối viên duyệt phương án chi viện',
    narration: 'Quy trình BPMN SOP-02 ghi nhận phê duyệt: hủy ca của V02, chuyển giao cho xuồng chi viện V01, ghi nhận vào sổ cái.',
    status: 'pending',
  },
  {
    id: 'start',
    title: 'Phương tiện chi viện V01 xuất phát',
    narration: 'Ca cứu hộ mới được kích hoạt: xuồng V01 chuyển sang trạng thái đang cơ động đến hiện trường.',
    status: 'pending',
  },
  {
    id: 'drive',
    title: 'Cơ động tiếp cận vị trí người dân',
    narration: 'Quan sát trên bản đồ tác chiến: vector giải cứu cập nhật liên tục khi xuồng tiến sát tọa độ người dân gặp nạn.',
    status: 'pending',
  },
  {
    id: 'audit',
    title: 'Kiểm chứng tính toàn vẹn sổ cái SHA-256',
    narration: 'Toàn bộ chuỗi khối ghi vết sự kiện cứu nạn được kiểm toán mật mã: mọi hành động đều bất biến và có nguồn gốc rõ ràng.',
    status: 'pending',
  },
];

/** Coordinator-driven storyline that calls real FloodOS APIs so the tactical map and state react dynamically. */
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
    setMessage('Đang khôi phục dữ liệu ban đầu về trạng thái trực…');
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
      await sleep(800);
    };

    let incidentId = '';
    let optionId = '';
    let rescueVehicle = '';
    let newOrderId = '';

    try {
      await step('locate', async () => {
        const v = (state.vehicles || []).find((x) => x.vehicle_id === BROKEN_VEHICLE);
        if (!v) throw new Error(`Không tìm thấy phương tiện ${BROKEN_VEHICLE}. Vui lòng bấm "Đặt lại dữ liệu".`);
        if (v.status === 'BREAKDOWN' || v.status === 'MAINTENANCE') {
          throw new Error(`${BROKEN_VEHICLE} đang ở trạng thái sự cố từ lần chạy trước. Vui lòng bấm "Đặt lại dữ liệu" rồi thử lại.`);
        }
        return `${v.vehicle_id} · ${v.vehicle_name} · Nhiên liệu ${v.fuel_percent}%`;
      });

      await step('incident', async () => {
        const res = await api.reportFieldIncident(token, {
          vehicle_id: BROKEN_VEHICLE,
          severity: 'CRITICAL',
          incident_type: 'PROPELLER_FOULED',
          description: 'Kịch bản demo: chân vịt xuồng V02 bị rác và lưới cuốn chặt khi qua kênh, động cơ quá tải dừng khẩn cấp.',
          estimated_downtime_hours: 6,
          evidence_filename: 'demo_chan_vit_mac_luoi.jpg',
        });
        incidentId = res.incident_id;
        const options = res.candidate_options ?? [];
        if (res.no_feasible_option || options.length === 0) {
          throw new Error('Không có phương tiện nào sẵn sàng trong khung giờ. Kịch bản dừng theo đúng quy tắc nghiệp vụ.');
        }
        optionId = options[0].option_id;
        rescueVehicle = options[0].vehicle_id || options[0].machine_id || '';
        await onRefresh();
        return `Sự cố ${incidentId} · ${res.impacted_order_ids?.length ?? 1} ca cứu hộ cần chi viện`;
      });

      if (runId.current !== id) return;

      await step('score', async () => {
        const res = await api.getTacticalState(token);
        const inc = (res.incidents || []).find((i: any) => i.incident_id === incidentId);
        const top = inc?.candidate_options?.[0];
        if (!top) throw new Error('Không tìm thấy danh sách phương tiện chi viện.');
        const others = (inc.candidate_options?.length ?? 1) - 1;
        return `Xếp hạng #1: ${top.vehicle_id || top.machine_id} · Điểm tin cậy: ${top.score} · Cách hiện trường: ${top.distance_km} km (đường chim bay)${others > 0 ? ` (vượt qua ${others} phương án khác)` : ''}`;
      });

      await step('approve', async () => {
        const res: any = await api.approveReplan(token, incidentId, { option_id: optionId });
        newOrderId = res.new_order_id || res.new_assignment_id || '';
        await onRefresh();
        return `Ca cũ ${res.superseded_order_id || res.superseded_assignment_id || ''} → Ca mới ${newOrderId} · BPMN SOP-02 ghi nhận thành công`;
      });

      await step('start', async () => {
        if (newOrderId) {
          await api.updateOrderStatus(token, newOrderId, {
            status: 'IN_PROGRESS',
            progress_pct: 15,
            outcome: 'Kịch bản demo: phương tiện chi viện V01 đã xuất phát cơ động đến tọa độ ngập.',
          });
        }
        await onRefresh();
        return `${rescueVehicle || 'V01'} đang di chuyển khẩn cấp tới mục tiêu`;
      });

      await step('drive', async () => {
        for (let i = 1; i <= 3; i++) {
          if (runId.current !== id) return;
          await api.simTick(token);
          await onRefresh();
          patch('drive', { detail: `Cơ động tiếp cận ${i}/3…` });
          await sleep(1500);
        }
        return `${rescueVehicle || 'V01'} đã tiếp cận hiện trường cứu hộ`;
      });

      await step('audit', async () => {
        const proof: any = await api.verifyAuditChain(token);
        if (!proof.chain_valid) throw new Error('Chuỗi băm SHA-256 bị sai lệch hoặc không hợp lệ!');
        return `Chuỗi băm SHA-256 hợp lệ 100% · ${proof.total_blocks} khối · Mã băm gần nhất: ${String(proof.latest_hash).slice(0, 16)}…`;
      });

      setPhase('done');
      setMessage('Hoàn tất kịch bản. Toàn bộ tiến trình đều đi qua API backend thật, quy trình Flowable BPMN và sổ cái mật mã.');
    } catch (e: any) {
      setPhase('error');
      setMessage(e?.message ?? 'Kịch bản bị gián đoạn.');
    }
  }, [token, state, onRefresh, patch]);

  const running = phase === 'running';

  return (
    <section className="rounded-3xl border border-blue-200 bg-gradient-to-br from-blue-50/70 via-indigo-50/40 to-white p-5 shadow-sm" aria-label="Demo tự động">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-extrabold text-slate-900 flex items-center gap-2">
            <span>⚡ Demo Tự Động: Ứng Phó Sự Cố &amp; Chi Viện Hiện Trường</span>
          </h3>
          <p className="text-xs text-slate-600 mt-0.5">
            Thực hiện chuỗi API thật ({BROKEN_VEHICLE} sự cố chân vịt → Hệ thống tính toán chi viện → Điều phối duyệt BPMN SOP-02).
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={run}
            disabled={running}
            className="rounded-xl bg-blue-700 px-4 py-2 text-xs font-bold text-white shadow transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {running ? 'Đang thực thi…' : '▶ Chạy Kịch Bản Tự Động'}
          </button>
          <button
            type="button"
            onClick={reset}
            disabled={running}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            ↺ Đặt Lại Dữ Liệu
          </button>
        </div>
      </div>

      <ol className="mt-4 space-y-2" aria-live="polite">
        {steps.map((s, i) => (
          <li
            key={s.id}
            className={`flex gap-3 rounded-xl border px-3 py-2.5 text-xs transition ${
              s.status === 'running'
                ? 'border-amber-400 bg-amber-50'
                : s.status === 'done'
                ? 'border-emerald-300 bg-emerald-50/60'
                : s.status === 'error'
                ? 'border-rose-300 bg-rose-50'
                : 'border-slate-200 bg-white'
            }`}
          >
            <span
              className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-black ${
                s.status === 'done'
                  ? 'bg-emerald-600 text-white'
                  : s.status === 'running'
                  ? 'animate-pulse bg-amber-500 text-white'
                  : s.status === 'error'
                  ? 'bg-rose-600 text-white'
                  : 'bg-slate-200 text-slate-600'
              }`}
            >
              {s.status === 'done' ? '✓' : s.status === 'error' ? '!' : i + 1}
            </span>
            <div className="min-w-0">
              <div className="font-bold text-slate-900">{s.title}</div>
              <div className="text-slate-600 mt-0.5">{s.narration}</div>
              {s.detail && <div className="mt-1 break-words font-mono text-[11px] text-blue-800">{s.detail}</div>}
            </div>
          </li>
        ))}
      </ol>

      {message && (
        <p
          role="status"
          className={`mt-3 rounded-xl px-3 py-2 text-xs font-semibold ${
            phase === 'error' ? 'bg-rose-100 text-rose-900 border border-rose-200' : 'bg-emerald-100 text-emerald-900 border border-emerald-200'
          }`}
        >
          {message}
        </p>
      )}
    </section>
  );
};
