// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import React, { useContext, useMemo, useState } from 'react';
import type {
  FloodReport, DispatchOrder, RescueTeam, RescueVehicle, FieldIncident, FloodZone, FloodPriority, CandidateRescueOption,
} from '../../types';
import { needType, vehicleType, incidentType, incidentStatus, formatLocalDateTime } from '../../utils/labels';
import { reportStages } from '../../utils/caseFlow';
import { metresBetween } from '../../utils/fleetInsights';
import {
  isActiveDispatchOrder, isActiveIncident, isTeamAvailable, isVehicleAvailable,
  reportDepthCm, reportPeopleAffected, validateRejectionReason,
} from '../../utils/workflowRules';
import { StatusBadge } from '../common/StatusBadge';
import { CaseRiver, EmptyState, Field, ageText } from '../ui/kit';
import { MapDetailPanel, type MapSelection } from '../map/MapDetailPanel';
import { Sparkles, FileText, Loader2, ShieldCheck, Check, AlertCircle, Truck, Users, Clock } from 'lucide-react';
import { api } from '../../services/api';
import { AuthContext } from '../../context/authCore';
import { Modal } from '../common/Modal';

interface DispatcherWorkspaceProps {
  reports: FloodReport[];
  orders: DispatchOrder[];
  teams: RescueTeam[];
  vehicles: RescueVehicle[];
  incidents: FieldIncident[];
  zones: FloodZone[];
  mapElement?: React.ReactNode;
  /** object picked on the map (report → opens the case; anything else → detail card) */
  mapSelection?: MapSelection | null;
  onClearMapSelection?: () => void;
  onVerifyReport: (reportId: string, priority: FloodPriority, notes?: string, decision?: 'VERIFIED' | 'REJECTED') => Promise<void>;
  onDispatchOrder: (data: { report_id: string; team_id: string; vehicle_id: string; target_time: string; notes?: string }) => Promise<void>;
  onApproveReplan?: (incidentId: string, optionId: string) => Promise<void>;
  /** focus the map on a case */
  onSelectReport?: (report: FloodReport) => void;
}

type Queue = 'VERIFY' | 'DISPATCH' | 'ACTIVE' | 'INCIDENT' | 'ALL';

const PRIORITY_RANK: Record<string, number> = { URGENT: 0, CRITICAL: 0, HIGH: 1, NORMAL: 2, LOW: 3 };
const PRIORITY_BAR: Record<string, string> = { URGENT: 'bg-crit', CRITICAL: 'bg-crit', HIGH: 'bg-warn', NORMAL: 'bg-water', LOW: 'bg-line-2' };
const PRIORITIES: { value: FloodPriority; label: string; hint: string }[] = [
  { value: 'URGENT', label: 'Khẩn cấp', hint: 'Nguy hiểm tính mạng' },
  { value: 'HIGH', label: 'Cao', hint: 'Cần xử lý sớm' },
  { value: 'NORMAL', label: 'Bình thường', hint: 'Xử lý theo thứ tự' },
  { value: 'LOW', label: 'Thấp', hint: 'Theo dõi thêm' },
];
const DURATIONS = [{ h: 1, label: '1 giờ' }, { h: 2, label: '2 giờ' }, { h: 4, label: '4 giờ' }, { h: 8, label: '8 giờ' }];

const byUrgencyThenAge = (a: FloodReport, b: FloodReport) =>
  (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) || Date.parse(a.created_at) - Date.parse(b.created_at);

const waitText = (iso: string): string => ageText(iso)?.replace(' trước', '') ?? '';

