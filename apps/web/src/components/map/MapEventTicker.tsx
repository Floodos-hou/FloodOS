// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenAgriOS Contributors

import React, { useEffect, useRef, useState } from 'react';
import type { CandidateRescueOption, HarvesterMachine } from '../../types';
import { detectFleetEvents, snapshotStatuses, type FleetEvent } from '../../utils/fleetInsights';

interface Shown extends FleetEvent {
  id: number;
}

const MAX_SHOWN = 4;
const LIFETIME_MS = 14_000;

const TONE: Record<string, string> = {
  danger: 'border-red-400 bg-red-950/90 text-red-50',
  warn: 'border-amber-400 bg-amber-950/90 text-amber-50',
  success: 'border-emerald-400 bg-emerald-950/90 text-emerald-50',
  info: 'border-sky-400 bg-slate-900/90 text-sky-50',
};

/** Slide-in feed of what just happened on the map (status changes and the rescue proposal). */
export const MapEventTicker: React.FC<{ machines: HarvesterMachine[]; rescueCandidate?: CandidateRescueOption | null }> = ({
  machines,
  rescueCandidate,
}) => {
  const [events, setEvents] = useState<Shown[]>([]);
  const prev = useRef<Map<string, string> | null>(null);
  const lastRescue = useRef<string | null | undefined>(undefined); // undefined = baseline not taken yet
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
      prev.current = snapshotStatuses(machines); // the first snapshot is the baseline, not news
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
      push([
        {
          key: `rescue:${id}`,
          tone: 'warn',
          icon: '🆘',
          text: `Đề xuất máy thay: ${c.machine_id} · ${c.score} điểm · ${c.distance_km} km`,
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
    <ul aria-live="polite" aria-label="Sự kiện mới" className="pointer-events-none absolute bottom-10 left-3 z-10 flex w-72 flex-col gap-1.5">
      {events.map((e) => (
        <li key={e.id} className={`ticker-in rounded-xl border-l-4 px-3 py-2 text-sm font-semibold shadow-xl backdrop-blur-md ${TONE[e.tone]}`}>
          <span className="mr-1.5">{e.icon}</span>
          {e.text}
        </li>
      ))}
    </ul>
  );
};
