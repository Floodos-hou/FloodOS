// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Map as MapLibreMap, Marker, NavigationControl, AttributionControl, LngLatBounds, setWorkerUrl, type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { Maximize, TriangleAlert } from 'lucide-react';
import type { FloodZone, RescueVehicle, FloodReport, GaugeStation, SafeShelter } from '../../types';
import type { LiveFleetInfo } from '../../hooks/useLiveFleet';
import type { MapSelection } from './MapDetailPanel';
setWorkerUrl(maplibreWorkerUrl);

export interface MapRoute {
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
  label: string;
}

interface TacticalMapProps {
  zones?: FloodZone[];
  vehicles?: RescueVehicle[];
  reports?: FloodReport[];
  gauges?: GaugeStation[];
  shelters?: SafeShelter[];
  /** straight line from a replacement vehicle to the impacted job (never a road route) */
  route?: MapRoute | null;
  trails?: Record<string, [number, number][]>;
  live?: LiveFleetInfo;
  /** `type:id` of the object shown in the side panel */
  selectedKey?: string | null;
  onSelect?: (selection: MapSelection) => void;
  className?: string;
  heightClass?: string;
}

const DEFAULT_CENTER: [number, number] = [105.845, 20.978];

/** Real OpenStreetMap raster, desaturated so the case markers carry the colour. No hand-drawn geography. */
const STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    },
  },
  layers: [
    { id: 'paper', type: 'background', paint: { 'background-color': '#ece8dc' } },
    { id: 'osm', type: 'raster', source: 'osm', paint: { 'raster-saturation': -0.55, 'raster-contrast': -0.05, 'raster-brightness-max': 0.95 } },
  ],
};

const RISK_COLOR = ['match', ['get', 'risk_level'], 'CRITICAL', '#b73220', 'WARNING', '#c85f17', 'WATCH', '#a87908', '#2f7d4f'];

const ICON: Record<string, string> = {
  report: '<path d="M12 3 2.5 20h19L12 3z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><path d="M12 10v4M12 17.2v.1" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  boat: '<path d="M3 17h18l-2 4H5l-2-4zM7 17V9h10v8M12 4v5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>',
  truck: '<path d="M2 6h11v10H2zM13 9h5l3 3v4h-8z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="7" cy="18" r="1.8" fill="currentColor"/><circle cx="17" cy="18" r="1.8" fill="currentColor"/>',
  pump: '<path d="M12 3c3 4 5 6.5 5 9.5a5 5 0 0 1-10 0C7 9.5 9 7 12 3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  shelter: '<path d="M3 11 12 4l9 7M5 10v10h14V10" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  gauge: '<path d="M9 3v18M9 6h5M9 10h3M9 14h5M9 18h3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
};

const vehicleGlyph = (t: string) => (t === 'RESCUE_BOAT' ? 'boat' : t === 'MOBILE_PUMP' ? 'pump' : 'truck');

const CLOSED_STATUSES = ['RESOLVED', 'REJECTED', 'CANCELLED'];

const reportColor = (r: FloodReport): string => {
  if (CLOSED_STATUSES.includes(r.status)) return 'var(--color-ink-3)';
  if (r.priority === 'URGENT' || r.priority === 'CRITICAL') return 'var(--color-crit)';
  if (r.status === 'RECEIVED') return 'var(--color-watch)';
  return 'var(--color-warn)';
};

const gaugeColor = (g: GaugeStation): string => {
  if (g.alert_state === 'CRITICAL') return 'var(--color-crit)';
  if (g.alert_state === 'WARNING') return 'var(--color-warn)';
  if (g.alert_state === 'WATCH') return 'var(--color-watch)';
  return g.level_cm == null ? 'var(--color-ink-3)' : 'var(--color-safe)';
};

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c]);

