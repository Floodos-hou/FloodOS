// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import React, { useState } from 'react';
import { Camera, ExternalLink } from 'lucide-react';
import type { DispatchOrder, RescueTeam, RescueVehicle, FloodReport, FieldIncident, DispatchOrderStatus } from '../../types';
import { needType, vehicleType, incidentType, incidentStatus, severity, formatLocalDateTime } from '../../utils/labels';
import { isActiveDispatchOrder, reportDepthCm, reportPeopleAffected } from '../../utils/workflowRules';
import { StatusBadge } from '../common/StatusBadge';
import { Modal } from '../common/Modal';
import { EmptyState, Field, ageText } from '../ui/kit';

interface FieldTeamWorkspaceProps {
  currentUserId: string;
  teams: RescueTeam[];
  vehicles: RescueVehicle[];
  orders: DispatchOrder[];
  reports: FloodReport[];
  incidents: FieldIncident[];
  onUpdateOrderStatus: (
    orderId: string,
    status: DispatchOrderStatus,
    payload?: { progress_pct?: number; note?: string; outcome?: string; final_depth_cm?: number; evidence_filename?: string; evidence_data_url?: string },
  ) => Promise<void>;
  onReportIncident: (data: {
    order_id: string; vehicle_id: string; incident_type: string; severity: string; description: string;
    estimated_downtime_hours: number; photo_bytes?: string;
  }) => Promise<void>;
  onSelectReport?: (report: FloodReport) => void;
}

const INCIDENT_TYPES = ['ENGINE_FAILURE', 'PROPELLER_FOULED', 'PUMP_CLOGGED', 'ROUTE_BLOCKED', 'OTHER'] as const;
const SEVERITIES = ['MINOR', 'MAJOR', 'CRITICAL'] as const;
const PROGRESS_STEPS = [25, 50, 75];
const OUTCOMES: { value: 'RESOLVED' | 'PARTIAL' | 'UNRESOLVED'; label: string; hint: string }[] = [
  { value: 'RESOLVED', label: 'Đã xử lý xong', hint: 'Người dân đã an toàn / điểm ngập đã hết' },
  { value: 'PARTIAL', label: 'Xử lý một phần', hint: 'Còn việc cần làm tiếp' },
  { value: 'UNRESOLVED', label: 'Chưa xử lý được', hint: 'Không tiếp cận hoặc không đủ khả năng' },
];

const readImage = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const rd = new FileReader();
    rd.onload = () => resolve(rd.result as string);
    rd.onerror = () => reject(new Error('Không đọc được ảnh.'));
    rd.readAsDataURL(file);
  });

