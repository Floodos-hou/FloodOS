// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { DispatchAssignment, FieldPlot, HarvesterMachine } from '../../types';
import { computeKpis } from '../../utils/fleetInsights';

/** Eases a displayed number towards its target (skipped when the user prefers reduced motion). */
function useCountUp(target: number, ms = 700): number {
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
  decimals?: number;
  suffix?: string;
  sub?: string;
  tone: 'green' | 'amber' | 'red' | 'blue' | 'slate';
  alert?: boolean;
  bar?: number;
}> = ({ label, value, decimals = 0, suffix = '', sub, tone, alert, bar }) => {
  const shown = useCountUp(value);
  const ring: Record<string, string> = {
    green: 'border-emerald-300 bg-emerald-50 text-emerald-900',
    amber: 'border-amber-300 bg-amber-50 text-amber-900',
    red: 'border-red-400 bg-red-50 text-red-900',
    blue: 'border-sky-300 bg-sky-50 text-sky-900',
    slate: 'border-slate-300 bg-white text-slate-800',
  };
  const fill: Record<string, string> = {
    green: 'bg-emerald-500',
    amber: 'bg-amber-500',
    red: 'bg-red-500',
    blue: 'bg-sky-500',
    slate: 'bg-slate-500',
  };
  return (
    <div className={`relative overflow-hidden rounded-2xl border px-4 py-3 shadow-sm ${ring[tone]} ${alert ? 'kpi-alert' : ''}`}>
      <div className="text-[11px] font-bold uppercase tracking-wider opacity-70">{label}</div>
      <div className="mt-0.5 text-3xl font-extrabold tabular-nums leading-none">
        {shown.toFixed(decimals)}
        <span className="ml-0.5 text-base font-bold opacity-70">{suffix}</span>
      </div>
      {sub && <div className="mt-1 text-xs opacity-75">{sub}</div>}
      {bar !== undefined && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/10">
          <div className={`h-full rounded-full transition-all duration-700 ${fill[tone]}`} style={{ width: `${Math.max(0, Math.min(100, bar))}%` }} />
        </div>
      )}
    </div>
  );
};

interface Props {
  machines: HarvesterMachine[];
  fields: FieldPlot[];
  assignments: DispatchAssignment[];
}

/** Headline numbers above the map. Hidden for roles that see no fleet and no fields. */
export const FleetKpiStrip: React.FC<Props> = ({ machines, fields, assignments }) => {
  const k = useMemo(() => computeKpis(machines, fields, assignments), [machines, fields, assignments]);
  if (k.machines === 0 && fields.length === 0) return null;
  return (
    <section aria-label="Chỉ số tổng quan" className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
      <Card label="Máy đang gặt" value={k.working} sub={`trên tổng ${k.machines} máy`} tone="green" bar={k.machines ? (k.working / k.machines) * 100 : 0} />
      <Card label="Máy gặp sự cố" value={k.broken} sub={k.broken ? 'cần máy thay thế' : 'không có sự cố'} tone={k.broken ? 'red' : 'slate'} alert={k.broken > 0} />
      <Card label="Nhiên liệu trung bình" value={k.avgFuelPct} decimals={1} suffix="%" sub={k.lowFuel ? `${k.lowFuel} máy sắp hết` : 'mức nhiên liệu ổn'} tone={k.lowFuel ? 'amber' : 'blue'} bar={k.avgFuelPct} />
      <Card label="Tiến độ thu hoạch" value={k.avgHarvestPct} decimals={1} suffix="%" sub="trung bình các thửa" tone="amber" bar={k.avgHarvestPct} />
      <Card label="Ca đang chạy" value={k.activeShifts} sub={`${k.idle} máy sẵn sàng`} tone="blue" />
    </section>
  );
};