export const TacticalMap: React.FC<TacticalMapProps> = ({
  zones = [], vehicles = [], reports = [], gauges = [], shelters = [],
  route = null, trails = {}, live, selectedKey = null, onSelect,
  className = '', heightClass = 'h-full min-h-[420px]',
}) => {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markers = useRef<Map<string, Marker>>(new Map());
  const zonesRef = useRef(zones);
  const onSelectRef = useRef(onSelect);
  const fitted = useRef(false);
  const [loaded, setLoaded] = useState(false);
  const [tilesFailed, setTilesFailed] = useState(false);
  const [layers, setLayers] = useState({ reports: true, vehicles: true, shelters: true, gauges: true, zones: true });

  useEffect(() => {
    zonesRef.current = zones;
    onSelectRef.current = onSelect;
  });

  useEffect(() => {
    if (!container.current || mapRef.current) return;
    const m = new MapLibreMap({ container: container.current, style: STYLE, center: DEFAULT_CENTER, zoom: 12.5, attributionControl: false });
    m.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    m.addControl(new AttributionControl({ compact: true }), 'bottom-right');
    m.on('error', (e) => { if ((e as { sourceId?: string }).sourceId === 'osm') setTilesFailed(true); });
    m.on('data', (e) => {
      const ev = e as { sourceId?: string; tile?: unknown };
      if (ev.sourceId === 'osm' && ev.tile) setTilesFailed(false);
    });
    m.on('load', () => {
      m.addSource('zones', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      m.addLayer({ id: 'zones-fill', type: 'fill', source: 'zones', paint: { 'fill-color': RISK_COLOR as never, 'fill-opacity': 0.2 } });
      m.addLayer({ id: 'zones-line', type: 'line', source: 'zones', paint: { 'line-color': RISK_COLOR as never, 'line-width': 2, 'line-dasharray': [3, 2] } });
      m.addSource('trails', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      m.addLayer({ id: 'trails', type: 'line', source: 'trails', paint: { 'line-color': '#0e5a7a', 'line-width': 2, 'line-opacity': 0.6 } });
      m.addSource('route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      m.addLayer({ id: 'route', type: 'line', source: 'route', paint: { 'line-color': '#14262e', 'line-width': 3, 'line-dasharray': [1.5, 1.5] } });
      m.on('click', 'zones-fill', (e) => {
        const id = e.features?.[0]?.properties?.zone_id;
        const z = zonesRef.current.find((x) => x.zone_id === id);
        if (z) onSelectRef.current?.({ type: 'zone', data: z });
      });
      m.on('mouseenter', 'zones-fill', () => { m.getCanvas().style.cursor = 'pointer'; });
      m.on('mouseleave', 'zones-fill', () => { m.getCanvas().style.cursor = ''; });
      setLoaded(true);
    });
    mapRef.current = m;
    const ro = new ResizeObserver(() => m.resize());
    ro.observe(container.current);
    const markerStore = markers.current;
    return () => { ro.disconnect(); markerStore.clear(); m.remove(); mapRef.current = null; };
  }, []);

  // zone polygons (seed polygons; the legend says so)
  useEffect(() => {
    const src = loaded ? (mapRef.current?.getSource('zones') as GeoJSONSource | undefined) : undefined;
    if (!src) return;
    src.setData({
      type: 'FeatureCollection',
      features: layers.zones
        ? zones.filter((z) => z.polygon?.length && z.visibility !== 'FOG_OF_WAR').map((z) => ({
            type: 'Feature' as const,
            properties: { zone_id: z.zone_id, risk_level: z.risk_level },
            geometry: { type: 'Polygon' as const, coordinates: z.polygon },
          }))
        : [],
    });
  }, [loaded, zones, layers.zones]);

  // trails: only positions actually received from the digital twin
  useEffect(() => {
    const src = loaded ? (mapRef.current?.getSource('trails') as GeoJSONSource | undefined) : undefined;
    if (!src) return;
    src.setData({
      type: 'FeatureCollection',
      features: Object.entries(trails).filter(([, pts]) => pts.length > 1).map(([id, pts]) => ({
        type: 'Feature' as const, properties: { id }, geometry: { type: 'LineString' as const, coordinates: pts },
      })),
    });
  }, [loaded, trails]);

  useEffect(() => {
    const src = loaded ? (mapRef.current?.getSource('route') as GeoJSONSource | undefined) : undefined;
    if (!src) return;
    src.setData({
      type: 'FeatureCollection',
      features: route ? [{
        type: 'Feature' as const, properties: { label: route.label },
        geometry: { type: 'LineString' as const, coordinates: [[route.from.lng, route.from.lat], [route.to.lng, route.to.lat]] },
      }] : [],
    });
  }, [loaded, route]);

  const points = useMemo(() => {
    const pts: { lng: number; lat: number }[] = [];
    reports.forEach((r) => pts.push({ lng: r.lng, lat: r.lat }));
    vehicles.forEach((v) => pts.push({ lng: v.current_lng, lat: v.current_lat }));
    shelters.forEach((s) => pts.push({ lng: s.lng, lat: s.lat }));
    gauges.forEach((g) => pts.push({ lng: g.lng, lat: g.lat }));
    return pts.filter((p) => Number.isFinite(p.lng) && Number.isFinite(p.lat));
  }, [reports, vehicles, shelters, gauges]);

  const fitAll = React.useCallback(() => {
    const m = mapRef.current;
    if (!m || points.length === 0) return;
    const b = new LngLatBounds();
    points.forEach((p) => b.extend([p.lng, p.lat]));
    m.fitBounds(b, { padding: 70, maxZoom: 15, duration: 600 });
  }, [points]);

  useEffect(() => {
    if (loaded && !fitted.current && points.length > 0) { fitted.current = true; fitAll(); }
  }, [loaded, points.length, fitAll]);

  // DOM markers are updated in place on every render so colour and state never go stale
  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;
    const touched = new Set<string>();
    const upsert = (key: string, lng: number, lat: number, cls: string, color: string, glyph: string, label: string, sel: MapSelection) => {
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
      touched.add(key);
      let mk = markers.current.get(key);
      if (!mk) {
        mk = new Marker({ element: document.createElement('div') }).setLngLat([lng, lat]).addTo(m);
        markers.current.set(key, mk);
      } else {
        mk.setLngLat([lng, lat]);
      }
      const el = mk.getElement();
      el.className = `fo-pin ${cls}${selectedKey === key ? ' is-selected' : ''}`;
      el.style.setProperty('--pin', color);
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', label);
      el.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[glyph]}</svg><span class="fo-pin-label">${esc(label)}</span>`;
      el.onclick = () => onSelectRef.current?.(sel);
    };

    if (layers.shelters) shelters.forEach((s) => upsert(`shelter:${s.shelter_id}`, s.lng, s.lat, 'fo-square', 'var(--color-safe)', 'shelter', `${s.name} · ${s.occupancy}/${s.capacity} chỗ`, { type: 'shelter', data: s }));
    if (layers.gauges) gauges.forEach((g) => upsert(`gauge:${g.station_id}`, g.lng, g.lat, 'fo-diamond', gaugeColor(g), 'gauge', `${g.name}${g.level_cm != null ? ` · ${g.level_cm} cm` : ' · chưa có số liệu'}`, { type: 'gauge', data: g }));
    if (layers.vehicles) {
      vehicles.forEach((v) => {
        const broken = v.status === 'BREAKDOWN';
        upsert(`vehicle:${v.vehicle_id}`, v.current_lng, v.current_lat, broken ? 'is-pulse' : '', broken ? 'var(--color-crit)' : 'var(--color-river)', vehicleGlyph(v.vehicle_type), `${v.name}${broken ? ' · hỏng' : ''}`, { type: 'vehicle', data: v });
      });
    }
    if (layers.reports) {
      reports.forEach((r) => {
        const closed = CLOSED_STATUSES.includes(r.status);
        const urgent = (r.priority === 'URGENT' || r.priority === 'CRITICAL') && !closed;
        upsert(`report:${r.report_id}`, r.lng, r.lat, `${urgent ? 'is-pulse' : ''} ${closed ? 'is-dim' : ''}`, reportColor(r), 'report', `${r.report_id} · ${r.depth_cm} cm`, { type: 'report', data: r });
      });
    }

    markers.current.forEach((mk, key) => { if (!touched.has(key)) { mk.remove(); markers.current.delete(key); } });
  }, [loaded, vehicles, reports, shelters, gauges, layers, selectedKey]);

  const toggle = (k: keyof typeof layers) => setLayers((s) => ({ ...s, [k]: !s[k] }));
  const items: { k: keyof typeof layers; label: string; n: number; color: string }[] = [
    { k: 'reports', label: 'Tin báo', n: reports.length, color: 'bg-crit' },
    { k: 'vehicles', label: 'Phương tiện', n: vehicles.length, color: 'bg-river' },
    { k: 'shelters', label: 'Điểm trú', n: shelters.length, color: 'bg-safe' },
    { k: 'gauges', label: 'Trạm đo', n: gauges.length, color: 'bg-watch' },
    { k: 'zones', label: 'Vùng giám sát', n: zones.length, color: 'bg-warn' },
  ];

  return (
    <div className={`relative overflow-hidden bg-paper ${heightClass} ${className}`}>
      {/* inline style: maplibre-gl.css sets .maplibregl-map to position:relative and would beat a utility class */}
      <div ref={container} style={{ position: 'absolute', inset: 0 }} />

      <div className="absolute left-3 top-3 z-10 flex max-w-[calc(100%-4rem)] flex-wrap gap-1.5">
        {items.map((it) => (
          <button
            key={it.k}
            type="button"
            aria-pressed={layers[it.k]}
            onClick={() => toggle(it.k)}
            className={`flex items-center gap-1.5 rounded border px-2 py-1 text-xs font-semibold shadow-sm ${layers[it.k] ? 'border-line-2 bg-sheet text-ink' : 'border-line bg-sheet/70 text-ink-3'}`}
          >
            <span className={`h-2 w-2 rounded-full ${it.color} ${layers[it.k] ? '' : 'opacity-30'}`} />
            {it.label} <span className="num text-ink-3">{it.n}</span>
          </button>
        ))}
      </div>

      <button type="button" onClick={fitAll} title="Căn khung theo dữ liệu" aria-label="Căn khung theo dữ liệu" className="btn absolute right-3 top-[88px] z-10 !min-h-8 !px-2">
        <Maximize className="h-4 w-4" aria-hidden="true" />
      </button>

      <div className="absolute bottom-3 left-3 z-10 max-w-[75%] rounded border border-line bg-sheet/95 px-2 py-1 text-[11px] text-ink-2 shadow-sm">
        Vùng giám sát: dữ liệu thí điểm.
        {live?.enabled && !live.connected && ' Mất kết nối bản sao số, vị trí xe có thể cũ.'}
        {route && ` Nét đứt: đường chim bay ${route.label}.`}
      </div>

      {tilesFailed && (
        <div role="status" className="absolute inset-x-3 bottom-16 z-10 mx-auto flex max-w-md items-center gap-2 rounded border border-warn bg-warn-soft px-3 py-2 text-xs text-ink">
          <TriangleAlert className="h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
          Không tải được bản đồ nền (OpenStreetMap). Các điểm dữ liệu vẫn đúng vị trí nhưng không có nền đường.
        </div>
      )}
    </div>
  );
};
