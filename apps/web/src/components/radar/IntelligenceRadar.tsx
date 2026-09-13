// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import React from 'react';
import { FieldIncident, MachineIncident, UserRole } from '../../types';
import { formatLocalTime } from '../../utils/dateTime';
import { incidentStatus, incidentType, severity } from '../../utils/labels';
import { StatusBadge } from '../common/StatusBadge';
import { ShieldAlert, CheckCircle2, Waves, Compass, AlertTriangle, Truck } from 'lucide-react';

interface IntelligenceRadarProps {
  incidents: (FieldIncident | MachineIncident | any)[];
  currentUserRole: UserRole;
  onApproveRescue?: (incidentId: string, optionId: string) => void;
  conflictError?: { code: string; message: string; details?: any } | null;
  onClearConflict?: () => void;
}

const fitWords = (score: number): string => (score >= 85 ? 'Tối ưu vượt trội' : score >= 65 ? 'Phù hợp' : 'Khả thi');

export const IntelligenceRadar: React.FC<IntelligenceRadarProps> = ({
  incidents,
  currentUserRole,
  onApproveRescue,
  conflictError,
  onClearConflict,
}) => {
  const open = incidents.filter((i) => i.status === 'OPEN_REPLANNING' || i.status === 'REPORTED' || i.status === 'IN_PROGRESS');
  const handled = incidents.filter((i) => i.status === 'RESOLVED' || i.status === 'SUPERSEDED');
  const canChoose = currentUserRole === 'DISPATCHER' || currentUserRole === 'COORDINATOR' || currentUserRole === 'PLATFORM_ADMIN';

  return (
    <div className="space-y-6">
      {conflictError && (
        <div role="alert" className="rounded-2xl border-2 border-rose-400 bg-rose-50 p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-base font-bold text-rose-900 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-rose-600" />
                Xung đột lịch điều động (409 Conflict): Phương tiện hoặc đội cứu hộ đã có ca trong khung giờ này
              </p>
              <p className="mt-1 text-xs text-rose-800">
                Phương tiện hoặc đội này đã được phân bổ cho một ca cứu hộ khẩn cấp khác. Vui lòng chọn phương án hoặc phương tiện dự phòng khác.
              </p>
            </div>
            <button
              type="button"
              onClick={onClearConflict}
              className="shrink-0 rounded-xl px-3 py-1.5 text-xs font-bold text-rose-900 underline hover:bg-rose-100"
            >
              Đóng
            </button>
          </div>
        </div>
      )}

      {open.length === 0 && (
        <section className="rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-8 text-center shadow-sm">
          <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto mb-2" />
          <h2 className="text-lg font-bold text-emerald-950">Mọi phương tiện và đội xung kích hoạt động an toàn</h2>
          <p className="mt-1 text-xs text-emerald-800">
            Hiện không có phương tiện nào gặp sự cố chân vịt hoặc động cơ cần chi viện khẩn cấp.
          </p>
        </section>
      )}

      {open.map((inc) => {
        const vehicleId = inc.vehicle_id || inc.machine_id;
        const options = inc.candidate_options || inc.replan_candidates || [];
        const isCritical = inc.severity === 'CRITICAL';

        return (
          <section key={inc.incident_id} aria-label={`Sự cố phương tiện ${vehicleId}`} className="space-y-4">
            <div className="rounded-2xl border-2 border-rose-300 bg-gradient-to-br from-rose-50 to-amber-50 p-5 shadow-md">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="p-3 bg-rose-600 text-white rounded-xl shadow">
                    <ShieldAlert className="w-6 h-6 animate-pulse" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-rose-950">
                      Phương tiện {vehicleId} gặp sự cố kỹ thuật hiện trường
                    </h2>
                    <p className="mt-0.5 text-xs text-slate-700">
                      {incidentType(inc.incident_type) || inc.incident_type} • Dự kiến xử lý: <strong>{inc.estimated_downtime_hours || 4} giờ</strong>
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className={`text-xs px-2.5 py-1 rounded-full font-bold ${isCritical ? 'bg-rose-600 text-white' : 'bg-amber-100 text-amber-800'}`}>
                    {inc.severity}
                  </span>
                  <span className="text-xs px-2.5 py-1 rounded-full font-bold bg-slate-100 text-slate-800">
                    {inc.status}
                  </span>
                </div>
              </div>
              {inc.description && (
                <p className="mt-3 rounded-xl bg-white/90 p-3 text-xs italic text-slate-800 border border-slate-200">
                  &ldquo;{inc.description}&rdquo;
                </p>
              )}
            </div>

            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800 flex items-center gap-2">
              <Waves className="w-4 h-4 text-blue-600" />
              Phương án chi viện được thuật toán xếp hạng ({options.length} phương tiện khả thi)
            </h3>

            {options.length === 0 ? (
              <p className="rounded-2xl border-2 border-dashed border-slate-300 bg-white p-6 text-center text-xs text-slate-600">
                <strong>Chưa tìm thấy phương tiện thay thế phù hợp.</strong>
                <br />Toàn bộ phương tiện dự phòng đang trong ca trực hoặc ngoài bán kính tiếp cận an toàn.
              </p>
            ) : (
              <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {options.map((opt: any, idx: number) => {
                  const top = idx === 0 || opt.rank === 1;
                  const scoreVal = opt.score > 1 ? opt.score : opt.score * 100;
                  const pct = Math.max(0, Math.min(100, scoreVal));
                  const optVehicleId = opt.replacement_vehicle_id || opt.vehicle_id || opt.machine_id;
                  const optVehicleName = opt.vehicle_name || opt.machine_name || `Xuồng chi viện ${optVehicleId}`;

                  return (
                    <li
                      key={opt.option_id}
                      className={`relative rounded-2xl border-2 bg-white p-5 shadow-sm flex flex-col justify-between ${
                        top ? 'border-indigo-500 ring-2 ring-indigo-100' : 'border-slate-200'
                      }`}
                    >
                      {top && (
                        <span className="absolute -top-3 left-4 rounded-full bg-indigo-700 px-3 py-0.5 text-xs font-bold text-white shadow">
                          ⭐ Phương Án Tối Ưu Nhất
                        </span>
                      )}

                      <div>
                        <div className="flex items-start justify-between gap-3 mb-2">
                          <div>
                            <h4 className="text-base font-bold text-slate-900 flex items-center gap-1.5">
                              <Truck className="w-4 h-4 text-indigo-600" />
                              {optVehicleName}
                            </h4>
                            <p className="text-xs text-slate-500">Mã phương tiện: <strong>{optVehicleId}</strong></p>
                          </div>
                          <div className="text-right">
                            <div className="text-xl font-black text-indigo-900">
                              {scoreVal.toFixed(0)}<span className="text-xs font-semibold text-slate-500">/100</span>
                            </div>
                            <div className="text-[11px] font-bold text-indigo-700">{fitWords(scoreVal)}</div>
                          </div>
                        </div>

                        {/* Progress */}
                        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar">
                          <div className="h-2 rounded-full bg-indigo-600 transition-all" style={{ width: `${pct}%` }} />
                        </div>

                        <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                          <div className="rounded-xl bg-slate-50 p-2.5 border border-slate-100">
                            <dt className="text-[11px] text-slate-500">Khoảng cách (đường chim bay)</dt>
                            <dd className="text-sm font-bold text-slate-900">{opt.distance_km} km</dd>
                          </div>
                          <div className="rounded-xl bg-slate-50 p-2.5 border border-slate-100">
                            <dt className="text-[11px] text-slate-500">Ước tính tiếp cận (ETA)</dt>
                            <dd className="text-sm font-bold text-slate-900">{opt.eta_minutes || Math.round(opt.distance_km * 4)} phút</dd>
                          </div>
                        </dl>

                        {(opt.explanation || opt.reason) && (
                          <p className="mt-2 text-xs italic text-slate-600 bg-indigo-50/50 p-2 rounded-lg border border-indigo-100">
                            &ldquo;{opt.explanation || opt.reason}&rdquo;
                          </p>
                        )}
                      </div>

                      <div className="mt-4 pt-3 border-t border-slate-100">
                        {canChoose ? (
                          <button
                            type="button"
                            onClick={() => onApproveRescue?.(inc.incident_id, opt.option_id)}
                            className={`w-full py-2.5 px-4 rounded-xl text-xs font-bold shadow-sm transition flex items-center justify-center gap-1.5 ${
                              top
                                ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
                                : 'border-2 border-indigo-600 bg-white text-indigo-700 hover:bg-indigo-50'
                            }`}
                          >
                            <CheckCircle2 className="w-4 h-4" />
                            Phê Duyệt Điều Động Phương Án Này
                          </button>
                        ) : (
                          <p className="text-center text-xs text-slate-500 italic">
                            Chỉ Điều phối viên (DISPATCHER) mới có quyền duyệt chi viện.
                          </p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}

      {handled.length > 0 && (
        <section aria-label="Sự cố đã xử lý" className="pt-2">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">
            📁 Lịch sử sự cố đã khắc phục &amp; chi viện ({handled.length})
          </h3>
          <ul className="space-y-2">
            {handled.map((inc) => (
              <li
                key={inc.incident_id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 text-xs"
              >
                <div>
                  <p className="font-bold text-slate-800">
                    Phương tiện {inc.vehicle_id || inc.machine_id}: {incidentType(inc.incident_type) || inc.incident_type}
                  </p>
                  <p className="text-slate-500 text-[11px]">Mã sự cố: #{inc.incident_id}</p>
                </div>
                <span className="px-2 py-0.5 rounded-full font-bold bg-emerald-100 text-emerald-800">
                  ĐÃ GIẢI QUYẾT
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};
