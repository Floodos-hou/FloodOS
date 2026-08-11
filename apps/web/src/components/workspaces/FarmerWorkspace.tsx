// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import React, { useState } from 'react';
import { FieldPlot, ServiceRequest, DispatchAssignment, WorkAcceptance } from '../../types';
import { Star, CheckCircle2, Phone, Tractor, CalendarClock } from 'lucide-react';
import { fromDateTimeLocal, formatLocalDateTime, defaultHarvestWindow } from '../../utils/dateTime';
import { fieldStatus, requestStatus, priority as priorityLabel } from '../../utils/labels';
import { Modal } from '../common/Modal';
import { StatusBadge } from '../common/StatusBadge';
import { ProgressSteps } from '../common/ProgressSteps';
import { completedSteps } from '../../utils/progress';

interface FarmerWorkspaceProps {
  fields: FieldPlot[];
  requests: ServiceRequest[];
  assignments: DispatchAssignment[];
  acceptances: WorkAcceptance[];
  onCreateRequest: (data: {
    field_id: string;
    requested_start: string;
    requested_end: string;
    priority: string;
    notes: string;
  }) => Promise<void>;
  onConfirmAcceptance: (data: {
    assignment_id: string;
    rating: number;
    notes: string;
  }) => Promise<void>;
}

const INPUT = 'w-full rounded-xl border-2 border-slate-300 bg-white p-3 text-base text-slate-900 outline-none focus:border-emerald-600 focus:ring-4 focus:ring-emerald-200';
const LABEL = 'mb-1.5 block text-base font-semibold text-slate-800';

