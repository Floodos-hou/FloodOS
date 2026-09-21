// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import React, { useState } from 'react';
import type { FloodReport, DispatchOrder, FloodZone, SafeShelter, ReportResolution } from '../../types';
import { needType, reportStatus, priority } from '../../utils/labels';
import { Modal } from '../common/Modal';
import { resolutionIdForReport, validateDisputeReason, validateReportDescription } from '../../utils/workflowRules';
import { AlertTriangle, CheckCircle2, Waves, Send, GitBranch } from 'lucide-react';

interface ReporterWorkspaceProps {
  reports: FloodReport[];
  orders: DispatchOrder[];
  zones: FloodZone[];
  shelters: SafeShelter[];
  resolutions?: ReportResolution[];
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

const HANOI_PRESETS = [
  { label: 'Hoàng Mai - Định Công (Khu trũng ven sông)', lat: 20.9782, lng: 105.8450 },
  { label: 'Đống Đa - Nguyễn Khuyến / Văn Miếu', lat: 21.0264, lng: 105.8361 },
  { label: 'Thanh Trì - Triều Khúc / Tân Triều', lat: 20.9850, lng: 105.7984 },
  { label: 'Nam Từ Liêm - Phú Đô / Lê Quang Đạo', lat: 21.0150, lng: 105.7720 },
  { label: 'Tây Hồ - Thụy Khuê / Trích Sài', lat: 21.0451, lng: 105.8182 },
  { label: 'Tự nhập tọa độ thủ công', lat: 20.9662, lng: 105.8714 },
];

export const ReporterWorkspace: React.FC<ReporterWorkspaceProps> = ({
  reports,
  orders,
  zones,
  shelters,
  resolutions = [],
  onCreateReport,
  onConfirmResolution,
  onOpenLineage,
}) => {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [presetIndex, setPresetIndex] = useState(0);
  const [lat, setLat] = useState(HANOI_PRESETS[0].lat);
  const [lng, setLng] = useState(HANOI_PRESETS[0].lng);
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
    const descriptionError = validateReportDescription(description);
    if (descriptionError) {
      setFormError(descriptionError);
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
    const disputeError = decision === 'DISPUTED' ? validateDisputeReason(confirmNotes) : null;
    if (disputeError) {
      setFormError(disputeError);
      return;
    }
    const resolutionId = resolutionIdForReport(confirmModalReport.report_id, resolutions, orders);
    if (!resolutionId) {
      setFormError('Chưa có mã nghiệm thu từ đội hiện trường. Vui lòng liên hệ điều phối viên.');
      return;
    }
    setIsSubmitting(true);
    setFormError(null);
    try {
      await onConfirmResolution(resolutionId, decision, confirmNotes.trim());
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
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-slate-900 p-5 text-white border border-slate-800 shadow-xl">
        <div>
          <div className="inline-flex items-center gap-1.5 rounded-full bg-cyan-950 px-2.5 py-0.5 text-[11px] font-semibold text-cyan-400 border border-cyan-800/60 mb-1">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse" />
            Cổng Tiếp Nhận Ứng Cứu Khẩn Cấp &amp; Sơ Tán
          </div>
          <h2 className="text-xl font-bold tracking-tight text-white">Gửi Tin Báo Ngập &amp; Yêu Cầu Cứu Trợ</h2>
          <p className="mt-1 text-xs text-slate-400">
            Khu vực của bạn đang ngập hoặc cần hỗ trợ sơ tán người già, trẻ nhỏ? Gửi tin báo ngay để Ban Chỉ Huy PCTT điều phối lực lượng.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreateModal(true)}
          className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-rose-950 hover:bg-rose-500 transition"
        >
          <AlertTriangle className="h-4 w-4" />
          <span>Báo điểm ngập khẩn cấp</span>
        </button>
      </div>

      {/* Reports List */}
      <section className="space-y-4">
        <h3 className="text-lg font-bold text-white flex items-center gap-2">
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
                  className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-xl hover:border-slate-700 transition space-y-3.5 text-slate-100"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xl">{nt.icon}</span>
                        <h4 className="text-base font-bold text-white">{nt.text}</h4>
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

                  <p className="rounded-xl bg-slate-950 p-3 text-xs text-slate-300 italic border border-slate-800/80">
                    "{r.description}"
                  </p>

                  <div className="grid grid-cols-2 gap-2 text-xs text-slate-300 bg-slate-950 p-2.5 rounded-xl border border-slate-800/80 font-mono">
                    <div>Mực nước: <strong className="text-cyan-800">{r.depth_cm} cm</strong></div>
                    <div>Số người cần cứu: <strong>{r.people_affected} người</strong></div>
                  </div>

                  {/* Order assignment notice if dispatched */}
                  {relatedOrder && (
                    <div className="rounded-xl bg-sky-950/70 p-3 border border-sky-800/60 text-xs text-sky-200 space-y-1">
                      <div>Lực lượng điều động: <strong>{relatedOrder.team_name || relatedOrder.team_id}</strong></div>
                      <div>Phương tiện: <strong>{relatedOrder.vehicle_name || relatedOrder.vehicle_id}</strong></div>
                      <div>Tiến độ: <strong>{Math.round(relatedOrder.progress_pct || 0)}%</strong></div>
                    </div>
                  )}

                  {/* Pending confirmation notice */}
                  {r.status === 'AWAITING_CONFIRMATION' && (
                    <div className="rounded-2xl bg-amber-50 border-2 border-amber-300 p-3.5 text-xs text-amber-950 space-y-2">
                      <div className="font-bold flex items-center gap-1.5 text-amber-900">
                        <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                        <span>Đội hiện trường đã báo cáo hoàn tất ca tác chiến!</span>
                      </div>
                      <p className="text-amber-800">
                        Vui lòng kiểm tra tình hình thực tế tại chỗ và bấm xác nhận an toàn để đóng hồ sơ vụ việc, hoặc phản ánh nếu nước chưa rút.
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmModalReport(r);
                          setConfirmNotes('Nước đã rút an toàn, đã nhận hỗ trợ đầy đủ.');
                        }}
                        className="w-full py-2.5 px-4 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs shadow flex items-center justify-center gap-2 transition"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        <span>Nghiệm thu &amp; Xác nhận an toàn ngay</span>
                      </button>
                    </div>
                  )}

