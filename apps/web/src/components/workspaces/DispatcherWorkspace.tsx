// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import React, { useState } from 'react';
import {
  FloodReport,
  DispatchOrder,
  RescueTeam,
  RescueVehicle,
  FieldIncident,
  FloodZone,
  FloodPriority,
} from '../../types';
import {
  reportStatus,
  orderStatus,
  needType,
  priority as priorityLabel,
  vehicleType,
} from '../../utils/labels';
import { Modal } from '../common/Modal';
import { StatusBadge } from '../common/StatusBadge';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Filter,
  MapPin,
  Navigation,
  Radio,
  Send,
  ShieldAlert,
  Truck,
  Users,
  Waves,
} from 'lucide-react';

interface DispatcherWorkspaceProps {
  reports: FloodReport[];
  orders: DispatchOrder[];
  teams: RescueTeam[];
  vehicles: RescueVehicle[];
  incidents: FieldIncident[];
  zones: FloodZone[];
  onVerifyReport: (reportId: string, priority: FloodPriority, notes?: string) => Promise<void>;
  onDispatchOrder: (data: {
    report_id: string;
    team_id: string;
    vehicle_id: string;
    target_time?: string;
    notes?: string;
  }) => Promise<void>;
  onApproveReplan?: (incidentId: string, optionId: string, reason?: string) => Promise<void>;
  onSelectReport?: (report: FloodReport) => void;
}

type TabType = 'ALL' | 'UNVERIFIED' | 'READY_DISPATCH' | 'ACTIVE_ORDERS' | 'INCIDENTS';

const INPUT_STYLE = 'w-full rounded-xl border-2 border-slate-300 bg-white p-3 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-4 focus:ring-amber-200 transition-all';
const LABEL_STYLE = 'mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-700';

