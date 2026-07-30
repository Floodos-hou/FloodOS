// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenAgriOS Contributors

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Map as MapLibreMap, Marker, NavigationControl, AttributionControl, setWorkerUrl, type GeoJSONSource } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { LiveFleetPanel } from './LiveFleetPanel';
import { MapEventTicker } from './MapEventTicker';
import { nextHeading, screenRotation } from '../../utils/fleetInsights';
import type { LiveFleetInfo } from '../../hooks/useLiveFleet';
setWorkerUrl(maplibreWorkerUrl);
import type { FieldPlot, HarvesterMachine, DispatchAssignment, CandidateRescueOption } from '../../types';
import { EyeOff, Video, Compass, MapPin } from 'lucide-react';
import { OpenAgriLogo } from '../common/OpenAgriLogo';
import { fieldStatus, machineStatus } from '../../utils/labels';

interface TacticalMapProps {
  fields: FieldPlot[];
  machines: HarvesterMachine[];
  assignments: DispatchAssignment[];
  rescueCandidate?: CandidateRescueOption | null;
  onSelectField?: (field: FieldPlot) => void;
  onSelectMachine?: (machine: HarvesterMachine) => void;
  userRole?: string;
  /** Recent positions per machine as [lng, lat], newest last: drawn as trails. */
  trails?: Record<string, [number, number][]>;
  /** Live telemetry status for the HUD panel. */
  live?: LiveFleetInfo;
}

type OperationsZone = 'NAM_DINH' | 'CAN_THO';

// --- MẪU ĐẤT ĐA CANH TẠI HẢI HẬU, NAM ĐỊNH ---
const NAM_DINH_CENTER: [number, number] = [106.2846, 20.1265];
const NAM_DINH_FIELDS: FieldPlot[] = [
  {
    field_id: 'ND_01',
    organization_id: 'HTX_NAMDINH_HAIHAU',
    owner_user_id: 'usr_farmer_ba',
    owner_name: 'Bác Ba (Thái Bình - Hải Hậu)',
    name: 'Ruộng Mẫu 01 — Lúa Nếp Cái Hoa Vàng Hải Hậu',
    hamlet: 'Xã Hải Trung, Huyện Hải Hậu',
    crop: 'Lúa Nếp Cái Hoa Vàng',
    area_ha: 0.45,
    readiness_status: 'HARVESTING',
    harvest_progress_pct: 75,
    window_start: '2026-11-20T07:00:00Z',
    window_end: '2026-11-20T12:00:00Z',
    center_lat: 20.1282,
    center_lng: 106.2832,
    polygon: [
      [
        [106.2820, 20.1275],
        [106.2845, 20.1275],
        [106.2845, 20.1290],
        [106.2820, 20.1290],
        [106.2820, 20.1275],
      ],
    ],
    visibility: 'FULL',
  },
  {
    field_id: 'ND_02',
    organization_id: 'HTX_NAMDINH_HAIHAU',
    owner_user_id: 'usr_farmer_ba',
    owner_name: 'Bác Ba (Thái Bình - Hải Hậu)',
    name: 'Ruộng Mẫu 02 — Lúa Tám Xoan Tiến Vua Hải Hậu',
    hamlet: 'Xã Hải Trung, Huyện Hải Hậu',
    crop: 'Lúa Tám Xoan Hải Hậu',
    area_ha: 0.38,
    readiness_status: 'READY_HARVEST',
    harvest_progress_pct: 0,
    window_start: '2026-11-20T08:00:00Z',
    window_end: '2026-11-20T16:00:00Z',
    center_lat: 20.1282,
    center_lng: 106.2860,
    polygon: [
      [
        [106.2848, 20.1275],
        [106.2872, 20.1275],
        [106.2872, 20.1290],
        [106.2848, 20.1290],
        [106.2848, 20.1275],
      ],
    ],
    visibility: 'FULL',
  },
  {
    field_id: 'ND_03',
    organization_id: 'HTX_NAMDINH_HAIHAU',
    owner_user_id: 'usr_farmer_ha',
    owner_name: 'Hộ Xã viên Trần Văn Hà',
    name: 'Ruộng Mẫu 03 — Ngô Ngọt Vụ Đông CNC',
    hamlet: 'Xã Hải Trung, Huyện Hải Hậu',
    crop: 'Ngô Ngọt Vụ Đông',
    area_ha: 0.50,
    readiness_status: 'GROWING',
    harvest_progress_pct: 0,
    window_start: '2026-11-25T07:00:00Z',
    window_end: '2026-11-25T17:00:00Z',
    center_lat: 20.1263,
    center_lng: 106.2832,
    polygon: [
      [
        [106.2820, 20.1255],
        [106.2845, 20.1255],
        [106.2845, 20.1272],
        [106.2820, 20.1272],
        [106.2820, 20.1255],
      ],
    ],
    visibility: 'FULL',
  },
  {
    field_id: 'ND_04',
    organization_id: 'HTX_NAMDINH_HAIHAU',
    owner_user_id: 'usr_farmer_ha',
    owner_name: 'Hộ Xã viên Trần Văn Hà',
    name: 'Ruộng Mẫu 04 — Đậu Tương Hữu Cơ Luân Canh',
    hamlet: 'Xã Hải Trung, Huyện Hải Hậu',
    crop: 'Đậu Tương Hữu Cơ',
    area_ha: 0.35,
    readiness_status: 'READY_HARVEST',
    harvest_progress_pct: 0,
    window_start: '2026-11-21T07:00:00Z',
    window_end: '2026-11-21T11:00:00Z',
    center_lat: 20.1263,
    center_lng: 106.2860,
    polygon: [
      [
        [106.2848, 20.1255],
        [106.2872, 20.1255],
        [106.2872, 20.1272],
        [106.2848, 20.1272],
        [106.2848, 20.1255],
      ],
    ],
    visibility: 'FULL',
  },
  {
    field_id: 'ND_05',
    organization_id: 'HTX_NAMDINH_HAIHAU',
    owner_user_id: 'usr_farmer_loan',
    owner_name: 'Hộ Xã viên Vũ Thị Loan',
    name: 'Ruộng Mẫu 05 — Khoai Tây Phù Sa Sông Đào',
    hamlet: 'Xã Hải Trung, Huyện Hải Hậu',
    crop: 'Khoai Tây Vụ Đông',
    area_ha: 0.42,
    readiness_status: 'GROWING',
    harvest_progress_pct: 0,
    window_start: '2026-12-05T07:00:00Z',
    window_end: '2026-12-05T17:00:00Z',
    center_lat: 20.1245,
    center_lng: 106.2832,
    polygon: [
      [
        [106.2820, 20.1238],
        [106.2845, 20.1238],
        [106.2845, 20.1252],
        [106.2820, 20.1252],
        [106.2820, 20.1238],
      ],
    ],
    visibility: 'FULL',
  },
  {
    field_id: 'ND_06',
    organization_id: 'HTX_NAMDINH_HAIHAU',
    owner_user_id: 'usr_farmer_loan',
    owner_name: 'Hộ Xã viên Vũ Thị Loan',
    name: 'Ruộng Mẫu 06 — Cà Chua & Dưa Lưới CNC',
    hamlet: 'Xã Hải Trung, Huyện Hải Hậu',
    crop: 'Cà Chua Nông Nghiệp CNC',
    area_ha: 0.28,
    readiness_status: 'HARVESTING',
    harvest_progress_pct: 50,
    window_start: '2026-11-20T08:00:00Z',
    window_end: '2026-11-20T17:00:00Z',
    center_lat: 20.1245,
    center_lng: 106.2860,
    polygon: [
      [
        [106.2848, 20.1238],
        [106.2872, 20.1238],
        [106.2872, 20.1252],
        [106.2848, 20.1252],
        [106.2848, 20.1238],
      ],
    ],
    visibility: 'FULL',
  },
];