                  {/* Actions for Reporter */}
                  <div className="pt-2 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100">
                    {r.status === 'RESOLVED' && (
                      <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-xl border border-emerald-200">
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        <span>Đã nghiệm thu an toàn &amp; niêm phong sổ cái</span>
                      </span>
                    )}

                    <button
                      type="button"
                      onClick={() => onOpenLineage?.(r.correlation_id || `CORR-${r.report_id}`)}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 hover:text-sky-900 ml-auto"
                    >
                      <GitBranch className="h-3.5 w-3.5" />
                      <span>Xem phả hệ dữ liệu (Lineage)</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>


      {/* Live Safe Shelters Finder Section */}
      <section className="space-y-3 pt-4 border-t border-slate-800">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <span>Điểm sơ tán an toàn lân cận</span>
            <span className="text-xs font-mono font-semibold text-slate-400">({shelters.length} điểm)</span>
          </h3>
          <span className="text-xs text-emerald-400 font-semibold flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            Trực ban 24/7
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {shelters.map((sh) => (
            <div key={sh.shelter_id} className="p-4 rounded-xl bg-slate-900 border border-slate-800 text-slate-200 shadow-md flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="font-bold text-white text-sm">{sh.name}</span>
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-800/70 font-mono font-bold">
                    {sh.occupancy ?? 0}/{sh.capacity} chỗ
                  </span>
                </div>
                <p className="text-xs text-slate-400 mb-2 leading-relaxed">{sh.address}</p>
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-400 border-t border-slate-800 pt-2 font-mono">
                <span className="text-emerald-400 font-semibold">Mở cửa tiếp nhận</span>
                <span>[{sh.lat.toFixed(4)}, {sh.lng.toFixed(4)}]</span>
              </div>
            </div>
          ))}
        </div>
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
                Địa bàn phát sinh ngập lụt (Hà Nội)
              </label>
              <select
                value={presetIndex}
                onChange={(e) => {
                  const idx = Number(e.target.value);
                  setPresetIndex(idx);
                  if (idx < HANOI_PRESETS.length) {
                    setLat(HANOI_PRESETS[idx].lat);
                    setLng(HANOI_PRESETS[idx].lng);
                  }
                }}
                className="w-full rounded-xl border border-slate-300 p-2.5 text-sm font-semibold focus:border-sky-500 focus:outline-none mb-2"
              >
                {HANOI_PRESETS.map((p, idx) => (
                  <option key={p.label} value={idx}>
                    📍 {p.label}
                  </option>
                ))}
              </select>

