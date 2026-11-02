// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../web/src/context/useAuth';
import { detectFleetEvents, snapshotStatuses } from '../../web/src/utils/fleetInsights';
import { DetailSheet } from './components/DetailSheet';
import { FlatMap, type MapPick } from './components/FlatMap';
import { Feed, type FeedItem } from './components/Panels';
import { Sidebar } from './components/Sidebar';
import { StartScreen } from './components/StartScreen';
import { Viewer3D } from './components/Viewer3D';
import { useTwinState } from './hooks/useTwinState';
import { hourFor } from './scene/sky';

const clock = (iso?: string) => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false }) : '--';
};

const TwinApp: React.FC = () => {
  const { user, token, logout } = useAuth();
  const { state, error } = useTwinState(token, () => logout('Phiên đăng nhập đã hết hạn.'));
  const [selected, setSelected] = useState<MapPick | null>(null);
  const [view3D, setView3D] = useState(false);
  const [frameToken, setFrameToken] = useState(0);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const prev = useRef<Map<string, string> | null>(null);
  const feedId = useRef(0);

  useEffect(() => {
    if (!state) return;
    if (prev.current) {
      const evs = detectFleetEvents(prev.current, state.machines);
      if (evs.length) {
        const at = new Date().toLocaleTimeString('vi-VN', { hour12: false });
        setFeed((f) => [...evs.map((e) => ({ id: ++feedId.current, tone: e.tone, icon: e.icon, text: e.text, at })), ...f].slice(0, 6));
      }
    }
    prev.current = snapshotStatuses(state.machines);
  }, [state]);

  const input = useMemo(() => state && {
    fields: state.fields, machines: state.machines, assignments: state.assignments,
    hour: hourFor('sim', state.sim_clock?.sim_time),
  }, [state]);

  const pick = useCallback((p: MapPick | null) => { setSelected(p); if (!p) setView3D(false); }, []);

  const machine = selected?.type === 'machine' ? state?.machines.find((m) => m.machine_id === selected.id) : undefined;
  const field = selected?.type === 'field' ? state?.fields.find((f) => f.field_id === selected.id) : undefined;
  const hiddenFields = state ? state.fields.filter((f) => f.visibility === 'FOG_OF_WAR').length : 0;

  return (
    <div className="app">
      <header className="topbar">
        <strong className="brand">FloodOS <em>Bản đồ thu hoạch</em></strong>
        <span className="who">{state?.auth_context.full_name ?? user?.full_name} · {state?.auth_context.organization_name}</span>
        <span className="sim" title="Đồng hồ mô phỏng của nền tảng">{clock(state?.sim_clock?.sim_time)}</span>
        <button onClick={() => { setSelected(null); setFrameToken((n) => n + 1); }}>Toàn cảnh</button>
        <button onClick={() => logout()}>Đăng xuất</button>
      </header>

      {state && <Sidebar machines={state.machines} fields={state.fields} requests={state.service_requests} assignments={state.assignments} selected={selected} onSelect={pick} hiddenFields={hiddenFields} />}
      {state && <FlatMap fields={state.fields} machines={state.machines} assignments={state.assignments} selected={selected} frameToken={frameToken} onPick={pick} />}
      {!state && !error && <div className="loading">Đang tải dữ liệu…</div>}
      {error && <div className="errbar" role="alert">{error}</div>}

      <Feed items={feed} />
      {(machine || field) && <DetailSheet machine={machine} field={field} assignments={state!.assignments} requests={state!.service_requests} onView3D={() => setView3D(true)} onClose={() => pick(null)} />}
      {view3D && input && selected && (machine || field) && <Viewer3D input={input} target={selected} machine={machine} field={field} onClose={() => setView3D(false)} />}
    </div>
  );
};

export const App: React.FC = () => {
  const { token } = useAuth();
  return token ? <TwinApp /> : <StartScreen />;
};
