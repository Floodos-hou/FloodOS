// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import React, { useState } from 'react';
import type { FloodReport, DispatchOrder, FloodZone, SafeShelter } from '../../types';
import { needType, reportStatus, priority, formatLocalDateTime } from '../../utils/labels';
import { Modal } from '../common/Modal';
import { AlertTriangle, CheckCircle2, Waves, Send, Camera, ShieldCheck, Home, GitBranch, MapPin } from 'lucide-react';

interface ReporterWorkspaceProps {
  reports: FloodReport[];
  orders: DispatchOrder[];
  zones: FloodZone[];
  shelters: SafeShelter[];
  onCreateReport: (data: {
    lat: number;
    lng: number;
    depth_cm: number;
    need_type: string;
    people_affected: number;
    description: string;
    evidence_filename?: string;
    evidence_data_url?: string;
  }) => Promise<void>;
  onConfirmResolution: (resolutionId: string, decision: 'CONFIRMED' | 'DISPUTED', notes?: string) => Promise<void>;
  onOpenLineage?: (corrId: string) => void;
}

export const ReporterWorkspace: React.FC<ReporterWorkspaceProps> = ({
  reports,
  orders,
  zones,
  shelters,
  onCreateReport,
  onConfirmResolution,
  onOpenLineage,
}) => {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [lat, setLat] = useState(20.9662);
  const [lng, setLng] = useState(105.8714);
  const [depthCm, setDepthCm] = useState(55);
  const [need, setNeed] = useState('EVACUATION');
  const [peopleAffected, setPeopleAffected] = useState(5);
  const [description, setDescription] = useState('');
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [evidencePreview, setEvidencePreview] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [confirmModalReport, setConfirmModalReport] = useState<FloodReport | null>(null);
  const [confirmNotes, setConfirmNotes] = useState('');

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setFormError('Chỉ chấp nhận tệp tin hình ảnh (JPEG, PNG, WebP).');
      return;
    }
    setFormError(null);
    setEvidenceFile(file);
    const reader = new FileReader();
    reader.onload = () => setEvidencePreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim()) {
      setFormError('Vui lòng nhập mô tả tình hình ngập tại hiện trường.');
      return;
    }
    setIsSubmitting(true);
    setFormError(null);
    try {
      await onCreateReport({
        lat,
        lng,
        depth_cm: depthCm,
        need_type: need,
        people_affected: peopleAffected,
        description: description.trim(),
        evidence_filename: evidenceFile?.name,
        evidence_data_url: evidencePreview || undefined,
      });
      setShowCreateModal(false);
      setDescription('');
      setEvidenceFile(null);
      setEvidencePreview(null);
    } catch (err: any) {
      setFormError(err.message || 'Không thể gửi tin báo ngập. Vui lòng thử lại.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirm = async (decision: 'CONFIRMED' | 'DISPUTED') => {
    if (!confirmModalReport) return;
    setIsSubmitting(true);
    try {
      await onConfirmResolution(confirmModalReport.report_id, decision, confirmNotes.trim());
      setConfirmModalReport(null);
      setConfirmNotes('');
    } catch (err: any) {
      setFormError(err.message || 'Lỗi khi gửi xác nhận.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-3xl bg-gradient-to-r from-sky-900 to-blue-900 p-6 text-white shadow-xl">
        <div>
          <h2 className="text-2xl font-bold">Cổng Tiếp nhận Cứu trợ Người dân</h2>
          <p className="mt-1 text-sm text-sky-100">
            Khu vực của bạn đang ngập hoặc cần hỗ trợ y tế, sơ tán? Hãy gửi tin báo ngay để Ban Chỉ huy điều phối lực lượng.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreateModal(true)}
          className="inline-flex items-center gap-2 rounded-2xl bg-amber-500 px-6 py-3.5 text-base font-bold text-slate-950 shadow-lg hover:bg-amber-400 transition"
        >
          <AlertTriangle className="h-5 w-5" />
          <span>🚨 Báo điểm ngập khẩn cấp</span>
        </button>
      </div>

      {/* Reports List */}
      <section className="space-y-4">
        <h3 className="text-xl font-bold text-slate-900 flex items-center gap-2">
          <span>Tin báo ngập của tôi</span>
          <span className="text-sm font-semibold text-slate-500">({reports.length} tin)</span>
        </h3>

        {reports.length === 0 ? (
          <div className="rounded-3xl border-2 border-dashed border-slate-300 p-12 text-center text-slate-500 bg-white">
            <Waves className="mx-auto h-12 w-12 text-slate-400" />
            <p className="mt-3 text-base font-semibold">Bạn chưa gửi tin báo ngập nào.</p>
            <p className="text-xs text-slate-400 mt-1">Khi gặp sự cố ngập lụt, hãy bấm nút báo tin ở trên.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {reports.map((r) => {
              const nt = needType(r.need_type);
              const st = reportStatus(r.status);
              const prio = priority(r.priority);
              const relatedOrder = orders.find((o) => o.report_id === r.report_id);

              return (
                <div
                  key={r.report_id}
                  className="rounded-3xl border border-slate-200 bg-white p-6 shadow-md hover:shadow-lg transition space-y-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xl">{nt.icon}</span>
                        <h4 className="text-lg font-bold text-slate-900">{nt.text}</h4>
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        Mã tin: <strong>{r.report_id}</strong> · {new Date(r.created_at).toLocaleTimeString('vi-VN')}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-3 py-0.5 text-xs font-bold text-sky-800">
                        {st.icon} {st.text}
                      </span>
                      {r.priority && (
                        <span className="text-[11px] font-semibold text-slate-500">
                          Ưu tiên: <strong>{prio.text}</strong>
                        </span>
                      )}
                    </div>
                  </div>

                  <p className="rounded-2xl bg-slate-50 p-3.5 text-sm text-slate-800 italic border border-slate-100">
                    "{r.description}"
                  </p>

                  <div className="grid grid-cols-2 gap-2 text-xs text-slate-600 bg-slate-50/70 p-3 rounded-2xl">
                    <div>Mực nước: <strong className="text-cyan-800">{r.depth_cm} cm</strong></div>
                    <div>Số người cần cứu: <strong>{r.people_affected} người</strong></div>
                  </div>

                  {/* Order assignment notice if dispatched */}
                  {relatedOrder && (
                    <div className="rounded-2xl bg-sky-50 p-3 border border-sky-200 text-xs text-sky-900 space-y-1">
                      <div>Lực lượng điều động: <strong>{relatedOrder.team_name || relatedOrder.team_id}</strong></div>
                      <div>Phương tiện: <strong>{relatedOrder.vehicle_name || relatedOrder.vehicle_id}</strong></div>
                      <div>Tiến độ: <strong>{Math.round(relatedOrder.progress_pct)}%</strong></div>
                    </div>
                  )}

                  {/* Actions for Reporter */}
                  <div className="pt-2 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100">
                    {r.status === 'RESOLVED' && (
                      <button
                        type="button"
                        onClick={() => setConfirmModalReport(r)}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-600 transition"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        <span>Xác nhận đã an toàn (Nghiệm thu)</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => onOpenLineage?.(r.correlation_id || `CORR-${r.report_id}`)}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 hover:text-sky-900 ml-auto"
                    >
                      <GitBranch className="h-3.5 w-3.5" />
                      <span>Xem phả hệ dữ liệu</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Create Flood Report Modal */}
      {showCreateModal && (
        <Modal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} title="🚨 Báo điểm ngập lụt khẩn cấp">
          <form onSubmit={handleSubmit} className="space-y-4">
            {formError && (
              <div className="rounded-2xl bg-red-50 p-3 text-sm text-red-800 border border-red-200">
                {formError}
              </div>
            )}

            <div>
              <label className="block text-xs font-bold uppercase text-slate-700 mb-1">
                Nhu cầu hỗ trợ khẩn cấp
              </label>
              <select
                value={need}
                onChange={(e) => setNeed(e.target.value)}
                className="w-full rounded-xl border border-slate-300 p-2.5 text-sm font-semibold focus:border-sky-500 focus:outline-none"
              >
                <option value="EVACUATION">🚤 Sơ tán người dân (người già, trẻ nhỏ)</option>
                <option value="MEDICAL">🚑 Cấp cứu y tế khẩn cấp</option>
                <option value="FOOD_WATER">🍞 Tiếp tế lương thực & nước sạch</option>
                <option value="PUMPING">💧 Bơm tiêu úng hầm / sân nhà</option>
                <option value="ROAD_BLOCKED">⛔ Đường bị ngập sâu cô lập</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold uppercase text-slate-700 mb-1">
                  Mực nước ước tính (cm)
                </label>
                <input
                  type="number"
                  min="5"
                  max="500"
                  value={depthCm}
                  onChange={(e) => setDepthCm(Number(e.target.value))}
                  className="w-full rounded-xl border border-slate-300 p-2.5 text-sm focus:border-sky-500 focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase text-slate-700 mb-1">
                  Số người bị ảnh hưởng
                </label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={peopleAffected}
                  onChange={(e) => setPeopleAffected(Number(e.target.value))}
                  className="w-full rounded-xl border border-slate-300 p-2.5 text-sm focus:border-sky-500 focus:outline-none"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase text-slate-700 mb-1">
                Mô tả chi tiết tình hình hiện trường
              </label>
              <textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Ví dụ: Nước tràn vào nhà ngập 60cm, trong nhà có người già không thể tự di chuyển..."
                className="w-full rounded-xl border border-slate-300 p-2.5 text-sm focus:border-sky-500 focus:outline-none"
                required
              />
            </div>

            {/* Evidence Photo */}
            <div>
              <label className="block text-xs font-bold uppercase text-slate-700 mb-1">
                Ảnh chụp mực nước hiện trường (quét mã độc qua ClamAV)
              </label>
              <input
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                className="w-full text-xs text-slate-500 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-sky-50 file:text-sky-700 hover:file:bg-sky-100"
              />
              {evidencePreview && (
                <div className="mt-2 relative rounded-2xl overflow-hidden border border-slate-200 max-h-40">
                  <img src={evidencePreview} alt="Preview" className="w-full h-full object-cover" />
                </div>
              )}
            </div>

            <div className="pt-2 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="inline-flex items-center gap-1.5 rounded-xl bg-sky-800 px-5 py-2.5 text-sm font-bold text-white shadow hover:bg-sky-700 disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
                <span>{isSubmitting ? 'Đang gửi…' : 'Gửi tin báo cho Ban chỉ huy'}</span>
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Confirmation Modal */}
      {confirmModalReport && (
        <Modal
          isOpen={!!confirmModalReport}
          onClose={() => setConfirmModalReport(null)}
          title="Xác nhận Kết quả Ứng cứu (Nghiệm thu)"
        >
          <div className="space-y-4">
            <p className="text-sm text-slate-700">
              Bạn đang xác nhận cho tin báo: <strong>{confirmModalReport.report_id}</strong>. Lực lượng cứu trợ đã hoàn tất ca xử lý.
            </p>

            <div>
              <label className="block text-xs font-bold uppercase text-slate-700 mb-1">
                Ghi chú hoặc phản hồi thực tế (nếu có)
              </label>
              <textarea
                rows={2}
                value={confirmNotes}
                onChange={(e) => setConfirmNotes(e.target.value)}
                placeholder="Ghi nhận nước đã rút an toàn hoặc góp ý cho đội cứu hộ..."
                className="w-full rounded-xl border border-slate-300 p-2.5 text-sm"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => handleConfirm('DISPUTED')}
                disabled={isSubmitting}
                className="rounded-xl border border-red-300 bg-red-50 px-4 py-2 text-sm font-bold text-red-800 hover:bg-red-100"
              >
                Phản đối (Chưa đạt)
              </button>
              <button
                type="button"
                onClick={() => handleConfirm('CONFIRMED')}
                disabled={isSubmitting}
                className="rounded-xl bg-emerald-700 px-5 py-2 text-sm font-bold text-white shadow hover:bg-emerald-600"
              >
                Xác nhận an toàn (Đóng vụ việc)
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
