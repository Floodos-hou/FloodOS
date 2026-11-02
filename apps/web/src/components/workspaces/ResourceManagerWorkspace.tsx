// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import React, { useState } from 'react';
import {
  RescueVehicle,
  SafeShelter,
  GaugeStation,
  FieldIncident,
} from '../../types';
import {
  vehicleType,
  vehicleStatus,
  shelterStatus,
  gaugeAlertState,
} from '../../utils/labels';
import { Modal } from '../common/Modal';
import {
  Truck,
  Fuel,
  HeartPulse,
  Wrench,
  Home,
  Waves,
  Activity,
  BatteryCharging,
  CheckCircle2,
  AlertTriangle,
  Users,
} from 'lucide-react';

interface ResourceManagerWorkspaceProps {
  vehicles: RescueVehicle[];
  shelters: SafeShelter[];
  gauges: GaugeStation[];
  incidents: FieldIncident[];
  onUpdateShelterOccupancy?: (shelterId: string, occupancy: number) => Promise<void>;
  onResolveTicket?: (ticketId: string, notes: string) => Promise<void>;
  onSelectShelter?: (shelter: SafeShelter) => void;
  onSelectGauge?: (gauge: GaugeStation) => void;
}

type SectionTab = 'VEHICLES' | 'SHELTERS' | 'GAUGES' | 'REPAIRS';

const INPUT_STYLE = 'w-full rounded-xl border-2 border-slate-300 bg-white p-3 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-4 focus:ring-amber-200 transition-all';
const LABEL_STYLE = 'mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-700';

