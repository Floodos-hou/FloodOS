// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { TacticalState } from '../../types';
import { Waves, AlertTriangle, ShieldCheck, Ship, Home, Activity } from 'lucide-react';

function useCountUp(target: number, ms = 600): number {
  const reduced = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const [value, setValue] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (reduced) return;
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / ms);
      const eased = 1 - Math.pow(1 - k, 3);
      const v = a + (target - a) * eased;
      from.current = v;
      setValue(v);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms, reduced]);
  return reduced ? target : value;
}

const Card: React.FC<{
  label: string;
  value: number;
  suffix?: string;
  sub?: string;
  tone: 'green' | 'amber' | 'red' | 'blue' | 'slate';
  alert?: boolean;
  icon: React.ReactNode;
}> = ({ label, value, suffix = '', sub, tone, alert, icon }) => {
  const shown = useCountUp(value);
  const ring: Record<string, string> = {
    green: 'border-emerald-300 bg-emerald-50 text-emerald-950',
    amber: 'border-amber-300 bg-amber-50 text-amber-950',
    red: 'border-red-400 bg-red-50 text-red-950 ring-2 ring-red-300',
    blue: 'border-sky-300 bg-sky-50 text-sky-950',
    slate: 'border-slate-300 bg-white text-slate-900',
  };

  return (
    <div className={`relative overflow-hidden rounded-2xl border px-3.5 py-2.5 shadow-sm transition ${ring[tone]} ${alert ? 'animate-pulse' : ''}`}>
      <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider opacity-75">
        <span>{label}</span>
        <span className="opacity-80">{icon}</span>
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-2xl font-black tabular-nums leading-none">
          {Math.round(shown)}
        </span>
        {suffix && <span className="text-sm font-semibold opacity-80">{suffix}</span>}
      </div>
      {sub && <div className="mt-1 text-[11px] font-medium opacity-80 truncate">{sub}</div>}
    </div>
  );
};

export const FleetKpiStrip: React.FC<{ state: TacticalState }> = ({ state }) => {
  const reports = state.reports || [];
  const orders = state.orders || [];
  const vehicles = state.vehicles || [];
  const incidents = state.incidents || [];
  const shelters = state.shelters || [];
  const gauges = state.gauges || [];

  const urgentReports = reports.filter((r) => r.priority === 'URGENT' || r.status === 'RECEIVED').length;
  const activeOrders = orders.filter((o) => o.status === 'IN_PROGRESS').length;
  const idleVehicles = vehicles.filter((v) => v.status === 'IDLE').length;
  const brokenVehicles = vehicles.filter((v) => v.status === 'BREAKDOWN').length;
  const warnGauges = gauges.filter((g) => g.alert_state === 'WARNING' || g.alert_state === 'CRITICAL').length;
  const totalSheltered = shelters.reduce((sum, s) => sum + (s.occupancy || 0), 0);
  const totalCapacity = shelters.reduce((sum, s) => sum + (s.capacity || 0), 0);

  return (
    <aside aria-label="Tổng quan tác chiến ứng phó ngập" className="space-y-2">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        <Card
          label="Tin khẩn cấp"
          value={urgentReports}
          tone={urgentReports > 0 ? 'red' : 'slate'}
          alert={urgentReports > 0}
          icon={<AlertTriangle className="h-4 w-4 text-red-600" />}
          sub={urgentReports > 0 ? 'Cần xử lý ngay' : 'Đã xác minh'}
        />

        <Card
          label="Ca đang xử lý"
          value={activeOrders}
          tone={activeOrders > 0 ? 'blue' : 'slate'}
          icon={<Ship className="h-4 w-4 text-sky-600" />}
          sub={`${orders.length} lệnh tổng số`}
        />

        <Card
          label="Xe sẵn sàng"
          value={idleVehicles}
          suffix={`/${vehicles.length}`}
          tone={brokenVehicles > 0 ? 'amber' : 'green'}
          alert={brokenVehicles > 0}
          icon={<Activity className="h-4 w-4 text-emerald-600" />}
          sub={brokenVehicles > 0 ? `Có ${brokenVehicles} xe gặp sự cố` : 'Nguồn lực đầy đủ'}
        />

        <Card
          label="Trạm đo báo động"
          value={warnGauges}
          suffix={`/${gauges.length}`}
          tone={warnGauges > 0 ? 'red' : 'green'}
          icon={<Waves className="h-4 w-4 text-cyan-600" />}
          sub={warnGauges > 0 ? 'Vượt ngưỡng an toàn' : 'Mực nước bình thường'}
        />

        <Card
          label="Người tại điểm trú"
          value={totalSheltered}
          suffix={`/${totalCapacity}`}
          tone="slate"
          icon={<Home className="h-4 w-4 text-amber-600" />}
          sub={`${shelters.length} điểm sơ tán mở`}
        />

        <Card
          label="Kiểm toán SHA-256"
          value={state.audit_chain_proof?.total_blocks || state.chain_proof?.total_blocks || state.audit_logs?.length || 0}
          suffix=" khối"
          tone="green"
          icon={<ShieldCheck className="h-4 w-4 text-emerald-600" />}
          sub={(state.audit_chain_proof?.chain_valid ?? state.chain_proof?.chain_valid) !== false ? 'Chuỗi băm toàn vẹn' : 'Lỗi chuỗi băm'}
        />
      </div>
    </aside>
  );
};
