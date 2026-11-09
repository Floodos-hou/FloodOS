// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ClipboardList, GitBranch, LayoutDashboard, Map as MapIcon, ScrollText, ShieldCheck, TriangleAlert, X } from 'lucide-react';
import { useAuth } from './context/useAuth';
import { api } from './services/api';
import type { TacticalState, FloodPriority, DispatchOrderStatus, FloodReport, UserRole } from './types';
import { LoginPage } from './components/auth/LoginPage';
import { Header } from './components/common/Header';
import { ProofInspectorModal } from './components/common/ProofInspectorModal';
import { DataLineageModal } from './components/common/DataLineageModal';
import { AuditView } from './components/common/AuditView';
import { MapDetailPanel, selectionKey, type MapSelection } from './components/map/MapDetailPanel';
import type { MapRoute } from './components/map/TacticalMap';
import { ProcessCommandCard } from './components/process/ProcessCommandCard';
import { ReporterWorkspace } from './components/workspaces/ReporterWorkspace';
import { DispatcherWorkspace } from './components/workspaces/DispatcherWorkspace';
import { FieldTeamWorkspace } from './components/workspaces/FieldTeamWorkspace';
import { ResourceManagerWorkspace } from './components/workspaces/ResourceManagerWorkspace';
import { MobileFloatingBar } from './components/mobile/MobileFloatingBar';
import { MobileSOSModal } from './components/mobile/MobileSOSModal';
import { useLiveFleet, mergeLive } from './hooks/useLiveFleet';
import { priority as priorityLabel } from './utils/labels';
import {
  speakVoiceAlert,
  formatReportVoiceAlert,
  formatIncidentVoiceAlert,
} from './utils/voiceAlert';

const TacticalMap = lazy(() => import('./components/map/TacticalMap').then((m) => ({ default: m.TacticalMap })));

type Tab = 'HOME' | 'MAP' | 'PROCESS' | 'AUDIT';

const POLL_MS = 20_000;
/** three missed polls: say so instead of showing old numbers as current */
const STALE_MS = POLL_MS * 3;

const HOME_LABEL: Record<string, string> = {
  REPORTER: 'Tin báo của tôi',
  DISPATCHER: 'Điều phối',
  FIELD_TEAM: 'Nhiệm vụ',
  RESOURCE_MANAGER: 'Nguồn lực',
  PLATFORM_ADMIN: 'Điều phối',
};

const errText = (err: unknown, fallback: string): string => (err instanceof Error && err.message ? err.message : fallback);

const openReportOnMap = (setSelection: (s: MapSelection) => void, setTab: (t: Tab) => void) => (r: FloodReport) => {
  setSelection({ type: 'report', data: r });
  setTab('MAP');
};

