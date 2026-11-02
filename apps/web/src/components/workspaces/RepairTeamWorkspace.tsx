// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import React, { useState } from 'react';
import { MachineIncident, HarvesterMachine } from '../../types';
import { incidentStatus, incidentType, severity } from '../../utils/labels';
import { formatLocalDateTime } from '../../utils/dateTime';
import { Modal } from '../common/Modal';
import { StatusBadge } from '../common/StatusBadge';

interface RepairTeamWorkspaceProps {
  incidents: MachineIncident[];
  machines: HarvesterMachine[];
  onUpdateRepair: (
    incidentId: string,
    data: { diagnosis: string; estimated_downtime_hours?: number; is_resolved?: boolean }
  ) => Promise<void>;
}

const INPUT = 'w-full rounded-xl border-2 border-slate-300 bg-white p-3 text-base text-slate-900 outline-none focus:border-emerald-600 focus:ring-4 focus:ring-emerald-200';
const LABEL = 'mb-1.5 block text-base font-semibold text-slate-800';

export const RepairTeamWorkspace: React.FC<RepairTeamWorkspaceProps> = ({ incidents, machines, onUpdateRepair }) => {
  const [selected, setSelected] = useState<MachineIncident | null>(null);
  const [diagnosis, setDiagnosis] = useState('');
  const [isResolved, setIsResolved] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const todo = incidents.filter((i) => i.status !== 'RESOLVED');
  const done = incidents.filter((i) => i.status === 'RESOLVED');
  const machineName = (id: string) => machines.find((m) => m.machine_id === id)?.name || `Máy ${id}`;

  const open = (inc: MachineIncident) => {
    setSelected(inc);
    setDiagnosis('');
    setIsResolved(false);
    setFormError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    if (!diagnosis.trim()) {
      setFormError('Bạn ghi lại vài dòng về chỗ hỏng và cách đã sửa nhé.');
      return;
    }
    setIsSubmitting(true);
    setFormError(null);
    try {
      await onUpdateRepair(selected.incident_id, { diagnosis: diagnosis.trim(), is_resolved: isResolved });
      setSelected(null);
    } catch (err: any) {
      setFormError(err?.message || 'Chưa lưu được kết quả sửa chữa. Bạn thử lại nhé.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-10">
      <section aria-labelledby="rp-todo">
        <h2 id="rp-todo" className="mb-4 text-2xl font-bold text-slate-900">🛠️ Máy đang chờ sửa <span className="text-lg font-semibold text-slate-500">({todo.length})</span></h2>
        {todo.length === 0 ? (
          <p className="rounded-3xl border-2 border-dashed border-emerald-300 bg-emerald-50 p-8 text-center text-xl font-semibold text-emerald-900">🎉 Không có máy nào cần sửa. Toàn bộ máy gặt đang hoạt động tốt!</p>
        ) : (
          <ul className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {todo.map((inc) => {
              const sev = severity(inc.severity);
              return (
                <li key={inc.incident_id} className="flex flex-col rounded-3xl border-2 border-red-300 bg-white p-5 shadow-md">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-xl font-bold text-slate-900">{machineName(inc.machine_id)}</h3>
                      <p className="mt-1 text-lg font-semibold text-red-800">{incidentType(inc.incident_type)}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <StatusBadge label={{ text: `Hỏng ${sev.text.toLowerCase()}`, tone: sev.tone, icon: '' }} />
                      <StatusBadge label={incidentStatus(inc.status)} />
                    </div>
                  </div>
                  {inc.description && <p className="mt-3 rounded-xl bg-slate-50 p-3 text-base italic text-slate-700">“{inc.description}”</p>}
                  <dl className="mt-3 grid grid-cols-2 gap-3 text-base">
                    <div className="rounded-2xl bg-slate-50 p-3"><dt className="text-sm text-slate-600">Dự kiến nghỉ</dt><dd className="text-lg font-bold text-slate-900">{inc.estimated_downtime_hours} giờ</dd></div>
                    <div className="rounded-2xl bg-slate-50 p-3"><dt className="text-sm text-slate-600">Báo lúc</dt><dd className="text-lg font-bold text-slate-900">{formatLocalDateTime(inc.created_at)}</dd></div>
                  </dl>
                  <p className="mt-3 text-base text-slate-600">{inc.evidence_s3_key ? '📷 Có ảnh hiện trường kèm theo' : 'Không có ảnh hiện trường'}</p>
                  <button type="button" onClick={() => open(inc)} className="mt-5 min-h-14 rounded-2xl bg-orange-600 px-6 py-3 text-lg font-bold text-white shadow-md transition hover:bg-orange-500 focus:outline-none focus-visible:ring-4 focus-visible:ring-orange-300">
                    🔧 Ghi nhận sửa chữa
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {done.length > 0 && (
        <section aria-labelledby="rp-done">
          <h2 id="rp-done" className="mb-4 text-2xl font-bold text-slate-900">✅ Đã khắc phục <span className="text-lg font-semibold text-slate-500">({done.length})</span></h2>
          <ul className="space-y-3">
            {done.map((inc) => (
              <li key={inc.incident_id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-lg font-bold text-slate-900">{machineName(inc.machine_id)}: {incidentType(inc.incident_type)}</p>
                <StatusBadge label={incidentStatus(inc.status)} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {selected && (
        <Modal title="Ghi nhận sửa chữa" onClose={() => setSelected(null)}>
          <form onSubmit={submit} className="space-y-5">
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="text-lg font-bold text-slate-900">{machineName(selected.machine_id)}</p>
              <p className="text-base font-semibold text-red-800">{incidentType(selected.incident_type)}</p>
              {selected.description && <p className="mt-1 text-base italic text-slate-600">“{selected.description}”</p>}
            </div>
            <div>
              <label htmlFor="rp-diag" className={LABEL}>Chỗ hỏng và cách đã sửa</label>
              <textarea id="rp-diag" value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} rows={4} required placeholder="Ví dụ: đã thay két nước làm mát, vệ sinh cánh tản nhiệt…" className={INPUT} />
            </div>
            <label className="flex min-h-14 cursor-pointer items-start gap-3 rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-4 text-base font-semibold text-emerald-950">
              <input type="checkbox" checked={isResolved} onChange={(e) => setIsResolved(e.target.checked)} className="mt-1 h-6 w-6 shrink-0 accent-emerald-700" />
              <span>Máy đã sửa xong, có thể đi gặt lại</span>
            </label>
            {formError && <p role="alert" className="rounded-xl border-2 border-red-300 bg-red-50 p-3 text-base font-semibold text-red-900">{formError}</p>}
            <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setSelected(null)} className="min-h-14 rounded-2xl border-2 border-slate-300 px-6 py-3 text-lg font-semibold text-slate-700 hover:bg-slate-50">Đóng</button>
              <button type="submit" disabled={isSubmitting} className="min-h-14 rounded-2xl bg-emerald-700 px-8 py-3 text-lg font-bold text-white shadow-md hover:bg-emerald-600 disabled:opacity-60">
                {isSubmitting ? 'Đang lưu…' : 'Lưu kết quả sửa'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};