const NAM_DINH_MACHINES: HarvesterMachine[] = [
  {
    machine_id: 'MC-01',
    organization_id: 'HTX_NAMDINH_HAIHAU',
    owner_user_id: 'usr_owner_tu',
    name: 'Máy Cày Yanmar YT5114 (Đa năng)',
    machine_type: 'TRACTOR',
    model: 'Yanmar YT5114 (114 HP)',
    capacity_ha_per_hr: 0.85,
    status: 'WORKING',
    fuel_pct: 85,
    health_pct: 98,
    current_lat: 20.1263,
    current_lng: 106.2835,
    assigned_operator_id: 'Kỹ sư Nam (Nam Định)',
    telemetry_updated_at: '2026-11-20T09:15:00Z',
    visibility: 'FULL',
  },
  {
    machine_id: 'MG-02',
    organization_id: 'HTX_NAMDINH_HAIHAU',
    owner_user_id: 'usr_owner_tu',
    name: 'Máy Gặt Kubota DC-70 Plus (Chủ lực)',
    machine_type: 'COMBINE_HARVESTER',
    model: 'Kubota DC-70 Plus',
    capacity_ha_per_hr: 0.70,
    status: 'WORKING',
    fuel_pct: 78,
    health_pct: 94,
    current_lat: 20.1282,
    current_lng: 106.2838,
    assigned_operator_id: 'Thợ lái Hưng',
    telemetry_updated_at: '2026-11-20T09:15:00Z',
    visibility: 'FULL',
  },
  {
    machine_id: 'MG-03',
    organization_id: 'HTX_NAMDINH_HAIHAU',
    owner_user_id: 'usr_owner_tu',
    name: 'Máy Gặt Yanmar AW70V (Dự phòng)',
    machine_type: 'COMBINE_HARVESTER',
    model: 'Yanmar AW70V',
    capacity_ha_per_hr: 0.65,
    status: 'IDLE',
    fuel_pct: 92,
    health_pct: 100,
    current_lat: 20.1280,
    current_lng: 106.2862,
    assigned_operator_id: 'Thợ lái Minh',
    telemetry_updated_at: '2026-11-20T09:15:00Z',
    visibility: 'FULL',
  },
];

// Helper để xác định màu sắc và chiều cao 3D theo loại nông sản
function getCropStyle(crop: string, status: string): { color: string; height: number; badge: string } {
  const c = crop.toLowerCase();
  if (c.includes('nếp cái hoa vàng')) return { color: '#F59E0B', height: 28, badge: '🌾 Nếp Cái Hoa Vàng' };
  if (c.includes('tám xoan')) return { color: '#10B981', height: 25, badge: '🌾 Tám Xoan Hải Hậu' };
  if (c.includes('ngô ngọt')) return { color: '#047857', height: 32, badge: '🌽 Ngô Ngọt Vụ Đông' };
  if (c.includes('đậu tương') || c.includes('đậu nành')) return { color: '#84CC16', height: 20, badge: '🥜 Đậu Tương Hữu Cơ' };
  if (c.includes('khoai tây') || c.includes('khoai')) return { color: '#B45309', height: 18, badge: '🥔 Khoai Phù Sa' };
  if (c.includes('cà chua') || c.includes('dưa')) return { color: '#EF4444', height: 26, badge: '🍅 Nông Sản CNC' };
  if (c.includes('st25')) return { color: '#EAB308', height: 27, badge: '🌾 Lúa ST25 Đặc Sản' };
  if (c.includes('đài thơm')) return { color: '#3B82F6', height: 24, badge: '🌾 Lúa Đài Thơm 8' };
  if (c.includes('om18') || c.includes('om5451')) return { color: '#6BA84E', height: 22, badge: '🌾 Lúa OM18' };

  if (status === 'HARVESTING') return { color: '#E7B52B', height: 26, badge: '🌾 Đang Thu Hoạch' };
  return { color: '#3A7228', height: 20, badge: '🌱 Canh Tác' };
}

interface MachineMarkerEntry {
  marker: Marker;
  /** Appearance signature: the marker element is rebuilt only when this changes. */
  sig: string;
  machine: HarvesterMachine;
  raf: number;
  /** Last position the heading was computed from (a machine only turns when it really moves). */
  hd: { lat: number; lng: number; heading: number } | null;
}

const GLIDE_MS = 1_800;

/** Turns the machine icon towards its direction of travel (screen-space, corrected for the map's rotation). */
function orientMarker(entry: MachineMarkerEntry, lat: number, lng: number, mapBearing: number) {
  entry.hd = nextHeading(entry.hd, lat, lng);
  const body = entry.marker.getElement().querySelector<HTMLElement>('[data-machine-body]');
  if (body) body.style.rotate = `${screenRotation(entry.hd.heading, mapBearing)}deg`;
}

/** Moves a marker to `target` with an ease-out glide; large jumps (zone switch, reset) snap instead. */
function glideMarker(entry: MachineMarkerEntry, target: [number, number]) {
  cancelAnimationFrame(entry.raf);
  const from = entry.marker.getLngLat();
  const dx = target[0] - from.lng;
  const dy = target[1] - from.lat;
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return;
  if (Math.abs(dx) > 0.05 || Math.abs(dy) > 0.05) {
    entry.marker.setLngLat(target);
    return;
  }
  const t0 = performance.now();
  const step = (now: number) => {
    const k = Math.min(1, (now - t0) / GLIDE_MS);
    const e = 1 - Math.pow(1 - k, 3);
    entry.marker.setLngLat([from.lng + dx * e, from.lat + dy * e]);
    if (k < 1) entry.raf = requestAnimationFrame(step);
  };
  entry.raf = requestAnimationFrame(step);
}

