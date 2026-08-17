// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import React, { useEffect, useMemo, useRef } from 'react';
import { LngLatBounds, Map as MapLibreMap, Marker, NavigationControl, AttributionControl, setWorkerUrl, type GeoJSONSource } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import type { DispatchAssignment, FieldPlot, HarvesterMachine } from '../../../web/src/types';
import { enu, geoOfEnu, longEdgeAxis, ringToLocal, splitByFraction, type Origin } from '../geo/geo';
import { cropState } from '../scene/crop';
import { MachineTrack } from '../scene/tracker';
import { fieldColor } from '../logic/tracking';
import { bearingDeg } from '../geo/geo';

setWorkerUrl(maplibreWorkerUrl);

export type MapPick = { type: 'field' | 'machine'; id: string };

interface Props {
  fields: FieldPlot[];
  machines: HarvesterMachine[];
  assignments: DispatchAssignment[];
  selected: MapPick | null;
  /** bump to re-frame the map on the fields */
  frameToken: number;
  onPick: (p: MapPick | null) => void;
}

const HARVESTER_SVG = `
<svg viewBox="0 0 48 64" width="40" height="54" aria-hidden="true">
  <rect x="2" y="2" width="44" height="12" rx="3" fill="#f0a020" stroke="#8a5a00" stroke-width="1.5"/>
  <rect x="6" y="5" width="36" height="3" rx="1.5" fill="#7a4a10"/>
  <rect x="4" y="18" width="9" height="40" rx="4" fill="#2b2f33"/>
  <rect x="35" y="18" width="9" height="40" rx="4" fill="#2b2f33"/>
  <rect x="11" y="16" width="26" height="44" rx="5" fill="#2f9a43" stroke="#14602a" stroke-width="1.5"/>
  <rect x="15" y="20" width="18" height="14" rx="3" fill="#bfe4f6" stroke="#4d7f99" stroke-width="1.2"/>
  <rect x="14" y="38" width="20" height="18" rx="3" fill="#f0a020" opacity=".95"/>
  <rect x="36" y="26" width="6" height="30" rx="2" fill="#f0a020" stroke="#8a5a00" stroke-width="1"/>
</svg>`;

const fieldFeatures = (origin: Origin, fields: FieldPlot[]) => {
  const feats: unknown[] = [];
  for (const f of fields) {
    const ring = f.visibility !== 'FOG_OF_WAR' ? f.polygon?.[0] : undefined;
    if (!ring || ring.length < 4) continue;
    const crop = cropState(f.readiness_status, f.harvest_progress_pct);
    const pts = ringToLocal(origin, ring);
    const { low, high } = splitByFraction(pts, crop.harvested, longEdgeAxis(pts));
    const toRing = (poly: typeof pts) => {
      const r = poly.map((p) => { const g = geoOfEnu(origin, p.x, p.z); return [g.lng, g.lat]; });
      r.push(r[0]); return r;
    };
    const base = { fid: f.field_id, blocked: crop.blocked ? 1 : 0 };
    if (high.length >= 3) feats.push({ type: 'Feature', properties: { ...base, part: 'standing', color: fieldColor(f.readiness_status, crop.blocked) }, geometry: { type: 'Polygon', coordinates: [toRing(high)] } });
    if (low.length >= 3) feats.push({ type: 'Feature', properties: { ...base, part: 'done', color: '#cdbf94' }, geometry: { type: 'Polygon', coordinates: [toRing(low)] } });
  }
  return { type: 'FeatureCollection' as const, features: feats };
};

interface MachineEntry { track: MachineTrack; marker: Marker; body: HTMLElement; tag: HTMLElement; data: HarvesterMachine }

