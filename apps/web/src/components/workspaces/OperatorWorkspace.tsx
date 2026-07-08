// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenAgriOS Contributors

import React, { useState } from 'react';
import {
  DispatchAssignment,
  HarvesterMachine,
  FieldPlot,
  OperatorProfile,
} from '../../types';
import { formatLocalTime } from '../../utils/dateTime';
import { Modal } from '../common/Modal';
import { Play, CheckCircle, AlertOctagon, Gauge, BatteryCharging, Fuel, Camera, MapPin } from 'lucide-react';
import { assignmentStatus } from '../../utils/labels';

const INPUT = 'w-full rounded-xl border-2 border-slate-300 bg-white p-3 text-base text-slate-900 outline-none focus:border-red-500 focus:ring-4 focus:ring-red-100';
const LABEL = 'mb-1.5 block text-base font-semibold text-slate-800';

interface OperatorWorkspaceProps {
  currentUserId: string;
  assignments: DispatchAssignment[];
  machines: HarvesterMachine[];
  fields: FieldPlot[];
  operators: OperatorProfile[];
  onUpdateShiftStatus: (
    asgId: string,
    data: { status: 'IN_PROGRESS' | 'COMPLETED'; progress_pct?: number; note?: string }
  ) => Promise<void>;
  onReportIncident: (data: {
    machine_id: string;
    severity: string;
    incident_type: string;
    description: string;
    estimated_downtime_hours: number;
    evidence_filename: string;
    evidence_data_url?: string;
  }) => Promise<void>;
}

