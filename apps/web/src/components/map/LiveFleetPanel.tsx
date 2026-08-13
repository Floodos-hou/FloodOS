// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import React, { useEffect, useState } from 'react';
import type { RescueVehicle, HarvesterMachine } from '../../types';
import { LIVE_WINDOW_MS, type LiveFleetInfo } from '../../hooks/useLiveFleet';
import { DEMO_MODE } from '../../demo/demoScript';

interface Props {
  machines: (RescueVehicle | HarvesterMachine | any)[];
  live?: LiveFleetInfo;
  onFocus: (machine: any) => void;
}

const STATUS_STYLE: Record<string, { dot: string; label: string }> = {
  AVAILABLE: { dot: 'bg-emerald-400', label: 'Sẵn sàng' },
  DISPATCHED: { dot: 'bg-blue-400 animate-pulse', label: 'Đang làm nhiệm vụ' },
  WORKING: { dot: 'bg-blue-400 animate-pulse', label: 'Đang làm nhiệm vụ' },
  IDLE: { dot: 'bg-emerald-400', label: 'Trực sẵn sàng' },
  BREAKDOWN: { dot: 'bg-rose-500 animate-ping', label: 'Sự cố hiện trường' },
  MAINTENANCE: { dot: 'bg-slate-400', label: 'Bảo trì kỹ thuật' },
  OFFLINE: { dot: 'bg-slate-500', label: 'Mất tín hiệu' },
};

function fuelColor(pct: number) {
  if (pct < 25) return 'bg-rose-500';
  if (pct < 50) return 'bg-amber-400';
  return 'bg-emerald-400';
}

/** Live HUD: is telemetry flowing, and a click-to-focus roster of the flood rescue fleet. */
export const LiveFleetPanel: React.FC<Props> = ({ machines, live, onFocus }) => {
  const [now, setNow] = useState(() => Date.now());
  const [open, setOpen] = useState(true);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(t);
  }, []);

  if (!live?.enabled) return null;

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
                flowing ? 'bg-emerald-400' : live.connected ? 'bg-amber-400' : 'bg-rose-500'
              }`}
            />
          </span>
          {flowing ? 'TRỰC TIẾP · IOT MQTT' : live.connected ? 'CHỜ TÍN HIỆU ĐỊNH VỊ' : 'MẤT KẾT NỐI BẢN SAO SỐ'}
        </span>
        <span className="text-[10px] font-mono text-slate-400">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="border-t border-slate-700 px-3 pb-3 pt-2">
          <div className="mb-2 flex items-center justify-between text-[11px] text-slate-300">
            <span>
              <strong className="text-amber-300">{movingCount}</strong> phương tiện cơ động
            </span>
            <span className="font-mono text-slate-400">{ago === null ? '—' : `cập nhật ${ago}s trước`}</span>
          </div>

          {!flowing && live.connected && (
            <p className="mb-2 rounded-lg bg-slate-800 px-2 py-1.5 text-[10px] leading-snug text-slate-300">
              Toạ độ mô phỏng IoT thủy văn Hà Nội.
              {DEMO_MODE && (
                <>
                  {' '}
                  Chạy thiết bị mô phỏng: <code className="text-amber-300">docker compose --profile demo up -d</code>
                </>
              )}
            </p>
          )}
          {live.error && <p className="mb-2 text-[11px] text-rose-300">{live.error}</p>}

          <ul className="max-h-36 space-y-1.5 overflow-y-auto pr-0.5">
            {machines.map((m) => {
              const id = m.vehicle_id || m.machine_id;
              const name = m.vehicle_name || m.name || id;
              const st = STATUS_STYLE[m.status] ?? STATUS_STYLE.AVAILABLE;
              const fuelVal = m.fuel_percent ?? m.fuel_pct ?? 100;

              return (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => onFocus(m)}
                    className="w-full rounded-lg bg-slate-800/80 px-2 py-1.5 text-left transition hover:bg-slate-700"
                    title="Bấm để định vị phương tiện"
                  >
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="flex items-center gap-1.5 font-mono font-bold text-amber-300 truncate max-w-[130px]">
                        <span className={`h-2 w-2 rounded-full shrink-0 ${st.dot}`} />
                        {name}
                      </span>
                      <span className="text-slate-300 text-[10px] shrink-0">{st.label}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-700">
                        <div
                          className={`h-full rounded-full transition-all duration-700 ${fuelColor(fuelVal)}`}
                          style={{ width: `${Math.max(0, Math.min(100, fuelVal))}%` }}
                        />
                      </div>
                      <span className="w-10 text-right font-mono text-[10px] text-slate-300">{fuelVal.toFixed(0)}%</span>
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
