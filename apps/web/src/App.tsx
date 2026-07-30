// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenAgriOS Contributors

import React, { Suspense, lazy, useEffect, useMemo, useState, useCallback } from 'react';
import { useAuth } from './context/useAuth';
import { api } from './services/api';
import type { TacticalState, CandidateRescueOption } from './types';
import { LoginPage } from './components/auth/LoginPage';
import { Header } from './components/common/Header';
import { ProofInspectorModal } from './components/common/ProofInspectorModal';
import { DataLineageModal } from './components/common/DataLineageModal';
import { BottomCombatLog } from './components/common/BottomCombatLog';
const TacticalMap = lazy(() => import('./components/map/TacticalMap').then((module) => ({ default: module.TacticalMap })));
import { ProcessCommandCard } from './components/process/ProcessCommandCard';
import { IntelligenceRadar } from './components/radar/IntelligenceRadar';
import { FarmerWorkspace } from './components/workspaces/FarmerWorkspace';
import { CoordinatorWorkspace } from './components/workspaces/CoordinatorWorkspace';
import { OperatorWorkspace } from './components/workspaces/OperatorWorkspace';
import { MachineOwnerWorkspace } from './components/workspaces/MachineOwnerWorkspace';
import { RepairTeamWorkspace } from './components/workspaces/RepairTeamWorkspace';
import { RefreshCw, AlertCircle } from 'lucide-react';
import { WelcomeBanner } from './components/common/WelcomeBanner';
import { DemoGuide } from './components/common/DemoGuide';
import { DEMO_MODE } from './demo/demoScript';
import { useLiveFleet, mergeLive } from './hooks/useLiveFleet';
import { IncidentScenario } from './components/demo/IncidentScenario';
import { FleetKpiStrip } from './components/map/FleetKpiStrip';

type Tab = 'HOME' | 'MAP' | 'PROCESS' | 'RESCUE';


