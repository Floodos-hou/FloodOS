// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../services/api';
import type { RescueVehicle } from '../types';

/** One vehicle as reported by the NGSI-LD digital twin (fed by MQTT telemetry). */
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
/** A vehicle counts as "live" while its position changed this recently. */
export const LIVE_WINDOW_MS = 8_000;
const MAX_TRAIL_POINTS = 60;
/** Ignore GPS jitter below ~0.5 m when extending a trail. */
const MIN_STEP_DEG = 0.000005;

const ROLES_WITH_TWIN = new Set([
  'DISPATCHER',
  'FIELD_TEAM',
  'RESOURCE_MANAGER',
  'PLATFORM_ADMIN',
]);

type Trails = Record<string, [number, number][]>;

interface Snapshot {
  entities: Array<{
    id?: string;
    location?: { value?: { coordinates?: [number, number] } };
    fuel_level?: { value?: number };
    vehicle_status?: { value?: string };
    machine_status?: { value?: string };
  }>;
}

function parseEntities(raw: Snapshot | null): LiveMachine[] {
  if (!raw || !Array.isArray(raw.entities)) return [];
  const out: LiveMachine[] = [];
  for (const e of raw.entities) {
    const coords = e.location?.value?.coordinates;
    if (!coords || coords.length < 2) continue;
    const [lng, lat] = coords;
    if (typeof lng !== 'number' || typeof lat !== 'number') continue;
    const id = (e.id || '').replace(/^urn:ngsi-ld:Vehicle:/, '').replace(/^urn:ngsi-ld:HarvesterMachine:/, '');
    if (!id) continue;
    const fuel = typeof e.fuel_level?.value === 'number' ? e.fuel_level.value : 100;
    const status = (e.vehicle_status?.value || e.machine_status?.value || 'IDLE').toString();
    out.push({ machine_id: id, lat, lng, fuel_pct: fuel, status });
  }
  return out;
}

export function useLiveFleet(token: string | null, role: string | undefined) {
  const [live, setLive] = useState<Map<string, LiveMachine>>(new Map());
  const [trails, setTrails] = useState<Trails>({});
  const [info, setInfo] = useState<LiveFleetInfo>({
    enabled: false,
    connected: false,
    lastMoveAt: null,
    lastPollAt: null,
    movedAt: {},
    error: null,
  });

  const enabled = Boolean(token && role && ROLES_WITH_TWIN.has(role));
  const trailsRef = useRef<Trails>({});
  trailsRef.current = trails;
  const lastPosRef = useRef<Map<string, [number, number]>>(new Map());
  const movedAtRef = useRef<Record<string, number>>({});

  useEffect(() => {
    if (!enabled || !token) {
      setInfo((prev) => ({ ...prev, enabled: false, connected: false }));
      return;
    }
    let cancelled = false;

    async function poll() {
      try {
        const raw = await api.getDigitalTwin(token!);
        if (cancelled) return;
        const list = parseEntities(raw as Snapshot);
        const nextMap = new Map<string, LiveMachine>();
        const now = Date.now();
        let anyMoved = false;

        const nextTrails: Trails = { ...trailsRef.current };

        for (const m of list) {
          nextMap.set(m.machine_id, m);
          const prev = lastPosRef.current.get(m.machine_id);
          const moved =
            !prev ||
            Math.abs(prev[0] - m.lat) > MIN_STEP_DEG ||
            Math.abs(prev[1] - m.lng) > MIN_STEP_DEG;

          if (moved) {
            anyMoved = true;
            lastPosRef.current.set(m.machine_id, [m.lat, m.lng]);
            movedAtRef.current[m.machine_id] = now;

            const existing = nextTrails[m.machine_id] || [];
            const lastPoint = existing[existing.length - 1];
            if (!lastPoint || lastPoint[0] !== m.lng || lastPoint[1] !== m.lat) {
              const appended = [...existing, [m.lng, m.lat] as [number, number]];
              nextTrails[m.machine_id] = appended.slice(-MAX_TRAIL_POINTS);
            }
          }
        }

        setLive(nextMap);
        setTrails(nextTrails);
        setInfo((prev) => ({
          ...prev,
          enabled: true,
          connected: true,
          lastPollAt: now,
          lastMoveAt: anyMoved ? now : prev.lastMoveAt,
          movedAt: { ...movedAtRef.current },
          error: null,
        }));
      } catch (err: any) {
        if (cancelled) return;
        setInfo((prev) => ({
          ...prev,
          enabled: true,
          connected: false,
          error: err?.message || 'Polling error',
        }));
      }
    }

    poll();
    const handle = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [enabled, token]);

  return { live, trails, info };
}

/** Merges the latest polled telemetry into the static state vehicles. */
export function mergeLive<T extends { vehicle_id?: string; machine_id?: string; current_lat?: number; current_lng?: number; fuel_pct?: number }>(
  vehicles: T[],
  live: Map<string, LiveMachine>
): T[] {
  if (live.size === 0) return vehicles;
  return vehicles.map((v) => {
    const id = v.vehicle_id || v.machine_id;
    if (!id) return v;
    const l = live.get(id);
    if (!l) return v;
    return {
      ...v,
      current_lat: l.lat,
      current_lng: l.lng,
      fuel_pct: l.fuel_pct,
      status: l.status || (v as any).status,
    };
  });
}
