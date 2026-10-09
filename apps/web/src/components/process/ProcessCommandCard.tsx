// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import React from 'react';
import type { BpmnProcessInstance, UserRole } from '../../types';
import { processName, processStatus, roleLabel, formatLocalDateTime } from '../../utils/labels';
import { EmptyState } from '../ui/kit';
import { TONE_CLASS } from '../../utils/labels';

interface ProcessCommandCardProps {
  instances: BpmnProcessInstance[];
  currentUserRole: UserRole;
}

/** Process instances started in Flowable for each report / incident, with the step that is waiting on someone. */
export const ProcessCommandCard: React.FC<ProcessCommandCardProps> = ({ instances, currentUserRole }) => (
  <section className="panel" aria-label="Quy trình nghiệp vụ">
    <div className="panel-head">
      <div>
        <h2 className="text-base">Quy trình nghiệp vụ (BPMN)</h2>
        <p className="text-xs text-ink-3">Mỗi tin báo và mỗi sự cố khởi tạo một tiến trình trong Flowable. Bước đang chờ lấy từ bản sao trạng thái của hệ thống nghiệp vụ.</p>
      </div>
      <span className="chip chip-info">{instances.filter((i) => i.status === 'ACTIVE').length} đang chạy</span>
    </div>
    {instances.length === 0 ? (
      <EmptyState title="Chưa có tiến trình nào" />
    ) : (
      <ul className="rule-y">
        {instances.map((p) => {
          const st = processStatus(p.status);
          const mine = p.candidate_group === currentUserRole && p.status === 'ACTIVE';
          return (
            <li key={p.process_instance_id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{processName(p.definition_key)}</span>
                <span className="block text-xs text-ink-3">Mã vụ việc {p.business_key} · bắt đầu {formatLocalDateTime(p.started_at)}</span>
              </span>
              {p.status === 'ACTIVE' && (
                <span className="text-xs text-ink-2">
                  Đang chờ: <span className="font-semibold text-ink">{p.current_step_name || p.current_task_name}</span> · {roleLabel(p.candidate_group)}
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
);
