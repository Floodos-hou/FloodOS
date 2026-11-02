// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import React, { useEffect, useRef, useState } from 'react';
import type { CandidateRescueOption, RescueVehicle } from '../../types';
import { detectFleetEvents, snapshotStatuses, type FleetEvent } from '../../utils/fleetInsights';

interface Shown extends FleetEvent {
  id: number;
}

const MAX_SHOWN = 4;
const LIFETIME_MS = 10_000;

const TONE: Record<string, string> = {
  danger: 'border-red-500 bg-red-950/95 text-red-100 border border-red-800/80',
  warn: 'border-amber-500 bg-amber-950/95 text-amber-100 border border-amber-800/80',
  success: 'border-emerald-500 bg-emerald-950/95 text-emerald-100 border border-emerald-800/80',
  info: 'border-cyan-500 bg-slate-900/95 text-cyan-100 border border-slate-700',
};

/** Slide-in feed of what just happened on the map (status changes and rescue replan proposals). */
export const MapEventTicker: React.FC<{ machines: RescueVehicle[] | any[]; rescueCandidate?: CandidateRescueOption | null }> = ({
  machines,
  rescueCandidate,
}) => {
  const [events, setEvents] = useState<Shown[]>([]);
  const prev = useRef<Map<string, string> | null>(null);
  const lastRescue = useRef<string | null | undefined>(undefined);
  const seq = useRef(0);
  const timers = useRef<number[]>([]);

  const push = (list: FleetEvent[]) => {
    if (list.length === 0) return;
    const shown = list.map((e) => ({ ...e, id: ++seq.current }));
    setEvents((cur) => [...cur, ...shown].slice(-MAX_SHOWN));
    for (const s of shown) {
      timers.current.push(window.setTimeout(() => setEvents((cur) => cur.filter((x) => x.id !== s.id)), LIFETIME_MS));
    }
  };

  useEffect(() => {
    if (prev.current === null) {
      prev.current = snapshotStatuses(machines);
    } else {
      push(detectFleetEvents(prev.current, machines));
      prev.current = snapshotStatuses(machines);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machines]);

  useEffect(() => {
    const id = rescueCandidate?.option_id ?? null;
    if (id && lastRescue.current !== undefined && id !== lastRescue.current) {
      const c = rescueCandidate!;
      const vehId = (c as any).vehicle_id || c.machine_id || 'PT-ChiVien';
      push([
        {
          key: `rescue:${id}`,
          tone: 'warn',
          icon: '🆘',
          text: `Đề xuất chi viện: ${vehId} · ${c.score} điểm · ${c.distance_km} km`,
        },
      ]);
    }
    lastRescue.current = id;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rescueCandidate?.option_id]);

  useEffect(() => {
    const t = timers.current;
    return () => t.forEach((x) => window.clearTimeout(x));
  }, []);

  if (events.length === 0) return null;
  return (
    <ul aria-live="polite" aria-label="Sự kiện mới" className="pointer-events-none absolute bottom-6 left-3 z-10 flex w-72 flex-col gap-1.5">
      {events.map((e) => (
        <li key={e.id} className={`ticker-in rounded-xl border-l-4 px-3 py-2 text-xs font-semibold shadow-2xl backdrop-blur-md ${TONE[e.tone]}`}>
          <span className="mr-1.5">{e.icon}</span>
          {e.text}
        </li>
      ))}
    </ul>
  );
};
