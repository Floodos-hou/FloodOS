// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenAgriOS Contributors

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../web/src/services/api';
import { useAuth } from '../../web/src/context/useAuth';
import { DEMO_CHARACTERS, DEMO_MODE } from '../../web/src/demo/demoScript';
import { detectFleetEvents, snapshotStatuses } from '../../web/src/utils/fleetInsights';
import { GameCanvas } from './components/GameCanvas';
import { FieldCard, MachineCard, QuestPanel, RatingModal, Toasts, TopBar, type Toast } from './components/Hud';
import { StartScreen } from './components/StartScreen';
import { deriveQuests, diffQuests, questSummary, type Quest } from './game/quests';
import type { FarmRenderer } from './game/renderer';
import { runBreakdownEvent } from './game/scenario';
import { buildFields, buildMachines, buildWorld, sceneHour, seasonProgress, type StateField, type TimeMode } from './game/scene';
import { Sfx } from './game/sound';
import { useFarmState } from './hooks/useFarmState';

type Selection = { type: 'field' | 'machine'; id: string } | null;

const NEXT_MODE: Record<TimeMode, TimeMode> = { sim: 'auto', auto: 'night', night: 'sim' };

function clockText(hour: number) {
  const h = Math.floor(hour) % 24; const m = Math.floor((hour - Math.floor(hour)) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

const Game: React.FC = () => {
  const { user, token, logout } = useAuth();
  const { state, error, refresh } = useFarmState(token, () => logout('Phiên đăng nhập đã hết hạn.'));
  const renderer = useRef<FarmRenderer | null>(null);
  const sfx = useRef(new Sfx());
  const [sound, setSound] = useState(false);
  const [selected, setSelected] = useState<Selection>(null);
  const [mode, setMode] = useState<TimeMode>('sim');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [rating, setRating] = useState<Quest | null>(null);
  const [following, setFollowing] = useState(false);
  const [clock, setClock] = useState('--:--');
  const started = useRef(performance.now());
  const toastId = useRef(0);
  const prevStatuses = useRef<Map<string, string> | null>(null);
  const prevQuests = useRef<Quest[] | null>(null);
  const simTimeRef = useRef<string | undefined>(undefined);
  const modeRef = useRef<TimeMode>('sim');
  modeRef.current = mode;
  simTimeRef.current = state?.sim_clock?.sim_time;

  const toast = useCallback((tone: Toast['tone'], icon: string, text: string) => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-3), { id, tone, icon, text }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6500);
    if (tone === 'danger') sfx.current.alarm(); else if (tone === 'success') sfx.current.tada(); else if (tone === 'warn') sfx.current.chime(); else sfx.current.blip();
  }, []);

  const fields = (state?.fields ?? []) as unknown as StateField[];
  const userId = state?.auth_context.user_id ?? user?.user_id ?? '';
  const role = state?.auth_context.role ?? user?.role ?? '';

  const quests = useMemo(
    () => (state ? deriveQuests(fields as any, state.service_requests, state.assignments, state.acceptances, userId, role) : []),
    [state, fields, userId, role]
  );

  const scene = useMemo(() => {
    if (!state) return null;
    const machines = state.machines as unknown as { machine_id: string; status: string; fuel_pct: number; current_lat: number; current_lng: number }[];
    const world = buildWorld(fields, machines);
    return {
      world,
      fields: buildFields(fields, quests, userId),
      machines: buildMachines(world, machines, state.assignments),
      hour: 12,
      selected,
    };
  }, [state, fields, quests, userId, selected]);

  // notifications from real changes (the first snapshot is only a baseline)
  useEffect(() => {
    if (!state) return;
    const machineEvents = prevStatuses.current ? detectFleetEvents(prevStatuses.current, state.machines) : [];
    prevStatuses.current = snapshotStatuses(state.machines);
    const questEvents = diffQuests(prevQuests.current, quests);
    prevQuests.current = quests;
    const seen = new Set<string>();
    for (const e of [...machineEvents, ...questEvents]) {
      if (seen.has(e.key)) continue;
      seen.add(e.key);
      toast(e.tone, e.icon, e.text);
    }
    sfx.current.engine(state.machines.filter((m) => m.status === 'WORKING').length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  useEffect(() => {
    const id = window.setInterval(() => setClock(clockText(sceneHour(modeRef.current, simTimeRef.current, (performance.now() - started.current) / 1000))), 500);
    return () => window.clearInterval(id);
  }, []);

  const getHour = useCallback(() => sceneHour(modeRef.current, simTimeRef.current, (performance.now() - started.current) / 1000), []);

  const say = (s: string) => setBusy(s);
  const guard = async (label: string, fn: () => Promise<void>) => {
    try { await fn(); } catch (e) { toast('danger', '⚠️', (e as Error).message || `${label} thất bại`); } finally { setBusy(null); }
  };

  const callHarvester = (q: Quest) => guard('Gọi máy gặt', async () => {
    if (!token || !state) return;
    say(`Đang gửi yêu cầu cho ruộng ${q.fieldId}…`);
    const base = new Date(state.sim_clock?.sim_time ?? Date.now());
    const day = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + 1, 8, 0, 0));
    const end = new Date(day.getTime() + 4 * 3600_000);
    await api.createRequest(token, { field_id: q.fieldId, requested_start: day.toISOString(), requested_end: end.toISOString(), priority: 'NORMAL', notes: 'Gọi từ Nông Trại Số' });
    toast('success', '📣', `Đã gửi yêu cầu gặt cho ruộng ${q.fieldId}`);
    const wf = scene?.world.fields.find((f) => f.id === q.fieldId);
    if (wf) renderer.current?.celebrate(wf.x, wf.y);
    await refresh();
  });

  const confirmDone = (stars: number) => guard('Xác nhận', async () => {
    if (!token || !rating?.assignmentId) return;
    say('Đang niêm phong sổ cái…');
    await api.confirmAcceptance(token, { assignment_id: rating.assignmentId, action: 'FARMER_CONFIRM', rating: stars, notes: `Chấm ${stars} sao từ Nông Trại Số` });
    toast('success', '⭐', `Cảm ơn bạn! Ruộng ${rating.fieldId} đã được nghiệm thu (${stars} sao).`);
    const wf = scene?.world.fields.find((f) => f.id === rating.fieldId);
    if (wf) renderer.current?.celebrate(wf.x, wf.y);
    setRating(null);
    await refresh();
  });

  const onQuestAction = (q: Quest) => {
    sfx.current.blip();
    if (q.action === 'CALL_HARVESTER') void callHarvester(q);
    if (q.action === 'CONFIRM_DONE') setRating(q);
  };

  const canEvent = role === 'COORDINATOR' || role === 'PLATFORM_ADMIN';
  const workingMachine = state?.machines.find((m) => m.status === 'WORKING')?.machine_id;
  const runEvent = () => guard('Sự kiện', async () => {
    if (!token || !workingMachine) { toast('warn', 'ℹ️', 'Cần một máy đang gặt để tạo sự kiện.'); return; }
    await runBreakdownEvent(token, workingMachine, (t) => say(t), refresh);
    toast('success', '🛡️', 'Sự kiện kết thúc: mọi bước đã ghi vào sổ cái.');
  });
  const resetData = () => guard('Đặt lại', async () => { if (token) { say('Đang đặt lại nông trại…'); await api.simReset(token); await refresh(); } });

  const toggleSound = async () => {
    if (sound) { sfx.current.disable(); setSound(false); } else setSound(await sfx.current.enable());
  };

  const pick = (p: Selection) => {
    setSelected(p);
    if (!p) { renderer.current?.setFollow(null); setFollowing(false); return; }
    sfx.current.blip();
    if (p.type === 'field') renderer.current?.focusField(p.id);
  };

  const selField = selected?.type === 'field' ? fields.find((f) => f.field_id === selected.id) : undefined;
  const selMachine = selected?.type === 'machine' ? state?.machines.find((m) => m.machine_id === selected.id) : undefined;
  const sceneMachine = scene?.machines.find((m) => m.id === selected?.id);
  const character = DEMO_CHARACTERS.find((c) => c.username === user?.username);
  const summary = questSummary(quests);

  return (
    <div className="game">
      <GameCanvas scene={scene} getHour={getHour} onRenderer={(r) => { renderer.current = r; }} onPick={pick} />
      <TopBar
        avatar={character?.emoji ?? '🧑‍🌾'} name={character?.name ?? user?.full_name ?? 'Nông dân'} role={character?.role ?? user?.role ?? ''}
        season={seasonProgress(fields)} questsDone={summary.done} questsTotal={summary.total}
        clock={clock} mode={mode} sound={sound} busy={busy}
        onMode={() => setMode((m) => NEXT_MODE[m])} onSound={toggleSound}
        onFit={() => { renderer.current?.fit(); setFollowing(false); }}
        onFullscreen={() => { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen?.(); }}
        onLogout={() => logout()}
      />
      <QuestPanel quests={quests} selectedField={selected?.type === 'field' ? selected.id : null} onFocus={(id) => { setSelected({ type: 'field', id }); renderer.current?.focusField(id); }} onAction={onQuestAction} />
      {selField && (
        <FieldCard field={selField} mine={selField.owner_user_id === userId} quest={quests.find((q) => q.fieldId === selField.field_id)}
          ownerName={(state?.fields.find((f) => f.field_id === selField.field_id)?.owner_name) ?? ''} onAction={onQuestAction} onClose={() => pick(null)} />
      )}
      {selMachine && (
        <MachineCard machine={selMachine} fieldId={sceneMachine?.fieldId} following={following}
          operator={state?.operators.find((o) => o.operator_id === selMachine.assigned_operator_id)?.full_name ?? ''}
          onFollow={() => { if (following) { renderer.current?.setFollow(null); setFollowing(false); } else { renderer.current?.focusMachine(selMachine.machine_id); setFollowing(true); } }}
          onClose={() => pick(null)} />
      )}
      {(canEvent && DEMO_MODE) && (
        <div className="event-dock">
          <button onClick={runEvent} disabled={!!busy}>⚡ Sự kiện bất ngờ: máy hỏng</button>
          <button className="ghost" onClick={resetData} disabled={!!busy}>↺ Đặt lại nông trại</button>
        </div>
      )}
      <Toasts toasts={toasts} />
      {rating && <RatingModal fieldId={rating.fieldId} busy={!!busy} onSubmit={confirmDone} onCancel={() => setRating(null)} />}
      {error && <div className="net-error" role="alert">Mất kết nối dữ liệu: {error}</div>}
      {!state && !error && <div className="loading"><span className="spinner big" />Đang dựng nông trại…</div>}
    </div>
  );
};

export const App: React.FC = () => {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <Game /> : <StartScreen />;
};
