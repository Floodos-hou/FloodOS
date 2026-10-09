// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import React, { useState } from 'react';
import type { RescueVehicle, SafeShelter, GaugeStation, FieldIncident } from '../../types';
import { vehicleType, incidentType, incidentStatus } from '../../utils/labels';
import { StatusBadge } from '../common/StatusBadge';
import { Modal } from '../common/Modal';
import { EmptyState, Field, GaugeRuler, Metric, ageText } from '../ui/kit';

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

type Section = 'VEHICLES' | 'SHELTERS' | 'GAUGES' | 'REPAIR';

const pctText = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v)}%`);
const meter = (v: number | null | undefined, lowIsBad = true) => {
  if (v == null) return 'bg-line-2';
  if (lowIsBad) return v < 25 ? 'bg-crit' : v < 50 ? 'bg-warn' : 'bg-safe';
  return 'bg-river';
};

export const ResourceManagerWorkspace: React.FC<ResourceManagerWorkspaceProps> = ({
  vehicles, shelters, gauges, incidents, onUpdateShelterOccupancy, onResolveTicket, onSelectShelter, onSelectGauge,
}) => {
  const [section, setSection] = useState<Section>('VEHICLES');
  const [editing, setEditing] = useState<SafeShelter | null>(null);
  const [occupancy, setOccupancy] = useState('');
  const [resolving, setResolving] = useState<FieldIncident | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = vehicles.filter((v) => v.status === 'IDLE').length;
  const broken = vehicles.filter((v) => v.status === 'BREAKDOWN' || v.status === 'MAINTENANCE').length;
  const repairQueue = incidents.filter((i) => i.repair_ticket_id && i.status !== 'RESOLVED');
  const openSeats = shelters.reduce((n, s) => n + Math.max(0, s.capacity - (s.occupancy ?? s.current_occupancy ?? 0)), 0);

  const tabs: { id: Section; label: string; n: number }[] = [
    { id: 'VEHICLES', label: 'Phương tiện', n: vehicles.length },
    { id: 'SHELTERS', label: 'Điểm trú', n: shelters.length },
    { id: 'GAUGES', label: 'Trạm đo', n: gauges.length },
    { id: 'REPAIR', label: 'Sửa chữa', n: repairQueue.length },
  ];

  const saveOccupancy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing || !onUpdateShelterOccupancy) return;
    const n = Number(occupancy);
    if (occupancy === '' || Number.isNaN(n) || n < 0 || n > editing.capacity) { setError(`Sĩ số phải từ 0 đến ${editing.capacity}.`); return; }
    setBusy(true); setError(null);
    try { await onUpdateShelterOccupancy(editing.shelter_id, n); setEditing(null); }
    catch (err) { setError(err instanceof Error ? err.message : 'Không cập nhật được sĩ số.'); }
    finally { setBusy(false); }
  };

  const saveRepair = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resolving || !onResolveTicket) return;
    if (notes.trim().length < 3) { setError('Ghi rõ kết quả kiểm tra, sửa chữa (ít nhất 3 ký tự).'); return; }
    setBusy(true); setError(null);
    try { await onResolveTicket(resolving.incident_id, notes.trim()); setResolving(null); }
    catch (err) { setError(err instanceof Error ? err.message : 'Không đóng được phiếu sửa chữa.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="panel grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
        <Metric label="Xe sẵn sàng" value={`${ready}/${vehicles.length}`} tone={ready === 0 && vehicles.length > 0 ? 'crit' : 'river'} hint="trạng thái rảnh, chưa nhận lệnh" />
        <Metric label="Xe hỏng / bảo dưỡng" value={broken} tone={broken > 0 ? 'warn' : undefined} />
        <Metric label="Chỗ trống điểm trú" value={openSeats} hint={`${shelters.length} điểm`} />
        <Metric label="Phiếu sửa chữa mở" value={repairQueue.length} tone={repairQueue.length > 0 ? 'warn' : undefined} />
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-line" role="tablist" aria-label="Nhóm nguồn lực">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={section === t.id} onClick={() => setSection(t.id)}
            className={`shrink-0 border-b-2 px-3 py-2 text-sm font-semibold ${section === t.id ? 'border-river text-ink' : 'border-transparent text-ink-3 hover:text-ink'}`}>
            {t.label} <span className="num text-xs text-ink-3">{t.n}</span>
          </button>
        ))}
      </div>

      {section === 'VEHICLES' && (
        <div className="panel overflow-x-auto">
          {vehicles.length === 0 ? <EmptyState title="Chưa có phương tiện nào" /> : (
            <table className="w-full min-w-[640px] text-sm">
              <thead><tr className="border-b border-line text-left"><th className="eyebrow p-3">Phương tiện</th><th className="eyebrow p-3">Trạng thái</th><th className="eyebrow p-3">Nhiên liệu</th><th className="eyebrow p-3">Kỹ thuật</th><th className="eyebrow p-3">Vị trí</th></tr></thead>
              <tbody className="rule-y">
                {vehicles.map((v) => {
                  const fuel = v.fuel_pct ?? v.fuel_percent; const health = v.health_pct ?? v.health_percent;
                  return (
                    <tr key={v.vehicle_id}>
                      <td className="p-3"><div className="font-semibold">{v.name}</div><div className="text-xs text-ink-3">{vehicleType(v.vehicle_type)} · {v.capacity_value} {v.capacity_unit}</div></td>
                      <td className="p-3"><StatusBadge status={v.status} type="vehicle" /></td>
                      <td className="p-3"><div className="num font-semibold">{pctText(fuel)}</div><div className="mt-1 h-1.5 w-20 rounded-sm bg-sheet-2 ring-1 ring-line"><div className={`h-full rounded-sm ${meter(fuel)}`} style={{ width: `${fuel ?? 0}%` }} /></div></td>
                      <td className="p-3"><div className="num font-semibold">{pctText(health)}</div><div className="mt-1 h-1.5 w-20 rounded-sm bg-sheet-2 ring-1 ring-line"><div className={`h-full rounded-sm ${meter(health)}`} style={{ width: `${health ?? 0}%` }} /></div></td>
                      <td className="p-3 text-xs text-ink-2">{v.telemetry_source ?? 'Chưa rõ nguồn'}{v.position_is_simulated ? ' (mô phỏng)' : ''}<div className="text-ink-3">{ageText(v.telemetry_updated_at) ?? 'chưa có bản ghi'}</div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {section === 'SHELTERS' && (
        <div className="grid gap-3 md:grid-cols-2">
          {shelters.length === 0 && <div className="panel md:col-span-2"><EmptyState title="Chưa có điểm trú nào" /></div>}
          {shelters.map((s) => {
            const occ = s.occupancy ?? s.current_occupancy ?? 0; const pct = s.capacity > 0 ? Math.min(100, Math.round((occ / s.capacity) * 100)) : 0;
            return (
              <article key={s.shelter_id} className="panel p-4">
                <div className="flex items-start justify-between gap-2"><div><h4 className="text-base">{s.name}</h4>{s.address && <p className="text-xs text-ink-3">{s.address}</p>}</div><StatusBadge status={s.status === 'ACTIVE' ? 'OPEN' : s.status} type="shelter" /></div>
                <div className="mt-3 flex items-baseline justify-between"><span className="num text-xl font-bold">{occ}<span className="text-sm font-normal text-ink-3">/{s.capacity} chỗ</span></span><span className="eyebrow">{s.occupancy_source}</span></div>
                <div className="mt-1 h-2 rounded-sm bg-sheet-2 ring-1 ring-line"><div className={`h-full rounded-sm ${pct >= 100 ? 'bg-crit' : pct >= 80 ? 'bg-warn' : 'bg-safe'}`} style={{ width: `${pct}%` }} /></div>
                <div className="mt-3 flex gap-2">
                  {onUpdateShelterOccupancy && <button type="button" className="btn" onClick={() => { setError(null); setOccupancy(String(occ)); setEditing(s); }}>Cập nhật sĩ số</button>}
                  {onSelectShelter && <button type="button" className="btn btn-ghost" onClick={() => onSelectShelter(s)}>Xem trên bản đồ</button>}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {section === 'GAUGES' && (
        <div className="grid gap-3 md:grid-cols-2">
          {gauges.length === 0 && <div className="panel md:col-span-2"><EmptyState title="Chưa có trạm đo nào" /></div>}
          {gauges.map((g) => (
            <article key={g.station_id} className="panel p-4">
              <div className="flex items-start justify-between gap-2"><div><h4 className="text-base">{g.name}</h4>{g.river_stream && <p className="text-xs text-ink-3">{g.river_stream}</p>}</div><StatusBadge status={g.alert_state} type="gauge" /></div>
              <GaugeRuler className="mt-3" level={g.level_cm ?? g.water_level_cm} warn={g.warn_level_cm ?? g.warning_level_cm} crit={g.critical_level_cm} source={g.source} />
              <p className="mt-2 text-xs text-ink-3">Số đo gần nhất: {ageText(g.level_updated_at ?? g.last_telemetry_at) ?? 'chưa có bản ghi'}{g.battery_pct != null ? ` · pin ${g.battery_pct}%` : ''}{g.is_simulated ? ' · trạm mô phỏng' : ''}</p>
              {onSelectGauge && <button type="button" className="btn btn-ghost mt-2 !min-h-8 text-xs" onClick={() => onSelectGauge(g)}>Xem trên bản đồ</button>}
            </article>
          ))}
        </div>
      )}

      {section === 'REPAIR' && (
        <div className="panel">
          {repairQueue.length === 0 ? <EmptyState title="Không có phiếu sửa chữa đang mở" hint="Phiếu được tạo khi đội hiện trường báo sự cố và điều phối viên duyệt phương án thay thế." /> : (
            <ul className="rule-y">
              {repairQueue.map((i) => (
                <li key={i.incident_id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">{vehicles.find((v) => v.vehicle_id === i.vehicle_id)?.name ?? i.vehicle_id} · {incidentType(i.incident_type)}</div>
                    <div className="text-xs text-ink-3">Phiếu {i.repair_ticket_id} · {incidentStatus(i.status).text} · ngừng ước tính {i.estimated_downtime_hours} giờ</div>
                    {i.description && <p className="mt-1 text-sm">{i.description}</p>}
                  </div>
                  {onResolveTicket && <button type="button" className="btn btn-primary" onClick={() => { setError(null); setNotes(''); setResolving(i); }}>Đóng phiếu, trả xe về sẵn sàng</button>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {editing && (
        <Modal title={`Sĩ số: ${editing.name}`} onClose={() => setEditing(null)} size="max-w-sm">
          <form onSubmit={saveOccupancy} className="space-y-3">
            {error && <p role="alert" className="rounded border border-crit bg-crit-soft p-2 text-xs text-crit">{error}</p>}
            <Field label={`Số người đang ở điểm trú (tối đa ${editing.capacity})`} htmlFor="occ"><input id="occ" inputMode="numeric" className="input" value={occupancy} onChange={(e) => setOccupancy(e.target.value.replace(/[^0-9]/g, ''))} /></Field>
            <button type="submit" className="btn btn-primary w-full" disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu sĩ số'}</button>
          </form>
        </Modal>
      )}

      {resolving && (
        <Modal title="Đóng phiếu sửa chữa" onClose={() => setResolving(null)}>
          <form onSubmit={saveRepair} className="space-y-3">
            {error && <p role="alert" className="rounded border border-crit bg-crit-soft p-2 text-xs text-crit">{error}</p>}
            <p className="text-sm">{vehicles.find((v) => v.vehicle_id === resolving.vehicle_id)?.name ?? resolving.vehicle_id} · {incidentType(resolving.incident_type)}</p>
            <Field label="Kết quả kiểm tra và sửa chữa" htmlFor="repair-notes"><textarea id="repair-notes" rows={3} className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
            <button type="submit" className="btn btn-primary w-full" disabled={busy}>{busy ? 'Đang lưu…' : 'Xác nhận xe đã sửa xong'}</button>
          </form>
        </Modal>
      )}
    </div>
  );
};