export const TacticalMap: React.FC<TacticalMapProps> = ({
  fields,
  machines,
  assignments,
  rescueCandidate,
  onSelectField,
  onSelectMachine,
  trails,
  live,
}) => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const machineMarkersRef = useRef<Map<string, MachineMarkerEntry>>(new Map());
  const tagSigRef = useRef('');
  const rescuePulseRef = useRef<Marker | null>(null);
  // True after MapLibre's 'load' event. isStyleLoaded() is NOT used as a guard: it stays false while raster tiles are
  // slow or unreachable (flaky venue Wi-Fi), which froze every live update.
  const mapReadyRef = useRef(false);
  const syncRef = useRef<(map: MapLibreMap) => void>(() => {});
  const orbitAnimRef = useRef<number | null>(null);

  const [activeZone, setActiveZone] = useState<OperationsZone>('CAN_THO');
  const [is3D, setIs3D] = useState(true);
  const [isOrbiting, setIsOrbiting] = useState(false);
  const [viewMode, setViewMode] = useState<'MAP' | 'LIST'>('MAP');
  const [showFields, setShowFields] = useState(true);
  const [showMachines, setShowMachines] = useState(true);
  const [showVectors, setShowVectors] = useState(true);
  const [selectedItem, setSelectedItem] = useState<{ type: 'FIELD' | 'MACHINE'; data: any } | null>(null);

  // Active fields & machines based on selected zone
  const activeFields = activeZone === 'NAM_DINH' ? NAM_DINH_FIELDS : fields;
  const activeMachines = activeZone === 'NAM_DINH' ? NAM_DINH_MACHINES : machines;

  const latest = useRef({ fields: activeFields, machines: activeMachines, onSelectField, onSelectMachine });
  const updateRef = useRef<(map: MapLibreMap) => void>(() => {});

  useEffect(() => {
    latest.current = { fields: activeFields, machines: activeMachines, onSelectField, onSelectMachine };
  }, [activeFields, activeMachines, onSelectField, onSelectMachine]);

  // Toggle 3D Perspective vs 2D Flat View
  const handleToggle3D = () => {
    const map = mapRef.current;
    if (!map) return;
    const next3D = !is3D;
    setIs3D(next3D);
    map.easeTo({
      pitch: next3D ? 60 : 0,
      bearing: next3D ? -22 : 0,
      duration: 1200,
    });
  };

  // Toggle Cinematic Drone Orbit Tour
  const handleToggleOrbit = () => {
    const map = mapRef.current;
    if (!map) return;

    if (isOrbiting) {
      if (orbitAnimRef.current) cancelAnimationFrame(orbitAnimRef.current);
      orbitAnimRef.current = null;
      setIsOrbiting(false);
    } else {
      setIsOrbiting(true);
      if (!is3D) {
        setIs3D(true);
        map.setPitch(60);
      }
      const orbit = () => {
        if (!mapRef.current) return;
        mapRef.current.setBearing((mapRef.current.getBearing() + 0.12) % 360);
        orbitAnimRef.current = requestAnimationFrame(orbit);
      };
      orbitAnimRef.current = requestAnimationFrame(orbit);
    }
  };

  // Switch Operations Zone
  const handleSwitchZone = (zone: OperationsZone) => {
    setActiveZone(zone);
    setSelectedItem(null);
    const map = mapRef.current;
    if (!map) return;
    if (zone === 'NAM_DINH') {
      map.flyTo({
        center: NAM_DINH_CENTER,
        zoom: 16.2,
        pitch: is3D ? 60 : 0,
        bearing: -22,
        duration: 2000,
      });
    } else {
      map.flyTo({
        center: [105.57, 10.065],
        zoom: 13.8,
        pitch: is3D ? 60 : 0,
        bearing: -18,
        duration: 2000,
      });
    }
  };

  // --- RENDER 3D SVG ISOMETRIC MACHINE MARKER ---
  const create3DMachineMarker = useCallback((m: HarvesterMachine, getLatest?: () => HarvesterMachine) => {
    const isWorking = m.status === 'WORKING';
    const isBreakdown = m.status === 'BREAKDOWN';

    const el = document.createElement('div');
    el.className = 'tactical-3d-machine-marker group cursor-pointer relative select-none';

    // Container with 3D perspective
    const container = document.createElement('div');
    container.className = 'relative flex items-center justify-center';

    // SVG 3D Isometric Tractor / Harvester
    const svgWrap = document.createElement('div');
    svgWrap.className = 'relative transition-transform transform group-hover:scale-125 filter drop-shadow-xl';
    svgWrap.setAttribute('data-machine-body', '');
    svgWrap.style.transition = 'rotate 800ms ease-out, scale 150ms';

    const primaryColor = m.machine_type === 'TRACTOR' ? '#dc2626' : (m.status === 'BREAKDOWN' ? '#ef4444' : '#ea580c');
    const accentColor = m.machine_type === 'TRACTOR' ? '#991b1b' : '#c2410c';

    svgWrap.innerHTML = `
      <svg width="84" height="84" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
        <!-- 3D Headlight Cone Beam (working mode) -->
        ${isWorking ? `
          <polygon points="50,45 20,5 80,5" fill="url(#headlightCone)" opacity="0.65" class="anim-headlight" />
          <defs>
            <linearGradient id="headlightCone" x1="50" y1="45" x2="50" y2="5" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stop-color="#fef08a" stop-opacity="0.8" />
              <stop offset="100%" stop-color="#fef08a" stop-opacity="0" />
            </linearGradient>
          </defs>
        ` : ''}

        <!-- 3D Machine Shadow -->
        <ellipse cx="50" cy="72" rx="28" ry="12" fill="rgba(15, 23, 42, 0.45)" />

        <!-- 3D Tracks / Big Ag Wheels -->
        <rect x="24" y="58" width="12" height="24" rx="4" fill="#1e293b" stroke="#0f172a" stroke-width="1.5" />
        <line x1="24" y1="64" x2="36" y2="64" stroke="#475569" stroke-width="1.5" />
        <line x1="24" y1="70" x2="36" y2="70" stroke="#475569" stroke-width="1.5" />
        <line x1="24" y1="76" x2="36" y2="76" stroke="#475569" stroke-width="1.5" />

        <rect x="64" y="58" width="12" height="24" rx="4" fill="#1e293b" stroke="#0f172a" stroke-width="1.5" />
        <line x1="64" y1="64" x2="76" y2="64" stroke="#475569" stroke-width="1.5" />
        <line x1="64" y1="70" x2="76" y2="70" stroke="#475569" stroke-width="1.5" />
        <line x1="64" y1="76" x2="76" y2="76" stroke="#475569" stroke-width="1.5" />

        <!-- Main 3D Engine Chassis -->
        <polygon points="32,64 68,64 64,42 36,42" fill="${primaryColor}" stroke="${accentColor}" stroke-width="1.5" />

        <!-- 3D Panoramic Operator Cabin (Glass Reflection) -->
        <polygon points="36,46 64,46 60,30 40,30" fill="rgba(56, 189, 248, 0.55)" stroke="#38bdf8" stroke-width="1.5" />
        <line x1="42" y1="32" x2="52" y2="44" stroke="rgba(255, 255, 255, 0.85)" stroke-width="1.2" />

        <!-- 3D Header Cutter / Reel (Front of machine) -->
        <g class="${isWorking ? 'anim-spin-reel' : ''}">
          <rect x="22" y="38" width="56" height="7" rx="2" fill="#334155" stroke="#0f172a" stroke-width="1.5" />
          <line x1="26" y1="38" x2="26" y2="45" stroke="#f59e0b" stroke-width="1.5" />
          <line x1="38" y1="38" x2="38" y2="45" stroke="#f59e0b" stroke-width="1.5" />
          <line x1="50" y1="38" x2="50" y2="45" stroke="#f59e0b" stroke-width="1.5" />
          <line x1="62" y1="38" x2="62" y2="45" stroke="#f59e0b" stroke-width="1.5" />
          <line x1="74" y1="38" x2="74" y2="45" stroke="#f59e0b" stroke-width="1.5" />
        </g>

        <!-- RTK GPS Telematics Antenna & LED -->
        <line x1="50" y1="30" x2="50" y2="20" stroke="#0f172a" stroke-width="1.5" />
        <circle cx="50" cy="20" r="3.5" fill="#38bdf8" />
        <circle cx="50" cy="20" r="2" fill="#ffffff" />

        <!-- Breakdown Sparks & Smoke -->
        ${isBreakdown ? `
          <circle cx="50" cy="30" r="8" fill="#64748b" opacity="0.8" class="anim-smoke" />
          <polygon points="46,38 52,32 50,42 56,34" fill="#fbbf24" stroke="#ef4444" stroke-width="1" class="anim-spark" />
          <rect x="30" y="10" width="40" height="14" rx="4" fill="#dc2626" stroke="#ffffff" stroke-width="1" />
          <text x="50" y="20" font-size="8" font-weight="bold" fill="#ffffff" text-anchor="middle">SỰ CỐ</text>
        ` : ''}
      </svg>
    `;

    // RTK Telematics Radar Wave Ring
    const radarRing = document.createElement('div');
    radarRing.className = `absolute -inset-2 rounded-full border-2 ${
      isBreakdown ? 'border-red-500 animate-ping' : isWorking ? 'border-amber-400 anim-rtk-ping' : 'border-emerald-400'
    } pointer-events-none opacity-40`;

    // Floating 3D Telematics HUD Badge (Visible on hover/tap)
    const hud = document.createElement('div');
    hud.className =
      'absolute -top-12 left-1/2 -translate-x-1/2 px-2.5 py-1 bg-slate-900/95 backdrop-blur-md text-white rounded-xl text-xs font-mono whitespace-nowrap shadow-2xl border border-slate-700 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-30 flex items-center gap-1.5';
    hud.innerHTML = `
      <span class="h-2 w-2 rounded-full ${isBreakdown ? 'bg-red-500' : isWorking ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'}"></span>
      <span class="font-bold text-amber-300">${m.machine_id}</span>
      <span class="text-slate-300">| ${m.model}</span>
      <span class="text-emerald-400 font-bold">RTK ±2cm</span>
    `;

    container.append(radarRing, svgWrap, hud);
    el.replaceChildren(container);
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', `Thiết bị ${m.machine_id}: ${m.name}`);

    el.addEventListener('click', () => {
      const current = getLatest ? getLatest() : m;
      setSelectedItem({ type: 'MACHINE', data: current });
      latest.current.onSelectMachine?.(current);
    });

    return el;
  }, []);

  // Update Layers & GeoJSON on Map
  const updateMapLayers = useCallback(
    (map: MapLibreMap) => {

      // --- 1. FIELD POLYGONS WITH 3D EXTRUSION ---
      const currentFields = latest.current.fields;
      const fieldFeatures: any[] = currentFields
        .filter((f) => f.visibility === 'FULL' && f.polygon && f.polygon.length > 0)
        .map((f) => {
          const style = getCropStyle(f.crop, f.readiness_status);
          return {
            type: 'Feature',
            properties: {
              field_id: f.field_id,
              name: f.name,
              crop: f.crop,
              owner_name: f.owner_name,
              area_ha: f.area_ha,
              status: f.readiness_status,
              progress: f.harvest_progress_pct,
              color: style.color,
              height: style.height,
              crop_badge: style.badge,
            },
            geometry: {
              type: 'Polygon',
              coordinates: f.polygon,
            },
          };
        });

      const fieldsGeoJson: any = {
        type: 'FeatureCollection',
        features: fieldFeatures,
      };

      if (map.getSource('fields-source')) {
        (map.getSource('fields-source') as GeoJSONSource).setData(fieldsGeoJson);
      } else {
        map.addSource('fields-source', {
          type: 'geojson',
          data: fieldsGeoJson,
        });

        // 3D Volumetric Extrusion Layer
        map.addLayer({
          id: 'fields-3d-extrusion',
          type: 'fill-extrusion',
          source: 'fields-source',
          paint: {
            'fill-extrusion-color': ['get', 'color'] as any,
            'fill-extrusion-height': ['get', 'height'] as any,
            'fill-extrusion-base': 0,
            'fill-extrusion-opacity': 0.88,
          },
        });

        // 2D Fill fallback
        map.addLayer({
          id: 'fields-fill',
          type: 'fill',
          source: 'fields-source',
          paint: {
            'fill-color': ['get', 'color'] as any,
            'fill-opacity': 0.55,
          },
        });

        map.addLayer({
          id: 'fields-line',
          type: 'line',
          source: 'fields-source',
          paint: {
            'line-color': '#ffffff',
            'line-width': 2.5,
          },
        });

        map.on('click', 'fields-3d-extrusion', (e) => {
          if (e.features && e.features[0]) {
            const props: any = e.features[0].properties;
            const found = latest.current.fields.find((f) => f.field_id === props.field_id);
            if (found) {
              setSelectedItem({ type: 'FIELD', data: found });
              latest.current.onSelectField?.(found);
            }
          }
        });

        map.on('mouseenter', 'fields-3d-extrusion', () => {
          map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', 'fields-3d-extrusion', () => {
          map.getCanvas().style.cursor = '';
        });
      }

      if (map.getLayer('fields-3d-extrusion')) {
        map.setLayoutProperty('fields-3d-extrusion', 'visibility', showFields && is3D ? 'visible' : 'none');
      }
      if (map.getLayer('fields-fill')) {
        map.setLayoutProperty('fields-fill', 'visibility', showFields && !is3D ? 'visible' : 'none');
        map.setLayoutProperty('fields-line', 'visibility', showFields ? 'visible' : 'none');
      }

      // --- 2. VECTOR LINES (ASSIGNMENTS & RESCUE RADAR) ---
      const vectorFeatures: any[] = [];
      const currentMachines = latest.current.machines;

      if (showVectors && activeZone === 'CAN_THO') {
        assignments.forEach((asg) => {
          const machine = currentMachines.find((m) => m.machine_id === asg.machine_id);
          const field = currentFields.find((f) => f.field_id === asg.field_id);

          if (machine && field && field.visibility === 'FULL') {
            const isImpacted = asg.status === 'SUPERSEDED';
            vectorFeatures.push({
              type: 'Feature',
              properties: {
                type: isImpacted ? 'IMPACTED_ASG' : 'CONFIRMED_ASG',
                color: isImpacted ? '#ef4444' : '#2563eb',
              },
              geometry: {
                type: 'LineString',
                coordinates: [
                  [machine.current_lng, machine.current_lat],
                  [field.center_lng, field.center_lat],
                ],
              },
            });
          }
        });

        if (rescueCandidate) {
          const candMachine = currentMachines.find((m) => m.machine_id === rescueCandidate.machine_id);
          const impacted = assignments.find((a) => a.status === 'SUPERSEDED');
          const targetField = impacted
            ? currentFields.find((f) => f.field_id === impacted.field_id && f.visibility === 'FULL')
            : undefined;

          if (candMachine && targetField) {
            vectorFeatures.push({
              type: 'Feature',
              properties: {
                type: 'RESCUE_RADAR',
                color: '#10b981',
                title: `Cứu hộ: ${rescueCandidate.machine_name}`,
              },
              geometry: {
                type: 'LineString',
                coordinates: [
                  [candMachine.current_lng, candMachine.current_lat],
                  [targetField.center_lng, targetField.center_lat],
                ],
              },
            });
          }
        }
      }

      // Pulsing ring on the field the rescuer is heading to
      const rescueFeature = vectorFeatures.find((f) => f.properties?.type === 'RESCUE_RADAR');
      const rescueTarget: [number, number] | null = rescueFeature ? rescueFeature.geometry.coordinates[1] : null;
      if (rescueTarget) {
        if (!rescuePulseRef.current) {
          const el = document.createElement('div');
          el.className = 'rescue-pulse';
          rescuePulseRef.current = new Marker({ element: el, anchor: 'center' }).setLngLat(rescueTarget).addTo(map);
        } else {
          rescuePulseRef.current.setLngLat(rescueTarget);
        }
      } else if (rescuePulseRef.current) {
        rescuePulseRef.current.remove();
        rescuePulseRef.current = null;
      }
      const vectorsGeoJson: any = {
        type: 'FeatureCollection',
        features: vectorFeatures,
      };

      if (map.getSource('vectors-source')) {
        (map.getSource('vectors-source') as GeoJSONSource).setData(vectorsGeoJson);
      } else {
        map.addSource('vectors-source', {
          type: 'geojson',
          data: vectorsGeoJson,
        });

        map.addLayer({
          id: 'vectors-line',
          type: 'line',
          source: 'vectors-source',
          paint: {
            'line-color': ['get', 'color'] as any,
            'line-width': 4,
            'line-dasharray': [2, 1],
          },
        });
        const rescueOnly = ['==', ['get', 'type'], 'RESCUE_RADAR'] as any;
        map.addLayer({
          id: 'rescue-glow',
          type: 'line',
          source: 'vectors-source',
          filter: rescueOnly,
          layout: { 'line-cap': 'round' },
          paint: { 'line-color': '#34d399', 'line-width': 14, 'line-opacity': 0.35, 'line-blur': 6 },
        });
        map.addLayer({
          id: 'rescue-line',
          type: 'line',
          source: 'vectors-source',
          filter: rescueOnly,
          layout: { 'line-cap': 'round' },
          paint: { 'line-color': '#059669', 'line-width': 5, 'line-dasharray': [0, 4, 3] },
        });
      }

      // --- 3. LIVE TRAILS (machine markers are managed by syncMachineMarkers so they can glide) ---
      const trailFeatures: any[] = [];
      if (showMachines && trails) {
        currentMachines.forEach((m) => {
          const pts = trails[m.machine_id];
          if (!pts || pts.length < 2) return;
          trailFeatures.push({
            type: 'Feature',
            properties: {
              color: m.status === 'BREAKDOWN' ? '#ef4444' : m.status === 'WORKING' ? '#f59e0b' : '#10b981',
            },
            geometry: { type: 'LineString', coordinates: pts },
          });
        });
      }
      const trailsGeoJson: any = { type: 'FeatureCollection', features: trailFeatures };
      if (map.getSource('trails-source')) {
        (map.getSource('trails-source') as GeoJSONSource).setData(trailsGeoJson);
      } else {
        map.addSource('trails-source', { type: 'geojson', data: trailsGeoJson });
        map.addLayer({
          id: 'trails-glow',
          type: 'line',
          source: 'trails-source',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': ['get', 'color'] as any, 'line-width': 9, 'line-opacity': 0.18, 'line-blur': 4 },
        });
        map.addLayer({
          id: 'trails-line',
          type: 'line',
          source: 'trails-source',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': ['get', 'color'] as any, 'line-width': 3, 'line-opacity': 0.85 },
        });
      }

      // --- 4. 3D CROP BADGE LABELS OVER PARCELS ---
      const tagSig = showFields
        ? currentFields
            .map((f) => `${f.field_id}|${f.visibility}|${f.crop}|${f.readiness_status}|${f.harvest_progress_pct}|${f.area_ha}`)
            .join(';')
        : '';
      const tagsChanged = tagSig !== tagSigRef.current;
      if (tagsChanged) {
        markersRef.current.forEach((m) => m.remove());
        markersRef.current = [];
        tagSigRef.current = tagSig;
      }
      if (showFields && tagsChanged) {
        currentFields.forEach((f) => {
          if (f.visibility === 'FULL' && f.center_lat && f.center_lng) {
            const style = getCropStyle(f.crop, f.readiness_status);
            const el = document.createElement('div');
            el.className =
              'field-3d-tag cursor-pointer px-2.5 py-1 bg-white/95 backdrop-blur-md border border-slate-300 rounded-xl shadow-lg text-xs font-bold text-slate-800 hover:bg-emerald-50 transition transform hover:-translate-y-1';
            el.innerHTML = `
              <div class="flex items-center gap-1.5">
                <span class="h-2 w-2 rounded-full" style="background-color: ${style.color}"></span>
                <span>${f.field_id}: ${f.area_ha} ha</span>
              </div>
              <div class="text-[10px] text-slate-500 font-semibold">${style.badge}</div>
            `;

            el.addEventListener('click', () => {
              setSelectedItem({ type: 'FIELD', data: f });
              latest.current.onSelectField?.(f);
            });

            const marker = new Marker({ element: el, anchor: 'center' })
              .setLngLat([f.center_lng, f.center_lat])
              .addTo(map);

            markersRef.current.push(marker);
          }
        });
      }
    },
    [showFields, showMachines, showVectors, is3D, activeZone, assignments, rescueCandidate, trails]
  );

    // Machine markers are reused between updates so they glide to their new position instead of flickering.
  const syncMachineMarkers = useCallback(
    (map: MapLibreMap) => {
      const entries = machineMarkersRef.current;
      const wanted = showMachines
        ? latest.current.machines.filter((m) => !(m.current_lat === 0 && m.current_lng === 0))
        : [];
      const keep = new Set(wanted.map((m) => m.machine_id));
      entries.forEach((entry, id) => {
        if (!keep.has(id)) {
          cancelAnimationFrame(entry.raf);
          entry.marker.remove();
          entries.delete(id);
        }
      });
      wanted.forEach((m) => {
        const sig = `${m.status}|${m.machine_type}|${m.model}`;
        const target: [number, number] = [m.current_lng, m.current_lat];
        const existing = entries.get(m.machine_id);
        if (existing && existing.sig === sig) {
          existing.machine = m;
          orientMarker(existing, m.current_lat, m.current_lng, map.getBearing());
          glideMarker(existing, target);
          return;
        }
        let start = target;
        if (existing) {
          cancelAnimationFrame(existing.raf);
          const p = existing.marker.getLngLat();
          start = [p.lng, p.lat];
          existing.marker.remove();
        }
        const entry = { sig, machine: m, raf: 0, hd: existing ? existing.hd : null } as MachineMarkerEntry;
        const el = create3DMachineMarker(m, () => entry.machine);
        entry.marker = new Marker({ element: el }).setLngLat(start).addTo(map);
        entries.set(m.machine_id, entry);
        orientMarker(entry, m.current_lat, m.current_lng, map.getBearing());
        if (start !== target) glideMarker(entry, target);
      });
    },
    [showMachines, create3DMachineMarker]
  );

  // Fly the camera to a machine (from the live roster)
  const focusMachine = useCallback((m: HarvesterMachine) => {
    const map = mapRef.current;
    if (!map) return;
    map.flyTo({ center: [m.current_lng, m.current_lat], zoom: Math.max(map.getZoom(), 15.5), speed: 0.9, essential: true });
    setSelectedItem({ type: 'MACHINE', data: m });
  }, []);

  // Initialize Map with resilient styles and background
  useEffect(() => {
    if (!mapContainer.current || viewMode !== 'MAP') return;

    const initialCenter: [number, number] = activeZone === 'NAM_DINH' ? NAM_DINH_CENTER : [105.57, 10.065];
    const initialZoom = activeZone === 'NAM_DINH' ? 16.2 : 13.8;

    const map = new MapLibreMap({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {
          // OpenStreetMap tile source
          osm: {
            type: 'raster',
            tiles: [
              'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
            ],
            tileSize: 256,
            attribution: '&copy; OpenStreetMap contributors',
          },
        },
        layers: [
          // Fallback base agricultural terrain background (NEVER BLACK!)
          {
            id: 'base-terrain-bg',
            type: 'background',
            paint: {
              'background-color': '#e3ebd8', // Warm agricultural meadow green
            },
          },
          // Raster tile overlay
          {
            id: 'osm-tiles',
            type: 'raster',
            source: 'osm',
            minzoom: 0,
            maxzoom: 19,
            paint: {
              'raster-opacity': 0.85,
            },
          },
        ],
      },
      center: initialCenter,
      zoom: initialZoom,
      pitch: is3D ? 60 : 0,
      bearing: is3D ? -22 : 0,
      maxPitch: 80,
      attributionControl: false,
    });

    map.addControl(new NavigationControl({ showCompass: true, showZoom: true }), 'top-right');
    map.addControl(new AttributionControl({ compact: true }), 'bottom-right');

    map.on('load', () => {
      mapReadyRef.current = true;
      // Setup natural 3D sun lighting for extruded parcels
      try {
        map.setLight({
          anchor: 'viewport',
          color: '#ffffff',
          intensity: 0.65,
          position: [1.5, 180, 45],
        });
      } catch {
        // Safe fallback
      }
      updateRef.current(map);
      syncRef.current(map);
    });

    mapRef.current = map;

    return () => {
      if (orbitAnimRef.current) cancelAnimationFrame(orbitAnimRef.current);
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      machineMarkersRef.current.forEach((entry) => {
        cancelAnimationFrame(entry.raf);
        entry.marker.remove();
      });
      machineMarkersRef.current.clear();
      rescuePulseRef.current?.remove();
      rescuePulseRef.current = null;
      mapReadyRef.current = false;
      tagSigRef.current = '';
      mapRef.current?.remove();
      mapRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode]);

  // Redraw layers when state changes
  useEffect(() => {
    updateRef.current = updateMapLayers;
    const map = mapRef.current;
    if (map && mapReadyRef.current) {
      updateMapLayers(map);
    }
  }, [updateMapLayers]);

  useEffect(() => {
    syncRef.current = syncMachineMarkers;
    const map = mapRef.current;
    if (map && mapReadyRef.current) {
      syncMachineMarkers(map);
    }
  }, [syncMachineMarkers, activeMachines]);

  // Marching-ants animation of the rescue route (skipped for users who prefer reduced motion)
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const seq = [[0, 4, 3], [0.5, 4, 2.5], [1, 4, 2], [1.5, 4, 1.5], [2, 4, 1], [2.5, 4, 0.5], [3, 4, 0],
      [0, 0.5, 3, 3.5], [0, 1, 3, 3], [0, 1.5, 3, 2.5], [0, 2, 3, 2], [0, 2.5, 3, 1.5], [0, 3, 3, 1], [0, 3.5, 3, 0.5]];
    let step = 0;
    const id = window.setInterval(() => {
      const map = mapRef.current;
      if (!map || !mapReadyRef.current || !map.getLayer('rescue-line')) return;
      step = (step + 1) % seq.length;
      map.setPaintProperty('rescue-line', 'line-dasharray', seq[step]);
    }, 90);
    return () => window.clearInterval(id);
  }, []);

  // Vector lines (machine -> field) must follow machines as they move
  useEffect(() => {
    const map = mapRef.current;
    if (map && mapReadyRef.current) {
      updateRef.current(map);
    }
  }, [activeMachines]);

  const fogOfWarCount = activeFields.filter((f) => f.visibility === 'FOG_OF_WAR').length;
  const fullVisibleCount = activeFields.filter((f) => f.visibility === 'FULL').length;

  return (
    <div className="bg-white rounded-3xl shadow-xl border border-slate-200 overflow-hidden flex flex-col h-[600px] xl:h-[720px] relative">
      {/* Tactical Map Header Control Bar */}
      <div className="px-5 py-3 bg-slate-900 text-white flex flex-wrap items-center justify-between gap-3 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <OpenAgriLogo size={24} />
          <div>
            <h3 className="font-extrabold text-white text-sm sm:text-base tracking-tight flex items-center gap-2">
              <span>Bản đồ Tác chiến Nông nghiệp 3D</span>
              <span className="rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 text-[11px] px-2.5 py-0.5 font-mono font-bold">
                Digital Twin 3D
              </span>
            </h3>
          </div>
        </div>

        {/* Zone Selector & 3D Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Operations Zone Switcher */}
          <div className="flex items-center bg-slate-800 p-1 rounded-xl border border-slate-700 text-xs">
            <button
              type="button"
              onClick={() => handleSwitchZone('NAM_DINH')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold transition ${
                activeZone === 'NAM_DINH'
                  ? 'bg-amber-500 text-slate-950 shadow-md'
                  : 'text-slate-300 hover:text-white hover:bg-slate-700'
              }`}
            >
              <MapPin className="h-3.5 w-3.5" />
              <span>Hải Hậu (dữ liệu mẫu)</span>
            </button>
            <button
              type="button"
              onClick={() => handleSwitchZone('CAN_THO')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold transition ${
                activeZone === 'CAN_THO'
                  ? 'bg-emerald-600 text-white shadow-md'
                  : 'text-slate-300 hover:text-white hover:bg-slate-700'
              }`}
            >
              <MapPin className="h-3.5 w-3.5" />
              <span>Thới Lai (Cần Thơ)</span>
            </button>
          </div>

          {/* 3D Perspective Toggle Button */}
          <button
            type="button"
            onClick={handleToggle3D}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition border ${
              is3D
                ? 'bg-emerald-800 border-emerald-600 text-white shadow'
                : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'
            }`}
            title="Bật/Tắt Góc nhìn 3D Tác chiến 60 độ"
          >
            <Compass className={`h-3.5 w-3.5 ${is3D ? 'text-amber-300' : ''}`} />
            <span>{is3D ? 'Góc nhìn 3D (60°)' : '2D Bản đồ phẳng'}</span>
          </button>

          {/* Cinematic Fly-cam Orbit Tour */}
          <button
            type="button"
            onClick={handleToggleOrbit}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition border ${
              isOrbiting
                ? 'bg-rose-600 border-rose-500 text-white shadow animate-pulse'
                : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'
            }`}
            title="Quay Fly-cam 360 độ tuần tra thực địa"
          >
            <Video className="h-3.5 w-3.5" />
            <span>{isOrbiting ? 'Dừng Fly-cam' : 'Fly-cam 360°'}</span>
          </button>

          {/* List vs Map View */}
          <button
            type="button"
            onClick={() => setViewMode(viewMode === 'MAP' ? 'LIST' : 'MAP')}
            className="px-3 py-1.5 text-xs font-bold rounded-xl bg-slate-800 border border-slate-700 text-white hover:bg-slate-700 transition"
          >
            {viewMode === 'MAP' ? 'Dạng Danh sách' : 'Dạng Bản đồ'}
          </button>
        </div>
      </div>

      {/* Sub-bar: Filters & Crop Legends */}
      <div className="px-5 py-2 bg-slate-100/90 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-bold text-slate-500 uppercase tracking-wider text-[11px]">Cây trồng:</span>
          {activeZone === 'NAM_DINH' ? (
            <>
              <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 text-amber-900 px-2 py-0.5 font-bold">
                <span className="h-2 w-2 rounded-full bg-amber-500"></span> Nếp Cái Hoa Vàng
              </span>
              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 text-emerald-900 px-2 py-0.5 font-bold">
                <span className="h-2 w-2 rounded-full bg-emerald-600"></span> Tám Xoan Tiến Vua
              </span>
              <span className="inline-flex items-center gap-1 rounded-md bg-teal-100 text-teal-900 px-2 py-0.5 font-bold">
                <span className="h-2 w-2 rounded-full bg-teal-700"></span> Ngô Ngọt Vụ Đông
              </span>
              <span className="inline-flex items-center gap-1 rounded-md bg-lime-100 text-lime-900 px-2 py-0.5 font-bold">
                <span className="h-2 w-2 rounded-full bg-lime-600"></span> Đậu Tương Hữu Cơ
              </span>
              <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 text-amber-950 border border-amber-300 px-2 py-0.5 font-bold">
                <span className="h-2 w-2 rounded-full bg-amber-800"></span> Khoai Tây Phù Sa
              </span>
            </>
          ) : (
            <>
              <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 text-amber-900 px-2 py-0.5 font-bold">
                <span className="h-2 w-2 rounded-full bg-amber-500"></span> Lúa ST25 Đặc Sản
              </span>
              <span className="inline-flex items-center gap-1 rounded-md bg-blue-100 text-blue-900 px-2 py-0.5 font-bold">
                <span className="h-2 w-2 rounded-full bg-blue-600"></span> Lúa Đài Thơm 8
              </span>
              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 text-emerald-900 px-2 py-0.5 font-bold">
                <span className="h-2 w-2 rounded-full bg-emerald-600"></span> Lúa OM18
              </span>
            </>
          )}

          {fogOfWarCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-900 px-2.5 py-0.5 font-bold ml-2">
              <EyeOff className="w-3 h-3 text-amber-700" />
              <span>{fogOfWarCount} ruộng khác bị ẩn (Fog of War)</span>
            </span>
          )}
        </div>

        {/* Visibility Toggles */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShowFields(!showFields)}
            className={`px-2.5 py-1 rounded-lg border text-xs font-bold transition ${
              showFields ? 'bg-emerald-700 text-white border-emerald-800 shadow-sm' : 'bg-white text-slate-600 border-slate-300'
            }`}
          >
            Thửa ruộng ({fullVisibleCount})
          </button>
          <button
            type="button"
            onClick={() => setShowMachines(!showMachines)}
            className={`px-2.5 py-1 rounded-lg border text-xs font-bold transition ${
              showMachines ? 'bg-orange-600 text-white border-orange-700 shadow-sm' : 'bg-white text-slate-600 border-slate-300'
            }`}
          >
            Máy cày/gặt ({activeMachines.length})
          </button>
          {activeZone === 'CAN_THO' && (
            <button
              type="button"
              onClick={() => setShowVectors(!showVectors)}
              className={`px-2.5 py-1 rounded-lg border text-xs font-bold transition ${
                showVectors ? 'bg-indigo-700 text-white border-indigo-800 shadow-sm' : 'bg-white text-slate-600 border-slate-300'
              }`}
            >
              Đường điều máy & Radar
            </button>
          )}
        </div>
      </div>

      {/* Main Map Canvas with Warm Meadow Green Background (NEVER BLACK!) */}
      <div className="relative flex-1 bg-[#e3ebd8] overflow-hidden">
        {viewMode === 'MAP' ? (
          <>
            <div ref={mapContainer} className="w-full h-full" />
            {activeZone === 'CAN_THO' && <LiveFleetPanel machines={activeMachines} live={live} onFocus={focusMachine} />}
            {activeZone === 'CAN_THO' && <MapEventTicker machines={activeMachines} rescueCandidate={rescueCandidate} />}
          </>
        ) : (
          <div className="p-6 h-full overflow-y-auto bg-slate-50">
            <h4 className="text-base font-bold text-slate-800 mb-4">
              Danh mục Thực thể Nông nghiệp — {activeZone === 'NAM_DINH' ? 'Vùng Hải Hậu, Nam Định' : 'Vùng Thới Lai, Cần Thơ'}:
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Fields List */}
              <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm">
                <h5 className="font-bold text-xs uppercase tracking-wider text-slate-400 mb-3">
                  Thửa ruộng canh tác ({activeFields.length})
                </h5>
                <div className="space-y-2.5 max-h-80 overflow-y-auto">
                  {activeFields.map((f) => (
                    <div
                      key={f.field_id}
                      onClick={() => setSelectedItem({ type: 'FIELD', data: f })}
                      className="p-3 rounded-xl border border-slate-200 bg-white hover:border-emerald-500 hover:bg-emerald-50/50 cursor-pointer transition shadow-sm"
                    >
                      <div className="flex justify-between items-center font-bold text-sm text-slate-900">
                        <span>{f.name}</span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                          {f.area_ha} ha
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                        Chủ ruộng: <strong className="text-slate-700">{f.owner_name}</strong> | Cây trồng:{' '}
                        <strong className="text-emerald-700">{f.crop}</strong>
                      </div>
                      <div className="mt-2 flex items-center justify-between text-xs text-emerald-800 font-semibold">
                        <span>Tiến độ: {f.harvest_progress_pct}%</span>
                        <span>{fieldStatus(f.readiness_status).text}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Machinery List */}
              <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm">
                <h5 className="font-bold text-xs uppercase tracking-wider text-slate-400 mb-3">
                  Đoàn máy cày & máy gặt cơ giới ({activeMachines.length})
                </h5>
                <div className="space-y-2.5 max-h-80 overflow-y-auto">
                  {activeMachines.map((m) => (
                    <div
                      key={m.machine_id}
                      onClick={() => setSelectedItem({ type: 'MACHINE', data: m })}
                      className="p-3 rounded-xl border border-slate-200 bg-white hover:border-orange-500 hover:bg-orange-50/50 cursor-pointer transition shadow-sm"
                    >
                      <div className="flex justify-between items-center font-bold text-sm text-slate-900">
                        <span>{m.name}</span>
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full text-white ${
                            m.status === 'BREAKDOWN'
                              ? 'bg-red-600 animate-pulse'
                              : m.status === 'WORKING'
                              ? 'bg-amber-600'
                              : 'bg-emerald-600'
                          }`}
                        >
                          {machineStatus(m.status).text}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                        Model: <strong className="text-slate-700">{m.model}</strong> | Công suất:{' '}
                        <strong>{m.capacity_ha_per_hr} ha/h</strong>
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        Thợ lái: <strong>{m.assigned_operator_id}</strong> | Nhiên liệu: {m.fuel_pct}%
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Selected Entity Card Modal Overlay */}
        {selectedItem && (
          <div className="absolute bottom-5 left-5 right-5 sm:left-auto sm:right-5 sm:w-88 bg-slate-900/95 backdrop-blur-md rounded-2xl shadow-2xl border border-slate-700 p-4 z-30 text-white animate-in fade-in slide-in-from-bottom-2 duration-150">
            <div className="flex justify-between items-start pb-2.5 border-b border-slate-800 mb-3">
              <div>
                <span className="font-bold text-amber-300 text-sm">
                  {selectedItem.data.name}
                </span>
                <div className="text-slate-400 text-xs font-mono">
                  ID: {selectedItem.type === 'FIELD' ? selectedItem.data.field_id : selectedItem.data.machine_id}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedItem(null)}
                className="text-slate-400 hover:text-white font-bold p-1 rounded-lg hover:bg-slate-800"
              >
                ✕
              </button>
            </div>

            {selectedItem.type === 'FIELD' ? (
              <div className="space-y-2 text-xs text-slate-300">
                <div className="flex justify-between">
                  <span className="text-slate-400">Chủ sở hữu:</span>
                  <span className="font-bold text-white">{selectedItem.data.owner_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Giống cây trồng:</span>
                  <span className="font-bold text-amber-300">{selectedItem.data.crop}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Diện tích canh tác:</span>
                  <span className="font-bold text-white">{selectedItem.data.area_ha} hecta</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Tiến độ thu hoạch:</span>
                  <span className="font-bold text-emerald-400">{selectedItem.data.harvest_progress_pct}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Trạng thái:</span>
                  <span className="font-bold text-white">{fieldStatus(selectedItem.data.readiness_status).text}</span>
                </div>
              </div>
            ) : (
              <div className="space-y-2 text-xs text-slate-300">
                <div className="flex justify-between">
                  <span className="text-slate-400">Chủng loại máy:</span>
                  <span className="font-bold text-white">{selectedItem.data.model}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Định vị RTK GPS:</span>
                  <span className="font-bold text-emerald-400">Chính xác ±2.2 cm</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Mức nhiên liệu:</span>
                  <span className="font-bold text-white">{selectedItem.data.fuel_pct}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Sức khỏe động cơ:</span>
                  <span className="font-bold text-white">{selectedItem.data.health_pct}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Kỹ thuật lái máy:</span>
                  <span className="font-bold text-amber-300">{selectedItem.data.assigned_operator_id}</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
