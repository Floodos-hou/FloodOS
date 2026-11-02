// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Map as MapLibreMap, Marker, NavigationControl, AttributionControl, setWorkerUrl, type GeoJSONSource } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { LiveFleetPanel } from './LiveFleetPanel';
import { MapEventTicker } from './MapEventTicker';
import { nextHeading, screenRotation } from '../../utils/fleetInsights';
import type { LiveFleetInfo } from '../../hooks/useLiveFleet';
setWorkerUrl(maplibreWorkerUrl);
import type { FloodZone, RescueVehicle, FloodReport, DispatchOrder, GaugeStation, SafeShelter, CandidateRescueOption, UserRole } from '../../types';
import { EyeOff, Video, Compass, MapPin, AlertTriangle, ShieldCheck, Waves, Home, Ship } from 'lucide-react';
import { FloodOsLogo } from '../common/FloodOsLogo';
import { zoneRisk, vehicleStatus, needType } from '../../utils/labels';
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
  // Legacy compatibility props for twin3d
  fields?: any[];
  machines?: any[];
  assignments?: any[];
}

// Center of pilot flood-response zone in Hanoi
const HANOI_CENTER: [number, number] = [105.8710, 20.9660];

const OSM_STYLE: any = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '&copy; OpenStreetMap Contributors',
      maxzoom: 19,
    },
  },
  layers: [
    {
      id: 'osm-tiles',
      type: 'raster',
      source: 'osm',
      minzoom: 0,
      maxzoom: 19,
    },
  ],
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
}) => {
  // Normalize lists between native FloodOS and legacy compatibility props
  const activeZones: FloodZone[] = zones.length > 0 ? zones : (fields as any[]) || [];
  const activeVehicles: RescueVehicle[] = vehicles.length > 0 ? vehicles : (machines as any[]) || [];
  const activeOrders: DispatchOrder[] = orders.length > 0 ? orders : (assignments as any[]) || [];

  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Map<string, Marker>>(new Map());
  const headingsRef = useRef<Map<string, { lat: number; lng: number; heading: number }>>(new Map());
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapBearing, setMapBearing] = useState(0);

  // Initialize MapLibre
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    const m = new MapLibreMap({
      container: mapContainer.current,
      style: OSM_STYLE,
      center: HANOI_CENTER,
      zoom: 13.8,
      attributionControl: false,
    });

    m.addControl(new NavigationControl({ visualizePitch: true }), 'top-right');
    m.addControl(new AttributionControl({ compact: true }), 'bottom-right');

    m.on('rotate', () => setMapBearing(m.getBearing()));
    m.on('load', () => {
      setMapLoaded(true);

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
            'CRITICAL', '#ef4444',
            'WARNING', '#f97316',
            'WATCH', '#0284c7',
            '#38bdf8'
          ],
          'fill-opacity': 0.28,
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
            'CRITICAL', '#dc2626',
            'WARNING', '#ea580c',
            'WATCH', '#0369a1',
            '#0284c7'
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
          'line-opacity': 0.4,
          'line-blur': 4,
        },
      });

      m.addLayer({
        id: 'rescue-route-line',
        type: 'line',
        source: 'rescue-route',
        paint: {
          'line-color': '#0284c7',
          'line-width': 3.5,
          'line-dasharray': [2, 2],
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
    });

    map.current = m;

    return () => {
      m.remove();
      map.current = null;
    };
  }, []);

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

    const v = activeVehicles.find((x) => x.vehicle_id === rescueCandidate.vehicle_id);
    const destZone = activeZones[0]; // destination zone
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

  // Update Markers on Map (Vehicles, Reports, Shelters, Gauges)
  useEffect(() => {
    if (!map.current) return;
    const currentMap = map.current;
    const existing = markersRef.current;
    const touched = new Set<string>();

    // 1. Vehicles Markers
    activeVehicles.forEach((v) => {
      const key = `veh:${v.vehicle_id}`;
      touched.add(key);

      const prev = headingsRef.current.get(v.vehicle_id) || null;
      const next = nextHeading(prev, v.current_lat, v.current_lng);
      headingsRef.current.set(v.vehicle_id, next);
      const rot = screenRotation(next.heading, mapBearing);

      let m = existing.get(key);
      if (!m) {
        const el = document.createElement('div');
        el.className = 'cursor-pointer transition-transform duration-300';
        el.innerHTML = `
          <div class="relative flex items-center justify-center">
            <div class="h-10 w-10 rounded-full border-2 border-white bg-slate-900 shadow-lg flex items-center justify-center text-lg ${
              v.status === 'BREAKDOWN' ? 'ring-4 ring-red-500 animate-pulse bg-red-950' : 'ring-2 ring-sky-400'
            }">
              <span>${v.vehicle_type === 'RESCUE_BOAT' ? '🚤' : v.vehicle_type === 'MOBILE_PUMP' ? '💧' : '🚛'}</span>
            </div>
            <div class="absolute -bottom-5 whitespace-nowrap rounded-md bg-slate-900/90 px-1.5 py-0.5 text-[10px] font-bold text-white shadow border border-slate-700">
              ${v.name}
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

    // 2. Flood Reports Markers
    reports.forEach((r) => {
      const key = `rep:${r.report_id}`;
      touched.add(key);

      let m = existing.get(key);
      if (!m) {
        const el = document.createElement('div');
        el.className = 'cursor-pointer transition-transform duration-200 hover:scale-110';
        const isUrgent = r.priority === 'URGENT';
        const isResolved = r.status === 'RESOLVED';
        el.innerHTML = `
          <div class="relative flex items-center justify-center">
            <div class="h-9 w-9 rounded-2xl border-2 border-white shadow-xl flex items-center justify-center text-sm ${
              isResolved ? 'bg-emerald-600' : isUrgent ? 'bg-red-600 ring-4 ring-red-300 animate-bounce' : 'bg-amber-500 ring-2 ring-amber-200'
            }">
              <span>${r.need_type === 'EVACUATION' ? '🚨' : r.need_type === 'MEDICAL' ? '🚑' : r.need_type === 'PUMPING' ? '💧' : '🍞'}</span>
            </div>
            <div class="absolute -top-5 whitespace-nowrap rounded-md bg-slate-900/90 px-1.5 py-0.5 text-[9px] font-bold text-white shadow">
              ${r.report_id} · ${r.depth_cm}cm
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

    // 3. Shelters Markers
    shelters.forEach((sh) => {
      const key = `sh:${sh.shelter_id}`;
      touched.add(key);

      let m = existing.get(key);
      if (!m) {
        const el = document.createElement('div');
        el.className = 'cursor-pointer hover:scale-105 transition';
        el.innerHTML = `
          <div class="flex items-center gap-1 rounded-xl bg-emerald-800 border-2 border-white px-2 py-1 text-white shadow-lg text-xs font-bold">
            <span>🏠</span>
            <span class="text-[10px]">${sh.occupancy}/${sh.capacity}</span>
          </div>
        `;
        el.addEventListener('click', () => onSelect?.({ type: 'shelter', data: sh }));
        m = new Marker({ element: el }).setLngLat([sh.lng, sh.lat]).addTo(currentMap);
        existing.set(key, m);
      } else {
        m.setLngLat([sh.lng, sh.lat]);
      }
    });

    // 4. Gauge Stations Markers
    gauges.forEach((g) => {
      const key = `g:${g.station_id}`;
      touched.add(key);

      let m = existing.get(key);
      if (!m) {
        const el = document.createElement('div');
        el.className = 'cursor-pointer hover:scale-105 transition';
        const isWarn = g.alert_state === 'WARNING' || g.alert_state === 'CRITICAL';
        el.innerHTML = `
          <div class="flex items-center gap-1 rounded-xl border-2 border-white px-2 py-1 text-white shadow-lg text-xs font-bold ${
            isWarn ? 'bg-red-700 animate-pulse' : 'bg-sky-800'
          }">
            <span>🌊</span>
            <span class="text-[10px]">${g.station_id}: ${g.level_cm ?? '--'}cm</span>
          </div>
        `;
        el.addEventListener('click', () => onSelect?.({ type: 'gauge', data: g }));
        m = new Marker({ element: el }).setLngLat([g.lng, g.lat]).addTo(currentMap);
        existing.set(key, m);
      } else {
        m.setLngLat([g.lng, g.lat]);
      }
    });

    // Remove old markers
    existing.forEach((marker, k) => {
      if (!touched.has(k)) {
        marker.remove();
        existing.delete(k);
      }
    });
  }, [activeVehicles, reports, shelters, gauges, mapBearing]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-3xl border border-slate-200 shadow-xl bg-slate-900">
      {/* Map Container */}
      <div ref={mapContainer} className="h-full w-full" />

      {/* Transparent Disclaimer Banner */}
      <div className="absolute top-3 left-3 z-10 max-w-sm rounded-2xl bg-slate-900/90 backdrop-blur-md p-3 text-xs text-slate-200 border border-slate-700 shadow-xl">
        <div className="flex items-center gap-1.5 font-bold text-cyan-300 mb-1">
          <Waves className="h-4 w-4" />
          <span>Bản đồ Tác chiến Ngập lụt (Hà Nội)</span>
        </div>
        <p className="text-[11px] leading-relaxed text-slate-300">
          Vị trí xe phát từ simulator tua nhanh; tuyến chi viện là đường chim bay (Haversine), không phải tuyến đường thực tế.
        </p>
      </div>

      {/* Live Event Ticker in Corner */}
      <MapEventTicker
        machines={activeVehicles as any}
        rescueCandidate={rescueCandidate as any}
      />
    </div>
  );
};
