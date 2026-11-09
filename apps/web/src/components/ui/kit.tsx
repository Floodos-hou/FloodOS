// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import React from 'react';
import type { Stage } from '../../utils/caseFlow';

/* ---------- Water-level ruler: the product's signature gauge ---------- */

interface GaugeRulerProps {
  /** measured or reported level in cm; null/undefined renders "Chưa có số liệu" instead of a fake 0 */
  level: number | null | undefined;
  warn?: number;
  crit?: number;
  max?: number;
  /** where the number comes from (SEED / SIMULATOR / REPORTED / DEVICE) */
  source?: string;
  className?: string;
}

export const GaugeRuler: React.FC<GaugeRulerProps> = ({ level, warn, crit, max, source, className = '' }) => {
  if (level === null || level === undefined) {
    return <div className={`text-xs text-ink-3 ${className}`}>Chưa có số liệu mực nước</div>;
  }
  const top = Math.max(max ?? 0, (crit ?? 0) * 1.25, level * 1.15, 60);
  const pct = (v: number) => `${Math.min(100, (v / top) * 100)}%`;
  const tone = crit !== undefined && level >= crit ? 'bg-gradient-to-r from-red-500 to-rose-600' : warn !== undefined && level >= warn ? 'bg-gradient-to-r from-amber-500 to-orange-500' : 'bg-gradient-to-r from-sky-500 to-blue-600';
  const step = top > 200 ? 50 : top > 100 ? 20 : 10;
  const ticks: number[] = [];
  for (let t = 0; t <= top; t += step) ticks.push(t);
  return (
    <div className={className}>
      <div className="flex items-baseline justify-between">
        <span className="num text-lg font-extrabold text-ink">{level} <span className="text-xs font-semibold text-ink-3">cm</span></span>
        {source && <span className="rounded bg-sheet-2 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-ink-2 ring-1 ring-line">{source}</span>}
      </div>
      <div className="relative mt-1.5 h-3.5 rounded-full bg-sheet-2 ring-1 ring-line shadow-inner">
        <div className={`absolute inset-y-0 left-0 rounded-full transition-all duration-300 ${tone}`} style={{ width: pct(level) }} />
        {warn !== undefined && <div className="absolute -inset-y-1 w-0.5 bg-warn shadow-sm" style={{ left: pct(warn) }} title={`Cảnh báo ${warn} cm`} />}
        {crit !== undefined && <div className="absolute -inset-y-1 w-0.5 bg-crit shadow-sm" style={{ left: pct(crit) }} title={`Nguy hiểm ${crit} cm`} />}
      </div>
      <div className="relative mt-1 h-3 text-[10px] font-medium text-ink-3">
        {ticks.map((t) => (
          <span key={t} className="num absolute -translate-x-1/2" style={{ left: pct(t) }}>{t}</span>
        ))}
      </div>
    </div>
  );
};

/* ---------- Case river: five stations from report to confirmation ---------- */

export const CaseRiver: React.FC<{ stages: Stage[]; className?: string }> = ({ stages, className = '' }) => (
  <ol className={`flex w-full items-start ${className}`} aria-label="Tiến trình vụ việc">
    {stages.map((s, i) => {
      const dot =
        s.state === 'done' ? 'bg-river border-river shadow-sm shadow-sky-500/30'
        : s.state === 'current' ? 'bg-sheet border-river ring-4 ring-river-soft shadow-sm'
        : s.state === 'bad' ? 'bg-crit border-crit shadow-sm shadow-red-500/30'
        : 'bg-sheet border-line-2';
      const text = s.state === 'todo' ? 'text-ink-3' : s.state === 'bad' ? 'text-crit font-bold' : s.state === 'current' ? 'text-river font-bold' : 'text-ink';
      return (
        <li key={s.key} className="relative flex min-w-0 flex-1 flex-col items-center text-center" aria-current={s.state === 'current' ? 'step' : undefined}>
          {i > 0 && (
            <span
              className={`absolute right-1/2 top-[7px] h-0.5 w-full transition-colors ${stages[i - 1].state === 'done' ? 'bg-river' : 'bg-line-2'}`}
              aria-hidden="true"
            />
          )}
          <span className={`relative z-10 h-4 w-4 rounded-full border-2 transition-all ${dot}`} />
          <span className={`mt-1.5 text-[11px] font-semibold leading-tight ${text}`}>{s.label}</span>
        </li>
      );
    })}
  </ol>
);

/* ---------- small layout helpers ---------- */

export const Metric: React.FC<{ label: string; value: React.ReactNode; hint?: string; tone?: 'crit' | 'warn' | 'river' }> = ({ label, value, hint, tone }) => {
  const color = tone === 'crit' ? 'text-crit' : tone === 'warn' ? 'text-warn' : tone === 'river' ? 'text-river' : 'text-ink';
  return (
    <div className="min-w-0">
      <div className="eyebrow">{label}</div>
      <div className={`num text-xl font-extrabold leading-tight ${color}`}>{value}</div>
      {hint && <div className="text-[11px] text-ink-3">{hint}</div>}
    </div>
  );
};

export const EmptyState: React.FC<{ title: string; hint?: string }> = ({ title, hint }) => (
  <div className="px-4 py-8 text-center">
    <p className="text-sm font-bold text-ink">{title}</p>
    {hint && <p className="mx-auto mt-1 max-w-xs text-xs text-ink-3">{hint}</p>}
  </div>
);

export const Field: React.FC<{ label: string; htmlFor?: string; hint?: string; children: React.ReactNode }> = ({ label, htmlFor, hint, children }) => (
  <div>
    <label htmlFor={htmlFor} className="label">{label}</label>
    {children}
    {hint && <p className="mt-1 text-[11px] text-ink-3">{hint}</p>}
  </div>
);

/** "10 phút trước" style age; returns null for missing/invalid timestamps rather than inventing one */
export function ageText(iso?: string | null, now: number = Date.now()): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const m = Math.max(0, Math.round((now - t) / 60000));
  if (m < 1) return 'vừa xong';
  if (m < 60) return `${m} phút trước`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} giờ ${m % 60 ? `${m % 60} phút ` : ''}trước`;
  return `${Math.floor(h / 24)} ngày trước`;
}