export const OperatorWorkspace: React.FC<OperatorWorkspaceProps> = ({
  currentUserId,
  assignments,
  machines,
  fields,
  operators,
  onUpdateShiftStatus,
  onReportIncident,
}) => {
  // Resolve the signed-in user to their operator profile; never assume a fixed demo operator
  const myOperator = operators.find((o) => o.user_id === currentUserId);
  const myAssignments = myOperator ? assignments.filter((a) => a.operator_id === myOperator.operator_id) : [];

  const activeShift = myAssignments.find(
    (a) => a.status === 'CONFIRMED' || a.status === 'IN_PROGRESS'
  ) || myAssignments.find((a) => a.status !== 'SUPERSEDED');

  const assignedMachine = machines.find((m) => m.machine_id === activeShift?.machine_id)
    || (myOperator ? machines.find((m) => m.assigned_operator_id === myOperator.operator_id) : undefined);
  const assignedField = fields.find((f) => f.field_id === activeShift?.field_id);

  const [showIncidentModal, setShowIncidentModal] = useState(false);
  const [incidentType, setIncidentType] = useState('ENGINE_OVERHEAT');
  const [severity, setSeverity] = useState('HIGH');
  const [description, setDescription] = useState('');
  const [downtimeHours, setDowntimeHours] = useState(3.5);
  const [progressPct, setProgressPct] = useState(Number(assignedField?.harvest_progress_pct) || 0);
  const [progressNote, setProgressNote] = useState('');
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [evidencePreview, setEvidencePreview] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setFileError('Bạn chỉ chọn được file ảnh.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setFileError('Ảnh nặng quá (tối đa 5 MB). Bạn chụp lại hoặc chọn ảnh nhỏ hơn.');
      return;
    }
    setFileError(null);
    setEvidenceFile(file);
    const reader = new FileReader();
    reader.onload = () => setEvidencePreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleIncidentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignedMachine) return;
    setIsSubmitting(true);
    setActionError(null);
    try {
      await onReportIncident({
        machine_id: assignedMachine.machine_id,
        severity,
        incident_type: incidentType,
        description,
        estimated_downtime_hours: Number(downtimeHours),
        evidence_filename: evidenceFile?.name || 'su-co-hien-truong.jpg',
        evidence_data_url: evidencePreview || undefined,
      });
      setShowIncidentModal(false);
      setDescription('');
      setEvidenceFile(null);
      setEvidencePreview(null);
    } catch (err: any) {
      setActionError(err?.message || 'Chưa gửi được báo cáo sự cố. Vui lòng thử lại.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStartShift = async () => {
    if (!activeShift) return;
    setIsSubmitting(true);
    setActionError(null);
    try {
      await onUpdateShiftStatus(activeShift.assignment_id, {
        status: 'IN_PROGRESS',
        progress_pct: Number(assignedField?.harvest_progress_pct) || 0,
        note: 'Đã nhận bàn giao máy và bắt đầu ca gặt',
      });
    } catch (err: any) {
      setActionError(err?.message || 'Chưa bắt đầu được ca. Vui lòng thử lại.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCompleteShift = async () => {
    if (!activeShift || progressPct < 100 || !progressNote.trim()) return;
    setIsSubmitting(true);
    setActionError(null);
    try {
      await onUpdateShiftStatus(activeShift.assignment_id, {
        status: 'COMPLETED',
        progress_pct: 100,
        note: progressNote.trim(),
      });
    } catch (err: any) {
      setActionError(err?.message || 'Chưa hoàn tất được ca. Vui lòng thử lại.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveProgress = async () => {
    if (!activeShift || progressPct < (Number(assignedField?.harvest_progress_pct) || 0) || !progressNote.trim()) return;
    setIsSubmitting(true);
    setActionError(null);
    try {
      await onUpdateShiftStatus(activeShift.assignment_id, {
        status: 'IN_PROGRESS',
        progress_pct: progressPct,
        note: progressNote.trim(),
      });
      setProgressNote('');
    } catch (err: any) {
      setActionError(err?.message || 'Chưa lưu được tiến độ. Vui lòng thử lại.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {actionError && <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm font-semibold text-red-800">{actionError}</p>}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setShowIncidentModal(true)}
          className="flex min-h-16 w-full items-center justify-center gap-3 rounded-2xl bg-red-600 px-8 py-4 text-xl font-bold text-white shadow-lg transition hover:bg-red-700 focus:outline-none focus-visible:ring-4 focus-visible:ring-red-300 sm:w-auto"
        >
          <AlertOctagon aria-hidden="true" className="h-7 w-7" />
          <span>🆘 Máy bị hỏng? Báo ngay</span>
        </button>
      </div>

      {/* Main Shift Status Card */}
      {activeShift ? (
        <div className="bg-white rounded-xl shadow border border-slate-200 overflow-hidden">
          <div className="px-5 py-4 bg-slate-50 border-b border-slate-200 flex flex-wrap justify-between items-center gap-2">
            <div>
              <span className="text-sm text-slate-500 font-mono">Lệnh điều động: #{activeShift.assignment_id}</span>
              <h3 className="font-bold text-base text-slate-800">
                Ca gặt thực địa: {assignedField?.name || activeShift.field_id}
              </h3>
            </div>
            <span
              className={`px-3 py-1 rounded-full text-sm font-bold ${
                activeShift.status === 'IN_PROGRESS'
                  ? 'bg-amber-100 text-amber-800 animate-pulse'
                  : activeShift.status === 'COMPLETED'
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-blue-100 text-blue-800'
              }`}
            >
              Trạng thái: {assignmentStatus(activeShift.status).text}
            </span>
          </div>

          <div className="p-5 space-y-6">
            {/* Field & Machine Brief */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2 text-sm">
                <div className="font-bold text-slate-700 flex items-center">
                  <MapPin className="w-4 h-4 text-emerald-600 mr-1.5" />
                  Ruộng đang gặt:
                </div>
                <div className="text-sm font-semibold text-slate-900">{assignedField?.name}</div>
                <div className="text-slate-600">
                  Ấp: {assignedField?.hamlet} | Chủ ruộng: {assignedField?.owner_name}
                </div>
                <div className="text-slate-600">
                  Diện tích: <strong className="text-emerald-700">{assignedField?.area_ha} ha</strong> | Giống:{' '}
                  {assignedField?.crop}
                </div>
                <div className="text-slate-500 text-sm font-mono">
                  Khung giờ: {formatLocalTime(activeShift.start_time)} - {formatLocalTime(activeShift.end_time)}
                </div>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2 text-sm">
                <div className="font-bold text-slate-700 flex items-center">
                  <Gauge className="w-4 h-4 text-blue-600 mr-1.5" />
                  Máy đang lái:
                </div>
                <div className="text-sm font-semibold text-slate-900">
                  {assignedMachine?.name} ({assignedMachine?.machine_id})
                </div>
                <div className="text-slate-600">
                  Dòng máy: {assignedMachine?.model} | Công suất: {assignedMachine?.capacity_ha_per_hr} ha/h
                </div>
                <div className="flex items-center space-x-4 pt-1">
                  <div className="flex items-center text-slate-700">
                    <Fuel className="w-4 h-4 text-amber-500 mr-1" />
                    <span>Nhiên liệu: <strong>{assignedMachine?.fuel_pct}%</strong></span>
                  </div>
                  <div className="flex items-center text-slate-700">
                    <BatteryCharging className="w-4 h-4 text-emerald-500 mr-1" />
                    <span>Độ bền máy: <strong>{assignedMachine?.health_pct}%</strong></span>
                  </div>
                </div>
              </div>
            </div>

            {/* Progress recorded by the operator */}
            <div className="p-4 rounded-xl bg-emerald-50/50 border border-emerald-200">
              <div className="flex justify-between items-center mb-2">
                <span className="font-bold text-sm text-slate-800">
                  Đã gặt được:
                </span>
                <span className="text-base font-extrabold text-emerald-800">
                  {assignedField?.harvest_progress_pct || 0}%
                </span>
              </div>
              <div className="w-full bg-slate-200 rounded-full h-3">
                <div
                  className="bg-emerald-600 h-3 rounded-full transition-all duration-500"
                  style={{ width: `${assignedField?.harvest_progress_pct || 0}%` }}
                />
              </div>
              {activeShift.status === 'IN_PROGRESS' && (
                <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                  <div>
                    <label htmlFor="shift-progress" className="mb-1 block text-base font-semibold text-slate-800">Tiến độ ước tính ngoài hiện trường: {progressPct}%</label>
                    <input id="shift-progress" type="range" min={Number(assignedField?.harvest_progress_pct) || 0} max={100} step={5} value={progressPct} onChange={(e) => setProgressPct(Number(e.target.value))} className="w-full accent-emerald-700" />
                    <label htmlFor="shift-progress-note" className="mb-1 mt-3 block text-sm font-semibold text-slate-800">Ghi chú cập nhật</label>
                    <input id="shift-progress-note" value={progressNote} onChange={(e) => setProgressNote(e.target.value)} maxLength={500} placeholder="Ví dụ: đã gặt xong bờ phía đông, còn khoảng nửa thửa" className="w-full rounded-xl border-2 border-slate-300 bg-white p-3 text-base text-slate-900 focus:border-emerald-600 focus:outline-none" />
                    <p className="mt-1 text-xs text-slate-600">Tiến độ do người lái ước tính và ghi nhận, không phải dữ liệu cảm biến trực tiếp.</p>
                  </div>
                  <button type="button" onClick={handleSaveProgress} disabled={isSubmitting || !progressNote.trim() || progressPct < (Number(assignedField?.harvest_progress_pct) || 0)} className="min-h-14 rounded-2xl bg-emerald-700 px-5 py-3 text-lg font-bold text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50">{isSubmitting ? 'Đang lưu…' : 'Ghi nhận tiến độ'}</button>
                </div>
              )}
            </div>

            {/* Quick Large Mobile Buttons */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              {activeShift.status === 'CONFIRMED' && (
                <button
                  onClick={handleStartShift}
                  disabled={isSubmitting}
                  className="w-full min-h-16 py-4 px-6 bg-emerald-700 hover:bg-emerald-600 text-white rounded-2xl font-bold text-xl shadow-lg transition flex items-center justify-center space-x-2"
                >
                  <Play className="w-5 h-5 fill-current" />
                  <span>{isSubmitting ? 'Đang cập nhật...' : '▶️ Bắt đầu ca gặt'}</span>
                </button>
              )}

              {activeShift.status === 'IN_PROGRESS' && progressPct >= 100 && progressNote.trim() && (
                <button
                  onClick={handleCompleteShift}
                  disabled={isSubmitting}
                  className="w-full min-h-16 py-4 px-6 bg-emerald-700 hover:bg-emerald-600 text-white rounded-2xl font-bold text-xl shadow-lg transition flex items-center justify-center space-x-2"
                >
                  <CheckCircle className="w-5 h-5" />
                  <span>{isSubmitting ? 'Đang cập nhật...' : '✅ Hoàn tất ca gặt'}</span>
                </button>
              )}

              {activeShift.status === 'COMPLETED' && (
                <div className="col-span-2 p-3 bg-emerald-100 text-emerald-800 rounded-xl text-center text-sm font-bold flex items-center justify-center space-x-1.5">
                  <CheckCircle className="w-4 h-4" />
                  <span>Ca gặt đã xong. Chờ chủ ruộng xác nhận!</span>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white p-8 rounded-xl border text-center text-slate-500 text-sm">
          Hiện chưa có ca làm việc nào giao cho bạn. Bạn liên hệ điều phối viên HTX nhé.
        </div>
      )}

      {showIncidentModal && (
        <Modal title="Báo máy hỏng" onClose={() => setShowIncidentModal(false)}>
          <form onSubmit={handleIncidentSubmit} className="space-y-5">
            <div>
              <p className={LABEL}>Máy bị hỏng</p>
              <p className="rounded-xl bg-slate-100 p-3 text-base font-semibold text-slate-900">
                {assignedMachine?.name} ({assignedMachine?.machine_id})
              </p>
            </div>
            <div>
              <label htmlFor="in-type" className={LABEL}>Máy bị gì?</label>
              <select id="in-type" value={incidentType} onChange={(e) => setIncidentType(e.target.value)} className={INPUT}>
                <option value="ENGINE_OVERHEAT">Động cơ quá nóng</option>
                <option value="HYDRAULIC_FAILURE">Hỏng bơm thủy lực</option>
                <option value="TRACK_JAM">Kẹt xích hoặc gãy thanh cào</option>
                <option value="BLADE_DAMAGE">Mẻ lưỡi dao cắt</option>
              </select>
            </div>
            <div>
              <label htmlFor="in-sev" className={LABEL}>Hỏng nặng hay nhẹ?</label>
              <select id="in-sev" value={severity} onChange={(e) => setSeverity(e.target.value)} className={INPUT}>
                <option value="CRITICAL">Rất nặng, phải dừng máy ngay</option>
                <option value="HIGH">Nặng, cần máy khác đến thay</option>
                <option value="MEDIUM">Vừa, vẫn làm tạm được</option>
              </select>
            </div>
            <div>
              <label htmlFor="in-hours" className={LABEL}>Máy nghỉ khoảng bao nhiêu giờ?</label>
              <input id="in-hours" type="number" min={0.5} step={0.5} inputMode="decimal" value={downtimeHours} onChange={(e) => setDowntimeHours(Number(e.target.value))} className={INPUT} required />
            </div>
            <div>
              <label htmlFor="in-desc" className={LABEL}>Kể sơ chỗ hỏng</label>
              <textarea id="in-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} required placeholder="Ví dụ: nước làm mát bị rò, kim nhiệt lên cao…" className={INPUT} />
            </div>
            <div>
              <p className={LABEL}>Chụp ảnh chỗ hỏng <span className="font-normal text-slate-500">(nếu có)</span></p>
              <label className="flex min-h-14 cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-400 bg-slate-50 px-4 py-3 text-base font-semibold text-slate-700 hover:bg-slate-100">
                <Camera aria-hidden="true" className="h-6 w-6" />
                <span className="truncate">{evidenceFile?.name || 'Bấm để chọn ảnh hoặc chụp ảnh'}</span>
                <input type="file" accept="image/*" capture="environment" onChange={handleFileChange} className="sr-only" />
              </label>
              {fileError && <p role="alert" className="mt-2 text-base font-semibold text-red-700">{fileError}</p>}
              {evidencePreview && <img src={evidencePreview} alt="Ảnh chỗ hỏng đã chọn" className="mt-3 max-h-48 rounded-xl border border-slate-300 object-cover" />}
            </div>
            <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setShowIncidentModal(false)} className="min-h-14 rounded-2xl border-2 border-slate-300 px-6 py-3 text-lg font-semibold text-slate-700 hover:bg-slate-50">Đóng</button>
              <button type="submit" disabled={isSubmitting || !assignedMachine} className="min-h-14 rounded-2xl bg-red-600 px-8 py-3 text-lg font-bold text-white shadow-md hover:bg-red-700 disabled:opacity-60">
                {isSubmitting ? 'Đang gửi…' : 'Gửi báo hỏng'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};
