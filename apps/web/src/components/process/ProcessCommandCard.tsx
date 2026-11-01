// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenAgriOS Contributors

import React from 'react';
import { BpmnProcessInstance, UserRole } from '../../types';
import { formatLocalTime } from '../../utils/dateTime';
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
    <div className="bg-white rounded-xl shadow border border-slate-200 overflow-hidden flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 bg-slate-900 text-white flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <GitBranch className="w-5 h-5 text-emerald-400" />
          <h3 className="font-bold text-sm tracking-wide">Theo dõi quy trình</h3>
        </div>
        <div className="flex items-center space-x-2 text-sm">
          <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse mr-1.5" />
            Đang chạy ({instances.filter((i) => i.status === 'ACTIVE').length})
          </span>
        </div>
      </div>

      {/* Main Body */}
      <div className="p-4 space-y-4">
        {instances.length === 0 ? (
          <div className="text-center py-6 text-slate-500 text-sm">
            Hiện chưa có công việc nào đang chạy.
          </div>
        ) : (
          instances.map((proc) => {
            const isSop02 = proc.definition_key === 'incident_replan';
            const canUserAct = proc.candidate_group === currentUserRole && proc.status === 'ACTIVE';

            return (
              <div
                key={proc.process_instance_id}
                className="border border-slate-200 rounded-lg p-3 bg-slate-50/50 hover:bg-slate-50 transition"
              >
                {/* Process Title Bar */}
                <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-200">
                  <div className="flex items-center space-x-2">
                    <span
                      className={`text-sm font-bold px-2 py-0.5 rounded uppercase tracking-wider ${
                        isSop02 ? 'bg-red-100 text-red-800 border border-red-200' : 'bg-blue-100 text-blue-800 border border-blue-200'
                      }`}
                    >
                      {isSop02 ? 'Xử lý máy hỏng' : 'Thuê máy gặt'}
                    </span>
                    <span className="text-base font-semibold text-slate-700">Mã yêu cầu: {proc.business_key}</span>
                  </div>

                  <div className="flex items-center space-x-2 text-sm">
                    <span
                      className={`font-semibold px-2 py-0.5 rounded-full text-sm ${
                        proc.status === 'ACTIVE'
                          ? 'bg-amber-100 text-amber-800 flex items-center'
                          : 'bg-emerald-100 text-emerald-800'
                      }`}
                    >
                      {proc.status === 'ACTIVE' ? (
                        <>
                          <Clock className="w-3 h-3 mr-1 animate-spin text-amber-600" />
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
                  <div className="mt-3 p-3 bg-white rounded-lg border border-amber-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="text-sm font-bold text-amber-700 uppercase tracking-wide flex items-center">
                        <AlertCircle className="w-3.5 h-3.5 mr-1" />
                        Việc đang chờ:
                      </div>
                      <div className="text-sm font-bold text-slate-900">{proc.current_step_name}</div>
                      <div className="text-sm text-slate-600">
                        Người phụ trách: <span className="font-semibold text-indigo-700">{roleLabel(proc.candidate_group)}</span>
                      </div>
                    </div>

                    <div>
                      {canUserAct ? (
                        <button type="button" onClick={() => onActionClick?.('OPEN_TASK', proc)} className="min-h-12 rounded-xl bg-emerald-700 px-5 py-2.5 text-base font-bold text-white shadow hover:bg-emerald-600">👉 Làm việc này ngay</button>
                      ) : (
                        <div className="text-right text-base text-slate-600 bg-slate-100 px-3 py-2 rounded-xl border border-slate-200">
                          ⏳ Đang chờ <strong className="text-emerald-800">{roleLabel(proc.candidate_group)}</strong> xử lý
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Step History Timeline */}
                {proc.history && proc.history.length > 0 && (
                  <div className="mt-3">
                    <div className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-2">
                      Các bước đã làm:
                    </div>
                    <div className="space-y-1.5">
                      {proc.history.map((step, idx) => (
                        <div
                          key={idx}
                          className="flex items-center text-sm text-slate-700 bg-white p-2 rounded border border-slate-200"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 mr-2 flex-shrink-0" />
                          <span className="font-semibold text-slate-800 mr-2">{step.name}</span>
                          <span className="text-sm text-slate-500">
                            Thực hiện bởi <strong className="text-slate-700">{step.actor}</strong> ({roleLabel(step.role)})
                          </span>
                          <span className="ml-auto font-mono text-sm text-slate-400">
                            {formatLocalTime(step.ts)}
                          </span>
                        </div>
                      ))}
                    </div>
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