/** The main screen: a flat map in the style of a delivery-tracking app. Fields are coloured by crop stage, harvesters move live. */
export const FlatMap: React.FC<Props> = ({ fields, machines, assignments, selected, frameToken, onPick }) => {
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const loaded = useRef(false);
  const origin = useRef<Origin | null>(null);
  const entries = useRef(new Map<string, MachineEntry>());
  const labels = useRef(new Map<string, Marker>());
  const cb = useRef({ onPick });
  cb.current = { onPick };
  const latest = useRef({ fields, machines, assignments, selected });
  latest.current = { fields, machines, assignments, selected };

  const located = useMemo(() => fields.filter((f) => f.visibility !== 'FOG_OF_WAR' && (f.polygon?.[0]?.length ?? 0) >= 4), [fields]);

  // map creation
  useEffect(() => {
    if (!host.current) return;
    const map = new MapLibreMap({
      container: host.current,
      attributionControl: false,
      style: {
        version: 8,
        sources: {
          base: { type: 'raster', tiles: ['https://tiles.maps.eox.at/wmts/1.0.0/osm_3857/default/g/{z}/{y}/{x}.jpg'], tileSize: 256, maxzoom: 17 },
        },
        layers: [
          { id: 'bg', type: 'background', paint: { 'background-color': '#eef1e6' } },
          { id: 'base', type: 'raster', source: 'base' },
        ],
      },
      center: [105.57, 10.07], zoom: 13.5,
    });
    mapRef.current = map;
    (window as unknown as { __flat?: () => unknown }).__flat = () => ({ zoom: map.getZoom(), dots: map.queryRenderedFeatures({ layers: ['fields-dot'] }).length, fills: map.queryRenderedFeatures({ layers: ['fields-fill'] }).length, layers: map.getStyle().layers.map((l) => l.id), pts: (map.getSource('field-pts') as unknown as { _data?: { features?: unknown[] } })?._data?.features?.length });
    map.addControl(new NavigationControl({ showCompass: true }), 'bottom-right');
    map.addControl(new AttributionControl({ compact: true, customAttribution: '© OpenStreetMap contributors, tiles © EOX IT Services GmbH' }), 'bottom-left');
    map.on('load', () => {
      loaded.current = true;
      map.addSource('fields', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addSource('field-pts', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'fields-fill', type: 'fill', source: 'fields', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.72 } });
      // at wide zoom a 2 ha field is a few pixels: draw it as a coloured dot so every field stays visible
      map.addLayer({ id: 'fields-dot', type: 'circle', source: 'field-pts', maxzoom: 15.6, paint: { 'circle-radius': 9, 'circle-color': ['get', 'color'], 'circle-stroke-width': 2, 'circle-stroke-color': ['case', ['==', ['get', 'blocked'], 1], '#c62828', '#ffffff'] } });
      map.on('click', 'fields-dot', (e) => { const fid = e.features?.[0]?.properties?.fid as string | undefined; if (fid) cb.current.onPick({ type: 'field', id: fid }); });
      map.addLayer({ id: 'fields-line', type: 'line', source: 'fields', paint: { 'line-color': ['case', ['==', ['get', 'blocked'], 1], '#c62828', '#5b4a1a'], 'line-width': 1.4 } });
      map.addLayer({ id: 'fields-sel', type: 'line', source: 'fields', filter: ['==', ['get', 'fid'], ''], paint: { 'line-color': '#111', 'line-width': 3.5 } });
      map.on('click', 'fields-fill', (e) => {
        const fid = e.features?.[0]?.properties?.fid as string | undefined;
        if (fid) cb.current.onPick({ type: 'field', id: fid });
      });
      map.on('click', (e) => { if (!map.queryRenderedFeatures(e.point, { layers: ['fields-fill', 'fields-dot'] }).length) cb.current.onPick(null); });
      for (const l of ['fields-fill', 'fields-dot']) {
        map.on('mouseenter', l, () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', l, () => { map.getCanvas().style.cursor = ''; });
      }
      syncAll();
      frame();
    });
    let raf = 0; let last = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = (now - last) / 1000; last = now;
      const o = origin.current; if (!o) return;
      for (const e of entries.current.values()) {
        e.track.step(dt);
        const g = geoOfEnu(o, e.track.x, e.track.z);
        e.marker.setLngLat([g.lng, g.lat]);
        e.body.style.transform = `rotate(${e.track.heading - map.getBearing()}deg)`;
      }
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); entries.current.forEach((e) => e.marker.remove()); entries.current.clear(); labels.current.forEach((m) => m.remove()); labels.current.clear(); map.remove(); mapRef.current = null; loaded.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function frame() {
    const map = mapRef.current; const { fields: fs } = latest.current;
    if (!map || !loaded.current) return;
    const b = new LngLatBounds();
    let any = false;
    for (const f of fs) { const r = f.visibility !== 'FOG_OF_WAR' ? f.polygon?.[0] : undefined; if (r && r.length >= 4) for (const [lng, lat] of r) { b.extend([lng, lat]); any = true; } }
    if (any) map.fitBounds(b, { padding: { top: 90, bottom: 110, left: 400, right: 60 }, maxZoom: 16, duration: 900 });
  }

  function syncAll() {
    const map = mapRef.current; const { fields: fs, machines: ms, assignments: asg } = latest.current;
    if (!map || !loaded.current) return;
    const locFields = fs.filter((f) => f.visibility !== 'FOG_OF_WAR' && (f.polygon?.[0]?.length ?? 0) >= 4);
    const locMachines = ms.filter((m) => !(m.current_lat === 0 && m.current_lng === 0));
    if (!origin.current) {
      const base = locFields.length ? locFields.map((f) => [f.center_lat, f.center_lng]) : locMachines.map((m) => [m.current_lat, m.current_lng]);
      if (!base.length) return;
      origin.current = { lat: base.reduce((s, p) => s + p[0], 0) / base.length, lng: base.reduce((s, p) => s + p[1], 0) / base.length };
    }
    const o = origin.current;
    (map.getSource('fields') as GeoJSONSource | undefined)?.setData(fieldFeatures(o, locFields) as never);
    (map.getSource('field-pts') as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: locFields.map((f) => { const c = cropState(f.readiness_status, f.harvest_progress_pct); return { type: 'Feature', properties: { fid: f.field_id, blocked: c.blocked ? 1 : 0, color: fieldColor(f.readiness_status, c.blocked) }, geometry: { type: 'Point', coordinates: [f.center_lng, f.center_lat] } }; }),
    } as never);

    // field labels
    const seenL = new Set<string>();
    for (const f of locFields) {
      seenL.add(f.field_id);
      let m = labels.current.get(f.field_id);
      const text = `${f.field_id} · ${Math.round(f.harvest_progress_pct)}%`;
      if (!m) {
        const el = document.createElement('div'); el.className = 'fl-label'; el.textContent = text;
        el.addEventListener('click', (ev) => { ev.stopPropagation(); cb.current.onPick({ type: 'field', id: f.field_id }); });
        m = new Marker({ element: el, anchor: 'bottom', offset: [0, -12] }).setLngLat([f.center_lng, f.center_lat]).addTo(map);
        labels.current.set(f.field_id, m);
      } else m.getElement().textContent = text;
    }
    for (const [id, m] of labels.current) if (!seenL.has(id)) { m.remove(); labels.current.delete(id); }

    // machines
    const active = new Map<string, DispatchAssignment>();
    for (const a of asg) if (a.status === 'IN_PROGRESS' || a.status === 'CONFIRMED') active.set(a.machine_id, a);
    const seen = new Set<string>();
    for (const m of locMachines) {
      seen.add(m.machine_id);
      const p = enu(o, m.current_lat, m.current_lng);
      let e = entries.current.get(m.machine_id);
      if (!e) {
        const el = document.createElement('div'); el.className = 'mk';
        el.innerHTML = `<div class="mk-body">${HARVESTER_SVG}</div><div class="mk-tag"></div>`;
        el.addEventListener('click', (ev) => { ev.stopPropagation(); cb.current.onPick({ type: 'machine', id: m.machine_id }); });
        const marker = new Marker({ element: el, rotationAlignment: 'map' }).setLngLat([m.current_lng, m.current_lat]).addTo(map);
        e = { track: new MachineTrack(p.x, p.z), marker, body: el.querySelector('.mk-body') as HTMLElement, tag: el.querySelector('.mk-tag') as HTMLElement, data: m };
        entries.current.set(m.machine_id, e);
      }
      e.data = m;
      e.track.setTarget(p.x, p.z);
      const fa = active.get(m.machine_id);
      const fld = fa ? locFields.find((f) => f.field_id === fa.field_id) : undefined;
      if (fld) { const ax = longEdgeAxis(ringToLocal(o, fld.polygon[0])); e.track.setRestHeading(bearingDeg(ax.x, ax.z)); }
      const root = e.marker.getElement();
      root.className = `mk st-${m.status}${latest.current.selected?.type === 'machine' && latest.current.selected.id === m.machine_id ? ' sel' : ''}`;
      e.tag.textContent = m.machine_id;
    }
    for (const [id, e] of entries.current) if (!seen.has(id)) { e.marker.remove(); entries.current.delete(id); }
  }

  useEffect(() => { syncAll(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [fields, machines, assignments, located.length]);

  // selection highlight and fly-to
  useEffect(() => {
    const map = mapRef.current; if (!map || !loaded.current) return;
    map.setFilter('fields-sel', ['==', ['get', 'fid'], selected?.type === 'field' ? selected.id : '']);
    for (const [id, e] of entries.current) e.marker.getElement().classList.toggle('sel', selected?.type === 'machine' && selected.id === id);
    if (!selected) return;
    if (selected.type === 'machine') {
      const e = entries.current.get(selected.id); const o = origin.current;
      if (e && o) { const g = geoOfEnu(o, e.track.x, e.track.z); map.flyTo({ center: [g.lng, g.lat], zoom: Math.max(map.getZoom(), 15.5), duration: 900, offset: [150, 0] }); }
    } else {
      const f = fields.find((x) => x.field_id === selected.id);
      if (f) map.flyTo({ center: [f.center_lng, f.center_lat], zoom: Math.max(map.getZoom(), 16), duration: 900, offset: [150, 0] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  useEffect(() => { frame(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [frameToken, located.length]);

  return <div className="flatmap" ref={host} data-testid="flat-map" />;
};
