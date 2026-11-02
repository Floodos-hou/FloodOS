// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import React, { useEffect, useRef, useState } from 'react';
import { Map as MapLibreMap, Marker, NavigationControl, AttributionControl, setWorkerUrl, type GeoJSONSource } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { MapEventTicker } from './MapEventTicker';
import { nextHeading, screenRotation } from '../../utils/fleetInsights';
import type { LiveFleetInfo } from '../../hooks/useLiveFleet';
import { HANOI_TACTICAL_BASEMAP_GEOJSON } from './hanoiTacticalVector';
setWorkerUrl(maplibreWorkerUrl);
import type { FloodZone, RescueVehicle, FloodReport, DispatchOrder, GaugeStation, SafeShelter, CandidateRescueOption, UserRole } from '../../types';
import { Crosshair, Maximize2, Minimize2 } from 'lucide-react';
import type { MapSelection } from './MapDetailPanel';

interface TacticalMapProps {
  zones?: FloodZone[];
  vehicles?: RescueVehicle[];
  reports?: FloodReport[];
  orders?: DispatchOrder[];
  gauges?: GaugeStation[];
  shelters?: SafeShelter[];
  rescueCandidate?: CandidateRescueOption | null;
  userRole?: UserRole | string;
  trails?: Record<string, [number, number][]>;
  live?: LiveFleetInfo;
  onSelect?: (selection: MapSelection) => void;
  fields?: any[];
  machines?: any[];
  assignments?: any[];
  className?: string;
  heightClass?: string;
}

// Center of pilot flood-response zone in Hanoi (Hoàng Mai / Thanh Trì / Sông Nhuệ)
const HANOI_CENTER: [number, number] = [105.8450, 20.9780];

const BASEMAPS = {
  dark: {
    name: 'Tác chiến (Dark Command)',
    style: {
      version: 8,
      sources: {
        tactical_hanoi_base: {
          type: 'geojson',
          data: HANOI_TACTICAL_BASEMAP_GEOJSON,
        },
      },
      layers: [
        {
          id: 'tactical-bg',
          type: 'background',
          paint: {
            'background-color': '#070d18',
          },
        },
        {
          id: 'districts-fill',
          type: 'fill',
          source: 'tactical_hanoi_base',
          filter: ['all', ['==', '$type', 'Polygon'], ['!=', 'type', 'lake']],
          paint: {
            'fill-color': '#0e172a',
            'fill-opacity': 0.88,
          },
        },
        {
          id: 'districts-line',
          type: 'line',
          source: 'tactical_hanoi_base',
          filter: ['all', ['==', '$type', 'Polygon'], ['!=', 'type', 'lake']],
          paint: {
            'line-color': '#1e293b',
            'line-width': 1.5,
          },
        },
        {
          id: 'tactical-grid',
          type: 'line',
          source: 'tactical_hanoi_base',
          filter: ['==', 'type', 'grid'],
          paint: {
            'line-color': '#1e293b',
            'line-width': 1,
            'line-dasharray': [2, 4],
            'line-opacity': 0.5,
          },
        },
        {
          id: 'lakes-fill',
          type: 'fill',
          source: 'tactical_hanoi_base',
          filter: ['==', 'type', 'lake'],
          paint: {
            'fill-color': '#0369a1',
            'fill-opacity': 0.85,
          },
        },
        {
          id: 'lakes-outline',
          type: 'line',
          source: 'tactical_hanoi_base',
          filter: ['==', 'type', 'lake'],
          paint: {
            'line-color': '#0284c7',
            'line-width': 2,
          },
        },
        {
          id: 'rivers-glow',
          type: 'line',
          source: 'tactical_hanoi_base',
          filter: ['in', 'type', 'river', 'canal'],
          paint: {
            'line-color': '#0284c7',
            'line-width': 10,
            'line-opacity': 0.35,
            'line-blur': 4,
          },
        },
        {
          id: 'rivers-line',
          type: 'line',
          source: 'tactical_hanoi_base',
          filter: ['in', 'type', 'river', 'canal'],
          paint: {
            'line-color': '#38bdf8',
            'line-width': 3.5,
          },
        },
      ],
    },
  },
  voyager: {
    name: 'Đô thị / Thủy văn (Hybrid)',
    style: {
      version: 8,
      sources: {
        tactical_hanoi_base: {
          type: 'geojson',
          data: HANOI_TACTICAL_BASEMAP_GEOJSON,
        },
        osm_source: {
          type: 'raster',
          tiles: [
            'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
          ],
          tileSize: 256,
          attribution: '&copy; OpenStreetMap contributors',
          maxzoom: 19,
        },
      },
      layers: [
        {
          id: 'tactical-bg',
          type: 'background',
          paint: {
            'background-color': '#0f172a',
          },
        },
        {
          id: 'osm-layer',
          type: 'raster',
          source: 'osm_source',
          paint: {
            'raster-opacity': 0.75,
          },
        },
        {
          id: 'rivers-glow',
          type: 'line',
          source: 'tactical_hanoi_base',
          filter: ['in', 'type', 'river', 'canal'],
          paint: {
            'line-color': '#0284c7',
            'line-width': 8,
            'line-opacity': 0.45,
            'line-blur': 3,
          },
        },
      ],
    },
  },
};

