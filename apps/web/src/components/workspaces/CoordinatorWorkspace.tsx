// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenAgriOS Contributors

import React, { useState } from 'react';
import {
  FieldPlot,
  HarvesterMachine,
  OperatorProfile,
  ServiceRequest,
  DispatchAssignment,
  MachineIncident,
} from '../../types';
import { formatLocalDateTime, fromDateTimeLocal, toDateTimeLocal, defaultHarvestWindow } from '../../utils/dateTime';
import { assignmentStatus, machineStatus, priority } from '../../utils/labels';
import { Modal } from '../common/Modal';
import { StatusBadge } from '../common/StatusBadge';
import { CalendarClock, MapPin, Ruler } from 'lucide-react';

interface CoordinatorWorkspaceProps {
  fields: FieldPlot[];
  machines: HarvesterMachine[];
  operators: OperatorProfile[];
  requests: ServiceRequest[];
  assignments: DispatchAssignment[];
  incidents: MachineIncident[];
  onDispatchAssignment: (data: {
    request_id: string;
    field_id: string;
    machine_id: string;
    operator_id: string;
    start_time: string;
    end_time: string;
  }) => Promise<void>;
}

/** Statuses a coordinator still has to schedule. The backend creates new requests as PENDING_SCHEDULE. */
const NEEDS_SCHEDULING = new Set(['SUBMITTED', 'PENDING_SCHEDULE', 'RESCHEDULED']);

const INPUT = 'w-full rounded-xl border-2 border-slate-300 bg-white p-3 text-base text-slate-900 outline-none focus:border-emerald-600 focus:ring-4 focus:ring-emerald-200';
const LABEL = 'mb-1.5 block text-base font-semibold text-slate-800';

