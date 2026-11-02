// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import React, { Suspense, lazy, useEffect, useMemo, useState, useCallback } from 'react';
import { useAuth } from './context/useAuth';
import { api } from './services/api';
import type { TacticalState, CandidateRescueOption, FloodPriority, DispatchOrderStatus, FloodReport, SafeShelter, GaugeStation } from './types';
import { LoginPage } from './components/auth/LoginPage';
import { Header } from './components/common/Header';
import { ProofInspectorModal } from './components/common/ProofInspectorModal';
import { DataLineageModal } from './components/common/DataLineageModal';
import { BottomCombatLog } from './components/common/BottomCombatLog';
const TacticalMap = lazy(() => import('./components/map/TacticalMap').then((m) => ({ default: m.TacticalMap })));
import { MapDetailPanel, type MapSelection } from './components/map/MapDetailPanel';
import { ProcessCommandCard } from './components/process/ProcessCommandCard';
import { IntelligenceRadar } from './components/radar/IntelligenceRadar';
import { ReporterWorkspace } from './components/workspaces/ReporterWorkspace';
import { DispatcherWorkspace } from './components/workspaces/DispatcherWorkspace';
import { FieldTeamWorkspace } from './components/workspaces/FieldTeamWorkspace';
import { ResourceManagerWorkspace } from './components/workspaces/ResourceManagerWorkspace';
import { RefreshCw, AlertCircle, WifiOff, CheckCircle2 } from 'lucide-react';
import { WelcomeBanner } from './components/common/WelcomeBanner';
import { useLiveFleet, mergeLive } from './hooks/useLiveFleet';
import { FleetKpiStrip } from './components/map/FleetKpiStrip';

type Tab = 'HOME' | 'MAP' | 'PROCESS' | 'RESCUE';

