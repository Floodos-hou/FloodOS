// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import React from 'react';
import { BpmnProcessInstance, UserRole } from '../../types';
import { GitBranch, CheckCircle2, Clock, AlertCircle } from 'lucide-react';
import { roleLabel } from '../../utils/labels';

interface ProcessCommandCardProps {
  instances: BpmnProcessInstance[];
  currentUserRole: UserRole;
  onActionClick?: (actionType: string, instance: BpmnProcessInstance) => void;
}

export const ProcessCommandCard: React.FC<ProcessCommandCardProps> = ({
  instances,
  currentUserRole,
  onActionClick,
}) => {
  return (
    <div className="bg-slate-900/90 rounded-2xl shadow-xl border border-slate-800 overflow-hidden flex flex-col text-slate-100">
      {/* Header */}
      <div className="px-5 py-4 bg-slate-950 text-white flex items-center justify-between border-b border-slate-800">
        <div className="flex items-center space-x-2.5">
          <GitBranch className="w-5 h-5 text-cyan-400" />
          <h3 className="font-bold text-sm tracking-wide">Quy Trình Tác Chiến Flowable BPMN</h3>
        </div>
        <div className="flex items-center space-x-2 text-xs">
          <span className="px-2.5 py-1 rounded-full bg-cyan-950/80 text-cyan-300 border border-cyan-800/60 flex items-center">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse mr-1.5" />
            Đang chạy ({instances.filter((i) => i.status === 'ACTIVE').length})
          </span>
        </div>
      </div>

      {/* Main Body */}
      <div className="p-5 space-y-4">
        {instances.length === 0 ? (
          <div className="text-center py-8 text-slate-500 text-xs">
            Hiện không có quy trình cứu nạn nào đang chạy.
          </div>
        ) : (
          instances.map((proc) => {
            const isSop02 =
              proc.definition_key === 'dispatch_replan_workflow' ||
              proc.definition_key === 'incident_replan';
            const canUserAct = proc.candidate_group === currentUserRole && proc.status === 'ACTIVE';

            return (
              <div
                key={proc.process_instance_id}
                className="border border-slate-800 rounded-xl p-4 bg-slate-950/70 hover:border-slate-700 transition"
              >
                {/* Process Title Bar */}
                <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-slate-800">
                  <div className="flex items-center space-x-2">
                    <span
                      className={`text-xs font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider ${
                        isSop02
                          ? 'bg-rose-950/80 text-rose-300 border border-rose-800/60'
                          : 'bg-sky-950/80 text-cyan-300 border border-sky-800/60'
                      }`}
                    >
                      {isSop02 ? 'SOP-02 Chi Viện Sự Cố' : 'SOP-01 Tiếp Nhận & Ứng Cứu'}
                    </span>
                    <span className="text-xs font-mono font-bold text-slate-300">
                      Mã vụ việc: {proc.business_key}
                    </span>
                  </div>

                  <div className="flex items-center space-x-2 text-xs">
                    <span
                      className={`font-bold px-2.5 py-0.5 rounded-full text-xs ${
                        proc.status === 'ACTIVE'
                          ? 'bg-amber-950/80 text-amber-300 border border-amber-800/60 flex items-center'
                          : 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/60'
                      }`}
                    >
                      {proc.status === 'ACTIVE' ? (
                        <>
                          <Clock className="w-3 h-3 mr-1 animate-spin text-amber-400" />
                          Đang xử lý
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-3 h-3 mr-1 inline" />
                          Hoàn tất
                        </>
                      )}
                    </span>
                  </div>
                </div>

                {/* Current Active Task & Action Banner */}
                {proc.status === 'ACTIVE' && (
                  <div className="mt-3 p-3.5 bg-slate-900/90 rounded-xl border border-amber-500/30 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-slate-200">
                    <div className="space-y-1">
                      <div className="text-xs font-bold text-amber-400 uppercase tracking-wide flex items-center">
                        <AlertCircle className="w-3.5 h-3.5 mr-1" />
                        Nhiệm vụ đang chờ thực hiện:
                      </div>
                      <div className="text-xs font-bold text-white">{proc.current_step_name}</div>
                      <div className="text-xs text-slate-400">
                        Vai trò phụ trách: <span className="font-semibold text-cyan-400">{roleLabel(proc.candidate_group)}</span>
                      </div>
                    </div>

                    {canUserAct && onActionClick && (
                      <button
                        onClick={() => onActionClick(proc.current_step_definition_id || '', proc)}
                        className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-xl transition shadow flex items-center justify-center shrink-0"
                      >
                        Thực hiện ngay
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