export const App: React.FC = () => {
  const { user, token, isAuthenticated, logout } = useAuth();

  const [state, setState] = useState<TacticalState | null>(null);
  const { live, trails, info: liveInfo } = useLiveFleet(token, user?.role);
  const mapVehicles = useMemo(() => (state ? mergeLive(state.vehicles || [], live) : []), [state, live]);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const [tab, setTab] = useState<Tab>(() => {
    if (typeof window !== 'undefined') {
      const q = new URLSearchParams(window.location.search).get('tab');
      if (q === 'MAP' || q === 'PROCESS' || q === 'AUDIT') return q;
    }
    return 'HOME';
  });
  const [showMobileSos, setShowMobileSos] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return new URLSearchParams(window.location.search).get('action') === 'sos';
    }
    return false;
  });
  const [showProofInspector, setShowProofInspector] = useState(false);
  const [lineageId, setLineageId] = useState<string | null>(null);
  const [selection, setSelection] = useState<MapSelection | null>(null);

  const announcedReportIds = useRef<Set<string>>(new Set());
  const announcedIncidentIds = useRef<Set<string>>(new Set());
  const isInitialLoad = useRef<boolean>(true);

  const loadState = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    try {
      const data = await api.getTacticalState(token);

      if (isInitialLoad.current) {
        (data.reports || []).forEach((r) => announcedReportIds.current.add(r.report_id));
        (data.incidents || []).forEach((i) => announcedIncidentIds.current.add(i.incident_id));
        isInitialLoad.current = false;
      } else {
        for (const report of data.reports || []) {
          if (!announcedReportIds.current.has(report.report_id)) {
            announcedReportIds.current.add(report.report_id);
            if (report.priority === 'CRITICAL' || report.priority === 'URGENT') {
              speakVoiceAlert(formatReportVoiceAlert(report), { urgent: true });
            }
          }
        }
        for (const inc of data.incidents || []) {
          if (!announcedIncidentIds.current.has(inc.incident_id)) {
            announcedIncidentIds.current.add(inc.incident_id);
            if (inc.status === 'OPEN_REPLANNING') {
              speakVoiceAlert(formatIncidentVoiceAlert(inc), { urgent: true });
            }
          }
        }
      }

      setState(data);
      setUpdatedAt(new Date());
      setError(null);
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 401) logout('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
      else setError(errText(err, 'Không thể kết nối đến máy chủ FloodOS.'));
    } finally {
      setIsLoading(false);
    }
  }, [token, logout]);

  useEffect(() => {
    if (!isAuthenticated || !token) return;
    const first = window.setTimeout(() => { void loadState(); }, 0);
    const poll = window.setInterval(() => { void loadState(); }, POLL_MS);
    const clock = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => { window.clearTimeout(first); window.clearInterval(poll); window.clearInterval(clock); };
  }, [isAuthenticated, token, loadState]);

  useEffect(() => {
    if (notice?.kind !== 'ok') return;
    const t = window.setTimeout(() => setNotice(null), 7_000);
    return () => window.clearTimeout(t);
  }, [notice]);

  const act = async (call: () => Promise<unknown>, okText: string, failPrefix: string) => {
    try {
      await call();
      await loadState();
      setNotice({ kind: 'ok', text: okText });
    } catch (err) {
      setNotice({ kind: 'err', text: `${failPrefix}: ${errText(err, 'Vui lòng thử lại.')}` });
      throw err;
    }
  };

  const handleSimTick = async () => { if (token) { await api.simTick(token).catch(() => undefined); await loadState(); } };
  const handleSimReset = async () => {
    if (!token) return;
    await act(() => api.simReset(token), 'Đã đặt lại dữ liệu mô phỏng về trạng thái ban đầu.', 'Không đặt lại được').catch(() => undefined);
  };

  const handleCreateReport = (payload: Parameters<typeof api.createFloodReport>[1]) =>
    act(async () => api.createFloodReport(token!, payload), 'Đã gửi tin báo. Bạn có thể theo dõi tiến trình ở mục “Tin báo của tôi”.', 'Không gửi được tin báo');

  const handleConfirmResolution = (resolutionId: string, decision: 'CONFIRMED' | 'DISPUTED', notes?: string) =>
    act(
      () => api.confirmResolution(token!, { resolution_id: resolutionId, decision, notes }),
      decision === 'CONFIRMED' ? 'Cảm ơn bạn. Tin báo đã được đóng và ghi vào nhật ký kiểm chứng.' : 'Đã ghi nhận phản hồi. Vụ việc được chuyển lại cho điều phối viên.',
      'Không gửi được xác nhận',
    );

  const handleVerifyReport = (reportId: string, priority: FloodPriority, notes?: string, decision: 'VERIFIED' | 'REJECTED' = 'VERIFIED') =>
    act(
      () => api.verifyFloodReport(token!, reportId, { decision, priority, note: notes }),
      decision === 'VERIFIED' ? `Đã xác minh tin ${reportId}, mức ưu tiên ${priorityLabel(priority).text.toLowerCase()}.` : `Đã từ chối tin ${reportId}.`,
      'Không xác minh được',
    );

  const handleDispatchOrder = (payload: { report_id: string; team_id: string; vehicle_id: string; target_time: string; notes?: string }) =>
    act(
      async () => {
        try {
          await api.createDispatchOrder(token!, { report_id: payload.report_id, team_id: payload.team_id, vehicle_id: payload.vehicle_id, start_time: new Date().toISOString(), end_time: payload.target_time });
        } catch (err) {
          if ((err as { status?: number }).status === 409) throw new Error(`Trùng lịch: xe hoặc đội đã có lệnh trong khung giờ này. ${errText(err, '')}`.trim());
          throw err;
        }
      },
      `Đã phát lệnh điều phối cho tin ${payload.report_id}.`,
      'Không phát được lệnh',
    );

  const handleUpdateOrderStatus = (
    orderId: string,
    status: DispatchOrderStatus,
    payload: { progress_pct?: number; note?: string; outcome?: string; final_depth_cm?: number; evidence_filename?: string; evidence_data_url?: string } = {},
  ) => {
    const completing = status === 'COMPLETED' || status === 'RESOLVED';
    return act(
      () => api.updateOrderStatus(token!, orderId, {
        status: completing ? 'COMPLETED' : 'IN_PROGRESS',
        progress_pct: completing ? 100 : payload.progress_pct ?? 0,
        note: payload.note,
        outcome: payload.outcome as 'RESOLVED' | 'PARTIAL' | 'UNRESOLVED' | undefined,
        final_depth_cm: payload.final_depth_cm,
        evidence_filename: payload.evidence_filename,
        evidence_data_url: payload.evidence_data_url,
      }),
      completing ? 'Đã gửi báo cáo hoàn thành. Chờ người báo tin xác nhận.' : 'Đã cập nhật tiến độ nhiệm vụ.',
      'Không cập nhật được nhiệm vụ',
    );
  };

  const handleReportIncident = (payload: { order_id: string; vehicle_id: string; incident_type: string; severity: string; description: string; estimated_downtime_hours: number; photo_bytes?: string }) =>
    act(
      () => api.reportFieldIncident(token!, {
        vehicle_id: payload.vehicle_id, severity: payload.severity, incident_type: payload.incident_type, description: payload.description,
        estimated_downtime_hours: payload.estimated_downtime_hours, evidence_data_url: payload.photo_bytes,
      }),
      'Đã báo sự cố. Hệ thống đã xếp hạng các phương án thay thế để điều phối viên chọn.',
      'Không báo được sự cố',
    );

  const handleApproveReplan = (incidentId: string, optionId: string) =>
    act(() => api.approveReplan(token!, incidentId, { option_id: optionId }), 'Đã duyệt phương án thay thế. Lệnh mới đã được tạo.', 'Không duyệt được phương án');

  const handleUpdateShelterOccupancy = (shelterId: string, occupancy: number) =>
    act(() => api.updateShelterOccupancy(token!, shelterId, { occupancy }), `Đã cập nhật sĩ số điểm trú: ${occupancy} người.`, 'Không cập nhật được sĩ số');

  const handleResolveTicket = (incidentId: string, notes: string) =>
    act(() => api.updateRepairTicket(token!, incidentId, { action: 'RESOLVED', notes }), 'Đã đóng phiếu sửa chữa, xe trở lại trạng thái sẵn sàng.', 'Không đóng được phiếu');

  const route = useMemo<MapRoute | null>(() => {
    if (!state) return null;
    const inc = state.incidents.find((i) => i.status === 'OPEN_REPLANNING');
    const opt = inc?.candidate_options?.[0] ?? inc?.replan_candidates?.[0];
    if (!inc || !opt) return null;
    const veh = mapVehicles.find((v) => v.vehicle_id === (opt.replacement_vehicle_id ?? opt.vehicle_id));
    const order = state.orders.find((o) => inc.impacted_order_ids?.includes(o.order_id));
    const rep = state.reports.find((r) => r.report_id === order?.report_id);
    if (!veh || !rep) return null;
    return { from: { lat: veh.current_lat, lng: veh.current_lng }, to: { lat: rep.lat, lng: rep.lng }, label: `${veh.name} → ${rep.report_id}` };
  }, [state, mapVehicles]);

  if (!isAuthenticated || !user) return <LoginPage />;

  const role = user.role as UserRole;
  const isDispatcher = role === 'DISPATCHER' || role === 'PLATFORM_ADMIN';
  const isStaff = isDispatcher || role === 'RESOURCE_MANAGER';
  const isStale = !!updatedAt && now - updatedAt.getTime() > STALE_MS;

  const openReportsCount = (state?.reports || []).filter((r) => !['RESOLVED', 'CLOSED', 'REJECTED'].includes(r.status)).length;
  const activeBpmnCount = (state?.bpmn_instances || []).filter((b) => b.status === 'ACTIVE').length;
  const auditCount = (state?.audit_logs || []).length;

  const tabs: { id: Tab; label: string; Icon: React.ComponentType<{ className?: string }>; count?: number }[] = [
    { id: 'HOME', label: HOME_LABEL[role] ?? 'Trang chính', Icon: role === 'REPORTER' ? ClipboardList : LayoutDashboard, count: openReportsCount },
  ];
  if (!isDispatcher) tabs.push({ id: 'MAP', label: 'Bản đồ', Icon: MapIcon });
  if (isDispatcher) tabs.push({ id: 'PROCESS', label: 'Quy trình', Icon: GitBranch, count: activeBpmnCount });
  if (isStaff) tabs.push({ id: 'AUDIT', label: 'Nhật ký', Icon: ScrollText, count: auditCount });

  const mapEl = state && (
    <Suspense fallback={<div className="grid h-full min-h-[320px] place-items-center text-sm text-ink-3">Đang nạp bản đồ…</div>}>
      <TacticalMap
        zones={state.zones}
        vehicles={mapVehicles}
        reports={state.reports}
        gauges={state.gauges}
        shelters={state.shelters}
        route={route}
        trails={trails}
        live={liveInfo}
        selectedKey={selection ? selectionKey(selection) : null}
        onSelect={setSelection}
        legendOpen={tab === 'MAP'}
        heightClass={tab === 'MAP' ? 'h-[calc(100vh-9.5rem)] min-h-[420px]' : 'h-full'}
      />
    </Suspense>
  );

  const chainValid = (state?.chain_proof ?? state?.audit_chain_proof)?.chain_valid ?? true;

  return (
    <div className="flex min-h-screen flex-col bg-paper text-ink">
      <Header
        simTime={state?.sim_clock?.sim_time || ''}
        onTick={handleSimTick}
        onReset={handleSimReset}
        onRefresh={() => void loadState()}
        isRefreshing={isLoading}
        onOpenProofInspector={() => setShowProofInspector(true)}
        showStaffTools={isStaff}
        orgName={state?.auth_context?.organization_name}
        isStale={isStale}
        updatedAt={updatedAt}
        dataNotice={state?.data_notice}
      />

      <div className="flex min-h-0 flex-1">
        <nav
          aria-label="Điều hướng chính"
          className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-52 shrink-0 flex-col justify-between border-r border-line bg-sheet p-3 md:flex"
        >
          <div className="space-y-1">
            <div className="eyebrow px-2.5 pb-1.5 pt-1">Không gian làm việc</div>
            {tabs.map(({ id, label, Icon, count }) => {
              const active = tab === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  aria-current={active ? 'page' : undefined}
                  className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-semibold transition-colors ${
                    active
                      ? 'bg-river-soft text-river-2 shadow-2xs ring-1 ring-river/20'
                      : 'text-ink-2 hover:bg-sheet-2 hover:text-ink'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <Icon className={`h-4 w-4 ${active ? 'text-river' : 'text-ink-3'}`} aria-hidden="true" />
                    {label}
                  </span>
                  {count !== undefined && count > 0 && (
                    <span className={`num rounded-full px-1.5 py-0.5 text-[11px] font-bold ${active ? 'bg-river text-white' : 'bg-paper text-ink-2'}`}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="rounded-xl border border-line bg-sheet-2 p-3 text-xs space-y-2">
            <div className="flex items-center gap-1.5 font-bold text-ink">
              <ShieldCheck className={`h-4 w-4 ${chainValid ? 'text-safe' : 'text-crit'}`} aria-hidden="true" />
              <span>Bảo mật Zero-Trust</span>
            </div>
            <div className="text-[11px] leading-relaxed text-ink-3">
              Sổ cái SHA-256: <span className="font-semibold text-safe">{chainValid ? 'Toàn vẹn' : 'Cảnh báo'}</span>
              <br />
              Phân lập dữ liệu: <span className="font-semibold text-ink-2">PostgreSQL RLS</span>
            </div>
          </div>
        </nav>

        <main className="min-w-0 flex-1 p-3 pb-24 sm:p-4 md:pb-5">
          {error && (
            <div role="alert" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-crit/30 bg-crit-soft px-4 py-3 text-sm shadow-2xs">
              <span className="flex items-center gap-2">
                <TriangleAlert className="h-4 w-4 text-crit" aria-hidden="true" />
                <span>
                  <span className="font-semibold text-crit">Mất kết nối với máy chủ.</span> {error}
                  {updatedAt && ` Đang hiển thị dữ liệu lúc ${updatedAt.toLocaleTimeString('vi-VN')}.`}
                </span>
              </span>
              <button type="button" className="btn" onClick={() => void loadState()}>Thử lại</button>
            </div>
          )}

          {!state && !error && (
            <div role="status" className="grid place-items-center py-24 text-sm text-ink-3">
              Đang tải dữ liệu điều hành…
            </div>
          )}

          {state && tab === 'HOME' && (
            <>
              {role === 'REPORTER' && (
                <ReporterWorkspace
                  reports={state.reports} orders={state.orders} zones={state.zones} shelters={state.shelters} resolutions={state.resolutions}
                  onCreateReport={handleCreateReport} onConfirmResolution={handleConfirmResolution} onOpenLineage={setLineageId}
                />
              )}
              {isDispatcher && (
                <DispatcherWorkspace
                  reports={state.reports} orders={state.orders} teams={state.teams} vehicles={mapVehicles} incidents={state.incidents} zones={state.zones}
                  mapElement={mapEl} mapSelection={selection} onClearMapSelection={() => setSelection(null)}
                  onVerifyReport={handleVerifyReport} onDispatchOrder={handleDispatchOrder} onApproveReplan={handleApproveReplan}
                  onSelectReport={(r) => setSelection({ type: 'report', data: r })}
                />
              )}
              {role === 'FIELD_TEAM' && (
                <FieldTeamWorkspace
                  currentUserId={user.user_id} teams={state.teams} vehicles={mapVehicles} orders={state.orders} reports={state.reports} incidents={state.incidents}
                  onUpdateOrderStatus={handleUpdateOrderStatus} onReportIncident={handleReportIncident} onSelectReport={openReportOnMap(setSelection, setTab)}
                />
              )}
              {role === 'RESOURCE_MANAGER' && (
                <ResourceManagerWorkspace
                  vehicles={mapVehicles} shelters={state.shelters} gauges={state.gauges} incidents={state.incidents}
                  onUpdateShelterOccupancy={handleUpdateShelterOccupancy} onResolveTicket={handleResolveTicket}
                  onSelectShelter={(s) => { setSelection({ type: 'shelter', data: s }); setTab('MAP'); }}
                  onSelectGauge={(g) => { setSelection({ type: 'gauge', data: g }); setTab('MAP'); }}
                />
              )}
            </>
          )}

          {state && tab === 'MAP' && (
            <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
              <div className="panel min-w-0 overflow-hidden">{mapEl}</div>
              <div className="min-h-0">
                {selection ? (
                  <MapDetailPanel
                    selection={selection} onClose={() => setSelection(null)} currentUserRole={role} orders={state.orders} zones={state.zones}
                  />
                ) : (
                  <div className="panel p-4 text-sm text-ink-2">
                    <span className="font-semibold text-ink">Chọn một điểm trên bản đồ</span> (tin báo, phương tiện, điểm trú, trạm đo hoặc vùng) để xem chi tiết và nguồn dữ liệu.
                  </div>
                )}
              </div>
            </div>
          )}

          {state && tab === 'PROCESS' && <ProcessCommandCard instances={state.bpmn_instances} currentUserRole={role} />}
          {state && tab === 'AUDIT' && <AuditView logs={state.audit_logs} chain={state.chain_proof ?? state.audit_chain_proof} onOpenLineage={(id) => id && setLineageId(id)} />}
        </main>
      </div>

      <MobileFloatingBar
        currentTab={tab}
        onSelectTab={(t) => setTab(t)}
        onOpenSOS={() => setShowMobileSos(true)}
      />

      <nav
        aria-label="Điều hướng chính (điện thoại)"
        className="fixed inset-x-0 bottom-0 z-30 grid border-t border-line bg-sheet/95 backdrop-blur-md md:hidden"
        style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
      >
        {tabs.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            aria-current={tab === id ? 'page' : undefined}
            className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${tab === id ? 'text-river' : 'text-ink-3'}`}
          >
            <Icon className="h-5 w-5" aria-hidden="true" /> {label}
          </button>
        ))}
      </nav>

      {notice && (
        <div
          role={notice.kind === 'err' ? 'alert' : 'status'}
          className={`fixed bottom-20 left-1/2 z-40 flex w-[calc(100%-1.5rem)] max-w-xl -translate-x-1/2 items-start gap-3 rounded-xl border px-4 py-3 text-sm font-medium shadow-[var(--shadow-pop)] md:bottom-5 ${
            notice.kind === 'err' ? 'border-crit/30 bg-crit-soft text-crit' : 'border-safe/30 bg-safe-soft text-safe'
          }`}
        >
          <span className="flex-1">{notice.text}</span>
          <button type="button" aria-label="Đóng thông báo" onClick={() => setNotice(null)}>
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}

      <MobileSOSModal
        isOpen={showMobileSos}
        onClose={() => setShowMobileSos(false)}
        zones={state?.zones}
        onSubmit={handleCreateReport}
      />

      <ProofInspectorModal isOpen={showProofInspector} onClose={() => setShowProofInspector(false)} />
      <DataLineageModal isOpen={!!lineageId} correlationId={lineageId || ''} onClose={() => setLineageId(null)} />
    </div>
  );
};

export default App;
