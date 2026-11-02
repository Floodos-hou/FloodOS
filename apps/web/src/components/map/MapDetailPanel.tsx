// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import React, { useState } from 'react';
import type { FloodReport, RescueVehicle, FloodZone, SafeShelter, GaugeStation, DispatchOrder, UserRole } from '../../types';
import { needType, reportStatus, vehicleStatus, vehicleType, zoneRisk, gaugeAlert, shelterStatus, priority, roleLabel, formatLocalDateTime } from '../../utils/labels';
import { X, AlertTriangle, ShieldCheck, Ship, Waves, Home, MapPin, CheckCircle2, Clock, User, Phone, FileText, Send } from 'lucide-react';

export type MapSelection =
  | { type: 'report'; data: FloodReport }
  | { type: 'vehicle'; data: RescueVehicle }
  | { type: 'zone'; data: FloodZone }
  | { type: 'shelter'; data: SafeShelter }
  | { type: 'gauge'; data: GaugeStation };

interface MapDetailPanelProps {
  selection: MapSelection | null;
  onClose: () => void;
  currentUserRole: UserRole;
  orders: DispatchOrder[];
  onOpenVerifyModal?: (report: FloodReport) => void;
  onOpenDispatchModal?: (report: FloodReport) => void;
  onStartOrder?: (orderId: string) => Promise<void>;
  onUpdateOrderProgress?: (orderId: string, pct: number) => Promise<void>;
  onOpenIncidentModal?: (vehicle: RescueVehicle) => void;
  onConfirmResolution?: (report: FloodReport) => Promise<void>;
}

export const MapDetailPanel: React.FC<MapDetailPanelProps> = ({
  selection,
  onClose,
  currentUserRole,
  orders,
  onOpenVerifyModal,
  onOpenDispatchModal,
  onStartOrder,
  onUpdateOrderProgress,
  onOpenIncidentModal,
  onConfirmResolution,
}) => {
  if (!selection) return null;

  return (
    <div className="flex h-full flex-col rounded-3xl border border-slate-200 bg-white shadow-xl overflow-hidden animate-in fade-in slide-in-from-right duration-200">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-900 px-5 py-4 text-white">
        <div className="flex items-center gap-2.5">
          {selection.type === 'report' && <AlertTriangle className="h-5 w-5 text-amber-400" />}
          {selection.type === 'vehicle' && <Ship className="h-5 w-5 text-cyan-400" />}
          {selection.type === 'zone' && <Waves className="h-5 w-5 text-sky-400" />}
          {selection.type === 'shelter' && <Home className="h-5 w-5 text-emerald-400" />}
          {selection.type === 'gauge' && <Waves className="h-5 w-5 text-blue-400" />}
          <div className="font-bold text-base leading-tight">
            {selection.type === 'report' && `Tin báo ngập: ${selection.data.report_id}`}
            {selection.type === 'vehicle' && `Phương tiện: ${selection.data.name}`}
            {selection.type === 'zone' && `Vùng ngập: ${selection.data.name}`}
            {selection.type === 'shelter' && `Điểm trú: ${selection.data.name}`}
            {selection.type === 'gauge' && `Trạm đo: ${selection.data.name}`}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl p-1 text-slate-400 hover:bg-slate-800 hover:text-white transition"
          aria-label="Đóng bảng chi tiết"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Body content */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {selection.type === 'report' && (
          <ReportDetail
            report={selection.data}
            role={currentUserRole}
            orders={orders}
            onOpenVerifyModal={onOpenVerifyModal}
            onOpenDispatchModal={onOpenDispatchModal}
            onStartOrder={onStartOrder}
            onUpdateOrderProgress={onUpdateOrderProgress}
            onConfirmResolution={onConfirmResolution}
          />
        )}

        {selection.type === 'vehicle' && (
          <VehicleDetail
            vehicle={selection.data}
            role={currentUserRole}
            orders={orders}
            onOpenIncidentModal={onOpenIncidentModal}
          />
        )}

        {selection.type === 'zone' && <ZoneDetail zone={selection.data} />}
        {selection.type === 'shelter' && <ShelterDetail shelter={selection.data} />}
        {selection.type === 'gauge' && <GaugeDetail gauge={selection.data} />}
      </div>
    </div>
  );
};

