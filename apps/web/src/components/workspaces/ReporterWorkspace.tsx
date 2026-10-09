// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import React, { useState } from 'react';
import { Camera, GitBranch, LocateFixed, MapPin } from 'lucide-react';
import type { FloodReport, DispatchOrder, FloodZone, SafeShelter, ReportResolution } from '../../types';
import { needType, formatLocalDateTime } from '../../utils/labels';
import { reportStages } from '../../utils/caseFlow';
import { resolutionIdForReport, validateDisputeReason, validateReportDescription } from '../../utils/workflowRules';
import { StatusBadge } from '../common/StatusBadge';
import { Modal } from '../common/Modal';
import { CaseRiver, EmptyState, Field, ageText } from '../ui/kit';

interface ReporterWorkspaceProps {
  reports: FloodReport[];
  orders: DispatchOrder[];
  zones: FloodZone[];
  shelters: SafeShelter[];
  resolutions?: ReportResolution[];
  onCreateReport: (data: {
    lat: number; lng: number; depth_cm: number; need_type: string; people_affected: number; description: string;
    evidence_filename?: string; evidence_data_url?: string;
  }) => Promise<void>;
  onConfirmResolution: (resolutionId: string, decision: 'CONFIRMED' | 'DISPUTED', notes?: string) => Promise<void>;
  onOpenLineage?: (corrId: string) => void;
}

const NEEDS = ['EVACUATION', 'MEDICAL', 'FOOD_WATER', 'PUMPING', 'ROAD_BLOCKED'] as const;
const DEPTH_CHIPS = [10, 30, 50, 70, 100];

type Place = { lat: number; lng: number; label: string };

