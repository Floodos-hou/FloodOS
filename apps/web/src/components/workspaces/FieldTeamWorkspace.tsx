// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import React, { useState } from 'react';
import {
  DispatchOrder,
  RescueTeam,
  RescueVehicle,
  FloodReport,
  FieldIncident,
  DispatchOrderStatus,
} from '../../types';
import {
  orderStatus,
  needType,
  vehicleType,
  incidentType,
} from '../../utils/labels';
import { Modal } from '../common/Modal';
import { StatusBadge } from '../common/StatusBadge';
import { isActiveDispatchOrder, reportDepthCm, reportPeopleAffected } from '../../utils/workflowRules';
import {
  AlertOctagon,
  Camera,
  CheckCircle2,
  Clock,
  Compass,
  Fuel,
  MapPin,
  Navigation,
  Radio,
  ShieldCheck,
  Truck,
  Users,
  Waves,
} from 'lucide-react';

interface FieldTeamWorkspaceProps {
  currentUserId: string;
  teams: RescueTeam[];
  vehicles: RescueVehicle[];
  orders: DispatchOrder[];
  reports: FloodReport[];
  incidents: FieldIncident[];
  onUpdateOrderStatus: (
    orderId: string,
    status: DispatchOrderStatus,
    payload?: {
      progress_pct?: number;
      note?: string;
      outcome?: 'RESOLVED' | 'PARTIAL' | 'UNRESOLVED' | string;
      final_depth_cm?: number;
      evidence_filename?: string;
      evidence_data_url?: string;
    } | string
  ) => Promise<void>;
  onReportIncident: (data: {
    order_id: string;
    vehicle_id: string;
    incident_type: string;
    severity: string;
    description: string;
    photo_bytes?: string;
  }) => Promise<void>;
  onSelectReport?: (report: FloodReport) => void;
}

const INPUT_STYLE = 'w-full rounded-xl border-2 border-slate-300 bg-white p-3 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-4 focus:ring-amber-200 transition-all';
const LABEL_STYLE = 'mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-700';