export const FarmerWorkspace: React.FC<FarmerWorkspaceProps> = ({
  fields,
  requests,
  assignments,
  acceptances,
  onCreateRequest,
  onConfirmAcceptance,
}) => {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedFieldId, setSelectedFieldId] = useState(fields[0]?.field_id || '');
  const [initialWindow] = useState(defaultHarvestWindow);
  const [startTime, setStartTime] = useState(initialWindow.start);
  const [endTime, setEndTime] = useState(initialWindow.end);
  const [priority, setPriority] = useState('NORMAL');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [showAcceptModal, setShowAcceptModal] = useState<string | null>(null);
  const [rating, setRating] = useState(5);
  const [acceptNotes, setAcceptNotes] = useState('');

  const fieldId = selectedFieldId || fields[0]?.field_id || '';

  const handleSubmitRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fieldId) return;
    if (new Date(endTime) <= new Date(startTime)) {
      setFormError('Giờ xong phải sau giờ bắt đầu. Bác kiểm tra lại giúp nhé.');
      return;
    }
    setFormError(null);
    setIsSubmitting(true);
    try {
      await onCreateRequest({
        field_id: fieldId,
        requested_start: fromDateTimeLocal(startTime),
        requested_end: fromDateTimeLocal(endTime),
        priority,
        notes: notes.trim(),
      });
      setShowCreateModal(false);
      setNotes('');
    } catch (err: any) {
      setFormError(err?.message || 'Chưa gửi được yêu cầu. Bác kiểm tra kết nối rồi thử lại.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmAcceptance = async (asgId: string) => {
    setIsSubmitting(true);
    try {
      await onConfirmAcceptance({ assignment_id: asgId, rating, notes: acceptNotes.trim() });
      setShowAcceptModal(null);
      setAcceptNotes('');
    } catch (err: any) {
      setFormError(err?.message || 'Chưa xác nhận được nghiệm thu. Vui lòng thử lại.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const openRequests = requests.filter((r) => r.status !== 'COMPLETED' && r.status !== 'CANCELLED');

  return (
    <div className="space-y-8">
      {/* Việc chính: gọi máy gặt */}
      <section className="rounded-3xl bg-gradient-to-br from-amber-300 via-amber-200 to-amber-100 p-6 shadow-lg ring-1 ring-amber-400 sm:p-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-4">
            <span className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-emerald-700 text-white shadow-md" aria-hidden="true"><Tractor className="h-9 w-9" /></span>
            <div>
              <h2 className="text-2xl font-bold text-emerald-950 sm:text-3xl">Cần máy gặt cho ruộng của bác?</h2>
              <p className="mt-1 text-lg text-emerald-900">Bấm nút bên cạnh, chọn ruộng và ngày gặt. HTX sẽ xếp máy và thợ lái cho bác.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            disabled={fields.length === 0}
            className="min-h-16 shrink-0 rounded-2xl bg-emerald-700 px-8 py-4 text-xl font-bold text-white shadow-lg transition hover:bg-emerald-600 focus:outline-none focus-visible:ring-4 focus-visible:ring-emerald-300 disabled:opacity-50"
          >
            🌾 Gọi máy gặt
          </button>
        </div>
      </section>

      {/* Ruộng của tôi */}
      <section aria-labelledby="my-fields">
        <h2 id="my-fields" className="mb-4 text-2xl font-bold text-slate-900">🌾 Ruộng của tôi <span className="text-lg font-semibold text-slate-500">({fields.length} thửa)</span></h2>
        {fields.length === 0 ? (
          <p className="rounded-2xl border-2 border-dashed border-slate-300 p-6 text-lg text-slate-600">Chưa có thửa ruộng nào được ghi tên bác. Bác liên hệ HTX để được thêm vào nhé.</p>
        ) : (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
            {fields.map((field) => {
              const st = fieldStatus(field.readiness_status);
              const pct = Math.round(Number(field.harvest_progress_pct) || 0);
              return (
                <article key={field.field_id} className="rounded-3xl border-2 border-emerald-200 bg-white p-5 shadow-md">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-xl font-bold text-slate-900">{field.name}</h3>
                      <p className="text-base text-slate-600">{field.hamlet}</p>
                    </div>
                    <span className="shrink-0 rounded-xl bg-emerald-700 px-3 py-1.5 text-lg font-bold text-white">{field.area_ha} ha</span>
                  </div>
                  <dl className="mt-4 space-y-2 text-base">
                    <div className="flex justify-between gap-3"><dt className="text-slate-600">Giống lúa</dt><dd className="text-right font-semibold text-slate-900">{field.crop}</dd></div>
                    <div className="flex items-center justify-between gap-3"><dt className="text-slate-600">Tình trạng</dt><dd><StatusBadge label={st} /></dd></div>
                  </dl>
                  <div className="mt-4">
                    <div className="mb-1.5 flex justify-between text-base"><span className="text-slate-600">Đã gặt được</span><strong className="text-slate-900">{pct}%</strong></div>
                    <div className="h-4 w-full overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`Tiến độ gặt ${field.name}`}>
                      <div className="h-4 rounded-full bg-emerald-600 transition-all duration-500" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Yêu cầu của tôi */}
      <section aria-labelledby="my-requests">
        <h2 id="my-requests" className="mb-4 text-2xl font-bold text-slate-900">📋 Yêu cầu gặt của tôi <span className="text-lg font-semibold text-slate-500">({openRequests.length} đang theo dõi)</span></h2>
        {requests.length === 0 ? (
          <p className="rounded-2xl border-2 border-dashed border-slate-300 p-6 text-lg text-slate-600">Bác chưa gửi yêu cầu nào. Bấm nút <strong>“Gọi máy gặt”</strong> ở trên để bắt đầu.</p>
        ) : (
          <ul className="space-y-4">
            {requests.map((req) => {
              const asg = assignments.find((a) => a.request_id === req.request_id);
              const isAccepted = acceptances.some((acc) => acc.assignment_id === asg?.assignment_id);
              const field = fields.find((f) => f.field_id === req.field_id);
              const pr = priorityLabel(req.priority);
              return (
                <li key={req.request_id} className="rounded-3xl border-2 border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-xl font-bold text-slate-900">{field?.name || req.field_id}</h3>
                      <p className="mt-1 flex items-center gap-2 text-base text-slate-600"><CalendarClock aria-hidden="true" className="h-5 w-5" />Gặt từ {formatLocalDateTime(req.requested_start)}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge label={requestStatus(req.status)} />
                      <span className="rounded-full border border-slate-300 bg-slate-50 px-3 py-1 text-sm font-semibold text-slate-700">Mức gấp: {pr.text}</span>
                    </div>
                  </div>

                  {(() => { const { done, problem } = completedSteps(req, asg, isAccepted); return (
                    <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4">
                      <ProgressSteps done={done} problem={problem} />
                    </div>
                  ); })()}

                  <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-base">
                    {asg ? (
                      <p className="text-slate-800">
                        🚜 Máy <strong>{asg.machine_name || asg.machine_id}</strong>, thợ lái <strong>{asg.operator_name || asg.operator_id}</strong>
                      </p>
                    ) : (
                      <p className="text-slate-600">⏳ HTX chưa xếp máy. Có kết quả, bác sẽ thấy ngay tại đây.</p>
                    )}
                  </div>

                  {asg && (
                    <div className="mt-4">
                      {isAccepted ? (
                        <p className="inline-flex items-center gap-2 text-lg font-bold text-emerald-800"><CheckCircle2 aria-hidden="true" className="h-6 w-6" />Bác đã xác nhận gặt xong</p>
                      ) : asg.status === 'COMPLETED' ? (
                        <button type="button" onClick={() => setShowAcceptModal(asg.assignment_id)} className="min-h-14 rounded-2xl bg-emerald-700 px-6 py-3 text-lg font-bold text-white shadow-md hover:bg-emerald-600">
                          ✍️ Xác nhận đã gặt xong
                        </button>
                      ) : (
                        <p className="text-base text-slate-600">Khi thợ lái làm xong, nút xác nhận sẽ hiện ở đây.</p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <p className="flex items-center gap-2 rounded-2xl bg-emerald-50 p-4 text-base text-emerald-900">
        <Phone aria-hidden="true" className="h-5 w-5 shrink-0" />Cần hỗ trợ gấp? Bác gọi điều phối viên HTX để được giúp ngay.
      </p>

      {showCreateModal && (
        <Modal title="Gọi máy gặt cho ruộng" onClose={() => setShowCreateModal(false)}>
          <form onSubmit={handleSubmitRequest} className="space-y-5">
            <div>
              <label htmlFor="rq-field" className={LABEL}>Ruộng nào cần gặt?</label>
              <select id="rq-field" value={fieldId} onChange={(e) => setSelectedFieldId(e.target.value)} className={INPUT} required>
                {fields.map((f) => (
                  <option key={f.field_id} value={f.field_id}>{f.name} ({f.area_ha} ha)</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="rq-start" className={LABEL}>Bắt đầu lúc</label>
                <input id="rq-start" type="datetime-local" value={startTime} onChange={(e) => setStartTime(e.target.value)} className={INPUT} required />
              </div>
              <div>
                <label htmlFor="rq-end" className={LABEL}>Xong trước lúc</label>
                <input id="rq-end" type="datetime-local" value={endTime} onChange={(e) => setEndTime(e.target.value)} className={INPUT} required />
              </div>
            </div>
            <div>
              <label htmlFor="rq-prio" className={LABEL}>Mức độ gấp</label>
              <select id="rq-prio" value={priority} onChange={(e) => setPriority(e.target.value)} className={INPUT}>
                <option value="NORMAL">Bình thường</option>
                <option value="HIGH">Gấp, lúa đã chín rộ</option>
                <option value="URGENT">Rất gấp, sắp mưa hoặc nước lên</option>
              </select>
            </div>
            <div>
              <label htmlFor="rq-notes" className={LABEL}>Lời nhắn cho HTX <span className="font-normal text-slate-500">(không bắt buộc)</span></label>
              <textarea id="rq-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Ví dụ: ruộng bị đổ ngã, xin gặt sớm…" className={INPUT} />
            </div>
            {formError && <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-base font-semibold text-red-800">{formError}</p>}
            <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setShowCreateModal(false)} className="min-h-14 rounded-2xl border-2 border-slate-300 px-6 py-3 text-lg font-semibold text-slate-700 hover:bg-slate-50">Để sau</button>
              <button type="submit" disabled={isSubmitting} className="min-h-14 rounded-2xl bg-emerald-700 px-8 py-3 text-lg font-bold text-white shadow-md hover:bg-emerald-600 disabled:opacity-60">
                {isSubmitting ? 'Đang gửi…' : 'Gửi cho HTX'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {showAcceptModal && (
        <Modal title="Xác nhận đã gặt xong" onClose={() => setShowAcceptModal(null)}>
          <div className="space-y-5">
            <p className="rounded-2xl bg-emerald-50 p-4 text-base text-emerald-900">
              Bác xác nhận ruộng đã được gặt sạch, máy làm việc an toàn và không làm rơi vãi lúa.
            </p>
            <div>
              <p className={LABEL}>Bác chấm mấy sao cho lần gặt này?</p>
              <div className="flex gap-1" role="radiogroup" aria-label="Số sao đánh giá">
                {[1, 2, 3, 4, 5].map((s) => (
                  <button key={s} type="button" role="radio" aria-checked={s === rating} aria-label={`${s} sao`} onClick={() => setRating(s)} className={`rounded-xl p-2 transition ${s <= rating ? 'text-amber-500' : 'text-slate-300'}`}>
                    <Star aria-hidden="true" className="h-10 w-10 fill-current" />
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label htmlFor="ac-notes" className={LABEL}>Bác muốn nhắn thêm gì? <span className="font-normal text-slate-500">(không bắt buộc)</span></label>
              <textarea id="ac-notes" value={acceptNotes} onChange={(e) => setAcceptNotes(e.target.value)} rows={3} className={INPUT} />
            </div>
            <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setShowAcceptModal(null)} className="min-h-14 rounded-2xl border-2 border-slate-300 px-6 py-3 text-lg font-semibold text-slate-700 hover:bg-slate-50">Đóng</button>
              <button type="button" onClick={() => handleConfirmAcceptance(showAcceptModal)} disabled={isSubmitting} className="min-h-14 rounded-2xl bg-emerald-700 px-8 py-3 text-lg font-bold text-white shadow-md hover:bg-emerald-600 disabled:opacity-60">
                {isSubmitting ? 'Đang lưu…' : 'Xác nhận'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