export const CoordinatorWorkspace: React.FC<CoordinatorWorkspaceProps> = ({
  fields,
  machines,
  operators,
  requests,
  assignments,
  incidents,
  onDispatchAssignment,
}) => {
  const [dispatchFor, setDispatchFor] = useState<ServiceRequest | null>(null);
  const [selectedMachineId, setSelectedMachineId] = useState('');
  const [selectedOperatorId, setSelectedOperatorId] = useState('');
  const [initialWindow] = useState(defaultHarvestWindow);
  const [startTime, setStartTime] = useState(initialWindow.start);
  const [endTime, setEndTime] = useState(initialWindow.end);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [dispatchError, setDispatchError] = useState<string | null>(null);

  const pending = requests.filter((r) => NEEDS_SCHEDULING.has(r.status));
  const liveAssignments = assignments.filter((a) => a.status !== 'SUPERSEDED' && a.status !== 'CANCELLED');
  const brokenMachineIds = new Set(incidents.filter((i) => i.status !== 'RESOLVED').map((i) => i.machine_id));

  const openDispatch = (req: ServiceRequest) => {
    setDispatchFor(req);
    setDispatchError(null);
    const firstOk = machines.find((m) => m.status !== 'BREAKDOWN' && m.status !== 'MAINTENANCE' && !brokenMachineIds.has(m.machine_id)) || machines[0];
    setSelectedMachineId(firstOk?.machine_id || '');
    const op = operators.find((o) => o.operator_id === firstOk?.assigned_operator_id) || operators[0];
    setSelectedOperatorId(op?.operator_id || '');
    if (req.requested_start) setStartTime(toDateTimeLocal(req.requested_start));
    if (req.requested_end) setEndTime(toDateTimeLocal(req.requested_end));
  };

  const onMachineChange = (id: string) => {
    setSelectedMachineId(id);
    const m = machines.find((x) => x.machine_id === id);
    const op = operators.find((o) => o.operator_id === m?.assigned_operator_id);
    if (op) setSelectedOperatorId(op.operator_id);
  };

  const submitDispatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dispatchFor) return;
    if (new Date(endTime) <= new Date(startTime)) {
      setDispatchError('Giờ kết thúc phải sau giờ bắt đầu.');
      return;
    }
    setIsSubmitting(true);
    setDispatchError(null);
    try {
      await onDispatchAssignment({
        request_id: dispatchFor.request_id,
        field_id: dispatchFor.field_id,
        machine_id: selectedMachineId,
        operator_id: selectedOperatorId,
        start_time: fromDateTimeLocal(startTime),
        end_time: fromDateTimeLocal(endTime),
      });
      setDispatchFor(null);
    } catch (err: any) {
      setDispatchError(
        err?.status === 409
          ? 'Trùng lịch: máy hoặc thợ lái này đã có việc trong khung giờ đó. Bạn chọn giờ khác hoặc máy khác nhé.'
          : err?.message || 'Chưa xếp được máy. Bạn thử lại nhé.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const fieldOf = (id: string) => fields.find((f) => f.field_id === id);

  return (
    <div className="space-y-10">
      {/* 1. Việc cần làm ngay */}
      <section aria-labelledby="co-pending">
        <h2 id="co-pending" className="mb-4 text-2xl font-bold text-slate-900">
          ⏳ Yêu cầu đang chờ xếp máy <span className="text-lg font-semibold text-slate-500">({pending.length})</span>
        </h2>
        {pending.length === 0 ? (
          <p className="rounded-3xl border-2 border-dashed border-emerald-300 bg-emerald-50 p-8 text-center text-xl font-semibold text-emerald-900">
            🎉 Mọi yêu cầu của xã viên đều đã có máy. Tuyệt vời!
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {pending.map((req) => {
              const f = fieldOf(req.field_id);
              const pr = priority(req.priority);
              return (
                <li key={req.request_id} className="flex flex-col rounded-3xl border-2 border-amber-300 bg-white p-5 shadow-md">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-xl font-bold text-slate-900">{f?.name || req.field_id}</h3>
                      <p className="mt-0.5 text-base text-slate-600">Chủ ruộng: <strong>{f?.owner_name || req.requester_user_id}</strong></p>
                    </div>
                    <StatusBadge label={{ text: `Mức gấp: ${pr.text}`, tone: pr.tone, icon: '' }} />
                  </div>
                  <dl className="mt-4 grid grid-cols-1 gap-2 text-base text-slate-700 sm:grid-cols-3">
                    <div className="flex items-center gap-2"><MapPin aria-hidden="true" className="h-5 w-5 text-slate-500" />{f?.hamlet || '—'}</div>
                    <div className="flex items-center gap-2"><Ruler aria-hidden="true" className="h-5 w-5 text-slate-500" /><strong>{req.area_ha} ha</strong></div>
                    <div className="flex items-center gap-2"><CalendarClock aria-hidden="true" className="h-5 w-5 text-slate-500" />{formatLocalDateTime(req.requested_start)}</div>
                  </dl>
                  {req.notes && <p className="mt-3 rounded-xl bg-slate-50 p-3 text-base italic text-slate-700">“{req.notes}”</p>}
                  <button
                    type="button"
                    onClick={() => openDispatch(req)}
                    className="mt-5 min-h-14 rounded-2xl bg-emerald-700 px-6 py-3 text-lg font-bold text-white shadow-md transition hover:bg-emerald-600 focus:outline-none focus-visible:ring-4 focus-visible:ring-emerald-300"
                  >
                    🚜 Xếp máy cho yêu cầu này
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* 2. Lịch đang chạy */}
      <section aria-labelledby="co-live">
        <h2 id="co-live" className="mb-4 text-2xl font-bold text-slate-900">
          📅 Lịch máy đang chạy <span className="text-lg font-semibold text-slate-500">({liveAssignments.length})</span>
        </h2>
        {liveAssignments.length === 0 ? (
          <p className="rounded-2xl border-2 border-dashed border-slate-300 p-6 text-lg text-slate-600">Chưa có ca gặt nào được xếp.</p>
        ) : (
          <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {liveAssignments.map((a) => (
              <li key={a.assignment_id} className="rounded-3xl border-2 border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-xl font-bold text-slate-900">{a.field_name || fieldOf(a.field_id)?.name || a.field_id}</h3>
                    <p className="mt-1 text-base text-slate-700">
                      🚜 <strong>{a.machine_name || a.machine_id}</strong> · 👷 {a.operator_name || a.operator_id}
                    </p>
                  </div>
                  <StatusBadge label={assignmentStatus(a.status)} />
                </div>
                <p className="mt-3 flex items-center gap-2 text-base text-slate-600">
                  <CalendarClock aria-hidden="true" className="h-5 w-5" />
                  {formatLocalDateTime(a.start_time)} → {formatLocalDateTime(a.end_time)}
                </p>
                {a.replaces_assignment_id && (
                  <p className="mt-2 rounded-xl bg-amber-50 p-2 text-base text-amber-900">🔁 Thay cho ca {a.replaces_assignment_id} (máy cũ bị hỏng)</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 3. Đội máy */}
      <section aria-labelledby="co-fleet">
        <h2 id="co-fleet" className="mb-4 text-2xl font-bold text-slate-900">🚜 Đội máy của HTX <span className="text-lg font-semibold text-slate-500">({machines.length})</span></h2>
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {machines.map((m) => (
            <li key={m.machine_id} className={`rounded-3xl border-2 bg-white p-4 shadow-sm ${m.status === 'BREAKDOWN' ? 'border-red-400' : 'border-slate-200'}`}>
              <h3 className="text-lg font-bold text-slate-900">{m.name}</h3>
              <div className="mt-2"><StatusBadge label={machineStatus(m.status)} /></div>
              <div className="mt-3 text-base text-slate-600">
                <div className="flex justify-between"><span>Dầu còn</span><strong>{m.fuel_pct}%</strong></div>
                <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-slate-200"><div className="h-2.5 rounded-full bg-amber-500" style={{ width: `${m.fuel_pct}%` }} /></div>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {dispatchFor && (
        <Modal title="Xếp máy và thợ lái" onClose={() => setDispatchFor(null)}>
          <form onSubmit={submitDispatch} className="space-y-5">
            <p className="rounded-2xl bg-emerald-50 p-4 text-base text-emerald-900">
              Ruộng cần gặt: <strong>{fieldOf(dispatchFor.field_id)?.name || dispatchFor.field_id}</strong> ({dispatchFor.area_ha} ha)
            </p>
            <div>
              <label htmlFor="dp-machine" className={LABEL}>Chọn máy gặt</label>
              <select id="dp-machine" value={selectedMachineId} onChange={(e) => onMachineChange(e.target.value)} className={INPUT} required>
                {machines.map((m) => (
                  <option key={m.machine_id} value={m.machine_id}>{m.name}, {machineStatus(m.status).text.toLowerCase()}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="dp-op" className={LABEL}>Chọn thợ lái</label>
              <select id="dp-op" value={selectedOperatorId} onChange={(e) => setSelectedOperatorId(e.target.value)} className={INPUT} required>
                {operators.map((o) => (
                  <option key={o.operator_id} value={o.operator_id}>{o.full_name}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="dp-start" className={LABEL}>Bắt đầu lúc</label>
                <input id="dp-start" type="datetime-local" value={startTime} onChange={(e) => setStartTime(e.target.value)} className={INPUT} required />
              </div>
              <div>
                <label htmlFor="dp-end" className={LABEL}>Kết thúc lúc</label>
                <input id="dp-end" type="datetime-local" value={endTime} onChange={(e) => setEndTime(e.target.value)} className={INPUT} required />
              </div>
            </div>
            <p className="text-sm text-slate-600">Hệ thống tự chặn nếu máy hoặc thợ lái đã có việc trong cùng khung giờ.</p>
            {dispatchError && <p role="alert" className="rounded-xl border-2 border-red-300 bg-red-50 p-4 text-base font-semibold text-red-900">⚠️ {dispatchError}</p>}
            <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setDispatchFor(null)} className="min-h-14 rounded-2xl border-2 border-slate-300 px-6 py-3 text-lg font-semibold text-slate-700 hover:bg-slate-50">Hủy</button>
              <button type="submit" disabled={isSubmitting} className="min-h-14 rounded-2xl bg-emerald-700 px-8 py-3 text-lg font-bold text-white shadow-md hover:bg-emerald-600 disabled:opacity-60">
                {isSubmitting ? 'Đang xếp…' : 'Xác nhận xếp máy'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};