export const DispatcherWorkspace: React.FC<DispatcherWorkspaceProps> = ({
  reports, orders, teams, vehicles, incidents, zones, mapElement, mapSelection, onClearMapSelection,
  onVerifyReport, onDispatchOrder, onApproveReplan, onSelectReport,
}) => {
  const [queue, setQueue] = useState<Queue>('VERIFY');
  const [pickedReportId, setPickedReportId] = useState<string | null>(null);
  const [pickedIncidentId, setPickedIncidentId] = useState<string | null>(null);

  const zoneName = (r: FloodReport) => r.address_hint || zones.find((z) => z.zone_id === r.zone_id)?.name || 'Chưa gán khu vực';

  const activeOrders = useMemo(() => orders.filter((o) => isActiveDispatchOrder(o.status)), [orders]);
  const activeIncidents = useMemo(() => incidents.filter((i) => isActiveIncident(i.status)), [incidents]);
  const busyVehicleIds = useMemo(() => new Set(activeOrders.map((o) => o.vehicle_id)), [activeOrders]);
  const busyTeamIds = useMemo(() => new Set(activeOrders.map((o) => o.team_id)), [activeOrders]);

  const lists = useMemo(() => ({
    VERIFY: reports.filter((r) => r.status === 'RECEIVED').sort(byUrgencyThenAge),
    DISPATCH: reports.filter((r) => r.status === 'VERIFIED' || r.status === 'RESCHEDULED').sort(byUrgencyThenAge),
    ACTIVE: reports.filter((r) => ['DISPATCHED', 'IN_PROGRESS', 'IMPACTED', 'AWAITING_CONFIRMATION'].includes(r.status)).sort(byUrgencyThenAge),
    ALL: [...reports].sort(byUrgencyThenAge),
  }), [reports]);

  // a report picked on the map wins over the last queue click; otherwise default to top priority report
  const defaultReportId = lists.VERIFY[0]?.report_id ?? lists.DISPATCH[0]?.report_id ?? lists.ACTIVE[0]?.report_id ?? reports[0]?.report_id ?? null;
  const focusReportId = mapSelection?.type === 'report' ? mapSelection.data.report_id : (pickedReportId ?? defaultReportId);
  const focusReport = !pickedIncidentId ? (reports.find((r) => r.report_id === focusReportId) ?? null) : null;
  const focusIncident = activeIncidents.find((i) => i.incident_id === pickedIncidentId) ?? null;
  const otherSelection = mapSelection && mapSelection.type !== 'report' ? mapSelection : null;

  const pickReport = (r: FloodReport) => { setPickedReportId(r.report_id); setPickedIncidentId(null); onSelectReport?.(r); };
  const pickIncident = (i: FieldIncident) => { setPickedIncidentId(i.incident_id); setPickedReportId(null); onClearMapSelection?.(); };

  const tabs: { id: Queue; label: string; n: number; alert?: boolean }[] = [
    { id: 'VERIFY', label: 'Chờ xác minh', n: lists.VERIFY.length, alert: lists.VERIFY.length > 0 },
    { id: 'DISPATCH', label: 'Chờ điều phối', n: lists.DISPATCH.length },
    { id: 'ACTIVE', label: 'Đang xử lý', n: lists.ACTIVE.length },
    { id: 'INCIDENT', label: 'Sự cố xe', n: activeIncidents.length, alert: activeIncidents.length > 0 },
    { id: 'ALL', label: 'Tất cả', n: reports.length },
  ];

  const rows: FloodReport[] = queue === 'INCIDENT' ? [] : lists[queue];
  const readyVehiclesCount = vehicles.filter((v) => isVehicleAvailable(v, busyVehicleIds)).length;
  const readyTeamsCount = teams.filter((t) => isTeamAvailable(t, busyTeamIds)).length;
  const urgentVerifyCount = lists.VERIFY.filter((r) => r.priority === 'URGENT' || r.priority === 'CRITICAL').length;

  return (
    <div className="space-y-3">
      {/* ---------- Tactical Command KPI Strip ---------- */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="panel flex items-center justify-between border-t-4 border-t-rose-500 p-3.5">
          <div>
            <div className="eyebrow">Tin chờ xác minh</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className={`num text-2xl font-extrabold ${lists.VERIFY.length > 0 ? 'text-crit' : 'text-ink'}`}>{lists.VERIFY.length}</span>
              {urgentVerifyCount > 0 && <span className="chip chip-bad">{urgentVerifyCount} khẩn cấp</span>}
            </div>
          </div>
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-rose-500 to-red-600 text-white shadow-sm shadow-rose-500/30">
            <AlertCircle className="h-5 w-5" aria-hidden="true" />
          </span>
        </div>

        <div className="panel flex items-center justify-between border-t-4 border-t-sky-500 p-3.5">
          <div>
            <div className="eyebrow">Đang điều phối & xử lý</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="num text-2xl font-extrabold text-river">{lists.DISPATCH.length + lists.ACTIVE.length}</span>
              <span className="text-xs font-medium text-ink-3">{lists.DISPATCH.length} chờ cử đội · {lists.ACTIVE.length} hiện trường</span>
            </div>
          </div>
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-sky-500 to-blue-600 text-white shadow-sm shadow-sky-500/30">
            <Clock className="h-5 w-5" aria-hidden="true" />
          </span>
        </div>

        <div className="panel flex items-center justify-between border-t-4 border-t-emerald-500 p-3.5">
          <div>
            <div className="eyebrow">Phương tiện & Đội sẵn sàng</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="num text-2xl font-extrabold text-safe">{readyVehiclesCount}/{vehicles.length}</span>
              <span className="text-xs font-medium text-ink-3">xe · <strong className="num text-ink">{readyTeamsCount}/{teams.length}</strong> đội</span>
            </div>
          </div>
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-sm shadow-emerald-500/30">
            <Truck className="h-5 w-5" aria-hidden="true" />
          </span>
        </div>

        <div className="panel flex items-center justify-between border-t-4 border-t-amber-500 p-3.5">
          <div>
            <div className="eyebrow">Sự cố phương tiện</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className={`num text-2xl font-extrabold ${activeIncidents.length > 0 ? 'text-warn' : 'text-ink'}`}>{activeIncidents.length}</span>
              <span className="text-xs font-medium text-ink-3">{activeIncidents.length > 0 ? 'Cần duyệt xe thay thế' : 'Hoạt động bình thường'}</span>
            </div>
          </div>
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 text-white shadow-sm shadow-amber-500/30">
            <Users className="h-5 w-5" aria-hidden="true" />
          </span>
        </div>
      </div>

      {/* ---------- Main 3-Column Tactical Console ---------- */}
      <div className="grid min-h-[calc(100vh-11.5rem)] gap-3 lg:grid-cols-[350px_minmax(0,1fr)] xl:grid-cols-[360px_minmax(0,1fr)_410px]">
        {/* ---------- queue ---------- */}
        <section className="panel flex min-h-0 flex-col overflow-hidden" aria-label="Hàng đợi vụ việc">
          <div className="flex gap-1 overflow-x-auto border-b border-line bg-sheet-2 p-2" role="tablist" aria-label="Lọc hàng đợi">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={queue === t.id}
                onClick={() => setQueue(t.id)}
                className={`flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                  queue === t.id
                    ? 'bg-ink text-white shadow-2xs'
                    : 'text-ink-2 hover:bg-sheet hover:text-ink'
                }`}
              >
                {t.label}
                <span className={`num rounded-full px-1.5 py-0.2 text-[11px] font-bold ${queue === t.id ? 'bg-white/20 text-white' : t.alert ? 'bg-crit text-white' : 'bg-line text-ink-2'}`}>
                  {t.n}
                </span>
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {queue === 'INCIDENT' ? (
              activeIncidents.length === 0 ? (
                <EmptyState title="Không có sự cố phương tiện" hint="Khi đội hiện trường báo xe hỏng, các phương án thay thế sẽ xuất hiện ở đây." />
              ) : (
                <ul className="rule-y">
                  {activeIncidents.map((i) => (
                    <li key={i.incident_id}>
                      <button
                        type="button"
                        onClick={() => pickIncident(i)}
                        className={`block w-full px-3.5 py-3 text-left transition-colors hover:bg-sheet-2 ${
                          focusIncident?.incident_id === i.incident_id ? 'bg-river-soft/75' : ''
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-bold text-ink">{vehicles.find((v) => v.vehicle_id === i.vehicle_id)?.name ?? i.vehicle_id}</span>
                          <span className="text-[11px] font-medium text-ink-3">{ageText(i.created_at)}</span>
                        </div>
                        <div className="mt-0.5 text-xs font-medium text-crit">{incidentType(i.incident_type)}</div>
                      </button>
                    </li>
                  ))}
                </ul>
              )
            ) : rows.length === 0 ? (
              <EmptyState
                title={queue === 'VERIFY' ? 'Không có tin báo chờ xác minh' : queue === 'DISPATCH' ? 'Không có tin báo chờ điều phối' : 'Không có vụ việc'}
                hint="Hàng đợi tự làm mới mỗi 20 giây."
              />
            ) : (
              <ul className="rule-y">
                {rows.map((r) => {
                  const sel = focusReportId === r.report_id;
                  return (
                    <li key={r.report_id}>
                      <button
                        type="button"
                        onClick={() => pickReport(r)}
                        aria-current={sel ? 'true' : undefined}
                        className={`flex w-full gap-3 px-3.5 py-3 text-left transition-colors ${
                          sel ? 'bg-river-soft/75' : 'hover:bg-sheet-2'
                        }`}
                      >
                        <span className={`mt-0.5 w-1.5 shrink-0 self-stretch rounded-full ${PRIORITY_BAR[r.priority] ?? 'bg-line-2'}`} aria-hidden="true" />
                        <span className="min-w-0 flex-1 space-y-1">
                          <span className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm font-bold text-ink">{zoneName(r)}</span>
                            <span className="num shrink-0 rounded bg-paper px-1.5 py-0.5 text-[11px] font-medium text-ink-3">
                              chờ {waitText(r.created_at)}
                            </span>
                          </span>
                          <span className="flex flex-wrap items-center gap-1.5 text-xs text-ink-2">
                            <span className="font-mono text-[11px] font-semibold text-river-2">{r.report_id}</span>
                            <span>·</span>
                            <span className="font-medium">{needType(r.need_type).text}</span>
                            <span>·</span>
                            <span className="num font-semibold text-ink">{reportDepthCm(r)} cm</span>
                            <span>·</span>
                            <span className="num font-semibold text-ink">{reportPeopleAffected(r)} người</span>
                          </span>
                          {queue === 'ALL' && (
                            <span className="mt-1 inline-block">
                              <StatusBadge status={r.status} type="report" />
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="border-t border-line bg-sheet-2 px-3.5 py-2.5 text-[11px] text-ink-3">
            Xếp theo mức ưu tiên rồi theo thời gian chờ. Xe sẵn sàng: <span className="num font-bold text-ink">{readyVehiclesCount}/{vehicles.length}</span>
            {' · '}Đội sẵn sàng: <span className="num font-bold text-ink">{readyTeamsCount}/{teams.length}</span>
          </div>
        </section>

        {/* ---------- map ---------- */}
        <section className="panel relative min-h-[380px] overflow-hidden lg:min-h-0" aria-label="Bản đồ">
          {mapElement ? <div className="absolute inset-0">{mapElement}</div> : <EmptyState title="Chưa có bản đồ" />}
        </section>

        {/* ---------- case / incident / object detail ---------- */}
        <aside className="min-h-0 lg:col-span-2 xl:col-span-1" aria-label="Chi tiết">
          {otherSelection ? (
            <MapDetailPanel selection={otherSelection} onClose={() => onClearMapSelection?.()} currentUserRole="DISPATCHER" orders={orders} zones={zones} />
          ) : focusIncident ? (
            <ReplanPanel incident={focusIncident} vehicles={vehicles} onApprove={onApproveReplan} />
          ) : focusReport ? (
            <CasePanel
              key={focusReport.report_id}
              report={focusReport}
              zoneLabel={zoneName(focusReport)}
              orders={orders}
              teams={teams}
              vehicles={vehicles}
              busyVehicleIds={busyVehicleIds}
              busyTeamIds={busyTeamIds}
              onVerify={onVerifyReport}
              onDispatch={onDispatchOrder}
            />
          ) : (
            <div className="panel h-full grid place-items-center">
              <EmptyState title="Chọn một vụ việc" hint="Bấm vào một dòng trong hàng đợi hoặc một điểm trên bản đồ để xem hồ sơ và xử lý." />
            </div>
          )}
        </aside>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Case panel: verify → dispatch → follow, all inline (no dialogs).    */
/* ------------------------------------------------------------------ */

interface CasePanelProps {
  report: FloodReport;
  zoneLabel: string;
  orders: DispatchOrder[];
  teams: RescueTeam[];
  vehicles: RescueVehicle[];
  busyVehicleIds: Set<string>;
  busyTeamIds: Set<string>;
  onVerify: DispatcherWorkspaceProps['onVerifyReport'];
  onDispatch: DispatcherWorkspaceProps['onDispatchOrder'];
}

const CasePanel: React.FC<CasePanelProps> = ({ report, zoneLabel, orders, teams, vehicles, busyVehicleIds, busyTeamIds, onVerify, onDispatch }) => {
  const auth = useContext(AuthContext);
  const token = auth?.token ?? null;
  const order = orders.find((o) => o.report_id === report.report_id && o.status !== 'SUPERSEDED' && o.status !== 'CANCELLED');

  const [aiSummary, setAiSummary] = useState<{
    report_id: string;
    summary_text: string;
    current_status: string;
    timeline: string[];
    suggested_actions: string[];
    engine: string;
    generated_at: string;
  } | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [showSummary, setShowSummary] = useState(false);

  const [aarReport, setAarReport] = useState<{
    report_id: string;
    report_title: string;
    executive_summary: string;
    markdown_content: string;
    engine: string;
    generated_at: string;
  } | null>(null);
  const [loadingAar, setLoadingAar] = useState(false);
  const [showAarModal, setShowAarModal] = useState(false);

  const handleToggleAiSummary = async () => {
    if (showSummary) {
      setShowSummary(false);
      return;
    }
    if (aiSummary && aiSummary.report_id === report.report_id) {
      setShowSummary(true);
      return;
    }
    if (!token) return;
    setLoadingSummary(true);
    try {
      const data = await api.getReportAiSummary(token, report.report_id);
      setAiSummary(data);
      setShowSummary(true);
    } catch (err) {
      console.error('Failed to get AI summary', err);
    } finally {
      setLoadingSummary(false);
    }
  };

  const handleOpenAar = async () => {
    if (!token) return;
    setShowAarModal(true);
    if (!aarReport || aarReport.report_id !== report.report_id) {
      setLoadingAar(true);
      try {
        const data = await api.getAfterActionReport(token, report.report_id);
        setAarReport(data);
      } catch (err) {
        console.error('Failed to get AAR', err);
      } finally {
        setLoadingAar(false);
      }
    }
  };

  const isResolvedOrClosed = ['RESOLVED', 'CLOSED', 'AWAITING_CONFIRMATION'].includes(report.status);

  return (
    <section className="panel flex h-full flex-col overflow-hidden" aria-label={`Hồ sơ ${report.report_id}`}>
      <div className="panel-head">
        <div className="min-w-0">
          <div className="eyebrow">Hồ sơ {report.report_id}</div>
          <h3 className="truncate text-base font-bold">{zoneLabel}</h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleToggleAiSummary}
            className="btn !min-h-8 border-river/30 bg-river-soft/50 px-2.5 py-1 text-xs text-river-2 hover:bg-river-soft"
            title="Gọi AI tổng hợp tình huống, diễn biến và đề xuất hành động"
          >
            {loadingSummary ? <Loader2 className="h-3.5 w-3.5 animate-spin text-river" /> : <Sparkles className="h-3.5 w-3.5 text-river" />}
            <span>{showSummary ? 'Ẩn tóm tắt' : '✨ Tóm tắt AI'}</span>
          </button>
          <StatusBadge status={report.priority} type="priority" />
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {showSummary && aiSummary && (
          <div className="rounded-xl border border-river/30 bg-river-soft/40 p-3.5 text-sm space-y-2.5 shadow-2xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-river-2">
                <Sparkles className="h-3.5 w-3.5 text-river" />
                Tóm tắt Tình huống Điều phối (AI Co-pilot)
              </div>
              <span className="rounded border border-line bg-sheet px-2 py-0.5 font-mono text-[10px] text-ink-2">
                {aiSummary.engine}
              </span>
            </div>
            <p className="text-xs font-medium leading-relaxed text-ink">{aiSummary.summary_text}</p>
            {aiSummary.timeline?.length > 0 && (
              <div>
                <div className="eyebrow mb-1 text-[11px]">Diễn biến xử lý</div>
                <ul className="space-y-1 text-xs text-ink-2">
                  {aiSummary.timeline.map((step, idx) => (
                    <li key={idx} className="flex items-start gap-1.5">
                      <span className="font-bold text-river">•</span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {aiSummary.suggested_actions?.length > 0 && (
              <div>
                <div className="eyebrow mb-1 text-[11px]">Đề xuất hành động tiếp theo</div>
                <ul className="space-y-1 text-xs text-ink-2">
                  {aiSummary.suggested_actions.map((act, idx) => (
                    <li key={idx} className="flex items-start gap-1.5">
                      <span className="font-bold text-safe">✓</span>
                      <span>{act}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <CaseRiver stages={reportStages(report.status)} />

        <dl className="grid grid-cols-3 gap-2.5 text-sm">
          <div className="rounded-lg border border-line bg-sheet-2 p-2.5">
            <dt className="eyebrow">Nhu cầu</dt>
            <dd className="mt-0.5 font-bold text-ink">{needType(report.need_type).text}</dd>
          </div>
          <div className="rounded-lg border border-line bg-sheet-2 p-2.5">
            <dt className="eyebrow">Độ ngập</dt>
            <dd className="num mt-0.5 font-bold text-river-2">{reportDepthCm(report)} cm</dd>
          </div>
          <div className="rounded-lg border border-line bg-sheet-2 p-2.5">
            <dt className="eyebrow">Người</dt>
            <dd className="num mt-0.5 font-bold text-ink">{reportPeopleAffected(report)}</dd>
          </div>
        </dl>

        <p className="text-xs text-ink-3">
          Gửi {formatLocalDateTime(report.created_at)} ({ageText(report.created_at)}) qua {report.channel === 'PHONE' ? 'điện thoại' : 'ứng dụng'}. Độ ngập do người báo ước lượng.
        </p>

        {(report.description || report.notes) && (
          <p className="rounded-lg border border-line bg-sheet-2 p-3 text-sm leading-relaxed text-ink">
            {report.description || report.notes}
          </p>
        )}

        {(report.reporter_name || report.reporter_phone) && (
          <p className="text-sm">
            <span className="text-ink-3">Người báo: </span>
            <span className="font-semibold text-ink">{[report.reporter_name, report.reporter_phone].filter(Boolean).join(' · ')}</span>
          </p>
        )}

        {report.verification_note && (
          <p className="rounded-lg border border-line bg-sheet-2 px-3 py-2 text-xs text-ink-2">
            <span className="font-semibold text-ink">Ghi chú xác minh:</span> {report.verification_note}
          </p>
        )}

        {report.status === 'RECEIVED' && <VerifyForm report={report} onVerify={onVerify} />}
        {(report.status === 'VERIFIED' || report.status === 'RESCHEDULED') && (
          <DispatchForm report={report} teams={teams} vehicles={vehicles} busyVehicleIds={busyVehicleIds} busyTeamIds={busyTeamIds} onDispatch={onDispatch} />
        )}

        {order && (
          <div className="rounded-xl border border-line bg-sheet-2 p-3.5 text-sm">
            <div className="eyebrow mb-1">Lệnh điều phối {order.order_id}</div>
            <div className="font-bold text-ink">{order.vehicle_name ?? vehicles.find((v) => v.vehicle_id === order.vehicle_id)?.name ?? order.vehicle_id}</div>
            <div className="text-xs font-medium text-ink-2">{order.team_name ?? teams.find((t) => t.team_id === order.team_id)?.name ?? order.team_id}</div>
            <div className="mt-2.5 flex items-center justify-between gap-2">
              <StatusBadge status={order.status} type="order" />
              <span className="num text-xs font-semibold text-ink-2">tiến độ {order.progress_pct}%</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-paper ring-1 ring-line">
              <div className="h-full rounded-full bg-river transition-all" style={{ width: `${order.progress_pct}%` }} />
            </div>
          </div>
        )}

        {isResolvedOrClosed && (
          <div className="border-t border-line pt-3">
            <button
              type="button"
              onClick={handleOpenAar}
              className="btn w-full border-river/30 bg-river-soft/40 py-2 text-xs text-river-2 hover:bg-river-soft"
            >
              <FileText className="h-4 w-4 text-river" />
              <span>📄 Xem Báo cáo Sau Vụ việc (AI After-Action Report)</span>
            </button>
          </div>
        )}
      </div>

      {showAarModal && (
        <Modal
          title={`Báo cáo Tổng kết Vụ việc ${report.report_id} (AAR)`}
          onClose={() => setShowAarModal(false)}
          size="max-w-2xl"
        >
          {loadingAar ? (
            <div className="flex flex-col items-center justify-center gap-2 p-8 text-center text-sm text-ink-3">
              <Loader2 className="h-6 w-6 animate-spin text-river" />
              <span>Đang trích xuất dữ liệu từ chuỗi Hash-Chain và khởi tạo báo cáo...</span>
            </div>
          ) : aarReport ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border border-river/20 bg-river-soft/30 p-2.5 text-xs">
                <div className="flex items-center gap-2 font-medium text-river-2">
                  <ShieldCheck className="h-4 w-4 text-river" />
                  <span>Xác thực bởi Chuỗi khối SHA-256 (Tamper-evident)</span>
                </div>
                <span className="rounded border border-line bg-sheet px-2 py-0.5 font-mono text-[10px]">
                  {aarReport.engine}
                </span>
              </div>
              <div className="rounded-lg border border-line bg-sheet-2 p-3 text-xs font-medium text-ink">
                <div className="eyebrow mb-1">Tóm lược Lãnh đạo (Executive Summary)</div>
                {aarReport.executive_summary}
              </div>
              <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-line bg-sheet p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap">
                {aarReport.markdown_content}
              </div>
            </div>
          ) : (
            <div className="p-4 text-center text-xs text-crit">Không tải được báo cáo AAR.</div>
          )}
        </Modal>
      )}
    </section>
  );
};

const VerifyForm: React.FC<{ report: FloodReport; onVerify: DispatcherWorkspaceProps['onVerifyReport'] }> = ({ report, onVerify }) => {
  const auth = useContext(AuthContext);
  const token = auth?.token ?? null;
  const [decision, setDecision] = useState<'VERIFIED' | 'REJECTED'>('VERIFIED');
  const [priority, setPriority] = useState<FloodPriority>(report.priority === 'CRITICAL' ? 'URGENT' : report.priority);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [aiRec, setAiRec] = useState<{
    suggested_priority: 'CRITICAL' | 'URGENT' | 'HIGH' | 'NORMAL' | 'LOW';
    confidence: number;
    reasoning: string;
    key_factors: string[];
    engine: string;
  } | null>(null);
  const [loadingAiRec, setLoadingAiRec] = useState(false);

  React.useEffect(() => {
    if (!token) return;
    let active = true;
    setLoadingAiRec(true);
    api.classifyPriority(token, {
      description: report.description || report.notes || 'Tin báo người dân',
      depth_cm: report.depth_cm,
      people_affected: report.people_affected,
      need_type: report.need_type,
    }).then((res) => {
      if (active) setAiRec(res);
    }).catch(() => {
      // Graceful fallback
    }).finally(() => {
      if (active) setLoadingAiRec(false);
    });
    return () => { active = false; };
  }, [report.report_id, report.depth_cm, report.people_affected, report.need_type, token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const bad = decision === 'REJECTED' ? validateRejectionReason(note) : null;
    if (bad) { setError(bad); return; }
    setBusy(true); setError(null);
    try { await onVerify(report.report_id, priority, note.trim(), decision); }
    catch (err) { setError(err instanceof Error ? err.message : 'Không lưu được kết quả xác minh.'); }
    finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} className="space-y-3 border-t border-line pt-4" aria-label="Xác minh tin báo">
      <h4 className="text-sm font-bold">Xác minh tin báo</h4>
      {error && <p role="alert" className="rounded-lg border border-crit/30 bg-crit-soft p-2.5 text-xs font-medium text-crit">{error}</p>}
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Kết quả xác minh">
        {([['VERIFIED', 'Hợp lệ'], ['REJECTED', 'Từ chối / tin sai']] as const).map(([v, l]) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={decision === v}
            onClick={() => setDecision(v)}
            className={`btn ${decision === v ? (v === 'VERIFIED' ? 'btn-primary' : 'btn-danger') : ''}`}
          >
            {l}
          </button>
        ))}
      </div>
      {decision === 'VERIFIED' && (
        <>
          <div className="rounded-xl border border-river/30 bg-river-soft/30 p-3 text-xs space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 font-bold text-river-2">
                <Sparkles className="h-3.5 w-3.5 text-river" /> Gợi ý AI phân loại ưu tiên
              </span>
              {loadingAiRec ? (
                <span className="inline-flex items-center gap-1 text-ink-3">
                  <Loader2 className="h-3 w-3 animate-spin" /> Đang đánh giá…
                </span>
              ) : aiRec ? (
                <span className="num font-semibold text-ink-2">
                  {(aiRec.confidence * 100).toFixed(0)}% tin cậy
                </span>
              ) : null}
            </div>

            {aiRec && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-ink">Gợi ý:</span>
                  <StatusBadge status={aiRec.suggested_priority} type="priority" />
                  {priority !== aiRec.suggested_priority && (
                    <button
                      type="button"
                      onClick={() => setPriority(aiRec.suggested_priority)}
                      className="btn !min-h-6 border-line bg-sheet px-2 py-0.5 text-[11px] font-medium text-river-2 hover:bg-sheet-2"
                    >
                      Áp dụng gợi ý
                    </button>
                  )}
                  {priority === aiRec.suggested_priority && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-safe">
                      <Check className="h-3 w-3" /> Đã áp dụng
                    </span>
                  )}
                </div>
                <p className="text-[11px] italic text-ink-2">"{aiRec.reasoning}"</p>
                {aiRec.key_factors?.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    {aiRec.key_factors.map((f, i) => (
                      <span key={i} className="rounded border border-line bg-sheet px-1.5 py-0.5 text-[10px] text-ink-3">
                        {f}
                      </span>
                    ))}
                  </div>
                )}
                <div className="font-mono text-[10px] text-ink-3">
                  Quyết định con người là tối thượng · Engine: {aiRec.engine}
                </div>
              </div>
            )}
          </div>

          <Field label="Mức ưu tiên" hint={`Người báo chọn: ${PRIORITIES.find((p) => p.value === report.priority)?.label ?? report.priority}. Đổi nếu thẩm định khác.`}>
            <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Mức ưu tiên">
              {PRIORITIES.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  role="radio"
                  aria-checked={priority === p.value}
                  onClick={() => setPriority(p.value)}
                  className={`rounded-lg border px-2.5 py-2 text-left text-xs transition-colors ${
                    priority === p.value ? 'border-ink bg-ink text-white shadow-2xs' : 'border-line-2 bg-sheet hover:bg-sheet-2'
                  }`}
                >
                  <span className="block font-bold">{p.label}</span>
                  <span className={priority === p.value ? 'text-white/75' : 'text-ink-3'}>{p.hint}</span>
                </button>
              ))}
            </div>
          </Field>
        </>
      )}
      <Field label={decision === 'REJECTED' ? 'Lý do từ chối (bắt buộc)' : 'Ghi chú xác minh (tuỳ chọn)'} htmlFor="verify-note">
        <textarea
          id="verify-note"
          rows={2}
          className="input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={decision === 'REJECTED' ? 'Ví dụ: tin trùng, đã gọi lại người báo, ngoài địa bàn' : 'Ví dụ: đã gọi lại người báo, xác nhận nước đang lên'}
        />
      </Field>
      <button type="submit" className="btn btn-primary w-full" disabled={busy}>
        {busy ? 'Đang lưu…' : decision === 'VERIFIED' ? 'Xác nhận hợp lệ' : 'Từ chối tin báo'}
      </button>
    </form>
  );
};

const kmText = (m: number) => `${(m / 1000).toFixed(1)} km`;

const DispatchForm: React.FC<{
  report: FloodReport; teams: RescueTeam[]; vehicles: RescueVehicle[];
  busyVehicleIds: Set<string>; busyTeamIds: Set<string>;
  onDispatch: DispatcherWorkspaceProps['onDispatchOrder'];
}> = ({ report, teams, vehicles, busyVehicleIds, busyTeamIds, onDispatch }) => {
  const [vehicleId, setVehicleId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [hours, setHours] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const freeVehicles = useMemo(
    () => vehicles
      .filter((v) => isVehicleAvailable(v, busyVehicleIds))
      .map((v) => ({ v, m: metresBetween(v.current_lat, v.current_lng, report.lat, report.lng) }))
      .sort((a, b) => a.m - b.m),
    [vehicles, busyVehicleIds, report.lat, report.lng],
  );
  const freeTeams = useMemo(() => teams.filter((t) => isTeamAvailable(t, busyTeamIds)), [teams, busyTeamIds]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vehicleId || !teamId || hours === null) { setError('Chọn phương tiện, đội và thời lượng dự kiến trước khi phát lệnh.'); return; }
    setBusy(true); setError(null);
    try {
      await onDispatch({ report_id: report.report_id, team_id: teamId, vehicle_id: vehicleId, target_time: new Date(Date.now() + hours * 3_600_000).toISOString(), notes: note.trim() || undefined });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không phát được lệnh điều phối.');
    } finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} className="space-y-3 border-t border-line pt-4" aria-label="Lệnh điều phối">
      <h4 className="text-sm font-bold">Điều phối lực lượng</h4>
      {error && <p role="alert" className="rounded-lg border border-crit/30 bg-crit-soft p-2.5 text-xs font-medium text-crit">{error}</p>}

      <fieldset>
        <legend className="label">
          Phương tiện sẵn sàng <span className="font-normal text-ink-3">(gần nhất trước; khoảng cách đường chim bay từ vị trí ghi nhận gần nhất)</span>
        </legend>
        {freeVehicles.length === 0 ? (
          <p className="rounded-lg border border-warn/30 bg-warn-soft p-2.5 text-xs text-warn">
            Không có phương tiện nào sẵn sàng. Chờ xe hoàn thành lệnh hiện tại hoặc nhờ quản lý nguồn lực xử lý.
          </p>
        ) : (
          <div className="rule-y overflow-hidden rounded-lg border border-line">
            {freeVehicles.map(({ v, m }) => (
              <label
                key={v.vehicle_id}
                className={`flex cursor-pointer items-center gap-2.5 px-3 py-2.5 text-sm transition-colors ${
                  vehicleId === v.vehicle_id ? 'bg-river-soft/75' : 'hover:bg-sheet-2'
                }`}
              >
                <input
                  type="radio"
                  name="vehicle"
                  value={v.vehicle_id}
                  checked={vehicleId === v.vehicle_id}
                  onChange={() => setVehicleId(v.vehicle_id)}
                  aria-label={`Phương tiện ${v.name}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="font-semibold text-ink">{v.name}</span>
                  <span className="block text-xs text-ink-3">
                    {vehicleType(v.vehicle_type)} · nhiên liệu {v.fuel_pct == null ? '—' : `${Math.round(v.fuel_pct)}%`}
                  </span>
                </span>
                <span className="num rounded bg-paper px-1.5 py-0.5 text-xs font-bold text-river-2">{kmText(m)}</span>
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <fieldset>
        <legend className="label">Đội sẵn sàng</legend>
        {freeTeams.length === 0 ? (
          <p className="rounded-lg border border-warn/30 bg-warn-soft p-2.5 text-xs text-warn">Không có đội nào sẵn sàng.</p>
        ) : (
          <div className="rule-y overflow-hidden rounded-lg border border-line">
            {freeTeams.map((t) => (
              <label
                key={t.team_id}
                className={`flex cursor-pointer items-center gap-2.5 px-3 py-2.5 text-sm transition-colors ${
                  teamId === t.team_id ? 'bg-river-soft/75' : 'hover:bg-sheet-2'
                }`}
              >
                <input
                  type="radio"
                  name="team"
                  value={t.team_id}
                  checked={teamId === t.team_id}
                  onChange={() => setTeamId(t.team_id)}
                  aria-label={t.name}
                />
                <span className="min-w-0 flex-1">
                  <span className="font-semibold text-ink">{t.name}</span>
                  <span className="block text-xs text-ink-3">
                    {t.member_count} người{t.specialty ? ` · ${t.specialty}` : ''}{t.leader_name ? ` · ${t.leader_name}` : ''}
                  </span>
                </span>
                <span className="num text-xs font-semibold text-watch">{t.rating?.toFixed?.(1) ?? t.rating}★</span>
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <Field label="Thời lượng dự kiến của ca">
        <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Thời lượng dự kiến">
          {DURATIONS.map((d) => (
            <button
              key={d.h}
              type="button"
              role="radio"
              aria-checked={hours === d.h}
              onClick={() => setHours(d.h)}
              className={`btn !min-h-9 ${hours === d.h ? 'btn-primary' : ''}`}
            >
              {d.label}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Chỉ đạo cho đội (tuỳ chọn)" htmlFor="dispatch-note">
        <textarea id="dispatch-note" rows={2} className="input" value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <button type="submit" className="btn btn-primary w-full" disabled={busy || !vehicleId || !teamId || hours === null}>
        {busy ? 'Đang phát lệnh…' : 'Phát lệnh điều phối'}
      </button>
      <p className="text-[11px] text-ink-3">
        Hệ thống chặn trùng lịch xe và đội tại cơ sở dữ liệu; nếu xung đột, lệnh bị từ chối và hiển thị tại đây.
      </p>
    </form>
  );
};

/* ------------------------------------------------------------------ */
/* Replan: ranked replacement options; the dispatcher must choose one. */
/* ------------------------------------------------------------------ */

const ReplanPanel: React.FC<{ incident: FieldIncident; vehicles: RescueVehicle[]; onApprove?: DispatcherWorkspaceProps['onApproveReplan'] }> = ({ incident, vehicles, onApprove }) => {
  const [optionId, setOptionId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options: CandidateRescueOption[] = incident.candidate_options?.length ? incident.candidate_options : incident.replan_candidates ?? [];
  const broken = vehicles.find((v) => v.vehicle_id === incident.vehicle_id);
  const canApprove = incident.status === 'OPEN_REPLANNING' || incident.status === 'REPORTED';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!optionId || !onApprove) return;
    setBusy(true); setError(null);
    try { await onApprove(incident.incident_id, optionId); }
    catch (err) { setError(err instanceof Error ? err.message : 'Không phê duyệt được phương án.'); }
    finally { setBusy(false); }
  };

  return (
    <section className="panel flex h-full flex-col overflow-hidden" aria-label="Điều phối lại">
      <div className="panel-head">
        <div className="min-w-0">
          <div className="eyebrow">Sự cố phương tiện</div>
          <h3 className="text-base font-bold">{broken?.name ?? incident.vehicle_id} · {incidentType(incident.incident_type)}</h3>
        </div>
        <StatusBadge label={incidentStatus(incident.status)} />
      </div>
      <form onSubmit={submit} className="flex-1 space-y-3 overflow-y-auto p-4">
        {incident.description && <p className="rounded-lg border border-line bg-sheet-2 p-3 text-sm">{incident.description}</p>}
        <p className="text-xs text-ink-3">
          Ước tính ngừng hoạt động {incident.estimated_downtime_hours} giờ. {incident.impacted_order_ids?.length ? `Ảnh hưởng ${incident.impacted_order_ids.length} lệnh.` : ''}
        </p>
        {error && <p role="alert" className="rounded-lg border border-crit/30 bg-crit-soft p-2.5 text-xs font-medium text-crit">{error}</p>}
        <h4 className="text-sm font-bold">Phương án thay thế (xếp hạng theo điểm, tối đa 100)</h4>
        {options.length === 0 ? (
          <p className="rounded-lg border border-warn/30 bg-warn-soft p-2.5 text-xs text-warn">
            Chưa có phương án thay thế nào đủ điều kiện (xe sẵn sàng và đội rảnh trong khung giờ).
          </p>
        ) : (
          <div className="rule-y overflow-hidden rounded-lg border border-line" role="radiogroup" aria-label="Phương án thay thế">
            {options.map((o, i) => (
              <label key={o.option_id} className={`block cursor-pointer px-3.5 py-3 transition-colors ${optionId === o.option_id ? 'bg-river-soft/75' : 'hover:bg-sheet-2'}`}>
                <div className="flex items-start gap-2.5">
                  <input
                    type="radio"
                    name="option"
                    value={o.option_id}
                    checked={optionId === o.option_id}
                    onChange={() => setOptionId(o.option_id)}
                    disabled={!canApprove}
                    className="mt-1"
                    aria-label={`Phương án ${o.rank ?? i + 1}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-bold text-ink">#{o.rank ?? i + 1} · {o.vehicle_name ?? o.replacement_vehicle_id ?? o.vehicle_id}</span>
                      <span className="num text-sm font-bold text-river-2">{Math.round(o.score)}<span className="text-xs font-normal text-ink-3">/100</span></span>
                    </div>
                    <div className="text-xs text-ink-2">
                      {o.team_name ?? o.team_id} · {o.distance_km} km {o.distance_kind === 'STRAIGHT_LINE_HAVERSINE' || !o.distance_kind ? 'đường chim bay' : o.distance_kind}
                      {o.position_is_simulated ? ' · vị trí mô phỏng' : ''}
                    </div>
                    {(o.explanations?.length || o.explanation || o.reason) && (
                      <ul className="mt-1 list-disc pl-4 text-xs text-ink-3">
                        {(o.explanations?.length ? o.explanations : [o.explanation || o.reason || '']).map((t, k) => <li key={k}>{t}</li>)}
                      </ul>
                    )}
                  </div>
                </div>
              </label>
            ))}
          </div>
        )}
        {canApprove && options.length > 0 && (
          <>
            <button type="submit" className="btn btn-primary w-full" disabled={busy || !optionId}>
              {busy ? 'Đang duyệt…' : 'Duyệt phương án đã chọn'}
            </button>
            <p className="text-[11px] text-ink-3">
              Điểm là luật chấm điểm (40 khoảng cách, 25 phù hợp nhu cầu, 20 sức chứa, 15 đánh giá đội); hệ thống chỉ đề xuất, người điều phối quyết định.
            </p>
          </>
        )}
      </form>
    </section>
  );
};