export const ResourceManagerWorkspace: React.FC<ResourceManagerWorkspaceProps> = ({
  vehicles,
  shelters,
  gauges,
  incidents,
  onUpdateShelterOccupancy,
  onResolveTicket,
  onSelectShelter,
  onSelectGauge,
}) => {
  const [activeTab, setActiveTab] = useState<SectionTab>('VEHICLES');

  // Shelter update state
  const [editingShelter, setEditingShelter] = useState<SafeShelter | null>(null);
  const [newOccupancy, setNewOccupancy] = useState<number>(0);
  const [isUpdatingShelter, setIsUpdatingShelter] = useState(false);

  // Repair resolution state
  const [resolvingIncident, setResolvingIncident] = useState<FieldIncident | null>(null);
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [isResolving, setIsResolving] = useState(false);

  const availableVehicles = vehicles.filter((v) => v.status === 'AVAILABLE');
  const activeIncidents = incidents.filter((i) => i.status !== 'RESOLVED');

  const openShelterEdit = (s: SafeShelter) => {
    setEditingShelter(s);
    setNewOccupancy(s.current_occupancy ?? s.occupancy ?? 0);
  };

  const handleShelterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingShelter || !onUpdateShelterOccupancy) return;
    setIsUpdatingShelter(true);
    try {
      await onUpdateShelterOccupancy(editingShelter.shelter_id, newOccupancy);
      setEditingShelter(null);
    } finally {
      setIsUpdatingShelter(false);
    }
  };

  const openResolveTicket = (inc: FieldIncident) => {
    setResolvingIncident(inc);
    setResolutionNotes('Đã gỡ rác chân vịt, thay chốt định vị và kiểm tra áp suất dầu. Phương tiện sẵn sàng tác chiến.');
  };

  const handleResolveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resolvingIncident || !onResolveTicket) return;
    setIsResolving(true);
    try {
      await onResolveTicket(resolvingIncident.incident_id, resolutionNotes);
      setResolvingIncident(null);
    } finally {
      setIsResolving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gradient-to-r from-slate-900 to-teal-950 p-5 rounded-2xl border border-slate-800 text-white shadow-xl">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-teal-500/20 rounded-xl text-teal-300 border border-teal-500/30">
            <Truck className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-tight">Hạ Tầng &amp; Nguồn Lực Ứng Phó</h2>
            <p className="text-xs text-teal-200">
              Quản lý đội xe xuồng cứu nạn • Điểm sơ tán an toàn • Trạm đo ngập thủy văn tự động
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="px-3 py-1.5 bg-emerald-500/20 border border-emerald-500/40 rounded-xl flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            <span className="text-xs text-emerald-300 font-semibold">{availableVehicles.length}/{vehicles.length} phương tiện sẵn sàng</span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 overflow-x-auto pb-2">
        <button
          onClick={() => setActiveTab('VEHICLES')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all shrink-0 ${
            activeTab === 'VEHICLES'
              ? 'bg-teal-600 text-white shadow-md'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Truck className="w-4 h-4" />
          Đội Phương Tiện Cứu Nạn ({vehicles.length})
        </button>

        <button
          onClick={() => setActiveTab('SHELTERS')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all shrink-0 ${
            activeTab === 'SHELTERS'
              ? 'bg-blue-600 text-white shadow-md'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Home className="w-4 h-4" />
          Điểm Trú Ẩn An Toàn ({shelters.length})
        </button>

        <button
          onClick={() => setActiveTab('GAUGES')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all shrink-0 ${
            activeTab === 'GAUGES'
              ? 'bg-indigo-600 text-white shadow-md'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Waves className="w-4 h-4" />
          Trạm Đo Ngập Thủy Văn ({gauges.length})
        </button>

        <button
          onClick={() => setActiveTab('REPAIRS')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all shrink-0 ${
            activeTab === 'REPAIRS'
              ? 'bg-rose-600 text-white shadow-md'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Wrench className="w-4 h-4" />
          Phiếu Sửa Chữa ({activeIncidents.length})
        </button>
      </div>

      {/* TAB 1: VEHICLES */}
      {activeTab === 'VEHICLES' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {vehicles.map((v) => {
            const isBroken = v.status === 'MAINTENANCE' || v.status === 'BREAKDOWN';
            return (
              <div
                key={v.vehicle_id}
                className={`bg-white rounded-2xl border-2 p-5 shadow-sm flex flex-col justify-between transition-all ${
                  isBroken ? 'border-rose-300 bg-rose-50/20' : 'border-slate-200 hover:border-teal-300'
                }`}
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <span className="font-mono text-xs font-bold text-slate-500">#{v.vehicle_id}</span>
                    <span
                      className={`text-xs px-2.5 py-0.5 rounded-full font-bold ${
                        v.status === 'AVAILABLE'
                          ? 'bg-emerald-100 text-emerald-800'
                          : v.status === 'DISPATCHED'
                          ? 'bg-blue-100 text-blue-800'
                          : 'bg-rose-100 text-rose-800'
                      }`}
                    >
                      {vehicleStatus[v.status] || v.status}
                    </span>
                  </div>

                  <h3 className="font-bold text-slate-900 text-base mb-1">{v.vehicle_name}</h3>
                  <div className="text-xs text-slate-500 mb-4">
                    Loại: <strong>{vehicleType[v.vehicle_type] || v.vehicle_type}</strong>
                  </div>

                  <div className="space-y-2 bg-slate-50 p-3 rounded-xl border border-slate-100 text-xs">
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500 flex items-center gap-1.5">
                        <Fuel className="w-3.5 h-3.5 text-amber-500" /> Nhiên liệu:
                      </span>
                      <span className="font-bold text-slate-800">{v.fuel_percent}%</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500 flex items-center gap-1.5">
                        <HeartPulse className="w-3.5 h-3.5 text-emerald-500" /> Tình trạng máy:
                      </span>
                      <span className="font-bold text-slate-800">{v.health_percent}%</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500 flex items-center gap-1.5">
                        <Activity className="w-3.5 h-3.5 text-blue-500" /> Nguồn toạ độ:
                      </span>
                      <span className="font-medium text-slate-600">Mô phỏng IoT</span>
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-100 text-[11px] text-slate-400 flex justify-between items-center">
                  <span>Toạ độ: [{v.current_lat.toFixed(4)}, {v.current_lng.toFixed(4)}]</span>
                  {v.assigned_team_id && <span className="font-semibold text-slate-600">Đội: {v.assigned_team_id}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* TAB 2: SHELTERS */}
      {activeTab === 'SHELTERS' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {shelters.map((s) => {
            const pct = Math.min(100, Math.round(((s.current_occupancy ?? s.occupancy ?? 0) / (s.capacity || 1)) * 100));
            const isFull = pct >= 95;

            return (
              <div
                key={s.shelter_id}
                className="bg-white rounded-2xl border-2 border-slate-200 p-5 shadow-sm hover:border-blue-300 transition-all flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <span className="font-mono text-xs font-bold text-slate-500">#{s.shelter_id}</span>
                    <span
                      className={`text-xs px-2.5 py-0.5 rounded-full font-bold ${
                        isFull
                          ? 'bg-rose-100 text-rose-800'
                          : s.status === 'ACTIVE'
                          ? 'bg-blue-100 text-blue-800'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {isFull ? 'GẦN KÍN CHỖ' : shelterStatus[s.status] || s.status}
                    </span>
                  </div>

                  <h3 className="font-bold text-slate-900 text-base mb-1">{s.shelter_name}</h3>
                  <p className="text-xs text-slate-600 mb-4">{s.address}</p>

                  <div className="space-y-2 bg-blue-50/40 p-3 rounded-xl border border-blue-100 text-xs mb-3">
                    <div className="flex justify-between items-center">
                      <span className="text-slate-600 font-semibold">Công suất tiếp nhận:</span>
                      <span className="font-bold text-blue-900">
                        {s.current_occupancy} / {s.capacity} người ({pct}%)
                      </span>
                    </div>
                    {/* Progress bar */}
                    <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                      <div
                        className={`h-2 rounded-full transition-all ${
                          pct >= 90 ? 'bg-rose-500' : pct >= 70 ? 'bg-amber-500' : 'bg-emerald-500'
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="text-[11px] text-slate-500 flex justify-between pt-1">
                      <span>Người phụ trách: {s.contact_phone || 'Trực ban phường'}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-3 border-t border-slate-100">
                  {onSelectShelter && (
                    <button
                      type="button"
                      onClick={() => onSelectShelter(s)}
                      className="flex-1 py-2 px-3 text-xs font-semibold rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700"
                    >
                      Bản đồ
                    </button>
                  )}
                  {onUpdateShelterOccupancy && (
                    <button
                      type="button"
                      onClick={() => openShelterEdit(s)}
                      className="flex-1 py-2 px-3 text-xs font-bold rounded-xl bg-blue-600 hover:bg-blue-700 text-white shadow"
                    >
                      Cập nhật số người
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* TAB 3: GAUGES */}
      {activeTab === 'GAUGES' && (
        <div className="space-y-4">
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
            <span>
              <strong>Lưu ý minh bạch:</strong> Mực nước trạm quan trắc hiện được cấp bởi bộ mô phỏng IoT thủy văn Hà Nội để thử nghiệm kịch bản ngập cục bộ.
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {gauges.map((g) => {
              const isDanger = g.alert_state === 'DANGER' || g.alert_state === 'WARNING';

              return (
                <div
                  key={g.station_id}
                  className={`bg-white rounded-2xl border-2 p-5 shadow-sm transition-all flex flex-col justify-between ${
                    isDanger ? 'border-rose-400 bg-rose-50/30' : 'border-slate-200 hover:border-indigo-300'
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <span className="font-mono text-xs font-bold text-slate-500">#{g.station_id}</span>
                      <span
                        className={`text-xs px-2.5 py-0.5 rounded-full font-bold ${
                          g.alert_state === 'DANGER'
                            ? 'bg-rose-600 text-white animate-pulse'
                            : g.alert_state === 'WARNING'
                            ? 'bg-amber-500 text-white'
                            : g.alert_state === 'WATCH'
                            ? 'bg-yellow-100 text-yellow-800'
                            : 'bg-emerald-100 text-emerald-800'
                        }`}
                      >
                        {gaugeAlertState[g.alert_state] || g.alert_state}
                      </span>
                    </div>

                    <h3 className="font-bold text-slate-900 text-base mb-1">{g.station_name}</h3>
                    <p className="text-xs text-slate-500 mb-4">Lưu vực: {g.river_stream || 'Sông Nhuệ / Kênh xả'}</p>

                    <div className="space-y-2 bg-slate-50 p-4 rounded-xl border border-slate-200 text-xs">
                      <div className="flex justify-between items-center">
                        <span className="text-slate-500">Mực nước hiện tại:</span>
                        <span className="text-base font-black text-rose-600">{g.water_level_cm} cm</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-slate-500">Ngưỡng báo động:</span>
                        <span className="font-bold text-slate-700">{g.warning_level_cm} cm</span>
                      </div>
                      <div className="flex justify-between items-center pt-1 border-t border-slate-200 text-slate-500">
                        <span className="flex items-center gap-1">
                          <BatteryCharging className="w-3.5 h-3.5 text-emerald-500" /> Pin trạm: {g.battery_pct}%
                        </span>
                        <span>Đo lúc: {new Date(g.last_telemetry_at || g.level_updated_at || Date.now()).toLocaleTimeString('vi-VN')}</span>
                      </div>
                    </div>
                  </div>

                  {onSelectGauge && (
                    <div className="pt-3 border-t border-slate-100 mt-4">
                      <button
                        type="button"
                        onClick={() => onSelectGauge(g)}
                        className="w-full py-2 px-3 text-xs font-semibold rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700"
                      >
                        Định vị trạm trên bản đồ tác chiến →
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 4: REPAIR TICKETS */}
      {activeTab === 'REPAIRS' && (
        <div className="space-y-4">
          {activeIncidents.length === 0 ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-8 text-center text-emerald-800">
              <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
              <h3 className="font-bold text-lg">Không có phương tiện cần bảo dưỡng khẩn cấp</h3>
              <p className="text-sm text-emerald-600 mt-1">
                Toàn bộ xuồng và xe lội nước đang ở tình trạng kỹ thuật đạt chuẩn.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {activeIncidents.map((inc) => (
                <div
                  key={inc.incident_id}
                  className="bg-white rounded-2xl border-2 border-rose-200 p-5 shadow-sm flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <span className="font-mono text-xs font-bold text-slate-500">#{inc.incident_id}</span>
                      <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-rose-100 text-rose-800">
                        {inc.severity}
                      </span>
                    </div>

                    <h4 className="font-bold text-slate-900 text-base mb-1">
                      {inc.description}
                    </h4>
                    <p className="text-xs text-slate-600 mb-3">
                      Phương tiện: <strong className="text-rose-600">{inc.vehicle_id}</strong> • Báo cáo lúc: {new Date(inc.reported_at || inc.created_at).toLocaleTimeString('vi-VN')}
                    </p>
                  </div>

                  <div className="pt-3 border-t border-slate-100 flex items-center justify-end">
                    {onResolveTicket && (
                      <button
                        type="button"
                        onClick={() => openResolveTicket(inc)}
                        className="py-2 px-4 text-xs font-bold rounded-xl bg-teal-600 hover:bg-teal-700 text-white shadow flex items-center gap-1.5"
                      >
                        <Wrench className="w-3.5 h-3.5" />
                        Xác nhận Sửa Chữa Xong
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* MODAL: UPDATE SHELTER OCCUPANCY */}
      {editingShelter && (
        <Modal
          isOpen={true}
          onClose={() => setEditingShelter(null)}
          title={`Cập Nhật Sĩ Số: ${editingShelter.shelter_name}`}
        >
          <form onSubmit={handleShelterSubmit} className="space-y-4">
            <div className="p-3 bg-blue-50 rounded-xl border border-blue-200 text-xs">
              <div><strong>Địa chỉ:</strong> {editingShelter.address}</div>
              <div><strong>Sức chứa tối đa:</strong> {editingShelter.capacity} người</div>
            </div>

            <div>
              <label className={LABEL_STYLE}>Số người đang có mặt tại điểm sơ tán</label>
              <input
                type="number"
                min={0}
                max={editingShelter.capacity * 2}
                value={newOccupancy}
                onChange={(e) => setNewOccupancy(parseInt(e.target.value) || 0)}
                className={INPUT_STYLE}
                required
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-3">
              <button
                type="button"
                onClick={() => setEditingShelter(null)}
                className="px-4 py-2.5 text-xs font-semibold rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={isUpdatingShelter}
                className="px-5 py-2.5 text-xs font-bold rounded-xl bg-blue-600 hover:bg-blue-700 text-white shadow disabled:opacity-50"
              >
                {isUpdatingShelter ? 'Đang lưu...' : 'Lưu Thay Đổi'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* MODAL: RESOLVE TICKET */}
      {resolvingIncident && (
        <Modal
          isOpen={true}
          onClose={() => setResolvingIncident(null)}
          title={`Nghiệm Thu Sửa Chữa #${resolvingIncident.incident_id}`}
        >
          <form onSubmit={handleResolveSubmit} className="space-y-4">
            <div className="p-3 bg-teal-50 rounded-xl border border-teal-200 text-xs">
              <div><strong>Phương tiện:</strong> {resolvingIncident.vehicle_id}</div>
              <div><strong>Sự cố ban đầu:</strong> {resolvingIncident.description}</div>
            </div>

            <div>
              <label className={LABEL_STYLE}>Nội dung nghiệm thu kỹ thuật</label>
              <textarea
                rows={3}
                value={resolutionNotes}
                onChange={(e) => setResolutionNotes(e.target.value)}
                className={INPUT_STYLE}
                required
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-3">
              <button
                type="button"
                onClick={() => setResolvingIncident(null)}
                className="px-4 py-2.5 text-xs font-semibold rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={isResolving}
                className="px-5 py-2.5 text-xs font-bold rounded-xl bg-teal-600 hover:bg-teal-700 text-white shadow disabled:opacity-50"
              >
                {isResolving ? 'Đang cập nhật...' : 'Xác Nhận Đưa Xe Trở Lại Trực'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};
