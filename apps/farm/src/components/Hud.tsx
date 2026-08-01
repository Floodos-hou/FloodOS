// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenAgriOS Contributors

import React, { useState } from 'react';
import type { HarvesterMachine } from '../../../web/src/types';
import { readinessLabel } from '../game/crops';
import type { Quest, QuestState } from '../game/quests';
import type { StateField } from '../game/scene';

export interface Toast {
  id: number;
  tone: 'info' | 'success' | 'warn' | 'danger';
  icon: string;
  text: string;
}

export const Toasts: React.FC<{ toasts: Toast[] }> = ({ toasts }) => (
  <ul className="toasts" aria-live="polite">
    {toasts.map((t) => (
      <li key={t.id} className={`toast ${t.tone}`}><span>{t.icon}</span>{t.text}</li>
    ))}
  </ul>
);

const bar = (pct: number, tone = 'green') => (
  <div className="bar"><div className={`fill ${tone}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} /></div>
);

export const TopBar: React.FC<{
  avatar: string; name: string; role: string; season: number; questsDone: number; questsTotal: number;
  clock: string; mode: 'sim' | 'auto' | 'night'; sound: boolean; busy: string | null;
  onMode: () => void; onSound: () => void; onFit: () => void; onFullscreen: () => void; onLogout: () => void;
}> = (p) => (
  <header className="topbar">
    <div className="who"><span className="avatar">{p.avatar}</span><div><strong>{p.name}</strong><small>{p.role}</small></div></div>
    <div className="season" title="Tiến độ gặt trung bình của các thửa bạn nhìn thấy">
      <small>Mùa vụ</small>{bar(p.season, 'gold')}<b>{p.season.toFixed(0)}%</b>
    </div>
    <div className="stars" title="Nhiệm vụ đã hoàn thành"><span>⭐</span><b>{p.questsDone}</b><small>/ {p.questsTotal}</small></div>
    {p.busy && <div className="busy"><span className="spinner" />{p.busy}</div>}
    <div className="dock">
      <span className="clock">{p.clock}</span>
      <button onClick={p.onMode} title="Đổi chế độ thời gian: đồng hồ mô phỏng / ngày đêm tự chạy / ban đêm (chỉ để trang trí)">{p.mode === 'sim' ? '🕘' : p.mode === 'auto' ? '🔄' : '🌙'}</button>
      <button onClick={p.onSound} aria-pressed={p.sound} title="Âm thanh">{p.sound ? '🔊' : '🔇'}</button>
      <button onClick={p.onFit} title="Xem toàn cảnh">🧭</button>
      <button onClick={p.onFullscreen} title="Toàn màn hình">⛶</button>
      <button onClick={p.onLogout} title="Đổi nhân vật">🚪</button>
    </div>
  </header>
);

const STATE_LABEL: Record<QuestState, string> = { alert: 'Khẩn cấp', todo: 'Cần làm', active: 'Đang diễn ra', waiting: 'Đang chờ', done: 'Xong' };

export const QuestPanel: React.FC<{
  quests: Quest[]; selectedField: string | null; onFocus: (fieldId: string) => void; onAction: (q: Quest) => void;
}> = ({ quests, selectedField, onFocus, onAction }) => {
  const [open, setOpen] = useState(true);
  return (
    <aside className={`quests ${open ? 'open' : ''}`} aria-label="Nhiệm vụ">
      <button className="quests-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span>📜 Nhiệm vụ</span><b>{quests.filter((q) => q.state !== 'done' && q.state !== 'waiting').length}</b><i>{open ? '▾' : '▸'}</i>
      </button>
      {open && (
        <ul>
          {quests.length === 0 && <li className="empty">Chưa có nhiệm vụ cho bạn.</li>}
          {quests.map((q) => (
            <li key={q.id} className={`quest ${q.state} ${selectedField === q.fieldId ? 'sel' : ''}`}>
              <button className="quest-main" onClick={() => onFocus(q.fieldId)}>
                <span className="q-icon">{q.icon}</span>
                <span className="q-text"><strong>{q.title}</strong><small>{q.hint}</small></span>
                <span className="q-tag">{STATE_LABEL[q.state]}</span>
              </button>
              {q.progress !== undefined && q.state !== 'done' && bar(q.progress, q.state === 'alert' ? 'red' : 'gold')}
              {q.action && (
                <button className="quest-action" onClick={() => onAction(q)}>
                  {q.action === 'CALL_HARVESTER' ? '🚜 Gọi máy gặt' : '⭐ Xác nhận & chấm sao'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
};

export const FieldCard: React.FC<{
  field: StateField; mine: boolean; quest?: Quest; ownerName: string; onAction: (q: Quest) => void; onClose: () => void;
}> = ({ field, mine, quest, ownerName, onAction, onClose }) => (
  <section className="card" aria-label={`Ruộng ${field.field_id}`}>
    <button className="close" onClick={onClose} aria-label="Đóng">×</button>
    <h3>🌾 Ruộng {field.field_id} {mine && <span className="mine">của bạn</span>}</h3>
    <p className="sub">{field.crop} · {field.area_ha} ha · chủ ruộng {ownerName}</p>
    <div className="row"><span>{readinessLabel(field.readiness_status)}</span><b>{field.harvest_progress_pct.toFixed(0)}%</b></div>
    {bar(field.harvest_progress_pct, field.readiness_status === 'IMPACTED' ? 'red' : 'gold')}
    {quest && <p className="hint">{quest.icon} {quest.title}<br /><small>{quest.hint}</small></p>}
    {quest?.action && <button className="quest-action" onClick={() => onAction(quest)}>{quest.action === 'CALL_HARVESTER' ? '🚜 Gọi máy gặt' : '⭐ Xác nhận & chấm sao'}</button>}
  </section>
);

const MACHINE_STATUS: Record<string, string> = { WORKING: 'Đang gặt', IDLE: 'Sẵn sàng', BREAKDOWN: 'Bị hỏng', MAINTENANCE: 'Đang bảo trì', MOVING: 'Đang di chuyển' };

export const MachineCard: React.FC<{
  machine: HarvesterMachine; operator: string; fieldId?: string; following: boolean; onFollow: () => void; onClose: () => void;
}> = ({ machine, operator, fieldId, following, onFollow, onClose }) => (
  <section className="card" aria-label={`Máy ${machine.machine_id}`}>
    <button className="close" onClick={onClose} aria-label="Đóng">×</button>
    <h3>🚜 Máy {machine.machine_id}</h3>
    <p className="sub">{machine.name}</p>
    <div className="row"><span>Trạng thái</span><b className={`st ${machine.status}`}>{MACHINE_STATUS[machine.status] ?? machine.status}</b></div>
    <div className="row"><span>Nhiên liệu</span><b>{machine.fuel_pct.toFixed(0)}%</b></div>
    {bar(machine.fuel_pct, machine.fuel_pct < 25 ? 'red' : 'green')}
    <div className="row"><span>Sức khỏe động cơ</span><b>{machine.health_pct.toFixed(0)}%</b></div>
    {bar(machine.health_pct, machine.health_pct < 40 ? 'red' : 'green')}
    <div className="row"><span>Thợ lái</span><b>{operator || '—'}</b></div>
    {fieldId && <div className="row"><span>Đang làm ruộng</span><b>{fieldId}</b></div>}
    <button className="quest-action" onClick={onFollow}>{following ? '🎥 Đang theo dõi (bấm để dừng)' : '🎥 Theo dõi máy này'}</button>
  </section>
);

export const RatingModal: React.FC<{
  fieldId: string; busy: boolean; onSubmit: (stars: number) => void; onCancel: () => void;
}> = ({ fieldId, busy, onSubmit, onCancel }) => {
  const [stars, setStars] = useState(5);
  const [hover, setHover] = useState(0);
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Chấm sao">
      <div className="modal">
        <h3>Ruộng {fieldId} đã gặt xong 🎉</h3>
        <p>Bạn hài lòng với ca gặt này chứ? Xác nhận sẽ niêm phong hồ sơ vào sổ cái.</p>
        <div className="star-row" onMouseLeave={() => setHover(0)}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} className={n <= (hover || stars) ? 'on' : ''} onMouseEnter={() => setHover(n)} onClick={() => setStars(n)} aria-label={`${n} sao`}>★</button>
          ))}
        </div>
        <div className="modal-actions">
          <button className="ghost" onClick={onCancel} disabled={busy}>Để sau</button>
          <button className="primary" onClick={() => onSubmit(stars)} disabled={busy}>{busy ? 'Đang gửi…' : `Xác nhận ${stars} sao`}</button>
        </div>
      </div>
    </div>
  );
};