// ----------------------------------------------------------------------------
// Report Detail View
// ----------------------------------------------------------------------------
const ReportDetail: React.FC<{
  report: FloodReport;
  role: UserRole;
  orders: DispatchOrder[];
  onOpenVerifyModal?: (r: FloodReport) => void;
  onOpenDispatchModal?: (r: FloodReport) => void;
  onStartOrder?: (orderId: string) => Promise<void>;
  onUpdateOrderProgress?: (orderId: string, pct: number) => Promise<void>;
  onConfirmResolution?: (r: FloodReport) => Promise<void>;
}> = ({
  report,
  role,
  orders,
  onOpenVerifyModal,
  onOpenDispatchModal,
  onStartOrder,
  onUpdateOrderProgress,
  onConfirmResolution,
}) => {
  const need = needType(report.need_type);
  const status = reportStatus(report.status);
  const prio = priority(report.priority);
  const order = orders.find((o) => o.report_id === report.report_id && o.status !== 'SUPERSEDED' && o.status !== 'CANCELLED');

  const isDispatcher = role === 'DISPATCHER' || role === 'PLATFORM_ADMIN';
  const isReporter = role === 'REPORTER';
  const isFieldTeam = role === 'FIELD_TEAM';

  return (
    <div className="space-y-4">
      {/* Priority & Status Badges */}
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1 text-xs font-bold ${
          report.priority === 'URGENT' ? 'bg-red-100 text-red-800 border border-red-200' : 'bg-slate-100 text-slate-800'
        }`}>
          {prio.icon} Mức ưu tiên: {prio.text}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-xl bg-sky-100 px-3 py-1 text-xs font-bold text-sky-800 border border-sky-200">
          {status.icon} {status.text}
        </span>
      </div>

      {/* Primary Metrics */}
      <div className="grid grid-cols-2 gap-3 rounded-2xl bg-slate-50 p-3.5 border border-slate-200">
        <div>
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Nhu cầu cứu hộ</span>
          <div className="mt-0.5 flex items-center gap-1.5 text-sm font-bold text-slate-900">
            <span>{need.icon}</span>
            <span>{need.text}</span>
          </div>
        </div>
        <div>
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Mực nước ngập</span>
          <div className="mt-0.5 text-sm font-bold text-cyan-800">
            {report.depth_cm} cm <span className="text-[10px] text-slate-500 font-normal">({report.depth_source || 'REPORTED'})</span>
          </div>
        </div>
        <div>
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Số người ảnh hưởng</span>
          <div className="mt-0.5 text-sm font-bold text-slate-900">
            {report.people_affected > 0 ? `${report.people_affected} người` : 'Chưa ghi nhận'}
          </div>
        </div>
        <div>
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Thời điểm gửi tin</span>
          <div className="mt-0.5 text-xs font-semibold text-slate-700">
            {new Date(report.created_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}
          </div>
        </div>
      </div>

      {/* Description */}
      <div>
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Mô tả hiện trường</span>
        <p className="mt-1 rounded-2xl bg-slate-50 p-3 text-sm text-slate-800 border border-slate-200 leading-relaxed italic">
          "{report.description || 'Không có mô tả chi tiết'}"
        </p>
      </div>

      {/* Verification Note if any */}
      {report.verification_note && (
        <div className="rounded-2xl bg-emerald-50 p-3 border border-emerald-200 text-xs text-emerald-900">
          <strong>Ghi chú xác minh của Ban chỉ huy:</strong> {report.verification_note}
        </div>
      )}

      {/* Attached Evidence Image if any */}
      {report.evidence_object_key && (
        <div className="space-y-1">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Ảnh minh chứng hiện trường</span>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600 flex items-center justify-between">
            <span className="truncate">{report.evidence_object_key}</span>
            <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
              <ShieldCheck className="h-3 w-3" /> Đã quét ClamAV
            </span>
          </div>
        </div>
      )}

      {/* Active Dispatch Order Status if any */}
      {order && (
        <div className="rounded-2xl border border-sky-200 bg-sky-50/70 p-3.5 space-y-2">
          <div className="flex items-center justify-between text-xs font-bold text-sky-900">
            <span>Lệnh điều động: {order.order_id}</span>
            <span className="rounded-md bg-sky-200/80 px-2 py-0.5 text-[10px]">{order.status}</span>
          </div>
          <div className="text-xs text-slate-700 space-y-0.5">
            <div>Phương tiện: <strong>{order.vehicle_name || order.vehicle_id}</strong></div>
            <div>Đội xung kích: <strong>{order.team_name || order.team_id}</strong></div>
            <div>Tiến độ xử lý: <strong>{Math.round(order.progress_pct)}%</strong></div>
          </div>
          {/* Progress Bar */}
          <div className="h-2 w-full rounded-full bg-slate-200 overflow-hidden">
            <div className="h-full bg-sky-600 transition-all duration-300" style={{ width: `${Math.min(100, Math.max(0, order.progress_pct))}%` }} />
          </div>
        </div>
      )}

      {/* Role-Specific Action Triggers */}
      <div className="pt-2 border-t border-slate-100 space-y-2">
        {/* Dispatcher Actions */}
        {isDispatcher && report.status === 'RECEIVED' && (
          <button
            type="button"
            onClick={() => onOpenVerifyModal?.(report)}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-sky-800 px-4 py-2.5 text-sm font-bold text-white hover:bg-sky-700 shadow transition"
          >
            <span>Xác minh & Đặt mức ưu tiên</span>
          </button>
        )}

        {isDispatcher && report.status === 'VERIFIED' && (
          <button
            type="button"
            onClick={() => onOpenDispatchModal?.(report)}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-600 shadow transition"
          >
            <span>Điều động Đội & Phương tiện ứng cứu</span>
          </button>
        )}

        {/* Field Team Actions */}
        {isFieldTeam && order && order.status === 'CONFIRMED' && (
          <button
            type="button"
            onClick={() => onStartOrder?.(order.order_id)}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-sky-800 px-4 py-2.5 text-sm font-bold text-white hover:bg-sky-700 shadow transition"
          >
            <span>▶ Bắt đầu triển khai nhiệm vụ</span>
          </button>
        )}

        {/* Reporter Actions */}
        {isReporter && report.status === 'RESOLVED' && (
          <button
            type="button"
            onClick={() => onConfirmResolution?.(report)}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-600 shadow transition"
          >
            <CheckCircle2 className="h-4 w-4" />
            <span>Xác nhận đã an toàn (Nghiệm thu)</span>
          </button>
        )}
      </div>
    </div>
  );
};

// ----------------------------------------------------------------------------
// Vehicle Detail View
// ----------------------------------------------------------------------------
const VehicleDetail: React.FC<{
  vehicle: RescueVehicle;
  role: UserRole;
  orders: DispatchOrder[];
  onOpenIncidentModal?: (v: RescueVehicle) => void;
}> = ({ vehicle, role, orders, onOpenIncidentModal }) => {
  const st = vehicleStatus(vehicle.status);
  const activeOrder = orders.find((o) => o.vehicle_id === vehicle.vehicle_id && o.status === 'IN_PROGRESS');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="rounded-xl bg-slate-100 px-3 py-1 text-xs font-bold text-slate-800">
          Loại: {vehicleType(vehicle.vehicle_type)}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-xl bg-sky-100 px-3 py-1 text-xs font-bold text-sky-800">
          {st.icon} {st.text}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 rounded-2xl bg-slate-50 p-3.5 border border-slate-200">
        <div>
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Công suất / Tải</span>
          <div className="mt-0.5 text-sm font-bold text-slate-900">
            {vehicle.capacity_value} {vehicle.capacity_unit}
          </div>
        </div>
        <div>
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Nhiên liệu còn lại</span>
          <div className="mt-0.5 text-sm font-bold text-slate-900">
            {vehicle.fuel_pct}%
          </div>
        </div>
        <div>
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Tình trạng kỹ thuật</span>
          <div className="mt-0.5 text-sm font-bold text-emerald-700">
            {vehicle.health_pct}%
          </div>
        </div>
        <div>
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Nguồn dữ liệu GPS</span>
          <div className="mt-0.5 text-xs font-semibold text-cyan-800">
            {vehicle.telemetry_source === 'DEVICE' ? 'Thiết bị thật' : 'Mô phỏng (Simulator)'}
          </div>
        </div>
      </div>

      {activeOrder && (
        <div className="rounded-2xl bg-sky-50 p-3 border border-sky-200 text-xs text-sky-900">
          Đang phục vụ lệnh điều động: <strong>{activeOrder.order_id}</strong>
        </div>
      )}

      {/* Report Incident button for Field Team */}
      {(role === 'FIELD_TEAM' || role === 'DISPATCHER') && vehicle.status !== 'BREAKDOWN' && (
        <button
          type="button"
          onClick={() => onOpenIncidentModal?.(vehicle)}
          className="w-full flex items-center justify-center gap-2 rounded-xl bg-red-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-red-600 shadow transition"
        >
          <AlertTriangle className="h-4 w-4" />
          <span>Báo sự cố phương tiện hỏng hóc</span>
        </button>
      )}
    </div>
  );
};

// ----------------------------------------------------------------------------
// Flood Zone Detail View
// ----------------------------------------------------------------------------
const ZoneDetail: React.FC<{ zone: FloodZone }> = ({ zone }) => {
  const rk = zoneRisk(zone.risk_level);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-500 uppercase">Mã vùng: {zone.zone_id}</span>
        <span className="inline-flex items-center gap-1.5 rounded-xl bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">
          {rk.icon} {rk.text}
        </span>
      </div>
      <div className="rounded-2xl bg-slate-50 p-3.5 border border-slate-200 space-y-2 text-xs">
        <div>Mực nước cảnh báo: <strong>{zone.water_level_cm || 0} cm</strong></div>
        <div>Nguồn dữ liệu: <strong>{zone.water_level_source || zone.data_origin || 'Mô phỏng'}</strong></div>
        <div>Tọa độ tâm: <strong>{zone.center_lat.toFixed(4)}, {zone.center_lng.toFixed(4)}</strong></div>
      </div>
    </div>
  );
};

// ----------------------------------------------------------------------------
// Shelter Detail View
// ----------------------------------------------------------------------------
const ShelterDetail: React.FC<{ shelter: SafeShelter }> = ({ shelter }) => {
  const st = shelterStatus(shelter.status);
  const remaining = Math.max(0, shelter.capacity - shelter.occupancy);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-500 uppercase">Điểm sơ tán an toàn</span>
        <span className="rounded-xl bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800">{st.text}</span>
      </div>
      <div className="grid grid-cols-2 gap-3 rounded-2xl bg-slate-50 p-3.5 border border-slate-200 text-xs">
        <div>Sức chứa tối đa: <strong>{shelter.capacity} người</strong></div>
        <div>Đang tạm trú: <strong>{shelter.occupancy} người</strong></div>
        <div>Số chỗ còn trống: <strong className="text-emerald-700">{remaining} chỗ</strong></div>
        <div>Nguồn số liệu: <strong>{shelter.occupancy_source}</strong></div>
      </div>
    </div>
  );
};

// ----------------------------------------------------------------------------
// Gauge Detail View
// ----------------------------------------------------------------------------
const GaugeDetail: React.FC<{ gauge: GaugeStation }> = ({ gauge }) => {
  const al = gaugeAlert(gauge.alert_state);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-500 uppercase">Trạm đo: {gauge.station_id}</span>
        <span className="rounded-xl bg-sky-100 px-3 py-1 text-xs font-bold text-sky-800">{al.text}</span>
      </div>
      <div className="grid grid-cols-2 gap-3 rounded-2xl bg-slate-50 p-3.5 border border-slate-200 text-xs">
        <div>Mực nước hiện tại: <strong className="text-cyan-800 text-sm">{gauge.level_cm ?? '--'} cm</strong></div>
        <div>Ngưỡng cảnh báo: <strong>{gauge.warn_level_cm} cm</strong></div>
        <div>Ngưỡng nguy hiểm: <strong className="text-red-700">{gauge.critical_level_cm} cm</strong></div>
        <div>Nguồn trạm: <strong>{gauge.source}</strong></div>
      </div>
    </div>
  );
};