export const TacticalMap: React.FC<TacticalMapProps> = ({
  zones = [],
  vehicles = [],
  reports = [],
  orders = [],
  gauges = [],
  shelters = [],
  rescueCandidate,
  userRole,
  trails = {},
  live,
  onSelect,
  fields,
  machines,
  assignments,
  className = '',
  heightClass = 'min-h-[580px] h-[calc(100vh-210px)]',
}) => {
  const activeZones: FloodZone[] = zones.length > 0 ? zones : (fields as any[]) || [];
  const activeVehicles: RescueVehicle[] = vehicles.length > 0 ? vehicles : (machines as any[]) || [];
  const activeOrders: DispatchOrder[] = orders.length > 0 ? orders : (assignments as any[]) || [];

  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Map<string, Marker>>(new Map());
  const headingsRef = useRef<Map<string, { lat: number; lng: number; heading: number }>>(new Map());

  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapBearing, setMapBearing] = useState(0);
  const [basemap, setBasemap] = useState<'dark' | 'voyager'>('dark');
  const [isFullscreen, setIsFullscreen] = useState(false);

  const [showReports, setShowReports] = useState(true);
  const [showVehicles, setShowVehicles] = useState(true);
  const [showShelters, setShowShelters] = useState(true);
  const [showGauges, setShowGauges] = useState(true);

  const handleCenterHanoi = () => {
    if (map.current) {
      map.current.flyTo({ center: HANOI_CENTER, zoom: 13.5, essential: true });
    }
  };

  const setupSourcesAndLayers = (m: MapLibreMap) => {
    if (m.getSource('flood-zones')) return;

    // Add GeoJSON sources and layers for Zones polygons
    m.addSource('flood-zones', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });

    m.addLayer({
      id: 'zones-fill',
      type: 'fill',
      source: 'flood-zones',
      paint: {
        'fill-color': [
          'match',
          ['get', 'risk_level'],
          'CRITICAL', '#dc2626',
          'WARNING', '#ea580c',
          'WATCH', '#0284c7',
          '#38bdf8'
        ],
        'fill-opacity': 0.35,
      },
    });

    m.addLayer({
      id: 'zones-outline',
      type: 'line',
      source: 'flood-zones',
      paint: {
        'line-color': [
          'match',
          ['get', 'risk_level'],
          'CRITICAL', '#ef4444',
          'WARNING', '#f97316',
          'WATCH', '#38bdf8',
          '#0ea5e9'
        ],
        'line-width': 2.5,
      },
    });

    // Add Rescue Route Source (Haversine straight line)
    m.addSource('rescue-route', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });

    m.addLayer({
      id: 'rescue-route-glow',
      type: 'line',
      source: 'rescue-route',
      paint: {
        'line-color': '#38bdf8',
        'line-width': 8,
        'line-opacity': 0.45,
        'line-blur': 4,
      },
    });

    m.addLayer({
      id: 'rescue-route-line',
      type: 'line',
      source: 'rescue-route',
      paint: {
        'line-color': '#0284c7',
        'line-width': 3,
        'line-dasharray': [3, 2],
      },
    });

    // Zone click handler
    m.on('click', 'zones-fill', (e) => {
      if (!e.features || !e.features[0]) return;
      const zid = e.features[0].properties?.zone_id;
      const found = activeZones.find((z) => z.zone_id === zid);
      if (found && onSelect) onSelect({ type: 'zone', data: found });
    });

    m.on('mouseenter', 'zones-fill', () => { m.getCanvas().style.cursor = 'pointer'; });
    m.on('mouseleave', 'zones-fill', () => { m.getCanvas().style.cursor = ''; });
  };

  // Initialize MapLibre
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    const m = new MapLibreMap({
      container: mapContainer.current,
      style: BASEMAPS[basemap].style as any,
      center: HANOI_CENTER,
      zoom: 13.5,
      attributionControl: false,
    });

    m.addControl(new NavigationControl({ visualizePitch: true }), 'top-right');
    m.addControl(new AttributionControl({ compact: true }), 'bottom-right');

    m.on('rotate', () => setMapBearing(m.getBearing()));
    m.on('load', () => {
      setMapLoaded(true);
      setupSourcesAndLayers(m);
      m.resize();
    });

    map.current = m;

    const ro = new ResizeObserver(() => {
      if (map.current) {
        map.current.resize();
      }
    });
    ro.observe(mapContainer.current);

    return () => {
      ro.disconnect();
      m.remove();
      map.current = null;
    };
  }, []);

  // Handle Basemap Switch
  const toggleBasemap = () => {
    const next = basemap === 'dark' ? 'voyager' : 'dark';
    setBasemap(next);
    if (map.current) {
      map.current.setStyle(BASEMAPS[next].style as any);
      map.current.once('style.load', () => {
        if (map.current) {
          setupSourcesAndLayers(map.current);
          map.current.resize();
        }
      });
    }
  };

  // Update Zones Polygons GeoJSON
  useEffect(() => {
    if (!mapLoaded || !map.current) return;
    const src = map.current.getSource('flood-zones') as GeoJSONSource | undefined;
    if (!src) return;

    const features = activeZones
      .filter((z) => z.polygon && z.polygon.length > 0 && z.visibility !== 'FOG_OF_WAR')
      .map((z) => ({
        type: 'Feature' as const,
        properties: {
          zone_id: z.zone_id,
          name: z.name,
          risk_level: z.risk_level,
          water_level_cm: z.water_level_cm || 0,
        },
        geometry: {
          type: 'Polygon' as const,
          coordinates: z.polygon,
        },
      }));

    src.setData({ type: 'FeatureCollection', features });
  }, [mapLoaded, activeZones]);

  // Update Rescue Route Line (Haversine straight-line vector)
  useEffect(() => {
    if (!mapLoaded || !map.current) return;
    const src = map.current.getSource('rescue-route') as GeoJSONSource | undefined;
    if (!src) return;

    if (!rescueCandidate) {
      src.setData({ type: 'FeatureCollection', features: [] });
      return;
    }

    const vId = (rescueCandidate as any).vehicle_id || rescueCandidate.machine_id;
    const v = activeVehicles.find((x) => x.vehicle_id === vId || (x as any).machine_id === vId);
    const destZone = activeZones[0];
    if (v && destZone) {
      src.setData({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { kind: 'RESCUE_STRAIGHT_LINE' },
            geometry: {
              type: 'LineString',
              coordinates: [
                [v.current_lng, v.current_lat],
                [destZone.center_lng, destZone.center_lat],
              ],
            },
          },
        ],
      });
    }
  }, [mapLoaded, rescueCandidate, activeVehicles, activeZones]);

  // Update Markers on Map with Crisp Tactical Symbology
  useEffect(() => {
    if (!map.current) return;
    const currentMap = map.current;
    const existing = markersRef.current;
    const touched = new Set<string>();

    // 1. Rescue Vehicles & Boats
    if (showVehicles) activeVehicles.forEach((v) => {
      const vId = v.vehicle_id || (v as any).machine_id || 'PT';
      const key = `veh:${vId}`;
      touched.add(key);

      const prev = headingsRef.current.get(vId) || null;
      const next = nextHeading(prev, v.current_lat, v.current_lng);
      headingsRef.current.set(vId, next);
      const rot = screenRotation(next.heading, mapBearing);

      let m = existing.get(key);
      if (!m) {
        const el = document.createElement('div');
        el.className = 'cursor-pointer transition-transform duration-200 hover:scale-110';
        const isBreakdown = v.status === 'BREAKDOWN';
        const isBoat = v.vehicle_type === 'RESCUE_BOAT';
        el.innerHTML = `
          <div class="relative flex flex-col items-center">
            <div class="h-9 w-9 rounded-xl border-2 flex items-center justify-center shadow-2xl transition-all ${
              isBreakdown
                ? 'bg-red-950 border-red-500 text-red-400 ring-4 ring-red-500/40'
                : 'bg-slate-900 border-cyan-400 text-cyan-300 ring-2 ring-cyan-500/30'
            }">
              <svg class="h-5 w-5 transform transition-transform" style="transform: rotate(${rot}deg);" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                ${isBoat
                  ? '<path d="M2 20a2.4 2.4 0 0 0 2 1 2.4 2.4 0 0 0 2-1 2.4 2.4 0 0 1 2-1 2.4 2.4 0 0 1 2 1 2.4 2.4 0 0 0 2 1 2.4 2.4 0 0 0 2-1 2.4 2.4 0 0 1 2-1 2.4 2.4 0 0 1 2 1 2.4 2.4 0 0 0 2 1 2.4 2.4 0 0 0 2-1M4 17l1.5-6h13l1.5 6H4zM12 4v7M9 7l3-3 3 3"/>'
                  : '<rect x="1" y="3" width="15" height="13"></rect><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"></polygon><circle cx="5.5" cy="18.5" r="2.5"></circle><circle cx="18.5" cy="18.5" r="2.5"></circle>'
                }
              </svg>
            </div>
            <div class="mt-1 whitespace-nowrap rounded-md bg-slate-950 px-2 py-0.5 text-[10px] font-mono font-bold text-slate-100 shadow border border-slate-700 flex items-center gap-1.5">
              <span>${vId}</span>
              <span class="h-1.5 w-1.5 rounded-full ${isBreakdown ? 'bg-red-500 animate-pulse' : 'bg-emerald-400'}"></span>
            </div>
          </div>
        `;
        el.addEventListener('click', () => onSelect?.({ type: 'vehicle', data: v }));
        m = new Marker({ element: el }).setLngLat([v.current_lng, v.current_lat]).addTo(currentMap);
        existing.set(key, m);
      } else {
        m.setLngLat([v.current_lng, v.current_lat]);
      }
    });

    // 2. Flood Incident Reports
    if (showReports) reports.forEach((r) => {
      const key = `rep:${r.report_id}`;
      touched.add(key);

      let m = existing.get(key);
      if (!m) {
        const el = document.createElement('div');
        el.className = 'cursor-pointer hover:scale-110 transition';
        const isUrgent = r.priority === 'URGENT' || r.priority === 'CRITICAL';
        const isResolved = r.status === 'RESOLVED' || r.status === 'CLOSED';
        el.innerHTML = `
          <div class="relative flex flex-col items-center">
            <div class="flex items-center gap-1.5 rounded-xl border px-2 py-1 shadow-2xl transition font-mono font-bold ${
              isResolved
                ? 'bg-slate-900 border-slate-700 text-slate-400'
                : isUrgent
                ? 'bg-red-950 border-red-500 text-red-200 ring-4 ring-red-500/40 animate-pulse'
                : 'bg-amber-950 border-amber-500 text-amber-200 ring-2 ring-amber-500/30'
            }">
              <svg class="h-4 w-4 shrink-0 text-current" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/>
                <line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
              <div class="flex flex-col leading-none">
                <span class="text-[8px] uppercase tracking-wider font-mono opacity-80">${isUrgent ? 'Khẩn cấp' : 'Báo ngập'}</span>
                <span class="font-mono text-[11px] font-extrabold">${r.depth_cm}cm</span>
              </div>
            </div>
            <div class="mt-0.5 whitespace-nowrap rounded bg-slate-950 px-1.5 py-0.5 text-[9px] font-mono text-slate-300 border border-slate-800 shadow">
              #${r.report_id} · ${r.people_affected} người
            </div>
          </div>
        `;
        el.addEventListener('click', () => onSelect?.({ type: 'report', data: r }));
        m = new Marker({ element: el }).setLngLat([r.lng, r.lat]).addTo(currentMap);
        existing.set(key, m);
      } else {
        m.setLngLat([r.lng, r.lat]);
      }
    });

    // 3. Safe Shelters
    if (showShelters) shelters.forEach((sh) => {
      const key = `sh:${sh.shelter_id}`;
      touched.add(key);

      let m = existing.get(key);
      if (!m) {
        const el = document.createElement('div');
        el.className = 'cursor-pointer hover:scale-105 transition';
        el.innerHTML = `
          <div class="flex items-center gap-1.5 rounded-lg bg-emerald-950 border border-emerald-500/80 px-2 py-1 text-emerald-300 shadow-xl text-xs font-mono font-bold">
            <svg class="h-4 w-4 text-emerald-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
              <polyline points="9 22 9 12 15 12 15 22"/>
            </svg>
            <div class="flex flex-col leading-tight">
              <span class="text-[8px] uppercase tracking-wider text-emerald-400">Điểm trú ẩn</span>
              <span class="text-[10px] text-white font-extrabold">${sh.occupancy}/${sh.capacity} chỗ</span>
            </div>
          </div>
        `;
        el.addEventListener('click', () => onSelect?.({ type: 'shelter', data: sh }));
        m = new Marker({ element: el }).setLngLat([sh.lng, sh.lat]).addTo(currentMap);
        existing.set(key, m);
      } else {
        m.setLngLat([sh.lng, sh.lat]);
      }
    });

    // 4. Gauge Stations
    if (showGauges) gauges.forEach((g) => {
      const key = `g:${g.station_id}`;
      touched.add(key);

      let m = existing.get(key);
      if (!m) {
        const el = document.createElement('div');
        el.className = 'cursor-pointer hover:scale-105 transition';
        const isWarn = g.alert_state === 'WARNING' || g.alert_state === 'CRITICAL';
        el.innerHTML = `
          <div class="flex items-center gap-1.5 rounded-lg bg-slate-950 border px-2 py-1 shadow-xl text-xs font-mono font-bold ${
            isWarn ? 'border-red-500 text-red-300 bg-red-950/80 ring-2 ring-red-500/30' : 'border-cyan-500/70 text-cyan-300'
          }">
            <svg class="h-4 w-4 text-cyan-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
            </svg>
            <div class="flex flex-col leading-tight">
              <span class="text-[8px] uppercase tracking-wider text-slate-400">${g.station_id}</span>
              <span class="text-[10px] text-white font-extrabold">${g.level_cm ?? '--'}cm</span>
            </div>
          </div>
        `;
        el.addEventListener('click', () => onSelect?.({ type: 'gauge', data: g }));
        m = new Marker({ element: el }).setLngLat([g.lng, g.lat]).addTo(currentMap);
        existing.set(key, m);
      } else {
        m.setLngLat([g.lng, g.lat]);
      }
    });

    // Cleanup stale markers
    existing.forEach((marker, k) => {
      if (!touched.has(k)) {
        marker.remove();
        existing.delete(k);
      }
    });
  }, [activeVehicles, reports, shelters, gauges, mapBearing, showVehicles, showReports, showShelters, showGauges]);

  return (
    <div className={`relative w-full overflow-hidden rounded-2xl border border-slate-800 shadow-2xl bg-slate-950 ${heightClass} ${className} ${isFullscreen ? 'fixed inset-0 z-50 rounded-none h-screen min-h-screen' : ''}`}>
      {/* Map Container - Zero Hacky CSS Filter */}
      <div 
        ref={mapContainer} 
        className="h-full w-full bg-slate-950" 
      />

      {/* Top Left HUD: Map Info & Controls */}
      <div className="absolute top-3 left-3 z-10 max-w-sm sm:max-w-md rounded-xl bg-slate-950/95 backdrop-blur-md p-3 text-xs text-slate-200 border border-slate-800 shadow-2xl space-y-2">
        <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-2">
          <div className="flex items-center gap-2">
            <span className="flex h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />
            <span className="font-bold tracking-tight text-white uppercase text-[11px]">Bản đồ Tác chiến Thủy văn</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={toggleBasemap}
              className="px-2 py-0.5 rounded-md bg-slate-900 hover:bg-slate-800 text-[10px] font-mono text-cyan-300 border border-slate-700 transition"
              title="Đổi lớp bản đồ nền"
            >
              {basemap === 'dark' ? '☀️ Ngày / Ảnh vệ tinh' : '🌙 Tác chiến Vector'}
            </button>
            <button
              type="button"
              onClick={handleCenterHanoi}
              className="px-2 py-0.5 rounded-md bg-sky-900 hover:bg-sky-800 text-[10px] font-bold text-sky-100 border border-sky-700 transition flex items-center gap-1"
              title="Căn tâm Hà Nội"
            >
              <Crosshair className="h-3 w-3" />
              <span>Hà Nội</span>
            </button>
            <button
              type="button"
              onClick={() => setIsFullscreen(!isFullscreen)}
              className="px-1.5 py-0.5 rounded-md bg-slate-900 hover:bg-slate-800 text-slate-300 transition border border-slate-700"
              title={isFullscreen ? 'Thu nhỏ' : 'Toàn màn hình'}
            >
              {isFullscreen ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
            </button>
          </div>
        </div>

        {/* Tactical Layer Filter Toggles */}
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <button
            type="button"
            onClick={() => setShowReports(!showReports)}
            className={`px-2 py-1 rounded-md text-[10px] font-mono font-bold transition flex items-center gap-1 border ${
              showReports
                ? 'bg-red-950 text-red-300 border-red-500/60 shadow-inner'
                : 'bg-slate-900 text-slate-500 border-slate-800'
            }`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-red-400"></span>
            <span>Tin ngập ({reports.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setShowVehicles(!showVehicles)}
            className={`px-2 py-1 rounded-md text-[10px] font-mono font-bold transition flex items-center gap-1 border ${
              showVehicles
                ? 'bg-sky-950 text-sky-300 border-sky-500/60 shadow-inner'
                : 'bg-slate-900 text-slate-500 border-slate-800'
            }`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-sky-400"></span>
            <span>Phương tiện ({activeVehicles.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setShowShelters(!showShelters)}
            className={`px-2 py-1 rounded-md text-[10px] font-mono font-bold transition flex items-center gap-1 border ${
              showShelters
                ? 'bg-emerald-950 text-emerald-300 border-emerald-500/60 shadow-inner'
                : 'bg-slate-900 text-slate-500 border-slate-800'
            }`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400"></span>
            <span>Điểm trú ({shelters.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setShowGauges(!showGauges)}
            className={`px-2 py-1 rounded-md text-[10px] font-mono font-bold transition flex items-center gap-1 border ${
              showGauges
                ? 'bg-blue-950 text-blue-300 border-blue-500/60 shadow-inner'
                : 'bg-slate-900 text-slate-500 border-slate-800'
            }`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-400"></span>
            <span>Trạm đo ({gauges.length})</span>
          </button>
        </div>
      </div>

      {/* Live Event Ticker in Bottom Corner */}
      <MapEventTicker
        machines={activeVehicles as any}
        rescueCandidate={rescueCandidate as any}
      />
    </div>
  );
};
