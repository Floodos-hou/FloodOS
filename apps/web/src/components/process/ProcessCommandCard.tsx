// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import React from 'react';
import { GitBranch, Activity, CheckCircle2, Clock } from 'lucide-react';
import type { BpmnProcessInstance, UserRole } from '../../types';
import { processName, processStatus, roleLabel, formatLocalDateTime, TONE_CLASS } from '../../utils/labels';
import { EmptyState } from '../ui/kit';

interface ProcessCommandCardProps {
  instances: BpmnProcessInstance[];
  currentUserRole: UserRole;
}

/** Process instances started in Flowable for each report / incident, with the step that is waiting on someone. */
export const ProcessCommandCard: React.FC<ProcessCommandCardProps> = ({ instances, currentUserRole }) => {
  const activeCount = instances.filter((i) => i.status === 'ACTIVE').length;
  const completedCount = instances.filter((i) => i.status === 'COMPLETED').length;
  const myTurnCount = instances.filter((i) => i.status === 'ACTIVE' && i.candidate_group === currentUserRole).length;

  return (
    <div className="space-y-4">
      <div className="grid gap-3.5 md:grid-cols-3">
        <div className="panel overflow-hidden border-t-4 border-t-sky-500 bg-gradient-to-br from-sky-50/90 via-white to-white p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="eyebrow text-sky-800/80">Tiến trình BPMN đang chạy</div>
              <div className="num mt-1 text-2xl font-extrabold text-river">{activeCount}</div>
              <div className="mt-1 text-xs text-ink-3">Đồng bộ trực tiếp với máy trạng thái Flowable</div>
            </div>
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-sky-500 to-blue-600 text-white shadow-md shadow-sky-500/30">
              <Activity className="h-5 w-5" aria-hidden="true" />
            </span>
          </div>
        </div>

        <div className="panel overflow-hidden border-t-4 border-t-amber-500 bg-gradient-to-br from-amber-50/90 via-white to-white p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="eyebrow text-amber-800/80">Chờ vai trò của bạn xử lý</div>
              <div className="num mt-1 text-2xl font-extrabold text-warn">{myTurnCount}</div>
              <div className="mt-1 text-xs text-ink-3">UserTask đang gán cho nhóm {roleLabel(currentUserRole)}</div>
            </div>
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 text-white shadow-md shadow-amber-500/30">
              <Clock className="h-5 w-5" aria-hidden="true" />
            </span>
          </div>
        </div>

        <div className="panel overflow-hidden border-t-4 border-t-emerald-500 bg-gradient-to-br from-emerald-50/90 via-white to-white p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="eyebrow text-emerald-800/80">Đã hoàn tất chu trình</div>
              <div className="num mt-1 text-2xl font-extrabold text-safe">{completedCount}</div>
              <div className="mt-1 text-xs text-ink-3">Tổng cộng {instances.length} phiên bản quy trình SOP</div>
            </div>
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-md shadow-emerald-500/30">
              <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
            </span>
          </div>
        </div>
      </div>

      <section className="panel overflow-hidden" aria-label="Quy trình nghiệp vụ">
        <div className="flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-[#082f49] via-[#0c4a6e] to-[#0284c7] px-5 py-4 text-white">
          <div>
            <h2 className="text-base font-extrabold text-white">Quy trình nghiệp vụ (BPMN 2.0 — Flowable Engine)</h2>
            <p className="text-xs text-sky-100/85">Mỗi tin báo và mỗi sự cố khởi tạo một tiến trình chuẩn SOP-01 / SOP-02.</p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-300/40 bg-white/15 px-3 py-1 text-xs font-bold text-white">
            <GitBranch className="h-3.5 w-3.5 text-sky-200" aria-hidden="true" />
            {activeCount} đang chạy
          </span>
        </div>
        {instances.length === 0 ? (
          <EmptyState title="Chưa có tiến trình nào" />
        ) : (
          <ul className="rule-y">
            {instances.map((p) => {
              const st = processStatus(p.status);
              const mine = p.candidate_group === currentUserRole && p.status === 'ACTIVE';
              return (
                <li
                  key={p.process_instance_id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5 text-sm transition-colors hover:bg-sky-50/40"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="rounded bg-sky-100 px-2 py-0.5 font-mono text-xs font-bold text-sky-800">{p.business_key}</span>
                      <span className="font-bold text-ink">{processName(p.definition_key)}</span>
                    </span>
                    <span className="mt-0.5 block text-xs text-ink-3">
                      Mã phiên: <span className="mono">{p.process_instance_id}</span> · bắt đầu {formatLocalDateTime(p.started_at)}
                    </span>
                  </span>
                  {p.status === 'ACTIVE' && (
                    <span className="rounded-lg border border-sky-200/80 bg-sky-50/70 px-3 py-1.5 text-xs text-ink-2">
                      Bước hiện tại: <span className="font-bold text-river-2">{p.current_step_name || p.current_task_name}</span> · {roleLabel(p.candidate_group)}
                      {mine && <span className="chip chip-warn ml-2">Đến lượt bạn</span>}
                    </span>
                  )}
                  <span className={`chip ${TONE_CLASS[st.tone]}`}>{st.text}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
};