export const DispatcherWorkspace: React.FC<DispatcherWorkspaceProps> = ({
  reports,
  orders,
  teams,
  vehicles,
  incidents,
  zones,
  onVerifyReport,
  onDispatchOrder,
  onApproveReplan,
  onSelectReport,
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('UNVERIFIED');

  // Verify modal state
  const [verifyingReport, setVerifyingReport] = useState<FloodReport | null>(null);
  const [verifyPriority, setVerifyPriority] = useState<FloodPriority>('URGENT');
  const [verifyNotes, setVerifyNotes] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  // Dispatch modal state
  const [dispatchReport, setDispatchReport] = useState<FloodReport | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [selectedVehicleId, setSelectedVehicleId] = useState('');
  const [targetTime, setTargetTime] = useState('');
  const [dispatchNotes, setDispatchNotes] = useState('');
  const [isDispatching, setIsDispatching] = useState(false);
  const [dispatchError, setDispatchError] = useState<string | null>(null);

  // Replan approval state
  const [approvingIncident, setApprovingIncident] = useState<FieldIncident | null>(null);
  const [chosenOptionId, setChosenOptionId] = useState('');
  const [replanReason, setReplanReason] = useState('');
  const [isApprovingReplan, setIsApprovingReplan] = useState(false);
  const [replanError, setReplanError] = useState<string | null>(null);

  const unverifiedReports = reports.filter((r) => r.status === 'RECEIVED');
  const readyDispatchReports = reports.filter((r) => r.status === 'VERIFIED');
  const activeOrders = orders.filter((o) => ['DISPATCHED', 'EN_ROUTE', 'ON_SCENE'].includes(o.status));
  const activeIncidents = incidents.filter((i) => i.status === 'REPORTED' || i.status === 'IN_PROGRESS');

  const openVerify = (report: FloodReport) => {
    setVerifyingReport(report);
    setVerifyPriority(report.priority === 'CRITICAL' ? 'URGENT' : report.priority);
    setVerifyNotes(`Đã liên lạc xác minh: điểm ngập ${report.address_hint || 'Hà Nội'}.`);
    setVerifyError(null);
  };

  const handleVerifySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!verifyingReport) return;
    setIsVerifying(true);
    setVerifyError(null);
    try {
      await onVerifyReport(verifyingReport.report_id, verifyPriority, verifyNotes);
      setVerifyingReport(null);
    } catch (err: unknown) {
      setVerifyError(err instanceof Error ? err.message : 'Xác minh thất bại. Vui lòng thử lại.');
    } finally {
      setIsVerifying(false);
    }
  };

  const openDispatch = (report: FloodReport) => {
    setDispatchReport(report);
    setDispatchError(null);
    // Find available vehicle and team
    const busyVehicleIds = new Set(
      orders
        .filter((o) => ['DISPATCHED', 'EN_ROUTE', 'ON_SCENE'].includes(o.status))
        .map((o) => o.vehicle_id)
    );
    const availVehicle = vehicles.find((v) => v.status === 'AVAILABLE' && !busyVehicleIds.has(v.vehicle_id)) || vehicles[0];
    const availTeam = teams.find((t) => t.status === 'READY') || teams[0];
    setSelectedVehicleId(availVehicle?.vehicle_id || '');
    setSelectedTeamId(availTeam?.team_id || '');
    setTargetTime(new Date(Date.now() + 45 * 60000).toISOString().slice(0, 16));
    setDispatchNotes(`Lệnh điều phối ứng cứu: ${report.address_hint || report.report_id}`);
  };

  const handleDispatchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dispatchReport) return;
    setIsDispatching(true);
    setDispatchError(null);
    try {
      await onDispatchOrder({
        report_id: dispatchReport.report_id,
        team_id: selectedTeamId,
        vehicle_id: selectedVehicleId,
        target_time: targetTime ? new Date(targetTime).toISOString() : undefined,
        notes: dispatchNotes,
      });
      setDispatchReport(null);
    } catch (err: unknown) {
      // Catch 409 conflict or other server error and keep form open for correction
      setDispatchError(
        err instanceof Error
          ? err.message
          : 'Lỗi xung đột điều phối (409 Conflict): Phương tiện hoặc đội đã có lịch trong khung giờ này. Vui lòng chọn tài nguyên khác.'
      );
    } finally {
      setIsDispatching(false);
    }
  };

  const openReplan = (incident: FieldIncident) => {
    setApprovingIncident(incident);
    setReplanError(null);
    const firstOpt = incident.replan_candidates?.[0]?.option_id || '';
    setChosenOptionId(firstOpt);
    setReplanReason('Phê duyệt phương án ứng cứu có điểm tin cậy và thời gian tiếp cận tối ưu.');
  };

  const handleReplanSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!approvingIncident || !onApproveReplan) return;
    setIsApprovingReplan(true);
    setReplanError(null);
    try {
      await onApproveReplan(approvingIncident.incident_id, chosenOptionId, replanReason);
      setApprovingIncident(null);
    } catch (err: unknown) {
      setReplanError(err instanceof Error ? err.message : 'Phê duyệt chi viện thất bại.');
    } finally {
      setIsApprovingReplan(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & Quick Counters */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gradient-to-r from-slate-900 to-indigo-950 p-5 rounded-2xl border border-slate-800 text-white shadow-xl">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-amber-500/20 rounded-xl text-amber-400 border border-amber-500/30">
            <Radio className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-tight">Trung Tâm Điều Phối Ứng Cứu</h2>
            <p className="text-xs text-slate-400">
              Tiếp nhận tin khẩn cấp • Thẩm định mức ưu tiên • Điều động đội xung kích &amp; phương tiện
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
          <div className="px-3 py-1.5 bg-rose-500/20 border border-rose-500/40 rounded-xl flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-rose-400" />
            <span className="text-xs text-rose-300 font-semibold">{unverifiedReports.length} chờ thẩm định</span>
          </div>
          <div className="px-3 py-1.5 bg-amber-500/20 border border-amber-500/40 rounded-xl flex items-center gap-2">
            <Truck className="w-4 h-4 text-amber-400" />
            <span className="text-xs text-amber-300 font-semibold">{readyDispatchReports.length} sẵn sàng điều</span>
          </div>
          <div className="px-3 py-1.5 bg-blue-500/20 border border-blue-500/40 rounded-xl flex items-center gap-2">
            <Navigation className="w-4 h-4 text-blue-400" />
            <span className="text-xs text-blue-300 font-semibold">{activeOrders.length} ca hiện trường</span>
          </div>
        </div>
      </div>

      {/* Tabs Bar */}
      <div className="flex items-center gap-2 border-b border-slate-200 overflow-x-auto pb-2">
        <button
          onClick={() => setActiveTab('UNVERIFIED')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all shrink-0 ${
            activeTab === 'UNVERIFIED'
              ? 'bg-rose-600 text-white shadow-md'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <AlertTriangle className="w-4 h-4" />
          Chờ thẩm định ({unverifiedReports.length})
        </button>

        <button
          onClick={() => setActiveTab('READY_DISPATCH')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all shrink-0 ${
            activeTab === 'READY_DISPATCH'
              ? 'bg-amber-600 text-white shadow-md'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Truck className="w-4 h-4" />
          Cần điều phối ({readyDispatchReports.length})
        </button>

        <button
          onClick={() => setActiveTab('ACTIVE_ORDERS')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all shrink-0 ${
            activeTab === 'ACTIVE_ORDERS'
              ? 'bg-blue-600 text-white shadow-md'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Navigation className="w-4 h-4" />
          Ca đang chạy ({activeOrders.length})
        </button>

        {activeIncidents.length > 0 && (
          <button
            onClick={() => setActiveTab('INCIDENTS')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all shrink-0 ${
              activeTab === 'INCIDENTS'
                ? 'bg-purple-600 text-white shadow-md'
                : 'text-purple-600 hover:bg-purple-50'
            }`}
          >
            <ShieldAlert className="w-4 h-4 animate-bounce" />
            Sự cố &amp; Chi viện ({activeIncidents.length})
          </button>
        )}

        <button
          onClick={() => setActiveTab('ALL')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all shrink-0 ${
            activeTab === 'ALL'
              ? 'bg-slate-800 text-white shadow-md'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Filter className="w-4 h-4" />
          Tất cả tin báo ({reports.length})
        </button>
      </div>

      {/* Main Tab Content */}
      <div className="grid grid-cols-1 gap-4">
        {/* TAB 1: UNVERIFIED */}
        {activeTab === 'UNVERIFIED' && (
          <div>
            {unverifiedReports.length === 0 ? (
              <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-8 text-center text-emerald-800">
                <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
                <h3 className="font-bold text-lg">Không có tin báo chờ thẩm định</h3>
                <p className="text-sm text-emerald-600 mt-1">
                  Mọi tin báo khẩn cấp từ người dân đã được thẩm định và phân loại ưu tiên.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {unverifiedReports.map((report) => (
                  <div
                    key={report.report_id}
                    className="bg-white rounded-2xl border-2 border-rose-200 p-5 shadow-sm hover:shadow-md transition-all flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <span className="font-mono text-xs font-bold text-slate-500">#{report.report_id}</span>
                        <div className="flex items-center gap-1.5">
                          <StatusBadge status={report.status} type="report" />
                          <span className="text-xs px-2 py-0.5 rounded-full font-bold bg-rose-100 text-rose-700">
                            {priorityLabel[report.priority] || report.priority}
                          </span>
                        </div>
                      </div>

                      <h4 className="font-bold text-slate-900 text-base mb-2 flex items-center gap-2">
                        <MapPin className="w-4 h-4 text-rose-500 shrink-0" />
                        {report.address_hint || `Khu vực toạ độ [${(report.latitude ?? report.lat ?? 0).toFixed(4)}, ${(report.longitude ?? report.lng ?? 0).toFixed(4)}]`}
                      </h4>

                      <div className="grid grid-cols-2 gap-2 text-xs text-slate-600 mb-4 bg-slate-50 p-3 rounded-xl border border-slate-100">
                        <div>
                          <span className="text-slate-400 block">Nhu cầu cứu trợ:</span>
                          <span className="font-semibold text-slate-800">{needType[report.need_type] || report.need_type}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block">Độ ngập ước tính:</span>
                          <span className="font-semibold text-rose-600">{report.flood_depth_cm} cm</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block">Người cần sơ tán:</span>
                          <span className="font-semibold text-slate-800">{report.people_count || 1} người</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block">Thời gian gửi:</span>
                          <span className="font-semibold text-slate-800">
                            {new Date(report.created_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </div>

                      {report.notes && (
                        <p className="text-xs text-slate-600 italic bg-amber-50 border-l-4 border-amber-400 p-2 rounded mb-4">
                          &ldquo;{report.notes}&rdquo;
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 pt-3 border-t border-slate-100">
                      {onSelectReport && (
                        <button
                          type="button"
                          onClick={() => onSelectReport(report)}
                          className="flex-1 py-2 px-3 text-xs font-semibold rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700"
                        >
                          Xem bản đồ
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => openVerify(report)}
                        className="flex-1 py-2 px-3 text-xs font-bold rounded-xl bg-rose-600 hover:bg-rose-700 text-white shadow flex items-center justify-center gap-1.5"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Thẩm định ngay
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: READY FOR DISPATCH */}
        {activeTab === 'READY_DISPATCH' && (
          <div>
            {readyDispatchReports.length === 0 ? (
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-8 text-center text-slate-600">
                <Truck className="w-12 h-12 text-slate-400 mx-auto mb-3" />
                <h3 className="font-bold text-lg">Không có tin báo chờ điều phối</h3>
                <p className="text-sm text-slate-500 mt-1">
                  Tất cả các tin đã thẩm định đều đã được cấp lệnh điều động.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {readyDispatchReports.map((report) => (
                  <div
                    key={report.report_id}
                    className="bg-white rounded-2xl border-2 border-amber-200 p-5 shadow-sm hover:shadow-md transition-all flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <span className="font-mono text-xs font-bold text-slate-500">#{report.report_id}</span>
                        <div className="flex items-center gap-1.5">
                          <StatusBadge status={report.status} type="report" />
                          <span className="text-xs px-2 py-0.5 rounded-full font-bold bg-amber-100 text-amber-800">
                            {priorityLabel[report.priority] || report.priority}
                          </span>
                        </div>
                      </div>

                      <h4 className="font-bold text-slate-900 text-base mb-2 flex items-center gap-2">
                        <MapPin className="w-4 h-4 text-amber-500 shrink-0" />
                        {report.address_hint || `Khu vực [${(report.latitude ?? report.lat ?? 0).toFixed(4)}, ${(report.longitude ?? report.lng ?? 0).toFixed(4)}]`}
                      </h4>

                      <div className="grid grid-cols-2 gap-2 text-xs text-slate-600 mb-4 bg-amber-50/50 p-3 rounded-xl border border-amber-100">
                        <div>
                          <span className="text-slate-400 block">Nhu cầu:</span>
                          <span className="font-semibold text-slate-800">{needType[report.need_type] || report.need_type}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block">Độ sâu:</span>
                          <span className="font-semibold text-amber-700">{report.flood_depth_cm} cm</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block">Sơ tán:</span>
                          <span className="font-semibold text-slate-800">{report.people_count || 1} người</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block">Người báo:</span>
                          <span className="font-semibold text-slate-800">{report.reporter_name || report.reporter_phone}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 pt-3 border-t border-slate-100">
                      {onSelectReport && (
                        <button
                          type="button"
                          onClick={() => onSelectReport(report)}
                          className="flex-1 py-2 px-3 text-xs font-semibold rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700"
                        >
                          Vị trí
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => openDispatch(report)}
                        className="flex-1 py-2 px-3 text-xs font-bold rounded-xl bg-amber-600 hover:bg-amber-700 text-white shadow flex items-center justify-center gap-1.5"
                      >
                        <Send className="w-3.5 h-3.5" />
                        Xuất lệnh điều phối
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: ACTIVE ORDERS */}
        {activeTab === 'ACTIVE_ORDERS' && (
          <div>
            {activeOrders.length === 0 ? (
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-8 text-center text-slate-600">
                <Navigation className="w-12 h-12 text-slate-400 mx-auto mb-3" />
                <h3 className="font-bold text-lg">Không có ca điều phối nào đang hoạt động</h3>
                <p className="text-sm text-slate-500 mt-1">
                  Hiện các đội và phương tiện đang ở trạng thái trực sẵn sàng tại căn cứ.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {activeOrders.map((order) => {
                  const targetReport = reports.find((r) => r.report_id === order.report_id);
                  const assignedVehicle = vehicles.find((v) => v.vehicle_id === order.vehicle_id);
                  const assignedTeam = teams.find((t) => t.team_id === order.team_id);

                  return (
                    <div
                      key={order.order_id}
                      className="bg-white rounded-2xl border-2 border-blue-200 p-5 shadow-sm flex flex-col justify-between"
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2 mb-3">
                          <span className="font-mono text-xs font-bold text-slate-500">#{order.order_id}</span>
                          <StatusBadge status={order.status} type="order" />
                        </div>

                        <h4 className="font-bold text-slate-900 text-base mb-2 flex items-center gap-2">
                          <Navigation className="w-4 h-4 text-blue-500 shrink-0" />
                          Mục tiêu: {targetReport?.address_hint || `Tin báo #${order.report_id}`}
                        </h4>

                        <div className="space-y-2 text-xs text-slate-700 mb-4 bg-blue-50/50 p-3 rounded-xl border border-blue-100">
                          <div className="flex justify-between items-center">
                            <span className="text-slate-500 flex items-center gap-1">
                              <Truck className="w-3.5 h-3.5" /> Phương tiện:
                            </span>
                            <span className="font-bold text-blue-900">
                              {assignedVehicle ? `${assignedVehicle.vehicle_name} (${vehicleType[assignedVehicle.vehicle_type] || assignedVehicle.vehicle_type})` : order.vehicle_id}
                            </span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-slate-500 flex items-center gap-1">
                              <Users className="w-3.5 h-3.5" /> Đội cứu hộ:
                            </span>
                            <span className="font-bold text-slate-800">
                              {assignedTeam ? `${assignedTeam.team_name} (Đội trưởng ${assignedTeam.leader_name})` : order.team_id}
                            </span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-slate-500 flex items-center gap-1">
                              <Clock className="w-3.5 h-3.5" /> Xuất phát:
                            </span>
                            <span className="font-semibold text-slate-700">
                              {new Date(order.dispatched_at || order.created_at).toLocaleTimeString('vi-VN')}
                            </span>
                          </div>
                        </div>

                        {order.notes && (
                          <p className="text-xs text-slate-600 bg-slate-50 p-2.5 rounded-lg border border-slate-200 mb-3">
                            <span className="font-semibold text-slate-700">Chỉ đạo:</span> {order.notes}
                          </p>
                        )}
                      </div>

                      <div className="text-xs text-slate-400 flex items-center justify-between pt-2 border-t border-slate-100">
                        <span>Cập nhật gần nhất: {new Date(order.updated_at || order.created_at).toLocaleTimeString('vi-VN')}</span>
                        {targetReport && onSelectReport && (
                          <button
                            type="button"
                            onClick={() => onSelectReport(targetReport)}
                            className="text-blue-600 hover:underline font-semibold"
                          >
                            Định vị trên bản đồ →
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 4: INCIDENTS & REPLAN */}
        {activeTab === 'INCIDENTS' && (
          <div className="space-y-4">
            {activeIncidents.map((incident) => {
              const brokenVehicle = vehicles.find((v) => v.vehicle_id === incident.vehicle_id);

              return (
                <div
                  key={incident.incident_id}
                  className="bg-white rounded-2xl border-2 border-purple-300 p-6 shadow-md"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-purple-100 pb-3 mb-4">
                    <div className="flex items-center gap-2">
                      <span className="px-3 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-700 uppercase">
                        SỰ CỐ HIỆN TRƯỜNG
                      </span>
                      <span className="font-mono text-xs text-slate-500">#{incident.incident_id}</span>
                    </div>
                    <span className="text-xs text-slate-500">
                      Ghi nhận: {new Date(incident.reported_at || incident.created_at).toLocaleTimeString('vi-VN')}
                    </span>
                  </div>

                  <h3 className="text-lg font-bold text-slate-900 mb-1">
                    {incident.description}
                  </h3>
                  <p className="text-xs text-slate-600 mb-4">
                    Phương tiện gặp sự cố: <strong className="text-rose-600">{brokenVehicle?.vehicle_name || incident.vehicle_id}</strong> • Vị trí: [{(incident.location?.lat ?? 20.9660).toFixed(4)}, {(incident.location?.lng ?? 105.8710).toFixed(4)}]
                  </p>

                  {/* Replan Candidates if available */}
                  {incident.replan_candidates && incident.replan_candidates.length > 0 && (
                    <div className="space-y-3 mb-5">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-purple-900 flex items-center gap-1.5">
                        <Waves className="w-4 h-4 text-purple-600" />
                        Các phương án chi viện do thuật toán xếp hạng:
                      </h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {incident.replan_candidates.map((cand) => (
                          <div
                            key={cand.option_id}
                            className={`p-4 rounded-xl border-2 transition-all ${
                              cand.rank === 1
                                ? 'border-purple-500 bg-purple-50/60 shadow-sm'
                                : 'border-slate-200 bg-slate-50'
                            }`}
                          >
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-xs font-bold px-2 py-0.5 rounded bg-purple-200 text-purple-800">
                                Ưu tiên #{cand.rank}
                              </span>
                              <span className="text-xs font-semibold text-slate-600">
                                Điểm tin cậy: {(cand.score * 100).toFixed(0)}%
                              </span>
                            </div>
                            <div className="text-sm font-bold text-slate-800 mb-1">
                              Thay thế bằng: {cand.replacement_vehicle_id}
                            </div>
                            <div className="text-xs text-slate-600 mb-2">
                              Khoảng cách: {cand.distance_km} km (đường chim bay) • Ước tính: {cand.eta_minutes} phút
                            </div>
                            <p className="text-xs text-slate-500 italic">
                              Lý do: {cand.reason}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() => openReplan(incident)}
                      className="px-4 py-2 text-xs font-bold rounded-xl bg-purple-600 hover:bg-purple-700 text-white shadow-md flex items-center gap-2"
                    >
                      <ShieldAlert className="w-4 h-4" />
                      Phê duyệt phương án chi viện
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* TAB 5: ALL REPORTS */}
        {activeTab === 'ALL' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {reports.map((report) => (
              <div
                key={report.report_id}
                className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm hover:border-slate-300 transition-all"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <span className="font-mono text-xs text-slate-400">#{report.report_id}</span>
                  <div className="flex items-center gap-1.5">
                    <StatusBadge status={report.status} type="report" />
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                      {priorityLabel[report.priority] || report.priority}
                    </span>
                  </div>
                </div>
                <h4 className="font-semibold text-slate-800 text-sm mb-1">
                  {report.address_hint || `Khu vực [${(report.latitude ?? report.lat ?? 0).toFixed(4)}, ${(report.longitude ?? report.lng ?? 0).toFixed(4)}]`}
                </h4>
                <div className="text-xs text-slate-500 flex items-center gap-3 mb-2">
                  <span>Nhu cầu: <strong>{needType[report.need_type] || report.need_type}</strong></span>
                  <span>Độ ngập: <strong className="text-rose-600">{report.flood_depth_cm} cm</strong></span>
                </div>
                <div className="flex items-center justify-between text-xs text-slate-400 pt-2 border-t border-slate-100">
                  <span>{new Date(report.created_at).toLocaleTimeString('vi-VN')}</span>
                  {onSelectReport && (
                    <button
                      type="button"
                      onClick={() => onSelectReport(report)}
                      className="text-amber-600 hover:underline font-semibold"
                    >
                      Định vị →
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* MODAL 1: VERIFY REPORT */}
      {verifyingReport && (
        <Modal
          isOpen={true}
          onClose={() => setVerifyingReport(null)}
          title={`Thẩm Định Tin Báo #${verifyingReport.report_id}`}
        >
          <form onSubmit={handleVerifySubmit} className="space-y-4">
            {verifyError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs">
                {verifyError}
              </div>
            )}

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-1">
              <div><strong>Địa bàn:</strong> {verifyingReport.address_hint || 'Hà Nội'}</div>
              <div><strong>Nhu cầu:</strong> {needType[verifyingReport.need_type] || verifyingReport.need_type} • <strong>Độ ngập:</strong> {verifyingReport.flood_depth_cm} cm</div>
              <div><strong>Người báo:</strong> {verifyingReport.reporter_name} ({verifyingReport.reporter_phone})</div>
            </div>

            <div>
              <label className={LABEL_STYLE}>Mức độ ưu tiên thẩm định</label>
              <select
                value={verifyPriority}
                onChange={(e) => setVerifyPriority(e.target.value as FloodPriority)}
                className={INPUT_STYLE}
              >
                <option value="CRITICAL">🔴 CỰC KỲ KHẨN CẤP (Nguy hiểm tính mạng ngay lập tức)</option>
                <option value="URGENT">🟠 KHẨN CẤP (Nước dâng nhanh, có người già/trẻ em)</option>
                <option value="HIGH">🟡 CAO (Cần sơ tán trong 1-2 giờ tới)</option>
                <option value="NORMAL">🟢 BÌNH THƯỜNG (Cung cấp lương thực/phao cứu hộ)</option>
                <option value="LOW">⚪ THẤP (Theo dõi thêm)</option>
              </select>
            </div>

            <div>
              <label className={LABEL_STYLE}>Ghi chú thẩm định &amp; Chỉ đạo</label>
              <textarea
                rows={3}
                value={verifyNotes}
                onChange={(e) => setVerifyNotes(e.target.value)}
                placeholder="Ghi chú xác thực qua điện thoại, phương tiện tiếp cận thích hợp..."
                className={INPUT_STYLE}
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-3">
              <button
                type="button"
                onClick={() => setVerifyingReport(null)}
                className="px-4 py-2.5 text-xs font-semibold rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={isVerifying}
                className="px-5 py-2.5 text-xs font-bold rounded-xl bg-rose-600 hover:bg-rose-700 text-white shadow flex items-center gap-2 disabled:opacity-50"
              >
                {isVerifying ? 'Đang xử lý...' : 'Xác nhận Thẩm định'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* MODAL 2: DISPATCH ORDER */}
      {dispatchReport && (
        <Modal
          isOpen={true}
          onClose={() => setDispatchReport(null)}
          title={`Lệnh Điều Phối Ứng Cứu #${dispatchReport.report_id}`}
        >
          <form onSubmit={handleDispatchSubmit} className="space-y-4">
            {dispatchError && (
              <div className="p-3 bg-rose-50 border-2 border-rose-300 rounded-xl text-rose-800 text-xs font-medium">
                {dispatchError}
              </div>
            )}

            <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-xs space-y-1">
              <div><strong>Điểm đến:</strong> {dispatchReport.address_hint || 'Hà Nội'}</div>
              <div><strong>Ưu tiên:</strong> {priorityLabel[dispatchReport.priority]} • <strong>Nhu cầu:</strong> {needType[dispatchReport.need_type]}</div>
            </div>

            <div>
              <label className={LABEL_STYLE}>Đội xung kích cứu hộ</label>
              <select
                value={selectedTeamId}
                onChange={(e) => setSelectedTeamId(e.target.value)}
                className={INPUT_STYLE}
                required
              >
                {teams.map((t) => (
                  <option key={t.team_id} value={t.team_id}>
                    {t.team_name} - {t.leader_name} ({t.status}) [{t.specialty}]
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={LABEL_STYLE}>Phương tiện phân bổ</label>
              <select
                value={selectedVehicleId}
                onChange={(e) => setSelectedVehicleId(e.target.value)}
                className={INPUT_STYLE}
                required
              >
                {vehicles.map((v) => (
                  <option key={v.vehicle_id} value={v.vehicle_id}>
                    {v.vehicle_name} ({vehicleType[v.vehicle_type] || v.vehicle_type}) - Trạng thái: {v.status} - Nhiên liệu: {v.fuel_percent}%
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={LABEL_STYLE}>Thời gian mục tiêu đến hiện trường</label>
              <input
                type="datetime-local"
                value={targetTime}
                onChange={(e) => setTargetTime(e.target.value)}
                className={INPUT_STYLE}
              />
            </div>

            <div>
              <label className={LABEL_STYLE}>Mệnh lệnh tác chiến</label>
              <textarea
                rows={2}
                value={dispatchNotes}
                onChange={(e) => setDispatchNotes(e.target.value)}
                className={INPUT_STYLE}
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-3">
              <button
                type="button"
                onClick={() => setDispatchReport(null)}
                className="px-4 py-2.5 text-xs font-semibold rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={isDispatching}
                className="px-5 py-2.5 text-xs font-bold rounded-xl bg-amber-600 hover:bg-amber-700 text-white shadow flex items-center gap-2 disabled:opacity-50"
              >
                {isDispatching ? 'Đang điều phối...' : 'Phát Lệnh Tác Chiến'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* MODAL 3: APPROVE REPLAN */}
      {approvingIncident && (
        <Modal
          isOpen={true}
          onClose={() => setApprovingIncident(null)}
          title={`Phê Duyệt Chi Viện #${approvingIncident.incident_id}`}
        >
          <form onSubmit={handleReplanSubmit} className="space-y-4">
            {replanError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs">
                {replanError}
              </div>
            )}

            <div className="p-3 bg-purple-50 rounded-xl border border-purple-200 text-xs">
              <p className="font-semibold text-purple-900 mb-1">{approvingIncident.description}</p>
              <p className="text-purple-700">Phương tiện hỏng: {approvingIncident.vehicle_id}</p>
            </div>

            <div>
              <label className={LABEL_STYLE}>Chọn phương án thay thế tối ưu</label>
              <div className="space-y-2">
                {approvingIncident.replan_candidates?.map((cand) => (
                  <label
                    key={cand.option_id}
                    className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                      chosenOptionId === cand.option_id
                        ? 'border-purple-600 bg-purple-50'
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="replanOption"
                      value={cand.option_id}
                      checked={chosenOptionId === cand.option_id}
                      onChange={() => setChosenOptionId(cand.option_id)}
                      className="mt-1"
                    />
                    <div className="text-xs">
                      <div className="font-bold text-slate-900">
                        Phương án {cand.rank}: Xe {cand.replacement_vehicle_id} (ETA: {cand.eta_minutes} phút, {cand.distance_km} km)
                      </div>
                      <div className="text-slate-600 mt-0.5">{cand.reason}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className={LABEL_STYLE}>Lý do phê duyệt của điều phối viên</label>
              <textarea
                rows={2}
                value={replanReason}
                onChange={(e) => setReplanReason(e.target.value)}
                className={INPUT_STYLE}
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-3">
              <button
                type="button"
                onClick={() => setApprovingIncident(null)}
                className="px-4 py-2.5 text-xs font-semibold rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={isApprovingReplan || !chosenOptionId}
                className="px-5 py-2.5 text-xs font-bold rounded-xl bg-purple-600 hover:bg-purple-700 text-white shadow flex items-center gap-2 disabled:opacity-50"
              >
                {isApprovingReplan ? 'Đang duyệt...' : 'Phê Duyệt Điều Phối Lại'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};
