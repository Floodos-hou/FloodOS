// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenAgriOS Contributors

import React from 'react';
import { MachineIncident, UserRole } from '../../types';
import { formatLocalTime } from '../../utils/dateTime';
import { incidentStatus, incidentType, severity } from '../../utils/labels';
import { StatusBadge } from '../common/StatusBadge';

interface IntelligenceRadarProps {
  incidents: MachineIncident[];
  currentUserRole: UserRole;
  onApproveRescue?: (incidentId: string, optionId: string) => void;
  conflictError?: { code: string; message: string; details?: any } | null;
  onClearConflict?: () => void;
}

/** Fit score → plain words, so nobody has to interpret "93.8/100". */
const fitWords = (score: number): string => (score >= 85 ? 'Rất phù hợp' : score >= 65 ? 'Phù hợp' : 'Tạm được');

export const IntelligenceRadar: React.FC<IntelligenceRadarProps> = ({
  incidents,
  currentUserRole,
  onApproveRescue,
  conflictError,
  onClearConflict,
}) => {
  const open = incidents.filter((i) => i.status === 'OPEN_REPLANNING');
  const handled = incidents.filter((i) => i.status !== 'OPEN_REPLANNING');
  const canChoose = currentUserRole === 'COORDINATOR' || currentUserRole === 'PLATFORM_ADMIN';

  return (
    <div className="space-y-8">
      {conflictError && (
        <div role="alert" className="rounded-3xl border-2 border-red-400 bg-red-50 p-5 shadow-md">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xl font-bold text-red-900">⚠️ Trùng lịch: máy hoặc thợ lái đã có việc trong giờ này</p>
              <p className="mt-1 text-base text-red-800">Máy gặt hoặc thợ lái này đã có việc khác trong giờ đó. Bạn chọn giờ hoặc máy khác nhé.</p>
            </div>
            <button type="button" onClick={onClearConflict} className="shrink-0 rounded-xl px-3 py-1.5 text-base font-bold text-red-900 underline hover:bg-red-100">Đóng</button>
          </div>
        </div>
      )}

      {open.length === 0 && (
        <section className="rounded-3xl border-2 border-emerald-300 bg-emerald-50 p-10 text-center shadow-sm">
          <div className="text-6xl" aria-hidden="true">✅</div>
          <h2 className="mt-3 text-2xl font-bold text-emerald-900">Mọi việc đều ổn</h2>
          <p className="mt-1 text-lg text-emerald-800">Hiện không có máy nào bị hỏng cần tìm máy thay.</p>
        </section>
      )}

      {open.map((inc) => {
        const sev = severity(inc.severity);
        const options = inc.candidate_options || [];
        return (
          <section key={inc.incident_id} aria-label={`Sự cố máy ${inc.machine_id}`} className="space-y-5">
            <div className="rounded-3xl border-2 border-red-400 bg-gradient-to-br from-red-50 to-amber-50 p-6 shadow-lg">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-4">
                  <span className="text-5xl" aria-hidden="true">🚨</span>
                  <div>
                    <h2 className="text-2xl font-bold text-red-900">Máy {inc.machine_id} bị hỏng giữa vụ</h2>
                    <p className="mt-1 text-lg text-slate-800">{incidentType(inc.incident_type)} · dự kiến nghỉ khoảng <strong>{inc.estimated_downtime_hours} giờ</strong></p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <StatusBadge label={{ text: `Mức độ: ${sev.text}`, tone: sev.tone, icon: '' }} />
                  <StatusBadge label={incidentStatus(inc.status)} />
                </div>
              </div>
              {inc.description && <p className="mt-4 rounded-2xl bg-white/80 p-4 text-lg italic text-slate-800">“{inc.description}”</p>}
            </div>

            <h3 className="text-xl font-bold text-slate-900">🔎 Máy được gợi ý để thay thế <span className="text-base font-semibold text-slate-500">({options.length} máy phù hợp)</span></h3>

            {options.length === 0 ? (
              <p className="rounded-3xl border-2 border-dashed border-slate-300 bg-white p-8 text-center text-lg text-slate-700">
                <strong>Chưa có máy thay thế phù hợp.</strong><br />Không có máy nào rảnh và đủ công suất trong khung giờ này.
              </p>
            ) : (
              <ul className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                {options.map((opt, idx) => {
                  const top = idx === 0;
                  const pct = Math.max(0, Math.min(100, opt.score));
                  return (
                    <li key={opt.option_id} className={`relative rounded-3xl border-2 bg-white p-5 shadow-md ${top ? 'border-emerald-500 ring-4 ring-emerald-100' : 'border-slate-200'}`}>
                      {top && <span className="absolute -top-3 left-5 rounded-full bg-emerald-700 px-4 py-1 text-base font-bold text-white shadow">⭐ Gợi ý tốt nhất</span>}
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h4 className="text-xl font-bold text-slate-900">{opt.machine_name}</h4>
                          <p className="text-base text-slate-600">Thợ lái: <strong>{opt.operator_name}</strong></p>
                        </div>
                        <div className="text-right">
                          <div className="text-3xl font-bold text-emerald-800">{opt.score.toFixed(0)}<span className="text-lg font-semibold text-slate-500">/100</span></div>
                          <div className="text-sm font-semibold text-emerald-800">{fitWords(opt.score)}</div>
                        </div>
                      </div>
                      <div className="mt-3 h-3 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Độ phù hợp">
                        <div className="h-3 rounded-full bg-emerald-600" style={{ width: `${pct}%` }} />
                      </div>
                      <dl className="mt-4 grid grid-cols-2 gap-3 text-base">
                        <div className="rounded-2xl bg-slate-50 p-3"><dt className="text-sm text-slate-600">Cách ruộng (đường chim bay)</dt><dd className="text-lg font-bold text-slate-900">{opt.distance_km} km</dd></div>
                        <div className="rounded-2xl bg-slate-50 p-3"><dt className="text-sm text-slate-600">Giờ làm việc</dt><dd className="text-lg font-bold text-slate-900">{formatLocalTime(opt.start_time)} – {formatLocalTime(opt.end_time)}</dd></div>
                      </dl>
                      {opt.explanation && <p className="mt-3 text-base italic text-slate-700">“{opt.explanation}”</p>}
                      {canChoose ? (
                        <button
                          type="button"
                          onClick={() => onApproveRescue?.(inc.incident_id, opt.option_id)}
                          className={`mt-5 min-h-14 w-full rounded-2xl px-6 py-3 text-lg font-bold shadow-md transition focus:outline-none focus-visible:ring-4 focus-visible:ring-emerald-300 ${top ? 'bg-emerald-700 text-white hover:bg-emerald-600' : 'border-2 border-emerald-700 bg-white text-emerald-800 hover:bg-emerald-50'}`}
                        >
                          ✅ Chọn máy này đi thay
                        </button>
                      ) : (
                        <p className="mt-5 rounded-2xl bg-slate-100 p-3 text-center text-base text-slate-700">Điều phối viên HTX sẽ chọn máy thay thế.</p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}

      {handled.length > 0 && (
        <section aria-label="Sự cố đã xử lý">
          <h3 className="mb-3 text-xl font-bold text-slate-900">📁 Đã xử lý <span className="text-base font-semibold text-slate-500">({handled.length})</span></h3>
          <ul className="space-y-3">
            {handled.map((inc) => (
              <li key={inc.incident_id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4">
                <div>
                  <p className="text-lg font-bold text-slate-900">Máy {inc.machine_id}: {incidentType(inc.incident_type)}</p>
                  {inc.selected_option && <p className="text-base text-slate-600">Đã chọn máy <strong>{inc.selected_option.machine_name}</strong> thay thế</p>}
                </div>
                <StatusBadge label={incidentStatus(inc.status)} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};
