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
import { isActiveDispatchOrder, isActiveIncident, isTeamAvailable, isVehicleAvailable, reportDepthCm, reportPeopleAffected, selectAvailableResources, validateRejectionReason } from '../../utils/workflowRules';
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
  mapElement?: React.ReactNode;
  onVerifyReport: (reportId: string, priority: FloodPriority, notes?: string, decision?: 'VERIFIED' | 'REJECTED') => Promise<void>;
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


const getReportLocationText = (report: FloodReport, zoneList: FloodZone[]): string => {
  if (report.address_hint) return report.address_hint;
  const matchedZone = zoneList.find((z) => z.zone_id === report.zone_id);
  if (matchedZone) return matchedZone.name;
  const lat = report.latitude ?? report.lat;
  const lng = report.longitude ?? report.lng;
  if (lat && lng) return `Vùng trũng [${lat.toFixed(4)}, ${lng.toFixed(4)}]`;
  return 'Chưa có dữ liệu vị trí';
};

export const DispatcherWorkspace: React.FC<DispatcherWorkspaceProps> = ({
  reports,
  orders,
  teams,
  vehicles,
  incidents,
  zones,
  mapElement,
  onVerifyReport,
  onDispatchOrder,
  onApproveReplan,
  onSelectReport,
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('UNVERIFIED');

  // Verify modal state
  const [verifyingReport, setVerifyingReport] = useState<FloodReport | null>(null);
  const [verifyDecision, setVerifyDecision] = useState<'VERIFIED' | 'REJECTED'>('VERIFIED');
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
  const activeOrders = orders.filter((o) => isActiveDispatchOrder(o.status));
  const activeIncidents = incidents.filter((i) => isActiveIncident(i.status));
  const busyVehicleIds = new Set(activeOrders.map((o) => o.vehicle_id));
  const busyTeamIds = new Set(activeOrders.map((o) => o.team_id));

  const openVerify = (report: FloodReport) => {
    setVerifyingReport(report);
    setVerifyDecision('VERIFIED');
    setVerifyPriority(report.priority === 'CRITICAL' ? 'URGENT' : report.priority);
    setVerifyNotes(`Đã liên lạc xác minh: điểm ngập ${report.address_hint || report.report_id || 'Hà Nội'}.`);
    setVerifyError(null);
  };

  const handleVerifySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!verifyingReport) return;
    const rejectionError = verifyDecision === 'REJECTED' ? validateRejectionReason(verifyNotes) : null;
    if (rejectionError) {
      setVerifyError(rejectionError);
      return;
    }
    setIsVerifying(true);
    setVerifyError(null);
    try {
      await onVerifyReport(verifyingReport.report_id, verifyPriority, verifyNotes.trim(), verifyDecision);
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
    const { vehicleId, teamId } = selectAvailableResources(
      vehicles,
      teams,
      busyVehicleIds,
      busyTeamIds,
    );
    setSelectedVehicleId(vehicleId || '');
    setSelectedTeamId(teamId || '');
    setTargetTime(new Date(Date.now() + 45 * 60000).toISOString().slice(0, 16));
    setDispatchNotes(`Lệnh điều phối ứng cứu: ${report.address_hint || report.report_id}`);
  };

  const handleDispatchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const selectedTeam = teams.find((team) => team.team_id === selectedTeamId);
    const selectedVehicle = vehicles.find((vehicle) => vehicle.vehicle_id === selectedVehicleId);
    if (!dispatchReport || !selectedTeam || !selectedVehicle ||
        !isTeamAvailable(selectedTeam, busyTeamIds) || !isVehicleAvailable(selectedVehicle, busyVehicleIds)) {
      setDispatchError('Đội hoặc phương tiện không còn sẵn sàng. Hãy chọn lại nguồn lực đang khả dụng.');
      return;
    }
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
    <div className="space-y-4">
      {/* Main Cockpit Split Layout (Queue on Left, Tactical Map on Right) */}
      <div className={mapElement ? "grid grid-cols-1 xl:grid-cols-[480px_minmax(0,1fr)] gap-4 items-start" : "space-y-4"}>
        <div className="space-y-3 min-w-0">
          {/* Tabs Bar */}
          <div className="flex items-center gap-1.5 border-b border-slate-800 overflow-x-auto pb-2">
            <button
              onClick={() => setActiveTab('UNVERIFIED')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all shrink-0 whitespace-nowrap border ${
                activeTab === 'UNVERIFIED'
                  ? 'bg-rose-600 text-white border-rose-500 shadow-lg shadow-rose-950/60'
                  : 'bg-slate-900 text-slate-400 border-slate-800 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5 text-rose-300" />
              Chờ thẩm định ({unverifiedReports.length})
            </button>

            <button
              onClick={() => setActiveTab('READY_DISPATCH')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all shrink-0 whitespace-nowrap border ${
                activeTab === 'READY_DISPATCH'
                  ? 'bg-amber-600 text-white border-amber-500 shadow-lg shadow-amber-950/60'
                  : 'bg-slate-900 text-slate-400 border-slate-800 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              <Truck className="w-3.5 h-3.5 text-amber-300" />
              Cần điều phối ({readyDispatchReports.length})
            </button>

            <button
              onClick={() => setActiveTab('ACTIVE_ORDERS')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all shrink-0 whitespace-nowrap border ${
                activeTab === 'ACTIVE_ORDERS'
                  ? 'bg-cyan-600 text-white border-cyan-500 shadow-lg shadow-cyan-950/60'
                  : 'bg-slate-900 text-slate-400 border-slate-800 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              <Navigation className="w-3.5 h-3.5 text-cyan-300" />
              Ca đang cơ động ({activeOrders.length})
            </button>

            {activeIncidents.length > 0 && (
              <button
                onClick={() => setActiveTab('INCIDENTS')}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all shrink-0 whitespace-nowrap border ${
                  activeTab === 'INCIDENTS'
                    ? 'bg-purple-600 text-white border-purple-500 shadow-lg shadow-purple-950/60'
                    : 'bg-slate-900 text-purple-300 border-slate-800 hover:bg-slate-800'
                }`}
              >
                <ShieldAlert className="w-3.5 h-3.5 animate-pulse text-purple-400" />
                Sự cố &amp; Chi viện ({activeIncidents.length})
              </button>
            )}

            <button
              onClick={() => setActiveTab('ALL')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all shrink-0 whitespace-nowrap border ${
                activeTab === 'ALL'
                  ? 'bg-slate-800 text-white border-slate-700 shadow-lg'
                  : 'bg-slate-900 text-slate-400 border-slate-800 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              <Filter className="w-3.5 h-3.5 text-slate-400" />
              Tất cả ({reports.length})
            </button>
          </div>

      {/* Main Tab Content */}
      <div className={mapElement ? "max-h-[calc(100vh-230px)] overflow-y-auto pr-1 space-y-3" : "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"}>
        {/* TAB 1: UNVERIFIED */}
        {activeTab === 'UNVERIFIED' && (
          <div className="space-y-3">
            {unverifiedReports.length === 0 ? (
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center text-slate-400">
                <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-2" />
                <h3 className="font-bold text-white text-base">Không có tin báo chờ thẩm định</h3>
                <p className="text-xs text-slate-400 mt-1">
                  Mọi tin báo khẩn cấp từ người dân đã được thẩm định và phân loại ưu tiên.
                </p>
              </div>
            ) : (
              <div className={mapElement ? "space-y-3" : "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3"}>
                {unverifiedReports.map((report) => (
                  <div
                    key={report.report_id}
                    className="bg-slate-900 rounded-2xl border border-slate-800 p-4 shadow-xl hover:border-slate-700 transition flex flex-col justify-between text-slate-100"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <span className="font-mono text-xs font-bold text-slate-400">#{report.report_id}</span>
                        <div className="flex items-center gap-1.5">
                          <StatusBadge status={report.status} type="report" />
                          <span className="text-[11px] px-2 py-0.5 rounded-full font-bold bg-rose-950 text-rose-300 border border-rose-800/80">
                            {priorityLabel(report.priority).text}
                          </span>
                        </div>
                      </div>

                      <h4 className="font-bold text-white text-sm mb-2 flex items-center gap-1.5">
                        <MapPin className="w-4 h-4 text-rose-400 shrink-0" />
                        <span className="leading-snug">{getReportLocationText(report, zones)}</span>
                      </h4>

                      <div className="grid grid-cols-2 gap-2 text-xs mb-3 bg-slate-950 p-2.5 rounded-xl border border-slate-800 text-slate-300">
                        <div>
                          <span className="text-slate-400 text-[10px] block uppercase">Nhu cầu cứu trợ:</span>
                          <span className="font-semibold text-slate-200">{needType(report.need_type).text}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 text-[10px] block uppercase">Độ ngập ước tính:</span>
                          <span className="font-bold text-rose-400 font-mono">{reportDepthCm(report)} cm</span>
                        </div>
                        <div>
                          <span className="text-slate-400 text-[10px] block uppercase">Người cần cứu:</span>
                          <span className="font-semibold text-slate-200">{reportPeopleAffected(report)} người</span>
                        </div>
                        <div>
                          <span className="text-slate-400 text-[10px] block uppercase">Thời gian gửi:</span>
                          <span className="font-semibold text-slate-300 font-mono">
                            {new Date(report.created_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </div>

                      {report.notes && (
                        <p className="text-xs text-amber-200 italic bg-amber-950/40 border-l-2 border-amber-500 p-2 rounded mb-3">
                          &ldquo;{report.notes}&rdquo;
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 pt-2 border-t border-slate-800">
                      {onSelectReport && (
                        <button
                          type="button"
                          onClick={() => onSelectReport(report)}
                          className="flex-1 py-1.5 px-3 text-xs font-semibold rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
                        >
                          Xem bản đồ
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => openVerify(report)}
                        className="flex-1 py-1.5 px-3 text-xs font-bold rounded-xl bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-950 flex items-center justify-center gap-1.5 transition"
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
          <div className="space-y-3">
            {readyDispatchReports.length === 0 ? (
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center text-slate-400">
                <Truck className="w-10 h-10 text-slate-500 mx-auto mb-2" />
                <h3 className="font-bold text-white text-base">Không có tin báo chờ điều phối</h3>
                <p className="text-xs text-slate-400 mt-1">
                  Tất cả các tin đã thẩm định đều đã được cấp lệnh điều động.
                </p>
              </div>
            ) : (
              <div className={mapElement ? "space-y-3" : "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3"}>
                {readyDispatchReports.map((report) => (
                  <div
                    key={report.report_id}
                    className="bg-slate-900 rounded-2xl border border-slate-800 p-4 shadow-xl hover:border-slate-700 transition flex flex-col justify-between text-slate-100"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <span className="font-mono text-xs font-bold text-slate-400">#{report.report_id}</span>
                        <div className="flex items-center gap-1.5">
                          <StatusBadge status={report.status} type="report" />
                          <span className="text-[11px] px-2 py-0.5 rounded-full font-bold bg-amber-950 text-amber-300 border border-amber-800/80">
                            {priorityLabel(report.priority).text}
                          </span>
                        </div>
                      </div>

                      <h4 className="font-bold text-white text-sm mb-2 flex items-center gap-1.5">
                        <MapPin className="w-4 h-4 text-amber-400 shrink-0" />
                        <span className="leading-snug">{getReportLocationText(report, zones)}</span>
                      </h4>

                      <div className="grid grid-cols-2 gap-2 text-xs mb-3 bg-slate-950 p-2.5 rounded-xl border border-slate-800 text-slate-300">
                        <div>
                          <span className="text-slate-400 text-[10px] block uppercase">Nhu cầu:</span>
                          <span className="font-semibold text-slate-200">{needType(report.need_type).text}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 text-[10px] block uppercase">Độ sâu:</span>
                          <span className="font-bold text-amber-400 font-mono">{reportDepthCm(report)} cm</span>
                        </div>
                        <div>
                          <span className="text-slate-400 text-[10px] block uppercase">Sơ tán:</span>
                          <span className="font-semibold text-slate-200">{reportPeopleAffected(report)} người</span>
                        </div>
                        <div>
                          <span className="text-slate-400 text-[10px] block uppercase">Người báo:</span>
                          <span className="font-semibold text-slate-300">{report.reporter_name || report.reporter_phone}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 pt-2 border-t border-slate-800">
                      {onSelectReport && (
                        <button
                          type="button"
                          onClick={() => onSelectReport(report)}
                          className="flex-1 py-1.5 px-3 text-xs font-semibold rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
                        >
                          Vị trí
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => openDispatch(report)}
                        className="flex-1 py-1.5 px-3 text-xs font-bold rounded-xl bg-amber-600 hover:bg-amber-500 text-white shadow-lg shadow-amber-950 flex items-center justify-center gap-1.5 transition"
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
          <div className="space-y-3">
            {activeOrders.length === 0 ? (
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center text-slate-400">
                <Navigation className="w-10 h-10 text-slate-500 mx-auto mb-2" />
                <h3 className="font-bold text-white text-base">Không có ca điều phối nào đang hoạt động</h3>
                <p className="text-xs text-slate-400 mt-1">
                  Hiện các đội và phương tiện đang ở trạng thái trực sẵn sàng tại căn cứ.
                </p>
              </div>
            ) : (
              <div className={mapElement ? "space-y-3" : "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3"}>
                {activeOrders.map((order) => {
                  const targetReport = reports.find((r) => r.report_id === order.report_id);
                  const assignedVehicle = vehicles.find((v) => v.vehicle_id === order.vehicle_id);
                  const assignedTeam = teams.find((t) => t.team_id === order.team_id);

                  return (
                    <div
                      key={order.order_id}
                      className="bg-slate-900 rounded-2xl border border-slate-800 p-4 shadow-xl hover:border-slate-700 transition flex flex-col justify-between text-slate-100"
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <span className="font-mono text-xs font-bold text-slate-400">#{order.order_id}</span>
                          <StatusBadge status={order.status} type="order" />
                        </div>

                        <h4 className="font-bold text-white text-sm mb-2 flex items-center gap-1.5">
                          <Navigation className="w-4 h-4 text-cyan-400 shrink-0" />
                          <span className="leading-snug">Mục tiêu: {targetReport ? getReportLocationText(targetReport, zones) : `Tin báo #${order.report_id}`}</span>
                        </h4>

                        <div className="space-y-1.5 text-xs mb-3 bg-slate-950 p-2.5 rounded-xl border border-slate-800 text-slate-300">
                          <div className="flex justify-between items-center">
                            <span className="text-slate-400 flex items-center gap-1 text-[11px]">
                              <Truck className="w-3.5 h-3.5" /> Phương tiện:
                            </span>
                            <span className="font-bold text-cyan-300 font-mono">
                              {assignedVehicle ? `${assignedVehicle.name || assignedVehicle.vehicle_name} (${vehicleType(assignedVehicle.vehicle_type) || assignedVehicle.vehicle_type})` : order.vehicle_id}
                            </span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-slate-400 flex items-center gap-1 text-[11px]">
                              <Users className="w-3.5 h-3.5" /> Đội cứu hộ:
                            </span>
                            <span className="font-bold text-slate-200">
                              {assignedTeam ? `${assignedTeam.name || assignedTeam.team_name} (${assignedTeam.leader_name || "Đội trưởng"})` : order.team_id}
                            </span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-slate-400 flex items-center gap-1 text-[11px]">
                              <Clock className="w-3.5 h-3.5" /> Xuất phát:
                            </span>
                            <span className="font-semibold text-slate-300 font-mono">
                              {new Date(order.dispatched_at || order.created_at).toLocaleTimeString('vi-VN')}
                            </span>
                          </div>
                        </div>

                        {order.notes && (
                          <p className="text-xs text-slate-300 bg-slate-950 p-2 rounded border border-slate-800 mb-2">
                            <span className="font-semibold text-cyan-400">Chỉ đạo:</span> {order.notes}
                          </p>
                        )}
                      </div>

                      <div className="text-[11px] text-slate-400 flex items-center justify-between pt-2 border-t border-slate-800">
                        <span>Cập nhật: {new Date(order.updated_at || order.created_at).toLocaleTimeString('vi-VN')}</span>
                        {targetReport && onSelectReport && (
                          <button
                            type="button"
                            onClick={() => onSelectReport(targetReport)}
                            className="text-cyan-400 hover:text-cyan-300 hover:underline font-semibold"
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
                  className="bg-slate-900 rounded-2xl border border-purple-900/60 p-6 shadow-xl text-slate-100"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-purple-900/40 pb-3 mb-4">
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

                  <h3 className="text-lg font-bold text-white mb-1">
                    {incident.description}
                  </h3>
                  <p className="text-xs text-slate-400 mb-4">
                    Phương tiện gặp sự cố: <strong className="text-rose-600">{brokenVehicle?.vehicle_name || incident.vehicle_id}</strong> • Vị trí: [{(incident.location?.lat ?? 20.9660).toFixed(4)}, {(incident.location?.lng ?? 105.8710).toFixed(4)}]
                  </p>

                  {/* Replan Candidates if available */}
                  {incident.replan_candidates && incident.replan_candidates.length > 0 && (
                    <div className="space-y-3 mb-5">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-purple-300 flex items-center gap-1.5">
                        <Waves className="w-4 h-4 text-purple-600" />
                        Các phương án chi viện do thuật toán xếp hạng:
                      </h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {incident.replan_candidates.map((cand) => (
                          <div
                            key={cand.option_id}
                            className={`p-4 rounded-xl border-2 transition-all ${
                              cand.rank === 1
                                ? 'border-purple-500/80 bg-purple-950/40 text-purple-200 shadow-sm'
                                : 'border-slate-800 bg-slate-950 text-slate-300'
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

                  <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
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
                className="bg-slate-900 rounded-2xl border border-slate-800 p-4 shadow-xl hover:border-slate-700 transition-all text-slate-100"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <span className="font-mono text-xs text-slate-400">#{report.report_id}</span>
                  <div className="flex items-center gap-1.5">
                    <StatusBadge status={report.status} type="report" />
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                      {priorityLabel(report.priority).text}
                    </span>
                  </div>
                </div>
                <h4 className="font-bold text-white text-sm mb-1 flex items-center gap-1.5">
                  {getReportLocationText(report, zones)}
                </h4>
                <div className="text-xs text-slate-400 flex items-center gap-3 mb-2">
                  <span>Nhu cầu: <strong>{needType(report.need_type).text}</strong></span>
                  <span>Độ ngập: <strong className="text-rose-600">{reportDepthCm(report)} cm</strong></span>
                </div>
                <div className="flex items-center justify-between text-xs text-slate-400 pt-2 border-t border-slate-800">
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
        </div>

        {/* Right Column: Embedded Tactical Map */}
        {mapElement && (
          <div className="sticky top-20 min-w-0">
            {mapElement}
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
              <div><strong>Địa bàn:</strong> {getReportLocationText(verifyingReport, zones)}</div>
              <div><strong>Nhu cầu:</strong> {needType(verifyingReport.need_type).text} • <strong>Độ ngập:</strong> {reportDepthCm(verifyingReport)} cm</div>
              <div><strong>Người báo:</strong> {verifyingReport.reporter_name} ({verifyingReport.reporter_phone})</div>
            </div>

            <div>
              <label className={LABEL_STYLE}>Quyết định thẩm định</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setVerifyDecision('VERIFIED')}
                  className={`py-2.5 px-3 rounded-xl border text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                    verifyDecision === 'VERIFIED'
                      ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                      : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  <CheckCircle2 className="w-4 h-4" />
                  Xác minh hợp lệ
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setVerifyDecision('REJECTED');
                    setVerifyNotes('');
                  }}
                  className={`py-2.5 px-3 rounded-xl border text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                    verifyDecision === 'REJECTED'
                      ? 'bg-rose-600 text-white border-rose-600 shadow-sm'
                      : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  <AlertTriangle className="w-4 h-4" />
                  Từ chối / Tin giả
                </button>
              </div>
            </div>

            {verifyDecision === 'VERIFIED' ? (
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
            ) : null}

            <div>
              <label className={LABEL_STYLE}>
                {verifyDecision === 'VERIFIED' ? 'Ghi chú thẩm định & Chỉ đạo' : 'Lý do từ chối tin báo (Bắt buộc)'}
              </label>
              <textarea
                rows={3}
                value={verifyNotes}
                onChange={(e) => setVerifyNotes(e.target.value)}
                placeholder={
                  verifyDecision === 'VERIFIED'
                    ? 'Ghi chú xác thực qua điện thoại, phương tiện tiếp cận thích hợp...'
                    : 'Ghi rõ lý do từ chối (ví dụ: Tin trùng lặp, ngoài khu vực quản lý, đã liên hệ người báo tin báo nhầm)...'
                }
                className={INPUT_STYLE}
                required={verifyDecision === 'REJECTED'}
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
              <div><strong>Điểm đến:</strong> {getReportLocationText(dispatchReport, zones)}</div>
              <div><strong>Ưu tiên:</strong> {priorityLabel(dispatchReport.priority).text} • <strong>Nhu cầu:</strong> {needType(dispatchReport.need_type).text}</div>
            </div>

            <div>
              <label htmlFor="dispatch-team" className={LABEL_STYLE}>Đội xung kích cứu hộ</label>
              <select
                id="dispatch-team"
                value={selectedTeamId}
                onChange={(e) => setSelectedTeamId(e.target.value)}
                className={INPUT_STYLE}
                required
              >
                <option value="">Chọn đội đang sẵn sàng</option>
                {teams.map((t) => (
                  <option key={t.team_id} value={t.team_id} disabled={!isTeamAvailable(t, busyTeamIds)}>
                    {t.name || t.team_name} - {t.leader_name || "Đội trưởng"} ({t.status}) [{t.specialty || "Cứu nạn"}]
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="dispatch-vehicle" className={LABEL_STYLE}>Phương tiện phân bổ</label>
              <select
                id="dispatch-vehicle"
                value={selectedVehicleId}
                onChange={(e) => setSelectedVehicleId(e.target.value)}
                className={INPUT_STYLE}
                required
              >
                <option value="">Chọn phương tiện khả dụng</option>
                {vehicles.map((v) => (
                  <option key={v.vehicle_id} value={v.vehicle_id} disabled={!isVehicleAvailable(v, busyVehicleIds)}>
                    {v.name || v.vehicle_name} ({vehicleType(v.vehicle_type) || v.vehicle_type}) - Trạng thái: {v.status} - Nhiên liệu: {v.fuel_pct ?? v.fuel_percent ?? 0}%
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
                disabled={isDispatching || !selectedVehicleId || !selectedTeamId}
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