              {presetIndex === HANOI_PRESETS.length - 1 && (
                <div className="grid grid-cols-2 gap-2 mt-1 mb-2">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-500">Vĩ độ (Latitude)</label>
                    <input
                      type="number"
                      step="0.0001"
                      value={lat}
                      onChange={(e) => setLat(Number(e.target.value))}
                      className="w-full rounded-xl border border-slate-300 p-2 text-xs"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-500">Kinh độ (Longitude)</label>
                    <input
                      type="number"
                      step="0.0001"
                      value={lng}
                      onChange={(e) => setLng(Number(e.target.value))}
                      className="w-full rounded-xl border border-slate-300 p-2 text-xs"
                      required
                    />
                  </div>
                </div>
              )}
            </div>

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
      {confirmModalReport && (() => {
        const matchingRes = resolutions.find((res) => res.report_id === confirmModalReport.report_id);
        const matchingOrder = orders.find((o) => o.report_id === confirmModalReport.report_id);

        return (
          <Modal
            isOpen={!!confirmModalReport}
            onClose={() => setConfirmModalReport(null)}
            title="Nghiệm thu &amp; Xác nhận Kết quả Cứu trợ"
          >
            <div className="space-y-4">
              {formError && (
                <div className="rounded-xl bg-rose-50 p-3 text-xs text-rose-800 border border-rose-200">
                  {formError}
                </div>
              )}

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-1">
                <div><strong>Mã tin báo:</strong> #{confirmModalReport.report_id}</div>
                <div><strong>Lực lượng thực hiện:</strong> {matchingOrder?.team_name || matchingOrder?.team_id || 'Đội ứng cứu cơ động'}</div>
                <div><strong>Phương tiện:</strong> {matchingOrder?.vehicle_name || matchingOrder?.vehicle_id || 'Xuồng cứu hộ'}</div>
                {matchingRes && (
                  <>
                    <div><strong>Kết quả hiện trường:</strong> <span className="font-bold text-emerald-700">{matchingRes.outcome}</span></div>
                    {matchingRes.notes && <div><strong>Ghi chú từ đội:</strong> {matchingRes.notes}</div>}
                  </>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold uppercase text-slate-700 mb-1">
                  Ý kiến phản hồi của người dân / người báo tin
                </label>
                <textarea
                  rows={3}
                  value={confirmNotes}
                  onChange={(e) => setConfirmNotes(e.target.value)}
                  placeholder="Xác nhận nước đã rút, người dân an toàn; hoặc phản ánh nếu còn người mắc kẹt..."
                  className="w-full rounded-xl border border-slate-300 p-2.5 text-sm outline-none focus:border-emerald-500"
                  required
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => handleConfirm('DISPUTED')}
                  disabled={isSubmitting}
                  className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-2 text-xs font-bold text-rose-800 hover:bg-rose-100"
                >
                  ⚠️ Phản đối / Nước chưa rút
                </button>
                <button
                  type="button"
                  onClick={() => handleConfirm('CONFIRMED')}
                  disabled={isSubmitting}
                  className="rounded-xl bg-emerald-700 px-5 py-2 text-xs font-bold text-white shadow hover:bg-emerald-600 disabled:opacity-50"
                >
                  {isSubmitting ? 'Đang gửi...' : '✅ Xác nhận an toàn (Nghiệm thu)'}
                </button>
              </div>
            </div>
          </Modal>
        );
      })()}
    </div>
  );
};
