// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../services/api';
import type { HarvesterMachine } from '../types';

/** One machine as reported by the NGSI-LD digital twin (fed by MQTT telemetry). */
export interface LiveMachine {
  machine_id: string;
  lat: number;
  lng: number;
  fuel_pct: number;
  status: string;
}

/** Status shown in the map's live HUD. */
export interface LiveFleetInfo {
  /** The hook is polling (role allowed and tab visible). */
  enabled: boolean;
  /** The last poll succeeded. */
  connected: boolean;
  /** Epoch ms of the last time any machine position or fuel level actually changed. */
  lastMoveAt: number | null;
  lastPollAt: number | null;
  /** Epoch ms of the last position change per machine (the HUD derives "moving" from it with its own clock). */
  movedAt: Record<string, number>;
  error: string | null;
}

const POLL_MS = 2_000;
/** A machine counts as "live" while its position changed this recently. */
export const LIVE_WINDOW_MS = 8_000;
const MAX_TRAIL_POINTS = 60;
/** Ignore GPS jitter below ~0.5 m when extending a trail. */
const MIN_STEP_DEG = 0.000005;

const ROLES_WITH_TWIN = new Set(['COORDINATOR', 'MACHINE_OWNER', 'OPERATOR', 'PLATFORM_ADMIN']);

type Trails = Record<string, [number, number][]>;

interface Snapshot {
  /** Token the data was fetched with: a snapshot is never shown to a different session/tenant. */
  key: string;
  live: Record<string, LiveMachine>;
  trails: Trails;
  movedAt: Record<string, number>;
  lastMoveAt: number | null;
  lastPollAt: number | null;
  connected: boolean;
  error: string | null;
}

const EMPTY: Snapshot = { key: '', live: {}, trails: {}, movedAt: {}, lastMoveAt: null, lastPollAt: null, connected: false, error: null };

/**
 * Polls the digital-twin endpoint every couple of seconds and keeps a short trail per machine.
 * Only roles that the API allows to read machine entities are polled (farmers and repair crews are
 * deliberately blind to the fleet: Fog of War), and polling pauses while the browser tab is hidden.
 */
export function useLiveFleet(token: string | null, role: string | undefined) {
  const allowed = !!token && !!role && ROLES_WITH_TWIN.has(role);
  const [snap, setSnap] = useState<Snapshot>(EMPTY);
  const inFlight = useRef(false);

  useEffect(() => {
    if (!allowed || !token) return;
    let cancelled = false;

    const poll = async () => {
      if (inFlight.current || document.hidden) return;
      inFlight.current = true;
      try {
        const res = await api.getDigitalTwin(token);
        if (cancelled) return;
        const t = Date.now();
        setSnap((previous) => {
          const prev = previous.key === token ? previous : EMPTY;
          const live: Record<string, LiveMachine> = {};
          const trails: Trails = { ...prev.trails };
          const movedAt = { ...prev.movedAt };
          let lastMoveAt = prev.lastMoveAt;
          for (const e of res.entities) {
            const id = String(e.id).split(':').pop() ?? '';
            const coords = e.location?.value?.coordinates;
            if (!id || !Array.isArray(coords)) continue;
            const m: LiveMachine = {
              machine_id: id,
              lng: Number(coords[0]),
              lat: Number(coords[1]),
              fuel_pct: Number(e.fuelLevel?.value ?? 0),
              status: String(e.status?.value ?? 'IDLE'),
            };
            live[id] = m;
            const before = prev.live[id];
            const trail = trails[id] ? [...trails[id]] : [];
            const last = trail[trail.length - 1];
            const moved = !last || Math.abs(last[0] - m.lng) > MIN_STEP_DEG || Math.abs(last[1] - m.lat) > MIN_STEP_DEG;
            if (moved) {
              trail.push([m.lng, m.lat]);
              if (trail.length > MAX_TRAIL_POINTS) trail.shift();
              trails[id] = trail;
              if (before) {
                movedAt[id] = t;
                lastMoveAt = t;
              }
            } else if (before && Math.abs(before.fuel_pct - m.fuel_pct) > 0.001) {
              lastMoveAt = t; // fuel burn also proves telemetry is arriving
            }
          }
          return { key: token, live, trails, movedAt, lastMoveAt, lastPollAt: t, connected: true, error: null };
        });
      } catch (err: any) {
        if (cancelled) return;
        setSnap((previous) => ({
          ...(previous.key === token ? previous : EMPTY),
          key: token,
          connected: false,
          lastPollAt: Date.now(),
          error: err?.message ?? 'Không đọc được bản sao số',
        }));
      } finally {
        inFlight.current = false;
      }
    };

    void poll();
    const timer = window.setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [allowed, token]);

  const view = allowed && snap.key === token ? snap : EMPTY;

  const info: LiveFleetInfo = useMemo(
    () => ({
      enabled: allowed,
      connected: view.connected,
      lastMoveAt: view.lastMoveAt,
      lastPollAt: view.lastPollAt,
      movedAt: view.movedAt,
      error: view.error,
    }),
    [view, allowed]
  );

  return { live: view.live, trails: view.trails, info };
}

/** Overlays live twin positions and fuel on the (slower) tactical-state machine list. */
export function mergeLive(machines: HarvesterMachine[], live: Record<string, LiveMachine>): HarvesterMachine[] {
  if (Object.keys(live).length === 0) return machines;
  return machines.map((m) => {
    const l = live[m.machine_id];
    if (!l) return m;
    return { ...m, current_lat: l.lat, current_lng: l.lng, fuel_pct: l.fuel_pct };
  });
}
