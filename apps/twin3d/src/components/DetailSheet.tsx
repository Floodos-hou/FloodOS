// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import React from 'react';
import type { DispatchAssignment, FieldPlot, HarvesterMachine, ServiceRequest } from '../../../web/src/types';
import { MACHINE_STATUS_LABEL, readinessLabel } from '../scene/crop';
import { ageText, requestSteps, shiftSteps } from '../logic/tracking';
import { StepBar, currentShift } from './Sidebar';

interface Props {
  machine?: HarvesterMachine;
  field?: FieldPlot;
  assignments: DispatchAssignment[];
  requests: ServiceRequest[];
  onView3D: () => void;
  onClose: () => void;
}

/** Bottom card on the flat map: like an order-tracking card, with a button that opens the 3D view. */
export const DetailSheet: React.FC<Props> = ({ machine, field, assignments, requests, onView3D, onClose }) => {
  if (machine) {
    const shift = currentShift(machine.machine_id, assignments);
    return (
      <section className="sheet" aria-label="Chi tiết máy">
        <header><div><h3>{machine.name}</h3><span className={`chip st-${machine.status}`}>{MACHINE_STATUS_LABEL[machine.status] ?? machine.status}</span></div><button className="x" onClick={onClose} aria-label="Đóng">×</button></header>
        {shift ? <><p className="sub">Ca: {shift.field_name ?? shift.field_id} · {shift.operator_name ?? shift.operator_id}</p><StepBar steps={shiftSteps(shift.status)} /></> : <p className="sub">Chưa có ca được giao.</p>}
        <dl>
          <dt>Nhiên liệu</dt><dd>{Math.round(machine.fuel_pct)}%</dd>
          <dt>Độ khỏe</dt><dd>{Math.round(machine.health_pct)}%</dd>
          <dt>Định vị</dt><dd>{machine.current_lat.toFixed(5)}, {machine.current_lng.toFixed(5)} · {ageText(machine.telemetry_updated_at, Date.now())}</dd>
        </dl>
        <button className="primary" onClick={onView3D}>Xem 3D</button>
      </section>
    );
  }
  if (field) {
    const req = requests.filter((r) => r.field_id === field.field_id).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    return (
      <section className="sheet" aria-label="Chi tiết ruộng">
        <header><div><h3>{field.name}</h3><span className="chip">{readinessLabel(field.readiness_status)}</span></div><button className="x" onClick={onClose} aria-label="Đóng">×</button></header>
        <p className="sub">{field.hamlet} · {field.crop} · {field.area_ha} ha · Chủ ruộng {field.owner_name}</p>
        {req && <><p className="sub">Yêu cầu {req.request_id}</p><StepBar steps={requestSteps(req.status)} /></>}
        <dl><dt>Đã gặt</dt><dd>{Math.round(field.harvest_progress_pct)}%</dd><dt>Cửa sổ gặt</dt><dd>{field.window_start?.slice(0, 10)} → {field.window_end?.slice(0, 10)}</dd></dl>
        <button className="primary" onClick={onView3D}>Xem 3D</button>
      </section>
    );
  }
  return null;
};