export const ReporterWorkspace: React.FC<ReporterWorkspaceProps> = ({
  reports, orders, zones, shelters, resolutions = [], onCreateReport, onConfirmResolution, onOpenLineage,
}) => {
  const [open, setOpen] = useState(false);
  const [need, setNeed] = useState<string>('');
  const [place, setPlace] = useState<Place | null>(null);
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [manual, setManual] = useState(false);
  const [manualLat, setManualLat] = useState('');
  const [manualLng, setManualLng] = useState('');
  const [depth, setDepth] = useState('');
  const [people, setPeople] = useState('');
  const [description, setDescription] = useState('');
  const [photo, setPhoto] = useState<{ name: string; dataUrl: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [confirming, setConfirming] = useState<FloodReport | null>(null);
  const [confirmNote, setConfirmNote] = useState('');

  const reset = () => {
    setNeed(''); setPlace(null); setPlaceError(null); setManual(false); setManualLat(''); setManualLng('');
    setDepth(''); setPeople(''); setDescription(''); setPhoto(null); setError(null);
  };

  const useMyLocation = () => {
    setPlaceError(null);
    if (!navigator.geolocation) { setPlaceError('Thiết bị không hỗ trợ định vị. Hãy chọn khu vực hoặc nhập tọa độ.'); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => { setPlace({ lat: pos.coords.latitude, lng: pos.coords.longitude, label: `Vị trí hiện tại (sai số ~${Math.round(pos.coords.accuracy)} m)` }); setLocating(false); },
      () => { setPlaceError('Không lấy được vị trí. Hãy cho phép định vị, hoặc chọn khu vực bên dưới.'); setLocating(false); },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const applyManual = () => {
    const lat = Number(manualLat); const lng = Number(manualLng);
    if (!manualLat || !manualLng || Number.isNaN(lat) || Number.isNaN(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) { setPlaceError('Tọa độ không hợp lệ.'); return; }
    setPlaceError(null); setPlace({ lat, lng, label: `Tọa độ ${lat.toFixed(5)}, ${lng.toFixed(5)}` });
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.type.startsWith('image/')) { setError('Chỉ nhận ảnh (JPEG, PNG, WebP).'); return; }
    setError(null);
    const rd = new FileReader();
    rd.onload = () => setPhoto({ name: f.name, dataUrl: rd.result as string });
    rd.readAsDataURL(f);
  };

  const ready = need && place && depth !== '' && people !== '' && description.trim();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const descError = validateReportDescription(description);
    if (descError) { setError(descError); return; }
    if (!need || !place || depth === '' || people === '') { setError('Hãy điền đủ: cần gì, ở đâu, nước sâu bao nhiêu và có bao nhiêu người.'); return; }
    setBusy(true); setError(null);
    try {
      await onCreateReport({
        lat: place.lat, lng: place.lng, depth_cm: Number(depth), need_type: need, people_affected: Number(people),
        description: description.trim(), evidence_filename: photo?.name, evidence_data_url: photo?.dataUrl,
      });
      setOpen(false); reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không gửi được tin báo. Vui lòng thử lại.');
    } finally { setBusy(false); }
  };

  const decide = async (decision: 'CONFIRMED' | 'DISPUTED') => {
    if (!confirming) return;
    const bad = decision === 'DISPUTED' ? validateDisputeReason(confirmNote) : null;
    if (bad) { setError(bad); return; }
    const id = resolutionIdForReport(confirming.report_id, resolutions, orders);
    if (!id) { setError('Chưa có biên bản xử lý từ đội hiện trường. Vui lòng liên hệ điều phối viên.'); return; }
    setBusy(true); setError(null);
    try { await onConfirmResolution(id, decision, confirmNote.trim()); setConfirming(null); setConfirmNote(''); }
    catch (err) { setError(err instanceof Error ? err.message : 'Không gửi được xác nhận.'); }
    finally { setBusy(false); }
  };

  const mine = [...reports].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));

  return (
    <div className="mx-auto grid max-w-5xl gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-4">
        <div className="panel flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <h2 className="text-lg">Khu vực của bạn đang ngập?</h2>
            <p className="text-sm text-ink-2">Gửi tin báo để điều phối viên xác minh và cử lực lượng. Bạn theo dõi được từng bước ngay trên trang này.</p>
          </div>
          <button type="button" className="btn btn-danger btn-lg w-full sm:w-auto" onClick={() => { reset(); setOpen(true); }}>Báo điểm ngập</button>
        </div>

        <h3 className="eyebrow px-1">Tin báo của tôi · {mine.length}</h3>
        {mine.length === 0 ? (
          <div className="panel"><EmptyState title="Bạn chưa gửi tin báo nào" hint="Khi gặp ngập hoặc cần sơ tán, bấm “Báo điểm ngập”." /></div>
        ) : (
          mine.map((r) => {
            const order = orders.find((o) => o.report_id === r.report_id && o.status !== 'SUPERSEDED' && o.status !== 'CANCELLED');
            return (
              <article key={r.report_id} className="panel p-4" aria-label={`Tin báo ${r.report_id}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h4 className="text-base">{needType(r.need_type).text}</h4>
                    <p className="text-xs text-ink-3">Mã tin <span className="font-semibold text-ink">{r.report_id}</span> · gửi {formatLocalDateTime(r.created_at)} ({ageText(r.created_at)})</p>
                  </div>
                  <StatusBadge status={r.status} type="report" />
                </div>
                <CaseRiver className="my-4" stages={reportStages(r.status)} />
                {r.description && <p className="rounded border border-line bg-sheet-2 p-2.5 text-sm">{r.description}</p>}
                {r.status === 'REJECTED' && r.verification_note && <p className="mt-2 text-sm text-crit">Lý do từ chối: {r.verification_note}</p>}
                {order && (
                  <p className="mt-2 text-sm text-ink-2">
                    Lực lượng: <span className="font-semibold text-ink">{order.team_name ?? order.team_id}</span> · {order.vehicle_name ?? order.vehicle_id} · tiến độ <span className="num">{order.progress_pct}%</span>
                  </p>
                )}
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  {r.status === 'AWAITING_CONFIRMATION' ? (
                    <button type="button" className="btn btn-primary" onClick={() => { setError(null); setConfirmNote(''); setConfirming(r); }}>Xác nhận đã được hỗ trợ</button>
                  ) : <span />}
                  <button type="button" className="btn btn-ghost !min-h-8 text-xs text-river" onClick={() => onOpenLineage?.(r.correlation_id || '')}>
                    <GitBranch className="h-3.5 w-3.5" aria-hidden="true" /> Xem nhật ký kiểm chứng
                  </button>
                </div>
              </article>
            );
          })
        )}
      </div>

      <aside className="space-y-3" aria-label="Điểm trú an toàn">
        <h3 className="eyebrow px-1">Điểm trú an toàn · {shelters.length}</h3>
        <div className="panel rule-y">
          {shelters.length === 0 && <EmptyState title="Chưa có điểm trú nào" />}
          {shelters.map((s) => {
            const occ = s.occupancy ?? s.current_occupancy ?? 0;
            const pct = s.capacity > 0 ? Math.min(100, Math.round((occ / s.capacity) * 100)) : 0;
            return (
              <div key={s.shelter_id} className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-semibold">{s.name}</span>
                  <StatusBadge status={s.status === 'ACTIVE' ? 'OPEN' : s.status} type="shelter" />
                </div>
                <div className="mt-1.5 h-1.5 rounded-sm bg-sheet-2 ring-1 ring-line"><div className={`h-full rounded-sm ${pct >= 100 ? 'bg-crit' : pct >= 80 ? 'bg-warn' : 'bg-safe'}`} style={{ width: `${pct}%` }} /></div>
                <div className="mt-1 flex justify-between text-xs text-ink-3"><span className="num">{occ}/{s.capacity} chỗ</span><span>{s.occupancy_source}</span></div>
                {s.contact_phone && <div className="mt-1 text-xs text-ink-2">Liên hệ: {s.contact_phone}</div>}
              </div>
            );
          })}
        </div>
        <p className="px-1 text-[11px] text-ink-3">Sĩ số điểm trú là số liệu thí điểm do quản lý nguồn lực cập nhật, chưa liên thông với đơn vị vận hành thật.</p>
      </aside>

      {/* ---------- report form ---------- */}
      {open && (
        <Modal title="Báo điểm ngập" onClose={() => setOpen(false)} size="max-w-xl">
          <form onSubmit={submit} className="space-y-5" aria-label="Báo điểm ngập">
            {error && <p role="alert" className="rounded border border-crit bg-crit-soft p-2.5 text-sm text-crit">{error}</p>}

            <fieldset>
              <legend className="label">1. Bạn cần gì?</legend>
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Loại nhu cầu">
                {NEEDS.map((n) => (
                  <button key={n} type="button" role="radio" aria-checked={need === n} onClick={() => setNeed(n)} className={`btn !min-h-12 justify-start text-left ${need === n ? 'btn-primary' : ''}`}>{needType(n).text}</button>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend className="label">2. Bạn đang ở đâu?</legend>
              <button type="button" className="btn w-full !min-h-12" onClick={useMyLocation} disabled={locating}>
                <LocateFixed className="h-4 w-4" aria-hidden="true" /> {locating ? 'Đang lấy vị trí…' : 'Dùng vị trí hiện tại của tôi'}
              </button>
              {zones.length > 0 && (
                <div className="mt-2">
                  <label htmlFor="zone-pick" className="label">hoặc chọn khu vực đang được giám sát</label>
                  <select id="zone-pick" className="input" value="" onChange={(e) => { const z = zones.find((x) => x.zone_id === e.target.value); if (z) { setPlaceError(null); setPlace({ lat: z.center_lat, lng: z.center_lng, label: `Khu vực ${z.name} (tâm khu vực)` }); } }}>
                    <option value="">Chọn khu vực…</option>
                    {zones.map((z) => <option key={z.zone_id} value={z.zone_id}>{z.name}</option>)}
                  </select>
                </div>
              )}
              <button type="button" className="mt-2 text-xs font-semibold text-river underline" onClick={() => setManual(!manual)}>{manual ? 'Ẩn nhập tọa độ' : 'Nhập tọa độ thủ công'}</button>
              {manual && (
                <div className="mt-2 grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                  <Field label="Vĩ độ" htmlFor="m-lat"><input id="m-lat" inputMode="decimal" className="input" value={manualLat} onChange={(e) => setManualLat(e.target.value)} /></Field>
                  <Field label="Kinh độ" htmlFor="m-lng"><input id="m-lng" inputMode="decimal" className="input" value={manualLng} onChange={(e) => setManualLng(e.target.value)} /></Field>
                  <button type="button" className="btn" onClick={applyManual}>Dùng</button>
                </div>
              )}
              {placeError && <p role="alert" className="mt-2 text-xs text-crit">{placeError}</p>}
              <p className={`mt-2 flex items-center gap-1.5 text-sm ${place ? 'font-semibold text-safe' : 'text-ink-3'}`}>
                <MapPin className="h-4 w-4" aria-hidden="true" /> {place ? place.label : 'Chưa chọn vị trí'}
              </p>
            </fieldset>

            <fieldset>
              <legend className="label">3. Nước sâu khoảng bao nhiêu? (cm)</legend>
              <div className="flex flex-wrap items-center gap-2">
                {DEPTH_CHIPS.map((d) => (
                  <button key={d} type="button" aria-pressed={depth === String(d)} onClick={() => setDepth(String(d))} className={`btn !min-h-10 ${depth === String(d) ? 'btn-primary' : ''}`}>{d === 100 ? '100+' : d}</button>
                ))}
                <input aria-label="Độ sâu (cm)" inputMode="numeric" className="input !w-24" value={depth} onChange={(e) => setDepth(e.target.value.replace(/[^0-9]/g, ''))} placeholder="khác" />
              </div>
              <p className="mt-1 text-[11px] text-ink-3">Đây là ước lượng của bạn, hệ thống ghi nhận là số liệu do người báo cung cấp.</p>
            </fieldset>

            <Field label="4. Có bao nhiêu người cần hỗ trợ?" htmlFor="people">
              <input id="people" inputMode="numeric" className="input !w-28" value={people} onChange={(e) => setPeople(e.target.value.replace(/[^0-9]/g, ''))} />
            </Field>

            <Field label="5. Mô tả ngắn tình hình" htmlFor="desc">
              <textarea id="desc" rows={3} className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ví dụ: nước tràn vào nhà, có người già và trẻ nhỏ" />
            </Field>

            <div>
              <label htmlFor="photo" className="btn w-full !min-h-12 cursor-pointer"><Camera className="h-4 w-4" aria-hidden="true" /> {photo ? 'Đổi ảnh' : 'Chụp / chọn ảnh hiện trường (tuỳ chọn)'}</label>
              <input id="photo" type="file" accept="image/*" capture="environment" className="sr-only" onChange={onFile} />
              {photo && <img src={photo.dataUrl} alt="Ảnh hiện trường đã chọn" className="mt-2 max-h-40 rounded border border-line" />}
              <p className="mt-1 text-[11px] text-ink-3">Ảnh được quét mã độc trước khi lưu; ảnh có mã độc sẽ bị từ chối.</p>
            </div>

            <button type="submit" className="btn btn-danger btn-lg w-full" disabled={busy || !ready}>{busy ? 'Đang gửi…' : 'Gửi tin báo'}</button>
          </form>
        </Modal>
      )}

      {/* ---------- confirm / dispute ---------- */}
      {confirming && (
        <Modal title={`Xác nhận tin ${confirming.report_id}`} onClose={() => setConfirming(null)}>
          <div className="space-y-3">
            {error && <p role="alert" className="rounded border border-crit bg-crit-soft p-2.5 text-sm text-crit">{error}</p>}
            <p className="text-sm">Đội cứu hộ báo đã xử lý xong. Tình trạng tại nhà bạn đã ổn chưa?</p>
            <Field label="Ý kiến của bạn (bắt buộc nếu chưa ổn)" htmlFor="confirm-note"><textarea id="confirm-note" rows={2} className="input" value={confirmNote} onChange={(e) => setConfirmNote(e.target.value)} /></Field>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="btn" disabled={busy} onClick={() => decide('DISPUTED')}>Chưa ổn, cần hỗ trợ thêm</button>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => decide('CONFIRMED')}>Đã ổn, đóng tin</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