export const FieldTeamWorkspace: React.FC<FieldTeamWorkspaceProps> = ({
  currentUserId, teams, vehicles, orders, reports, incidents, onUpdateOrderStatus, onReportIncident, onSelectReport,
}) => {
  // the team this account leads; never fall back to "the first team"
  const myTeam = teams.find((t) => t.lead_user_id === currentUserId) ?? null;
  const myOrders = myTeam ? orders.filter((o) => o.team_id === myTeam.team_id) : [];
  const active = myOrders.find((o) => isActiveDispatchOrder(o.status)) ?? null;
  const history = myOrders.filter((o) => !isActiveDispatchOrder(o.status)).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, 5);
  const target = active ? reports.find((r) => r.report_id === active.report_id) ?? null : null;
  const vehicle = active ? vehicles.find((v) => v.vehicle_id === active.vehicle_id) ?? null : null;
  const myIncidents = incidents.filter((i) => active && i.vehicle_id === active.vehicle_id && i.status !== 'RESOLVED');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'complete' | 'incident' | null>(null);

  // completion form
  const [outcome, setOutcome] = useState<'RESOLVED' | 'PARTIAL' | 'UNRESOLVED' | ''>('');
  const [finalDepth, setFinalDepth] = useState('');
  const [notes, setNotes] = useState('');
  const [photo, setPhoto] = useState<{ name: string; dataUrl: string } | null>(null);
  // incident form
  const [incType, setIncType] = useState('');
  const [incSeverity, setIncSeverity] = useState('');
  const [incDesc, setIncDesc] = useState('');
  const [downtime, setDowntime] = useState('');

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await fn(); } catch (err) { setError(err instanceof Error ? err.message : 'Thao tác thất bại. Vui lòng thử lại.'); } finally { setBusy(false); }
  };

  const onPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.type.startsWith('image/')) { setError('Chỉ nhận ảnh (JPEG, PNG, WebP).'); return; }
    setPhoto({ name: f.name, dataUrl: await readImage(f) });
  };

  const openSheet = (s: 'complete' | 'incident') => {
    setError(null); setPhoto(null);
    setOutcome(''); setFinalDepth(''); setNotes('');
    setIncType(''); setIncSeverity(''); setIncDesc(''); setDowntime('');
    setSheet(s);
  };

  const submitComplete = (e: React.FormEvent) => {
    e.preventDefault();
    if (!active) return;
    if (!outcome || finalDepth === '' || notes.trim().length < 3) { setError('Chọn kết quả, nhập độ ngập sau xử lý và ghi chú kết quả (ít nhất 3 ký tự).'); return; }
    void run(async () => {
      await onUpdateOrderStatus(active.order_id, 'COMPLETED', { progress_pct: 100, outcome, final_depth_cm: Number(finalDepth), note: notes.trim(), evidence_filename: photo?.name, evidence_data_url: photo?.dataUrl });
      setSheet(null);
    });
  };

  const submitIncident = (e: React.FormEvent) => {
    e.preventDefault();
    if (!active) return;
    if (!incType || !incSeverity || downtime === '' || incDesc.trim().length < 3) { setError('Chọn loại và mức độ sự cố, nhập thời gian ngừng ước tính và mô tả.'); return; }
    void run(async () => {
      await onReportIncident({ order_id: active.order_id, vehicle_id: active.vehicle_id, incident_type: incType, severity: incSeverity, description: incDesc.trim(), estimated_downtime_hours: Number(downtime), photo_bytes: photo?.dataUrl });
      setSheet(null);
    });
  };

  if (!myTeam) {
    return (
      <div className="mx-auto max-w-xl panel">
        <EmptyState title="Tài khoản này chưa được gán đội cứu hộ" hint="Nhờ quản lý nguồn lực gán bạn làm đội trưởng của một đội để nhận nhiệm vụ." />
      </div>
    );
  }

  const where = target?.address_hint || (target ? 'Điểm ngập đã báo' : '');
  const fuel = vehicle ? vehicle.fuel_pct ?? vehicle.fuel_percent : undefined;

  return (
    <div className="mx-auto grid max-w-3xl gap-4">
      <div className="panel flex flex-wrap items-center justify-between gap-2 p-4">
        <div>
          <div className="eyebrow">Đội của bạn</div>
          <h2 className="text-lg">{myTeam.name}</h2>
          <p className="text-xs text-ink-3">{myTeam.member_count} người{myTeam.specialty ? ` · ${myTeam.specialty}` : ''}</p>
        </div>
        <span className={`chip ${active ? 'chip-info' : 'chip-good'}`}>{active ? 'Đang có nhiệm vụ' : 'Sẵn sàng nhận lệnh'}</span>
      </div>

      {error && !sheet && <p role="alert" className="rounded border border-crit bg-crit-soft p-3 text-sm text-crit">{error}</p>}

      {!active ? (
        <div className="panel"><EmptyState title="Chưa có nhiệm vụ" hint="Khi điều phối viên giao lệnh, nhiệm vụ sẽ hiện ở đây và trang tự cập nhật." /></div>
      ) : (
        <section className="panel" aria-label="Nhiệm vụ hiện tại">
          <div className="panel-head">
            <div className="min-w-0"><div className="eyebrow">Nhiệm vụ {active.order_id}</div><h3 className="truncate text-base">{where || 'Điểm ngập'}</h3></div>
            <StatusBadge status={active.status} type="order" />
          </div>
          <div className="space-y-4 p-4">
            {target && (
              <>
                <dl className="grid grid-cols-3 gap-3 text-sm">
                  <div><dt className="eyebrow">Nhu cầu</dt><dd className="font-semibold">{needType(target.need_type).text}</dd></div>
                  <div><dt className="eyebrow">Độ ngập báo</dt><dd className="num font-semibold">{reportDepthCm(target)} cm</dd></div>
                  <div><dt className="eyebrow">Người cần hỗ trợ</dt><dd className="num font-semibold">{reportPeopleAffected(target)}</dd></div>
                </dl>
                {(target.description || target.notes) && <p className="rounded border border-line bg-sheet-2 p-2.5 text-sm">{target.description || target.notes}</p>}
                {(target.reporter_name || target.reporter_phone) && (
                  <p className="text-sm">
                    <span className="text-ink-3">Liên hệ: </span>
                    {target.reporter_name}{target.reporter_phone && <> <a className="font-semibold text-river underline" href={`tel:${target.reporter_phone}`}>{target.reporter_phone}</a></>}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <a className="btn" target="_blank" rel="noopener noreferrer" href={`https://www.openstreetmap.org/?mlat=${target.lat}&mlon=${target.lng}#map=17/${target.lat}/${target.lng}`}>
                    <ExternalLink className="h-4 w-4" aria-hidden="true" /> Mở bản đồ
                  </a>
                  {onSelectReport && <button type="button" className="btn" onClick={() => onSelectReport(target)}>Xem trên bản đồ FloodOS</button>}
                </div>
              </>
            )}

            {vehicle && (
              <div className="rounded border border-line p-3 text-sm">
                <div className="eyebrow mb-0.5">Phương tiện</div>
                <div className="font-semibold">{vehicle.name} <span className="font-normal text-ink-3">· {vehicleType(vehicle.vehicle_type)}</span></div>
                <div className="mt-0.5 text-xs text-ink-3">
                  Nhiên liệu {fuel == null ? 'chưa có dữ liệu' : `${Math.round(fuel)}%`} · vị trí cập nhật {ageText(vehicle.telemetry_updated_at) ?? 'chưa có bản ghi'}{vehicle.position_is_simulated ? ' (mô phỏng)' : ''}
                </div>
              </div>
            )}

            <div>
              <div className="flex justify-between text-xs text-ink-3"><span>Tiến độ</span><span className="num font-semibold text-ink">{active.progress_pct}%</span></div>
              <div className="mt-1 h-2 rounded-sm bg-sheet-2 ring-1 ring-line"><div className="h-full rounded-sm bg-river" style={{ width: `${active.progress_pct}%` }} /></div>
            </div>

            {active.notes && <p className="text-sm"><span className="font-semibold">Chỉ đạo:</span> {active.notes}</p>}

            {myIncidents.map((i) => (
              <div key={i.incident_id} className="rounded border border-crit bg-crit-soft p-3 text-sm">
                <div className="font-semibold text-crit">Sự cố đã báo: {incidentType(i.incident_type)}</div>
                <div className="text-xs text-ink-2">{incidentStatus(i.status).text}. {i.status === 'OPEN_REPLANNING' ? 'Điều phối viên đang chọn phương tiện thay thế.' : ''}</div>
              </div>
            ))}

            {/* one primary action per state */}
            <div className="grid gap-2">
              {active.status === 'CONFIRMED' && (
                <button type="button" className="btn btn-primary btn-lg" disabled={busy} onClick={() => run(() => onUpdateOrderStatus(active.order_id, 'IN_PROGRESS', { progress_pct: 0 }))}>Nhận lệnh, bắt đầu di chuyển</button>
              )}
              {active.status === 'IN_PROGRESS' && (
                <>
                  <div className="grid grid-cols-3 gap-2" aria-label="Cập nhật tiến độ">
                    {PROGRESS_STEPS.map((p) => (
                      <button key={p} type="button" className="btn !min-h-12" disabled={busy || p <= active.progress_pct} onClick={() => run(() => onUpdateOrderStatus(active.order_id, 'IN_PROGRESS', { progress_pct: p }))}>{p}%</button>
                    ))}
                  </div>
                  <button type="button" className="btn btn-primary btn-lg" onClick={() => openSheet('complete')}>Hoàn thành nhiệm vụ</button>
                </>
              )}
              {active.status === 'IMPACTED' && <p className="rounded border border-warn bg-warn-soft p-3 text-sm">Nhiệm vụ đang bị gián đoạn do sự cố phương tiện. Chờ điều phối viên chọn phương án thay thế.</p>}
              {active.status !== 'IMPACTED' && (
                <button type="button" className="btn btn-lg text-crit" onClick={() => openSheet('incident')}>Báo sự cố phương tiện</button>
              )}
            </div>
          </div>
        </section>
      )}

      {history.length > 0 && (
        <section className="panel" aria-label="Nhiệm vụ gần đây">
          <div className="panel-head"><h3 className="text-sm">Nhiệm vụ gần đây</h3></div>
          <ul className="rule-y">
            {history.map((o) => (
              <li key={o.order_id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
                <span>{o.order_id} <span className="text-xs text-ink-3">· {formatLocalDateTime(o.created_at)}</span></span>
                <StatusBadge status={o.status} type="order" />
              </li>
            ))}
          </ul>
        </section>
      )}

      {sheet === 'complete' && (
        <Modal title="Hoàn thành nhiệm vụ" onClose={() => setSheet(null)}>
          <form onSubmit={submitComplete} className="space-y-4" aria-label="Hoàn thành nhiệm vụ">
            {error && <p role="alert" className="rounded border border-crit bg-crit-soft p-2.5 text-sm text-crit">{error}</p>}
            <fieldset>
              <legend className="label">Kết quả</legend>
              <div className="grid gap-2" role="radiogroup" aria-label="Kết quả">
                {OUTCOMES.map((o) => (
                  <button key={o.value} type="button" role="radio" aria-checked={outcome === o.value} onClick={() => setOutcome(o.value)} className={`rounded border p-3 text-left ${outcome === o.value ? 'border-ink bg-ink text-sheet' : 'border-line-2 hover:bg-sheet-2'}`}>
                    <span className="block text-sm font-semibold">{o.label}</span><span className={`text-xs ${outcome === o.value ? 'text-sheet/70' : 'text-ink-3'}`}>{o.hint}</span>
                  </button>
                ))}
              </div>
            </fieldset>
            <Field label="Độ ngập tại chỗ sau xử lý (cm)" htmlFor="final-depth"><input id="final-depth" inputMode="numeric" className="input !w-32" value={finalDepth} onChange={(e) => setFinalDepth(e.target.value.replace(/[^0-9]/g, ''))} /></Field>
            <Field label="Ghi chú kết quả" htmlFor="done-notes"><textarea id="done-notes" rows={3} className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
            <div>
              <label htmlFor="done-photo" className="btn w-full !min-h-12 cursor-pointer"><Camera className="h-4 w-4" aria-hidden="true" /> {photo ? 'Đổi ảnh' : 'Chụp ảnh hiện trường (tuỳ chọn)'}</label>
              <input id="done-photo" type="file" accept="image/*" capture="environment" className="sr-only" onChange={onPhoto} />
              {photo && <img src={photo.dataUrl} alt="Ảnh kết quả đã chọn" className="mt-2 max-h-40 rounded border border-line" />}
            </div>
            <button type="submit" className="btn btn-primary btn-lg w-full" disabled={busy}>{busy ? 'Đang gửi…' : 'Gửi báo cáo hoàn thành'}</button>
          </form>
        </Modal>
      )}

      {sheet === 'incident' && (
        <Modal title="Báo sự cố phương tiện" onClose={() => setSheet(null)}>
          <form onSubmit={submitIncident} className="space-y-4" aria-label="Báo sự cố phương tiện">
            {error && <p role="alert" className="rounded border border-crit bg-crit-soft p-2.5 text-sm text-crit">{error}</p>}
            <fieldset>
              <legend className="label">Sự cố gì?</legend>
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Loại sự cố">
                {INCIDENT_TYPES.map((t) => <button key={t} type="button" role="radio" aria-checked={incType === t} onClick={() => setIncType(t)} className={`btn !min-h-12 ${incType === t ? 'btn-primary' : ''}`}>{incidentType(t)}</button>)}
              </div>
            </fieldset>
            <fieldset>
              <legend className="label">Mức độ</legend>
              <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Mức độ">
                {SEVERITIES.map((s) => <button key={s} type="button" role="radio" aria-checked={incSeverity === s} onClick={() => setIncSeverity(s)} className={`btn !min-h-12 ${incSeverity === s ? 'btn-primary' : ''}`}>{severity(s).text}</button>)}
              </div>
            </fieldset>
            <Field label="Ước tính ngừng hoạt động (giờ)" htmlFor="downtime"><input id="downtime" inputMode="decimal" className="input !w-32" value={downtime} onChange={(e) => setDowntime(e.target.value.replace(/[^0-9.]/g, ''))} /></Field>
            <Field label="Mô tả" htmlFor="inc-desc"><textarea id="inc-desc" rows={3} className="input" value={incDesc} onChange={(e) => setIncDesc(e.target.value)} /></Field>
            <div>
              <label htmlFor="inc-photo" className="btn w-full !min-h-12 cursor-pointer"><Camera className="h-4 w-4" aria-hidden="true" /> {photo ? 'Đổi ảnh' : 'Chụp ảnh sự cố (tuỳ chọn)'}</label>
              <input id="inc-photo" type="file" accept="image/*" capture="environment" className="sr-only" onChange={onPhoto} />
              {photo && <img src={photo.dataUrl} alt="Ảnh sự cố đã chọn" className="mt-2 max-h-40 rounded border border-line" />}
            </div>
            <button type="submit" className="btn btn-danger btn-lg w-full" disabled={busy}>{busy ? 'Đang gửi…' : 'Gửi báo cáo sự cố'}</button>
            <p className="text-[11px] text-ink-3">Hệ thống sẽ xếp hạng các phương án thay thế; điều phối viên chọn và duyệt.</p>
          </form>
        </Modal>
      )}
    </div>
  );
};
