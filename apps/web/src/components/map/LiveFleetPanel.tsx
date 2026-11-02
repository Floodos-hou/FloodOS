// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenAgriOS Contributors

import React, { useEffect, useState } from 'react';
import type { HarvesterMachine } from '../../types';
import { LIVE_WINDOW_MS, type LiveFleetInfo } from '../../hooks/useLiveFleet';
import { DEMO_MODE } from '../../demo/demoScript';

interface Props {
  machines: HarvesterMachine[];
  live?: LiveFleetInfo;
  onFocus: (machine: HarvesterMachine) => void;
}

const STATUS_STYLE: Record<string, { dot: string; label: string }> = {
  WORKING: { dot: 'bg-amber-400 animate-pulse', label: 'Đang gặt' },
  IDLE: { dot: 'bg-emerald-400', label: 'Sẵn sàng' },
  BREAKDOWN: { dot: 'bg-red-500 animate-ping', label: 'Sự cố' },
  MAINTENANCE: { dot: 'bg-slate-400', label: 'Bảo trì' },
};

function fuelColor(pct: number) {
  if (pct < 25) return 'bg-red-500';
  if (pct < 50) return 'bg-amber-400';
  return 'bg-emerald-400';
}

/** Live HUD: is telemetry flowing, and a click-to-focus roster of the fleet. */
export const LiveFleetPanel: React.FC<Props> = ({ machines, live, onFocus }) => {
  const [now, setNow] = useState(() => Date.now());
  const [open, setOpen] = useState(true);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(t);
  }, []);

  if (!live?.enabled) return null; // farmers / repair crews do not get the fleet view (Fog of War)

  const flowing = live.connected && live.lastMoveAt !== null && now - live.lastMoveAt < LIVE_WINDOW_MS;
  const movingCount = Object.values(live.movedAt).filter((at) => now - at < LIVE_WINDOW_MS).length;
  const ago = live.lastMoveAt ? Math.max(0, Math.round((now - live.lastMoveAt) / 1000)) : null;

  return (
    <div className="absolute left-3 top-3 z-10 w-64 select-none rounded-2xl border border-slate-700 bg-slate-900/90 text-white shadow-2xl backdrop-blur-md">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-xs font-extrabold tracking-wide">
          <span className="relative flex h-2.5 w-2.5">
            {flowing && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />}
            <span
              className={`relative inline-flex h-2.5 w-2.5 rounded-full ${
                flowing ? 'bg-emerald-400' : live.connected ? 'bg-amber-400' : 'bg-red-500'
              }`}
            />
          </span>
          {flowing ? 'TRỰC TIẾP · MQTT' : live.connected ? 'CHỜ TÍN HIỆU CẢM BIẾN' : 'MẤT KẾT NỐI BẢN SAO SỐ'}
        </span>
        <span className="text-[10px] font-mono text-slate-400">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="border-t border-slate-700 px-3 pb-3 pt-2">
          <div className="mb-2 flex items-center justify-between text-[11px] text-slate-300">
            <span>
              <strong className="text-amber-300">{movingCount}</strong> máy đang di chuyển
            </span>
            <span className="font-mono text-slate-400">{ago === null ? '—' : `cập nhật ${ago}s trước`}</span>
          </div>

          {!flowing && live.connected && (
            <p className="mb-2 rounded-lg bg-slate-800 px-2 py-1.5 text-[11px] leading-snug text-slate-300">
              Chưa có vị trí mới từ thiết bị.
              {DEMO_MODE && (
                <>
                  {' '}
                  Bật thiết bị mô phỏng: <code className="text-amber-300">docker compose --profile demo up -d</code>
                </>
              )}
            </p>
          )}
          {live.error && <p className="mb-2 text-[11px] text-red-300">{live.error}</p>}

          <ul className="max-h-36 space-y-1.5 overflow-y-auto pr-0.5">
            {machines.map((m) => {
              const st = STATUS_STYLE[m.status] ?? STATUS_STYLE.IDLE;
              return (
                <li key={m.machine_id}>
                  <button
                    type="button"
                    onClick={() => onFocus(m)}
                    className="w-full rounded-lg bg-slate-800/80 px-2 py-1.5 text-left transition hover:bg-slate-700"
                    title="Bấm để bay tới máy này"
                  >
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="flex items-center gap-1.5 font-mono font-bold text-amber-300">
                        <span className={`h-2 w-2 rounded-full ${st.dot}`} />
                        {m.machine_id}
                      </span>
                      <span className="text-slate-300">{st.label}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-700">
                        <div
                          className={`h-full rounded-full transition-all duration-700 ${fuelColor(m.fuel_pct)}`}
                          style={{ width: `${Math.max(0, Math.min(100, m.fuel_pct))}%` }}
                        />
                      </div>
                      <span className="w-10 text-right font-mono text-[10px] text-slate-300">{m.fuel_pct.toFixed(1)}%</span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
};
