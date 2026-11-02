// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import React, { useState } from 'react';
import type { DispatchAssignment, FieldPlot, HarvesterMachine, ServiceRequest } from '../../../web/src/types';
import { MACHINE_STATUS_LABEL, readinessLabel } from '../scene/crop';
import { requestSteps, shiftSteps, sortFields, sortMachines, type Step } from '../logic/tracking';
import type { MapPick } from './FlatMap';

export const StepBar: React.FC<{ steps: Step[] }> = ({ steps }) => (
  <ol className="steps">
    {steps.map((s, i) => <li key={i} className={s.state}><i />{s.label}</li>)}
  </ol>
);

const Bar: React.FC<{ pct: number }> = ({ pct }) => <span className="bar"><i style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} /></span>;

/** The shift that best describes what a machine is doing now. */
export function currentShift(machineId: string, asg: DispatchAssignment[]): DispatchAssignment | undefined {
  const rank: Record<string, number> = { IMPACTED: 0, IN_PROGRESS: 1, CONFIRMED: 2 };
  return asg.filter((a) => a.machine_id === machineId && a.status in rank).sort((a, b) => rank[a.status] - rank[b.status])[0];
}

interface Props {
  machines: HarvesterMachine[];
  fields: FieldPlot[];
  requests: ServiceRequest[];
  assignments: DispatchAssignment[];
  selected: MapPick | null;
  onSelect: (p: MapPick) => void;
  hiddenFields: number;
}

export const Sidebar: React.FC<Props> = ({ machines, fields, requests, assignments, selected, onSelect, hiddenFields }) => {
  const visibleMachines = machines.filter((m) => m.visibility !== 'FOG_OF_WAR');
  const visibleFields = fields.filter((f) => f.visibility !== 'FOG_OF_WAR');
  const tabs = [
    ...(visibleMachines.length ? [['machines', `Máy gặt (${visibleMachines.length})`] as const] : []),
    ['fields', `Ruộng (${visibleFields.length})`] as const,
    ...(requests.length ? [['requests', `Yêu cầu (${requests.length})`] as const] : []),
  ];
  const [tab, setTab] = useState<string>(visibleMachines.length ? 'machines' : 'fields');
  const active = tabs.some(([k]) => k === tab) ? tab : tabs[0][0];
  const fieldName = (id: string) => fields.find((f) => f.field_id === id)?.name ?? id;

  return (
    <aside className="side" aria-label="Danh sách">
      <nav className="tabs">{tabs.map(([k, label]) => <button key={k} className={k === active ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>)}</nav>
      <div className="cards">
        {active === 'machines' && sortMachines(visibleMachines).map((m) => {
          const shift = currentShift(m.machine_id, assignments);
          const sel = selected?.type === 'machine' && selected.id === m.machine_id;
          return (
            <button key={m.machine_id} className={`card${sel ? ' sel' : ''}`} onClick={() => onSelect({ type: 'machine', id: m.machine_id })}>
              <div className="card-top"><strong>{m.name}</strong><span className={`chip st-${m.status}`}>{MACHINE_STATUS_LABEL[m.status] ?? m.status}</span></div>
              <div className="card-sub">{shift ? `Ca: ${shift.field_name ?? fieldName(shift.field_id)}` : 'Chưa có ca'} · Nhiên liệu {Math.round(m.fuel_pct)}%</div>
              {shift && <StepBar steps={shiftSteps(shift.status)} />}
            </button>
          );
        })}
        {active === 'fields' && sortFields(visibleFields).map((f) => {
          const sel = selected?.type === 'field' && selected.id === f.field_id;
          return (
            <button key={f.field_id} className={`card${sel ? ' sel' : ''}`} onClick={() => onSelect({ type: 'field', id: f.field_id })}>
              <div className="card-top"><strong>{f.name}</strong><span className="chip">{readinessLabel(f.readiness_status)}</span></div>
              <div className="card-sub">{f.hamlet} · {f.area_ha} ha · {f.crop}</div>
              <div className="card-sub"><Bar pct={f.harvest_progress_pct} /> {Math.round(f.harvest_progress_pct)}% đã gặt</div>
            </button>
          );
        })}
        {active === 'requests' && requests.map((r) => (
          <button key={r.request_id} className="card" onClick={() => onSelect({ type: 'field', id: r.field_id })}>
            <div className="card-top"><strong>{r.request_id}</strong><span className="chip">{r.priority}</span></div>
            <div className="card-sub">{fieldName(r.field_id)} · {r.area_ha} ha</div>
            <StepBar steps={requestSteps(r.status)} />
          </button>
        ))}
        {hiddenFields > 0 && <p className="note">{hiddenFields} thửa của hộ khác bị ẩn theo quyền truy cập (RLS), không hiển thị.</p>}
      </div>
    </aside>
  );
};