export const FieldTeamWorkspace: React.FC<FieldTeamWorkspaceProps> = ({
  currentUserId,
  teams,
  vehicles,
  orders,
  reports,
  incidents,
  onUpdateOrderStatus,
  onReportIncident,
  onSelectReport,
}) => {
  // Resolve team
  const myTeam =
    teams.find(
      (t) =>
        t.team_id.toLowerCase() === currentUserId.toLowerCase() ||
        (t.leader_name && t.leader_name.toLowerCase().includes(currentUserId.toLowerCase())) ||
        currentUserId.toLowerCase().includes(t.team_id.toLowerCase())
    ) || teams[0];

  // Team orders
  const teamOrders = orders.filter((o) => !myTeam || o.team_id === myTeam.team_id);
  const activeOrder =
    teamOrders.find((o) => isActiveDispatchOrder(o.status)) ||
    orders.find((o) => isActiveDispatchOrder(o.status));

  const targetReport = reports.find((r) => r.report_id === activeOrder?.report_id);
  const assignedVehicle = vehicles.find((v) => v.vehicle_id === activeOrder?.vehicle_id);

  // Status transition state
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  // Incident reporting modal state
  const [isIncidentModalOpen, setIsIncidentModalOpen] = useState(false);
  const [incType, setIncType] = useState('PROPELLER_FOULED');
  const [incSeverity, setIncSeverity] = useState('CRITICAL');
  const [incDesc, setIncDesc] = useState('Chân vịt xuồng cứu nạn mắc phải rác nổi và lưới rách; động cơ quá nhiệt.');
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [isReportingIncident, setIsReportingIncident] = useState(false);
  const [incidentError, setIncidentError] = useState<string | null>(null);

  // Complete modal state
  const [isCompleteModalOpen, setIsCompleteModalOpen] = useState(false);
  const [compOutcome, setCompOutcome] = useState<'RESOLVED' | 'PARTIAL' | 'UNRESOLVED'>('RESOLVED');
  const [compFinalDepth, setCompFinalDepth] = useState<number>(0);
  const [completionNotes, setCompletionNotes] = useState('Đã tiếp cận hiện trường, hỗ trợ đưa người dân đến điểm sơ tán an toàn.');
  const [isCompleting, setIsCompleting] = useState(false);

  // Field progress update state
  const [interimProgress, setInterimProgress] = useState<number>(50);
  const [interimNote, setInterimNote] = useState<string>('');

  // Advance status handler
  const handleAdvanceStatus = async (
    nextStatus: DispatchOrderStatus,
    payload?: { progress_pct?: number; note?: string } | string
  ) => {
    if (!activeOrder) return;
    setIsUpdatingStatus(true);
    setStatusError(null);
    try {
      await onUpdateOrderStatus(activeOrder.order_id, nextStatus, payload);
    } catch (err: unknown) {
      setStatusError(err instanceof Error ? err.message : 'Cập nhật trạng thái tác chiến thất bại.');
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        setPhotoPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleIncidentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrder) return;
    setIsReportingIncident(true);
    setIncidentError(null);
    try {
      await onReportIncident({
        order_id: activeOrder.order_id,
        vehicle_id: activeOrder.vehicle_id,
        incident_type: incType,
        severity: incSeverity,
        description: incDesc,
        photo_bytes: photoPreview || undefined,
      });
      setIsIncidentModalOpen(false);
    } catch (err: unknown) {
      setIncidentError(err instanceof Error ? err.message : 'Báo cáo sự cố thất bại.');
    } finally {
      setIsReportingIncident(false);
    }
  };

  const handleCompleteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrder) return;
    if (completionNotes.trim().length < 3) {
      setStatusError('Báo cáo hoàn tất yêu cầu ghi rõ kết quả (ít nhất 3 ký tự).');
      return;
    }
    setIsCompleting(true);
    try {
      await onUpdateOrderStatus(activeOrder.order_id, 'COMPLETED', {
        progress_pct: 100,
        outcome: compOutcome,
        final_depth_cm: compFinalDepth,
        note: completionNotes.trim(),
        evidence_data_url: photoPreview || undefined,
      });
      setIsCompleteModalOpen(false);
    } catch (err: unknown) {
      setStatusError(err instanceof Error ? err.message : 'Hoàn tất nhiệm vụ thất bại.');
    } finally {
      setIsCompleting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Team Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gradient-to-r from-blue-900 to-indigo-950 p-5 rounded-2xl border border-blue-800 text-white shadow-xl">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-blue-500/20 rounded-xl text-blue-300 border border-blue-500/30">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-tight">
              {myTeam ? myTeam.team_name : 'Đội Ứng Cứu Xung Kích'}
            </h2>
            <p className="text-xs text-blue-200">
              Đội trưởng: <strong>{myTeam?.leader_name || 'Nguyễn Văn Cường'}</strong> • Chuyên trách: {myTeam?.specialty || 'Cứu hộ vùng ngập sâu'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-500/20 border border-emerald-400 text-emerald-300 flex items-center gap-1.5">
            <Radio className="w-3.5 h-3.5 animate-pulse" />
            Tín hiệu bộ đàm thông suốt
          </span>
        </div>
      </div>

      {statusError && (
        <div className="p-4 bg-rose-50 border border-rose-300 rounded-xl text-rose-800 text-sm font-medium">
          {statusError}
        </div>
      )}

      {/* ACTIVE MISSION COCKPIT */}
      {activeOrder ? (
        <div className="bg-white rounded-2xl border-2 border-blue-300 p-6 shadow-lg space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-4">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-blue-600 block mb-0.5">
                Nhiệm Vụ Tác Chiến Hiện Tại
              </span>
              <h3 className="text-xl font-black text-slate-900 flex items-center gap-2">
                Lệnh #{activeOrder.order_id}
              </h3>
            </div>
            <StatusBadge status={activeOrder.status} type="order" />
          </div>

          {/* Target Info Card */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
              <div className="flex items-center gap-2 text-rose-600 font-bold text-sm">
                <MapPin className="w-4 h-4" />
                {targetReport?.address_hint || `Khu vực ngập [${(targetReport?.latitude ?? targetReport?.lat ?? 0).toFixed(4)}, ${(targetReport?.longitude ?? targetReport?.lng ?? 0).toFixed(4)}]`}
              </div>
              <div className="text-xs text-slate-600 space-y-1">
                <div>Nhu cầu: <strong className="text-slate-900">{targetReport ? needType(targetReport.need_type).text : 'Cứu trợ khẩn cấp'}</strong></div>
                <div>Độ ngập ước tính: <strong className="text-rose-600">{targetReport ? reportDepthCm(targetReport) : 0} cm</strong></div>
                <div>Số người cần cứu: <strong className="text-slate-900">{targetReport ? reportPeopleAffected(targetReport) : 0} người</strong></div>
                <div>Người liên hệ: <strong className="text-slate-900">{targetReport?.reporter_name} ({targetReport?.reporter_phone})</strong></div>
              </div>
              {targetReport && onSelectReport && (
                <button
                  type="button"
                  onClick={() => onSelectReport(targetReport)}
                  className="mt-2 text-xs text-blue-600 hover:underline font-semibold block"
                >
                  Xem lộ trình trên bản đồ tác chiến →
                </button>
              )}
            </div>

            {/* Vehicle & Telemetry Card */}
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase text-slate-500 flex items-center gap-1.5">
                  <Truck className="w-4 h-4 text-blue-600" />
                  Phương tiện điều phối
                </span>
                <span className="text-xs px-2 py-0.5 rounded font-bold bg-blue-100 text-blue-800">
                  {assignedVehicle ? vehicleType(assignedVehicle.vehicle_type) : 'Xuồng cứu nạn'}
                </span>
              </div>
              <div className="text-sm font-bold text-slate-800">
                {assignedVehicle?.vehicle_name || activeOrder.vehicle_id}
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs text-slate-600 pt-1">
                <div className="flex items-center gap-1">
                  <Fuel className="w-3.5 h-3.5 text-amber-500" />
                  Nhiên liệu: <strong>{assignedVehicle?.fuel_percent || 100}%</strong>
                </div>
                <div className="flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                  Tình trạng: <strong>{assignedVehicle?.status || 'Tốt'}</strong>
                </div>
              </div>
              <div className="text-[11px] text-slate-500 italic pt-1">
                * Toạ độ GPS lấy từ IoT định vị hiện trường; khoảng cách tính bằng vector Haversine đường chim bay.
              </div>
            </div>
          </div>

          {/* Commander Order Notes */}
          {activeOrder.notes && (
            <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-xs text-amber-900">
              <strong>Mệnh lệnh từ Sở Chỉ huy:</strong> {activeOrder.notes}
            </div>
          )}

          {/* Action Step Bar (Mobile-friendly large buttons) */}
          <div className="pt-2">
            <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
              Cập nhật tiến độ ca tác chiến:
            </div>

            <div className="space-y-4">
              {/* Progress visual bar */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                  <span>Tiến độ ca tác chiến hiện tại:</span>
                  <span className="text-blue-700 text-sm">{Math.round(activeOrder.progress_pct || 0)}%</span>
                </div>
                <div className="w-full h-3 bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-blue-500 to-indigo-600 rounded-full transition-all duration-500"
                    style={{ width: `${Math.max(5, Math.min(100, activeOrder.progress_pct || 0))}%` }}
                  />
                </div>
              </div>

              {activeOrder.status === 'CONFIRMED' || activeOrder.status === 'DISPATCHED' ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    disabled={isUpdatingStatus}
                    onClick={() => handleAdvanceStatus('IN_PROGRESS', {
                      progress_pct: 25,
                      note: 'Đội đã nhận lệnh và bắt đầu cơ động đến hiện trường.'
                    })}
                    className="py-4 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm shadow-md flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-50"
                  >
                    <Navigation className="w-5 h-5 animate-bounce" />
                    🚀 Xuất Phát Đến Hiện Trường (IN_PROGRESS)
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsIncidentModalOpen(true)}
                    className="py-4 px-4 rounded-xl bg-rose-50 hover:bg-rose-100 border-2 border-rose-300 text-rose-700 font-bold text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
                  >
                    <AlertOctagon className="w-5 h-5 text-rose-600" />
                    🚨 Báo Sự Cố Kỹ Thuật
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Interim progress quick-updates */}
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl space-y-2">
                    <div className="text-xs font-bold text-blue-900">Cập nhật tiến độ tiếp cận &amp; cứu nạn:</div>
                    <div className="flex flex-wrap items-center gap-2">
                      {[50, 75, 90].map((pct) => (
                        <button
                          key={pct}
                          type="button"
                          disabled={isUpdatingStatus || (activeOrder.progress_pct >= pct)}
                          onClick={() => {
                            const noteMap: Record<number, string> = {
                              50: 'Đã tiếp cận vị trí ngập, triển khai xuồng/phao cứu hộ.',
                              75: 'Đang hỗ trợ sơ tán người dân và vận chuyển nhu yếu phẩm.',
                              90: 'Người dân đã lên xuồng an toàn, chuẩn bị đưa về điểm sơ tán.',
                            };
                            handleAdvanceStatus('IN_PROGRESS', { progress_pct: pct, note: noteMap[pct] });
                          }}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                            activeOrder.progress_pct >= pct
                              ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                              : 'bg-white text-blue-800 border border-blue-300 hover:bg-blue-100 shadow-sm'
                          }`}
                        >
                          Cập nhật {pct}%
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <button
                      type="button"
                      disabled={isUpdatingStatus}
                      onClick={() => setIsCompleteModalOpen(true)}
                      className="py-4 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm shadow-md flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-50"
                    >
                      <CheckCircle2 className="w-5 h-5" />
                      ✅ Hoàn Tất Ca Cứu Nạn &amp; Bàn Giao
                    </button>

                    <button
                      type="button"
                      onClick={() => setIsIncidentModalOpen(true)}
                      className="py-4 px-4 rounded-xl bg-rose-50 hover:bg-rose-100 border-2 border-rose-300 text-rose-700 font-bold text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
                    >
                      <AlertOctagon className="w-5 h-5 text-rose-600" />
                      🚨 Báo Sự Cố Phương Tiện
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-8 text-center text-slate-600">
          <Clock className="w-12 h-12 text-slate-400 mx-auto mb-3" />
          <h3 className="font-bold text-lg">Chưa có lệnh điều động mới</h3>
          <p className="text-sm text-slate-500 mt-1">
            Đội xung kích đang ở chế độ thường trực sẵn sàng tại vị trí căn cứ.
          </p>
        </div>
      )}

      {/* RECENT INCIDENTS / SỰ CỐ VỪA BÁO */}
      {incidents.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-3">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
            <AlertOctagon className="w-4 h-4 text-rose-500" />
            Nhật ký sự cố hiện trường gần nhất:
          </h4>
          <div className="space-y-2">
            {incidents.slice(0, 3).map((inc) => (
              <div
                key={inc.incident_id}
                className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
              >
                <div>
                  <span className="font-bold text-slate-800">{incidentType(inc.incident_type) || inc.incident_type}: </span>
                  <span className="text-slate-600">{inc.description}</span>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    Phương tiện: {inc.vehicle_id} • Thời gian: {new Date(inc.reported_at || inc.created_at).toLocaleTimeString('vi-VN')}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded font-bold ${inc.status === 'RESOLVED' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
                    {inc.status === 'RESOLVED' ? 'Đã khắc phục' : 'Đang xử lý / Chi viện'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* MODAL: REPORT INCIDENT */}
      {isIncidentModalOpen && activeOrder && (
        <Modal
          isOpen={true}
          onClose={() => setIsIncidentModalOpen(false)}
          title="🚨 Báo Sự Cố Phương Tiện Hiện Trường"
        >
          <form onSubmit={handleIncidentSubmit} className="space-y-4">
            {incidentError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs">
                {incidentError}
              </div>
            )}

            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs space-y-1">
              <div><strong>Nhiệm vụ:</strong> Lệnh #{activeOrder.order_id}</div>
              <div><strong>Phương tiện:</strong> {assignedVehicle?.vehicle_name || activeOrder.vehicle_id}</div>
              <div className="text-rose-700 font-semibold">
                * Báo cáo này sẽ lập tức kích hoạt quy trình Điều Phối Lại (SOP-02 Replan Workflow) tại Sở Chỉ huy.
              </div>
            </div>

            <div>
              <label className={LABEL_STYLE}>Loại sự cố kỹ thuật</label>
              <select
                value={incType}
                onChange={(e) => setIncType(e.target.value)}
                className={INPUT_STYLE}
              >
                <option value="PROPELLER_FOULED">Mắc kẹt chân vịt / rác nổi cuốn chân vịt</option>
                <option value="ENGINE_STALL">Chết máy động cơ / sự cố nhiên liệu</option>
                <option value="FLOODED_CABIN">Nước tràn khoang máy / nguy cơ chìm</option>
                <option value="GROUNDED">Mắc cạn bãi bùn / vật cản ngầm</option>
                <option value="OTHER">Sự cố khác</option>
              </select>
            </div>

            <div>
              <label className={LABEL_STYLE}>Mức độ nghiêm trọng</label>
              <select
                value={incSeverity}
                onChange={(e) => setIncSeverity(e.target.value)}
                className={INPUT_STYLE}
              >
                <option value="CRITICAL">🔴 KHẨN CẤP (Không thể tự di chuyển, cần chi viện ngay)</option>
                <option value="MAJOR">🟠 NẶNG (Tốc độ giảm mạnh, khả năng hư hỏng thêm)</option>
                <option value="MINOR">🟡 NHẸ (Có thể tự xử lý sơ bộ trong 15 phút)</option>
              </select>
            </div>

            <div>
              <label className={LABEL_STYLE}>Mô tả chi tiết hiện trạng</label>
              <textarea
                rows={3}
                value={incDesc}
                onChange={(e) => setIncDesc(e.target.value)}
                className={INPUT_STYLE}
                required
              />
            </div>

            <div>
              <label className={LABEL_STYLE}>Ảnh chụp minh chứng hiện trường (ClamAV scanned)</label>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer text-xs font-semibold text-slate-700">
                  <Camera className="w-4 h-4 text-slate-500" />
                  <span>Chọn ảnh chụp</span>
                  <input type="file" accept="image/*" onChange={handlePhotoUpload} className="hidden" />
                </label>
                {photoPreview && (
                  <span className="text-xs text-emerald-600 flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5" /> Đã chọn ảnh minh chứng
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3">
              <button
                type="button"
                onClick={() => setIsIncidentModalOpen(false)}
                className="px-4 py-2.5 text-xs font-semibold rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={isReportingIncident}
                className="px-5 py-2.5 text-xs font-bold rounded-xl bg-rose-600 hover:bg-rose-700 text-white shadow flex items-center gap-2 disabled:opacity-50"
              >
                {isReportingIncident ? 'Đang gửi sự cố...' : 'Gửi Khẩn Cấp Lên Chỉ Huy'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* MODAL: COMPLETE MISSION */}
      {isCompleteModalOpen && activeOrder && (
        <Modal
          isOpen={true}
          onClose={() => setIsCompleteModalOpen(false)}
          title={`Hoàn Tất Ca Tác Chiến #${activeOrder.order_id}`}
        >
          <form onSubmit={handleCompleteSubmit} className="space-y-4">
            {statusError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs">
                {statusError}
              </div>
            )}

            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs space-y-1">
              <div><strong>Khu vực:</strong> {targetReport?.address_hint || 'Hà Nội'}</div>
              <div><strong>Người báo:</strong> {targetReport?.reporter_name}</div>
              <div className="text-emerald-800 font-semibold">
                * Khi nộp báo cáo, hồ sơ sẽ chuyển sang trạng thái chờ người dân nghiệm thu an toàn.
              </div>
            </div>

            <div>
              <label className={LABEL_STYLE}>Kết quả xử lý hiện trường (Outcome)</label>
              <select
                value={compOutcome}
                onChange={(e) => setCompOutcome(e.target.value as any)}
                className={INPUT_STYLE}
              >
                <option value="RESOLVED">✅ RESOLVED - Đã cứu nạn / giải cứu an toàn toàn bộ</option>
                <option value="PARTIAL">⚠️ PARTIAL - Đã hỗ trợ một phần, cần lực lượng tiếp ứng</option>
                <option value="UNRESOLVED">❌ UNRESOLVED - Không thể tiếp cận mục tiêu</option>
              </select>
            </div>

            <div>
              <label className={LABEL_STYLE}>Độ sâu mực nước đo đạc sau cứu nạn (cm)</label>
              <input
                type="number"
                min="0"
                max="500"
                value={compFinalDepth}
                onChange={(e) => setCompFinalDepth(Number(e.target.value))}
                className={INPUT_STYLE}
              />
            </div>

            <div>
              <label className={LABEL_STYLE}>Báo cáo kết quả cứu nạn &amp; bàn giao (Bắt buộc)</label>
              <textarea
                rows={4}
                value={completionNotes}
                onChange={(e) => setCompletionNotes(e.target.value)}
                placeholder="Số người được cứu, tình trạng sức khỏe, điểm tập kết sơ tán an toàn..."
                className={INPUT_STYLE}
                required
              />
            </div>

            <div>
              <label className={LABEL_STYLE}>Ảnh chụp minh chứng hoàn thành (quét ClamAV)</label>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer text-xs font-semibold text-slate-700">
                  <Camera className="w-4 h-4 text-slate-500" />
                  <span>Chọn ảnh hiện trường</span>
                  <input type="file" accept="image/*" onChange={handlePhotoUpload} className="hidden" />
                </label>
                {photoPreview && (
                  <span className="text-xs text-emerald-600 flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5" /> Đã chọn ảnh minh chứng
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3">
              <button
                type="button"
                onClick={() => setIsCompleteModalOpen(false)}
                className="px-4 py-2.5 text-xs font-semibold rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={isCompleting}
                className="px-5 py-2.5 text-xs font-bold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow flex items-center gap-2 disabled:opacity-50"
              >
                {isCompleting ? 'Đang lưu...' : 'Xác Nhận Hoàn Tất'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};