export const App: React.FC = () => {
  const { user, token, isAuthenticated, logout, loginWithCredentials } = useAuth();

  const [state, setState] = useState<TacticalState | null>(null);
  const { live, trails, info: liveInfo } = useLiveFleet(token, user?.role);
  const mapVehicles = useMemo(
    () => (state ? mergeLive(state.vehicles || state.machines || [], live) : []),
    [state, live]
  );
  const [stateUpdatedAt, setStateUpdatedAt] = useState<Date | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [conflictError, setConflictError] = useState<{ code: string; message: string; details?: any } | null>(null);

  // Modals & Map Selection
  const [activeTab, setActiveTab] = useState<Tab>('HOME');
  const [showProofInspector, setShowProofInspector] = useState(false);
  const [activeLineageCorrId, setActiveLineageCorrId] = useState<string | null>(null);
  const [mapSelection, setMapSelection] = useState<MapSelection | null>(null);

  // Load tactical state
  const loadTacticalState = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.getTacticalState(token);
      setState(data);
      setStateUpdatedAt(new Date());
    } catch (err: any) {
      console.error('Failed to load tactical state:', err);
      if (err.status === 401) {
        logout('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
      } else {
        setError(err.message || 'Không thể kết nối đến máy chủ điều phối FloodOS.');
      }
    } finally {
      setIsLoading(false);
    }
  }, [token, logout]);

  useEffect(() => {
    if (!isAuthenticated || !token) return;
    const first = window.setTimeout(() => { void loadTacticalState(); }, 0);
    const timer = window.setInterval(() => { void loadTacticalState(); }, 20_000);
    return () => { window.clearTimeout(first); window.clearInterval(timer); };
  }, [isAuthenticated, token, loadTacticalState]);

  // Actions: Sim
  const handleSimTick = async () => {
    if (!token) return;
    try {
      await api.simTick(token);
      await loadTacticalState();
    } catch (err: any) {
      console.error('Sim tick error:', err);
    }
  };

  const handleSimReset = async () => {
    if (!token) return;
    try {
      await api.simReset(token);
      await loadTacticalState();
      setNotice({ kind: 'ok', text: 'Đã đặt lại dữ liệu tình huống về trạng thái trực ban đầu.' });
    } catch (err: any) {
      console.error('Sim reset error:', err);
    }
  };

  // Actions: Reporter
  const handleCreateReport = async (payload: {
    lat: number;
    lng: number;
    depth_cm: number;
    need_type: string;
    people_affected: number;
    description: string;
    evidence_filename?: string;
    evidence_data_url?: string;
  }) => {
    if (!token) return;
    try {
      const res = await api.createFloodReport(token, payload);
      await loadTacticalState();
      setNotice({
        kind: 'ok',
        text: `Đã tiếp nhận tin báo khẩn cấp #${res.report_id}! Quy trình Flowable SOP-01 đã được kích hoạt.`,
      });
    } catch (err: any) {
      setNotice({ kind: 'err', text: `Lỗi gửi tin báo ngập: ${err.message}` });
      throw err;
    }
  };

  const handleConfirmResolution = async (
    resolutionId: string,
    decision: 'CONFIRMED' | 'DISPUTED',
    notes?: string
  ) => {
    if (!token) return;
    try {
      await api.confirmResolution(token, {
        resolution_id: resolutionId,
        decision,
        notes,
      });
      await loadTacticalState();
      setNotice({
        kind: 'ok',
        text: decision === 'CONFIRMED'
          ? 'Đã xác nhận an toàn và nghiệm thu hoàn tất cứu trợ! Bản ghi đã niêm phong vào sổ cái mật mã.'
          : 'Đã gửi phản ánh chưa an toàn; hồ sơ vụ việc đã được chuyển lại hàng đợi điều phối.',
      });
    } catch (err: any) {
      setNotice({ kind: 'err', text: `Lỗi xác nhận: ${err.message}` });
      throw err;
    }
  };

  // Actions: Dispatcher
  const handleVerifyReport = async (
    reportId: string,
    priority: FloodPriority,
    notes?: string,
    decision: 'VERIFIED' | 'REJECTED' = 'VERIFIED'
  ) => {
    if (!token) return;
    try {
      await api.verifyFloodReport(token, reportId, {
        decision,
        priority,
        note: notes,
      });
      await loadTacticalState();
      setNotice({
        kind: 'ok',
        text: decision === 'VERIFIED'
          ? `Đã thẩm định tin báo #${reportId} với mức ưu tiên: ${priority}`
          : `Đã từ chối tin báo #${reportId}: ${notes}`,
      });
    } catch (err: any) {
      setNotice({ kind: 'err', text: `Lỗi thẩm định tin báo: ${err.message}` });
      throw err;
    }
  };

  const handleDispatchOrder = async (payload: {
    report_id: string;
    team_id: string;
    vehicle_id: string;
    target_time?: string;
    notes?: string;
  }) => {
    if (!token) return;
    setConflictError(null);
    try {
      const startTime = new Date().toISOString();
      const endTime = payload.target_time || new Date(Date.now() + 2 * 3600000).toISOString();
      await api.createDispatchOrder(token, {
        report_id: payload.report_id,
        team_id: payload.team_id,
        vehicle_id: payload.vehicle_id,
        start_time: startTime,
        end_time: endTime,
      });
      await loadTacticalState();
      setNotice({
        kind: 'ok',
        text: `Đã phát lệnh điều phối phương tiện ${payload.vehicle_id} và đội xung kích đến điểm ngập!`,
      });
    } catch (err: any) {
      if (err.status === 409) {
        setConflictError({
          code: err.code || 'CONFLICT',
          message: err.message || 'Xung đột lịch điều động phương tiện cứu hộ (PostgreSQL GiST Double-Booking Protection)',
          details: err.details,
        });
      }
      throw err;
    }
  };

  // Actions: Field Team
  const handleUpdateOrderStatus = async (
    orderId: string,
    status: DispatchOrderStatus,
    payload?: {
      progress_pct?: number;
      note?: string;
      outcome?: 'RESOLVED' | 'PARTIAL' | 'UNRESOLVED' | string;
      final_depth_cm?: number;
      evidence_filename?: string;
      evidence_data_url?: string;
    } | string
  ) => {
    if (!token) return;
    try {
      const opts = typeof payload === 'string'
        ? { note: payload, progress_pct: (status === 'RESOLVED' || status === 'COMPLETED') ? 100 : 50 }
        : (payload || {});

      const apiStatus: 'IN_PROGRESS' | 'COMPLETED' =
        (status === 'RESOLVED' || status === 'COMPLETED') ? 'COMPLETED' : 'IN_PROGRESS';

      await api.updateOrderStatus(token, orderId, {
        status: apiStatus,
        progress_pct: apiStatus === 'COMPLETED' ? 100 : (opts.progress_pct ?? 50),
        note: opts.note,
        outcome: (opts.outcome || 'RESOLVED') as any,
        final_depth_cm: opts.final_depth_cm,
        evidence_filename: opts.evidence_filename,
        evidence_data_url: opts.evidence_data_url,
      });
      await loadTacticalState();
      setNotice({
        kind: 'ok',
        text: apiStatus === 'COMPLETED'
          ? `Đã hoàn tất ca tác chiến #${orderId}. Báo cáo chuyển sang chờ người dân nghiệm thu!`
          : `Đã cập nhật tiến độ lệnh #${orderId}: ${opts.progress_pct ?? 50}%.`,
      });
    } catch (err: any) {
      setNotice({ kind: 'err', text: `Lỗi cập nhật lệnh tác chiến: ${err.message}` });
      throw err;
    }
  };

  const handleReportIncident = async (payload: {
    order_id: string;
    vehicle_id: string;
    incident_type: string;
    severity: string;
    description: string;
    photo_bytes?: string;
  }) => {
    if (!token) return;
    try {
      await api.reportFieldIncident(token, {
        vehicle_id: payload.vehicle_id,
        severity: payload.severity,
        incident_type: payload.incident_type,
        description: payload.description,
        estimated_downtime_hours: 4,
        evidence_data_url: payload.photo_bytes,
      });
      await loadTacticalState();
      setActiveTab('RESCUE');
      setNotice({
        kind: 'ok',
        text: 'Đã báo sự cố phương tiện! Quy trình Điều Phối Lại SOP-02 đã tự động xếp hạng các phương án chi viện.',
      });
    } catch (err: any) {
      setNotice({ kind: 'err', text: `Lỗi báo sự cố: ${err.message}` });
      throw err;
    }
  };

  const handleApproveReplan = async (incidentId: string, optionId: string, reason?: string) => {
    if (!token) return;
    try {
      await api.approveReplan(token, incidentId, { option_id: optionId });
      await loadTacticalState();
      setNotice({
        kind: 'ok',
        text: 'Đã phê duyệt phương án chi viện! Phương tiện thay thế đã nhận lệnh xuất phát.',
      });
    } catch (err: any) {
      setNotice({ kind: 'err', text: `Lỗi phê duyệt chi viện: ${err.message}` });
    }
  };

  // Actions: Resource Manager
  const handleUpdateShelterOccupancy = async (shelterId: string, occupancy: number) => {
    if (!token) return;
    try {
      await api.updateShelterOccupancy(token, shelterId, { occupancy });
      await loadTacticalState();
      setNotice({ kind: 'ok', text: `Đã cập nhật sĩ số điểm trú ẩn ${shelterId}: ${occupancy} người.` });
    } catch (err: any) {
      setNotice({ kind: 'err', text: `Lỗi cập nhật sĩ số điểm trú: ${err.message}` });
    }
  };

  const handleResolveTicket = async (ticketId: string, notes: string) => {
    if (!token) return;
    try {
      await api.updateRepairTicket(token, ticketId, {
        action: 'RESOLVED',
        notes,
      });
      await loadTacticalState();
      setNotice({ kind: 'ok', text: `Đã nghiệm thu và đưa phương tiện trở lại trạng thái trực sẵn sàng.` });
    } catch (err: any) {
      setNotice({ kind: 'err', text: `Lỗi nghiệm thu sửa chữa: ${err.message}` });
    }
  };

  // If not authenticated, show login page
  if (!isAuthenticated || !user) {
    return <LoginPage />;
  }

  const isStaff =
    user.role === 'DISPATCHER' ||
    user.role === 'COORDINATOR' ||
    user.role === 'PLATFORM_ADMIN' ||
    user.role === 'RESOURCE_MANAGER';

  // Active Incident
  const activeIncident = state?.incidents?.find(
    (i) => i.status === 'REPORTED' || i.status === 'IN_PROGRESS' || i.status === 'OPEN_REPLANNING'
  );
  const topRescueCandidate: CandidateRescueOption | null =
    activeIncident?.candidate_options?.[0] || activeIncident?.replan_candidates?.[0] || null;

  // Plain-language tabs
  const tabs: { id: Tab; icon: string; label: string; alert?: boolean }[] = [
    { id: 'HOME', icon: '🏠', label: HOME_LABEL[user.role] ?? 'Trang chủ' },
    { id: 'MAP', icon: '🗺️', label: 'Bản đồ Tác chiến' },
  ];
  if (['DISPATCHER', 'COORDINATOR', 'REPORTER', 'FARMER', 'PLATFORM_ADMIN'].includes(user.role)) {
    tabs.push({ id: 'PROCESS', icon: '📋', label: 'Quy trình SOP (BPMN)' });
  }
  if (
    ['DISPATCHER', 'COORDINATOR', 'FIELD_TEAM', 'RESOURCE_MANAGER', 'PLATFORM_ADMIN'].includes(
      user.role
    )
  ) {
    tabs.push({
      id: 'RESCUE',
      icon: '🆘',
      label: 'Chi viện Sự cố',
      alert: !!activeIncident,
    });
  }

  const mapEl = state && (
    <Suspense
      fallback={
        <div className="grid h-80 place-items-center rounded-3xl bg-slate-100 text-sm text-slate-600">
          Đang nạp bản đồ tác chiến Hà Nội…
        </div>
      }
    >
      <TacticalMap
        zones={state.zones}
        vehicles={mapVehicles}
        reports={state.reports}
        orders={state.orders}
        gauges={state.gauges}
        shelters={state.shelters}
        rescueCandidate={topRescueCandidate}
        userRole={user.role}
        trails={trails}
        live={liveInfo}
        onSelect={(selection) => setMapSelection(selection)}
      />
    </Suspense>
  );

  return (
    <div className={`min-h-screen flex flex-col text-slate-800 ${isStaff ? 'pb-20' : 'pb-10'}`}>
      <Header
        simTime={state?.sim_clock?.sim_time || ''}
        onTick={handleSimTick}
        onReset={handleSimReset}
        onOpenProofInspector={() => setShowProofInspector(true)}
        showStaffTools={isStaff && import.meta.env.DEV}
        orgName={state?.auth_context?.organization_name}
      />

      {/* Navigation */}
      <nav
        aria-label="Điều hướng chính"
        className="sticky top-[68px] z-20 border-b border-slate-200 bg-white/95 backdrop-blur shadow-sm"
      >
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-2 sm:px-6">
          {/* Main Action Tabs */}
          <div className="flex items-center gap-2 overflow-x-auto">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id)}
                aria-current={activeTab === t.id ? 'page' : undefined}
                className={`relative flex min-h-10 shrink-0 items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition ${
                  activeTab === t.id
                    ? 'bg-blue-900 text-white shadow'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                <span aria-hidden="true">{t.icon}</span>
                <span>{t.label}</span>
                {t.alert && (
                  <span
                    className="absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full bg-rose-500 ring-2 ring-white animate-pulse"
                    role="img"
                    aria-label="Có sự cố khẩn cấp"
                  />
                )}
              </button>
            ))}
          </div>

          {/* Quick Status / Refresh */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadTacticalState}
              disabled={isLoading}
              className="flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 border border-slate-200 hover:bg-slate-100 transition shadow-sm"
              title="Làm mới trạng thái từ Gateway"
            >
              <RefreshCw
                aria-hidden="true"
                className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin text-blue-700' : ''}`}
              />
              <span className="hidden sm:inline">Cập nhật</span>
            </button>
            {stateUpdatedAt && (
              <span className="hidden xl:inline text-xs text-slate-500" aria-live="polite">
                {stateUpdatedAt.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
        </div>
      </nav>

      <main className="mx-auto w-full max-w-7xl flex-1 space-y-6 p-4 sm:p-6">
        {notice && (
          <div
            role={notice.kind === 'err' ? 'alert' : 'status'}
            className={`flex items-start justify-between gap-3 rounded-2xl border-2 p-4 text-sm font-medium ${
              notice.kind === 'err'
                ? 'border-rose-300 bg-rose-50 text-rose-900'
                : 'border-emerald-300 bg-emerald-50 text-emerald-900'
            }`}
          >
            <div className="flex items-center gap-2">
              {notice.kind === 'err' ? (
                <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
              ) : (
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              )}
              <span>{notice.text}</span>
            </div>
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="shrink-0 rounded-lg px-2.5 py-1 text-xs font-bold underline hover:bg-black/5"
            >
              Đóng
            </button>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-2xl border-2 border-rose-300 bg-rose-50 p-4 text-sm text-rose-900"
          >
            <WifiOff aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
            <div>
              <p className="font-bold">Mất kết nối với máy chủ điều phối FloodOS</p>
              <p className="text-xs text-rose-700 mt-0.5">
                {error}. {stateUpdatedAt && `Đang hiển thị bản lưu lúc ${stateUpdatedAt.toLocaleTimeString('vi-VN')}.`}
              </p>
            </div>
          </div>
        )}

        {state && activeTab === 'HOME' && <WelcomeBanner user={user} state={state} />}

        {!state && !error && (
          <div
            className="grid place-items-center rounded-3xl border-2 border-dashed border-slate-300 p-16 text-center text-slate-600"
            role="status"
          >
            <div>
              <div className="mb-3 text-5xl" aria-hidden="true">🌊</div>
              <p className="font-bold text-slate-800 text-base">Đang nạp dữ liệu điều hành FloodOS Hà Nội…</p>
            </div>
          </div>
        )}

        {/* TAB 1: WORKSPACES */}
        {state && activeTab === 'HOME' && (
          <>
            {(user.role === 'REPORTER' || user.role === 'FARMER') && (
              <ReporterWorkspace
                reports={state.reports || []}
                orders={state.orders || []}
                zones={state.zones || []}
                shelters={state.shelters || []}
                resolutions={state.resolutions || []}
                onCreateReport={handleCreateReport}
                onConfirmResolution={handleConfirmResolution}
                onOpenLineage={(corrId) => setActiveLineageCorrId(corrId)}
              />
            )}

            {(user.role === 'DISPATCHER' || user.role === 'COORDINATOR' || user.role === 'PLATFORM_ADMIN') && (
              <DispatcherWorkspace
                reports={state.reports || []}
                orders={state.orders || []}
                teams={state.teams || []}
                vehicles={state.vehicles || []}
                incidents={state.incidents || []}
                zones={state.zones || []}
                onVerifyReport={handleVerifyReport}
                onDispatchOrder={handleDispatchOrder}
                onApproveReplan={handleApproveReplan}
                onSelectReport={(r: FloodReport) => {
                  setMapSelection({ type: 'report', data: r });
                  setActiveTab('MAP');
                }}
              />
            )}

            {(user.role === 'FIELD_TEAM' || user.role === 'OPERATOR') && (
              <FieldTeamWorkspace
                currentUserId={user.user_id}
                teams={state.teams || []}
                vehicles={state.vehicles || []}
                orders={state.orders || []}
                reports={state.reports || []}
                incidents={state.incidents || []}
                onUpdateOrderStatus={handleUpdateOrderStatus}
                onReportIncident={handleReportIncident}
                onSelectReport={(r: FloodReport) => {
                  setMapSelection({ type: 'report', data: r });
                  setActiveTab('MAP');
                }}
              />
            )}

            {(user.role === 'RESOURCE_MANAGER' || user.role === 'MACHINE_OWNER' || user.role === 'REPAIR_TEAM') && (
              <ResourceManagerWorkspace
                vehicles={state.vehicles || []}
                shelters={state.shelters || []}
                gauges={state.gauges || []}
                incidents={state.incidents || []}
                onUpdateShelterOccupancy={handleUpdateShelterOccupancy}
                onResolveTicket={handleResolveTicket}
                onSelectShelter={(s: SafeShelter) => {
                  setMapSelection({ type: 'shelter', data: s });
                  setActiveTab('MAP');
                }}
                onSelectGauge={(g: GaugeStation) => {
                  setMapSelection({ type: 'gauge', data: g });
                  setActiveTab('MAP');
                }}
              />
            )}
          </>
        )}

        {/* TAB 2: MAP */}
        {state && activeTab === 'MAP' && (
          <div className="space-y-4">
            <FleetKpiStrip state={state} />

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
              <div className="min-w-0">
                {mapEl}
              </div>

              {/* Side Detail Panel or Automated Scenario */}
              <div className="space-y-4">
                {mapSelection ? (
                  <MapDetailPanel
                    selection={mapSelection}
                    onClose={() => setMapSelection(null)}
                    currentUserRole={user.role}
                    orders={state.orders || []}
                    onOpenVerifyModal={(report: FloodReport) => {
                      handleVerifyReport(report.report_id, 'URGENT', 'Xác minh từ bản đồ tác chiến');
                    }}
                    onOpenDispatchModal={() => {
                      setActiveTab('HOME');
                    }}
                  />
                ) : (
                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl text-xs text-slate-500">
                    <p className="font-semibold text-slate-700 mb-1">Bảng Chi Tiết Tác Chiến</p>
                    <p>Nhấp vào bất kỳ điểm ngập, phương tiện cứu hộ, điểm trú ẩn hoặc trạm đo trên bản đồ để xem chi tiết và thao tác nghiệp vụ.</p>
                  </div>
                )}


              </div>
            </div>
          </div>
        )}

        {/* TAB 3: PROCESS */}
        {state && activeTab === 'PROCESS' && (
          <ProcessCommandCard
            instances={state.bpmn_instances || []}
            currentUserRole={user.role}
          />
        )}

        {/* TAB 4: RESCUE & REPLAN */}
        {state && activeTab === 'RESCUE' && (
          <IntelligenceRadar
            incidents={state.incidents || []}
            currentUserRole={user.role}
            onApproveRescue={handleApproveReplan}
            conflictError={conflictError}
            onClearConflict={() => setConflictError(null)}
          />
        )}
      </main>

      <ProofInspectorModal
        isOpen={showProofInspector}
        onClose={() => setShowProofInspector(false)}
      />

      <DataLineageModal
        isOpen={!!activeLineageCorrId}
        correlationId={activeLineageCorrId || ''}
        onClose={() => setActiveLineageCorrId(null)}
      />



      {isStaff && (
        <BottomCombatLog
          auditLogs={state?.audit_logs || []}
          orgName={state?.auth_context?.organization_name}
          onOpenLineage={(corrId) => {
            if (corrId) setActiveLineageCorrId(corrId);
          }}
        />
      )}
    </div>
  );
};

const HOME_LABEL: Record<string, string> = {
  REPORTER: 'Tiếp Nhận & Cứu Trợ',
  DISPATCHER: 'Trung Tâm Điều Phối',
  FIELD_TEAM: 'Ca Tác Chiến Hiện Trường',
  RESOURCE_MANAGER: 'Nguồn Lực & Hạ Tầng',
  PLATFORM_ADMIN: 'Tổng Quan Hệ Thống',
  FARMER: 'Tiếp Nhận & Cứu Trợ',
  COORDINATOR: 'Trung Tâm Điều Phối',
  OPERATOR: 'Ca Tác Chiến Hiện Trường',
  MACHINE_OWNER: 'Nguồn Lực & Hạ Tầng',
  REPAIR_TEAM: 'Bảo Trì Kỹ Thuật',
};

export default App;