export const App: React.FC = () => {
  const { user, token, isAuthenticated, logout, loginWithCredentials } = useAuth();

  const [state, setState] = useState<TacticalState | null>(null);
  const { live, trails, info: liveInfo } = useLiveFleet(token, user?.role);
  const mapMachines = useMemo(() => (state ? mergeLive(state.machines, live) : []), [state, live]);
  const [stateUpdatedAt, setStateUpdatedAt] = useState<Date | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [conflictError, setConflictError] = useState<{ code: string; message: string; details?: any } | null>(null);

  // Modals & Navigation
  const [activeTab, setActiveTab] = useState<Tab>('HOME');
  const [showProofInspector, setShowProofInspector] = useState(false);
  const [activeLineageCorrId, setActiveLineageCorrId] = useState<string | null>(null);

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
        logout('Phiên đăng nhập không còn hợp lệ. Vui lòng đăng nhập lại.');
      } else {
        setError(err.message || 'Không thể tải trạng thái tác chiến từ hệ thống.');
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

  // Actions
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
    } catch (err: any) {
      console.error('Sim reset error:', err);
    }
  };

  const handleCreateRequest = async (payload: {
    field_id: string;
    requested_start: string;
    requested_end: string;
    priority: string;
    notes: string;
  }) => {
    if (!token) return;
    try {
      await api.createRequest(token, payload);
      await loadTacticalState();
    } catch (err: any) {
      setNotice({ kind: 'err', text: `Lỗi tạo yêu cầu: ${err.message}` });
      throw err;
    }
  };

  const handleDispatchAssignment = async (payload: {
    request_id: string;
    field_id: string;
    machine_id: string;
    operator_id: string;
    start_time: string;
    end_time: string;
  }) => {
    if (!token) return;
    setConflictError(null);
    try {
      await api.dispatchAssignment(token, payload);
      await loadTacticalState();
    } catch (err: any) {
      if (err.status === 409) {
        setConflictError({
          code: err.code || 'CONFLICT',
          message: err.message || 'Xung đột lịch điều động máy gặt (PostgreSQL GiST Double-Booking Protection)',
          details: err.details,
        });
      }
      throw err;
    }
  };

  const handleUpdateShiftStatus = async (
    asgId: string,
    payload: { status: 'IN_PROGRESS' | 'COMPLETED'; progress_pct?: number; note?: string }
  ) => {
    if (!token) return;
    try {
      await api.updateAssignmentStatus(token, asgId, payload);
      await loadTacticalState();
    } catch (err: any) {
      setNotice({ kind: 'err', text: `Lỗi cập nhật ca: ${err.message}` });
      throw err;
    }
  };

  const handleReportIncident = async (payload: {
    machine_id: string;
    severity: string;
    incident_type: string;
    description: string;
    estimated_downtime_hours: number;
    evidence_filename: string;
    evidence_data_url?: string;
  }) => {
    if (!token) return;
    try {
      await api.reportIncident(token, payload);
      await loadTacticalState();
      setActiveTab('RESCUE'); // automatically focus radar when incident happens
    } catch (err: any) {
      setNotice({ kind: 'err', text: `Lỗi báo sự cố: ${err.message}` });
      throw err;
    }
  };

  const handleApproveRescue = async (incidentId: string, optionId: string) => {
    if (!token) return;
    try {
      await api.approveReplan(token, incidentId, { option_id: optionId });
      await loadTacticalState();
      setNotice({ kind: 'ok', text: 'Đã phê duyệt phương án cứu viện thành công! Lệnh điều động thay thế đã được phát.' });
    } catch (err: any) {
      setNotice({ kind: 'err', text: `Lỗi phê duyệt cứu viện: ${err.message}` });
    }
  };

  const handleUpdateRepair = async (
    incidentId: string,
    payload: { diagnosis: string; estimated_downtime_hours?: number; is_resolved?: boolean }
  ) => {
    if (!token) return;
    try {
      await api.updateRepair(token, incidentId, payload);
      await loadTacticalState();
      setNotice({ kind: 'ok', text: 'Đã cập nhật biên bản sửa chữa thành công!' });
    } catch (err: any) {
      setNotice({ kind: 'err', text: `Lỗi cập nhật sửa chữa: ${err.message}` });
      throw err;
    }
  };

  const handleConfirmAcceptance = async (payload: {
    assignment_id: string;
    rating: number;
    notes: string;
  }) => {
    if (!token) return;
    try {
      await api.confirmAcceptance(token, {
        assignment_id: payload.assignment_id,
        action: 'FARMER_CONFIRM',
        rating: payload.rating,
        notes: payload.notes,
      });
      await loadTacticalState();
      setNotice({ kind: 'ok', text: 'Đã ký biên bản nghiệm thu thành công! Bản ghi kiểm toán SHA-256 đã được bổ sung.' });
    } catch (err: any) {
      setNotice({ kind: 'err', text: `Lỗi nghiệm thu: ${err.message}` });
      throw err;
    }
  };

  // If not authenticated, show login page
  if (!isAuthenticated || !user) {
    return <LoginPage />;
  }

  const isStaff = user.role === 'COORDINATOR' || user.role === 'PLATFORM_ADMIN';

  // Find candidate rescue option if any incident is active
  const activeIncident = state?.incidents?.find(
    (i) => i.status === 'OPEN_REPLANNING' || (i.candidate_options && i.candidate_options.length > 0)
  );
  const topRescueCandidate: CandidateRescueOption | null =
    activeIncident?.candidate_options?.[0] || null;

  // Plain-language tabs, only the ones that matter for this role
  const tabs: { id: Tab; icon: string; label: string; alert?: boolean }[] = [
    { id: 'HOME', icon: '🏠', label: HOME_LABEL[user.role] ?? 'Trang chủ' },
    { id: 'MAP', icon: '🗺️', label: user.role === 'FARMER' ? 'Bản đồ ruộng' : 'Bản đồ' },
  ];
  if (['COORDINATOR', 'FARMER', 'PLATFORM_ADMIN'].includes(user.role)) {
    tabs.push({ id: 'PROCESS', icon: '📋', label: user.role === 'FARMER' ? 'Tiến trình yêu cầu' : 'Tiến trình công việc' });
  }
  if (['COORDINATOR', 'REPAIR_TEAM', 'MACHINE_OWNER', 'PLATFORM_ADMIN'].includes(user.role)) {
    tabs.push({ id: 'RESCUE', icon: '🆘', label: 'Máy hỏng & cứu viện', alert: !!activeIncident });
  }

  const mapEl = state && (
    <Suspense fallback={<div className="grid h-80 place-items-center rounded-3xl bg-slate-100 text-lg text-slate-600">Đang tải bản đồ…</div>}>
      <TacticalMap
        fields={state.fields}
        machines={mapMachines}
        assignments={state.assignments}
        rescueCandidate={topRescueCandidate}
        userRole={user.role}
        trails={trails}
        live={liveInfo}
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
        onSwitchPersona={async (uname) => {
          try {
            setIsLoading(true);
            await loginWithCredentials(uname, '123456');
            setNotice({ kind: 'ok', text: `Đã chuyển sang phiên làm việc của ${uname}` });
          } catch (err: any) {
            setNotice({ kind: 'err', text: `Không thể chuyển phiên: ${err.message}` });
          } finally {
            setIsLoading(false);
          }
        }}
        showStaffTools={isStaff && import.meta.env.DEV}
        orgName={state?.auth_context?.organization_name}
      />

      {/* Navigation */}
      <nav aria-label="Chọn màn hình" className="sticky top-[68px] z-20 border-b border-slate-200 bg-slate-50/95 backdrop-blur shadow-sm">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
          {/* Main Action Tabs */}
          <div className="flex items-center gap-2 overflow-x-auto">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id)}
                aria-current={activeTab === t.id ? 'page' : undefined}
                className={`relative flex min-h-11 shrink-0 items-center gap-2 rounded-2xl px-4 py-2 text-base font-bold transition ${
                  activeTab === t.id ? 'bg-emerald-800 text-white shadow-md' : 'bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-emerald-50'
                }`}
              >
                <span aria-hidden="true">{t.icon}</span>
                <span>{t.label}</span>
                {t.alert && <span className="absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full bg-red-500 ring-2 ring-white animate-pulse" role="img" aria-label="Có việc cần xử lý" />}
              </button>
            ))}
          </div>

          {/* Quick Demo Role Switcher & Live Refresh */}
          <div className="flex items-center gap-2">
            

            <button
              type="button"
              onClick={loadTacticalState}
              disabled={isLoading}
              className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl bg-white px-3 py-2 text-sm font-semibold text-slate-700 ring-1 ring-slate-300 hover:bg-slate-100 transition shadow-sm"
              title="Tải lại dữ liệu mới nhất từ Gateway"
            >
              <RefreshCw aria-hidden="true" className={`h-4 w-4 ${isLoading ? 'animate-spin text-emerald-700' : ''}`} />
              <span className="hidden sm:inline">Cập nhật</span>
            </button>
            {stateUpdatedAt && <span className="hidden xl:inline text-xs text-slate-500" aria-live="polite">Cập nhật {stateUpdatedAt.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</span>}
          </div>
        </div>
      </nav>

      <main className="mx-auto w-full max-w-7xl flex-1 space-y-6 p-4 sm:p-6">
        {notice && (
          <div
            role={notice.kind === 'err' ? 'alert' : 'status'}
            className={`flex items-start justify-between gap-3 rounded-2xl border-2 p-4 text-lg ${notice.kind === 'err' ? 'border-red-300 bg-red-50 text-red-900' : 'border-emerald-300 bg-emerald-50 text-emerald-900'}`}
          >
            <span>{notice.text}</span>
            <button type="button" onClick={() => setNotice(null)} className="shrink-0 rounded-xl px-3 py-1 font-bold underline underline-offset-2 hover:bg-white/60">Đóng</button>
          </div>
        )}

        {error && (
          <div role="alert" className="flex items-start gap-3 rounded-2xl border-2 border-red-300 bg-red-50 p-4 text-lg text-red-900">
            <AlertCircle aria-hidden="true" className="mt-0.5 h-6 w-6 shrink-0" />
            <span>
              Chưa tải được dữ liệu mới, vui lòng thử lại sau ít phút. {stateUpdatedAt && <>Đang hiển thị dữ liệu lúc {stateUpdatedAt.toLocaleTimeString('vi-VN')}. </>}
              <span className="block text-base text-red-800">({error})</span>
            </span>
          </div>
        )}

        {activeTab === 'HOME' && <WelcomeBanner user={user} state={state} />}

        {!state && !error && (
          <div className="grid place-items-center rounded-3xl border-2 border-dashed border-slate-300 p-16 text-center text-xl text-slate-600" role="status">
            <div><div className="mb-3 text-5xl" aria-hidden="true">🌱</div>Đang tải dữ liệu…</div>
          </div>
        )}

        {state && activeTab === 'HOME' && (
          <>
            {user.role === 'FARMER' && (
              <FarmerWorkspace
                fields={state.fields}
                requests={state.service_requests}
                assignments={state.assignments}
                acceptances={state.acceptances}
                onCreateRequest={handleCreateRequest}
                onConfirmAcceptance={handleConfirmAcceptance}
              />
            )}
            {user.role === 'COORDINATOR' && (
              <CoordinatorWorkspace
                fields={state.fields}
                machines={state.machines}
                operators={state.operators}
                requests={state.service_requests}
                assignments={state.assignments}
                incidents={state.incidents}
                onDispatchAssignment={handleDispatchAssignment}
              />
            )}
            {user.role === 'OPERATOR' && (
              <OperatorWorkspace
                currentUserId={user.user_id}
                assignments={state.assignments}
                machines={state.machines}
                fields={state.fields}
                operators={state.operators}
                onUpdateShiftStatus={handleUpdateShiftStatus}
                onReportIncident={handleReportIncident}
              />
            )}
            {user.role === 'MACHINE_OWNER' && (
              <MachineOwnerWorkspace
                currentUserId={user.user_id}
                machines={state.machines}
                assignments={state.assignments}
                incidents={state.incidents}
              />
            )}
            {user.role === 'REPAIR_TEAM' && (
              <RepairTeamWorkspace
                incidents={state.incidents}
                machines={state.machines}
                onUpdateRepair={handleUpdateRepair}
              />
            )}
          </>
        )}

        {state && activeTab === 'MAP' && (
          <div className={DEMO_MODE && user.role === 'COORDINATOR' && token ? 'grid gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]' : ''}>
            <div className="min-w-0">
              <FleetKpiStrip machines={mapMachines} fields={state.fields} assignments={state.assignments} />
              {mapEl}
            </div>
            {DEMO_MODE && user.role === 'COORDINATOR' && token && (
              <IncidentScenario token={token} state={state} onRefresh={loadTacticalState} />
            )}
          </div>
        )}

        {state && activeTab === 'PROCESS' && (
          <ProcessCommandCard
            instances={state.bpmn_instances}
            currentUserRole={user.role}
          />
        )}

        {state && activeTab === 'RESCUE' && (
          <IntelligenceRadar
            incidents={state.incidents}
            currentUserRole={user.role}
            onApproveRescue={handleApproveRescue}
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

      {DEMO_MODE && <DemoGuide />}

      {isStaff && (
        <BottomCombatLog
          auditLogs={state?.audit_logs || []}
          orgName={state?.auth_context?.organization_name}
          onOpenLineage={(corrId) => { if (corrId) setActiveLineageCorrId(corrId); }}
        />
      )}
    </div>
  );
};

const HOME_LABEL: Record<string, string> = {
  FARMER: 'Trang chủ',
  COORDINATOR: 'Điều phối',
  OPERATOR: 'Ca làm việc',
  MACHINE_OWNER: 'Máy của tôi',
  REPAIR_TEAM: 'Việc sửa chữa',
  PLATFORM_ADMIN: 'Tổng quan',
};

export default App;
