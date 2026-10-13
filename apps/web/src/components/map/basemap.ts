// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

/**
 * Base map selection. Preferred: a PMTiles file of OpenStreetMap data served by this app itself
 * (/basemap/hanoi.pmtiles), so the map works with no Internet and no third-party tile server.
 * Fallback: the public OpenStreetMap raster tiles, announced as "online" on screen.
 * Pure functions only (no DOM, no maplibre import) so they run under `node --test`.
 */

export const OFFLINE_BASEMAP_PATH = '/basemap/hanoi.pmtiles';
export const PMTILES_MAGIC = 'PMTiles';

export type BasemapKind = 'offline' | 'online';

/** true when the first bytes of the response are the PMTiles header (an SPA fallback page would be HTML instead) */
export function isPmtilesHeader(bytes: Uint8Array): boolean {
  if (bytes.length < PMTILES_MAGIC.length) return false;
  for (let i = 0; i < PMTILES_MAGIC.length; i++) if (bytes[i] !== PMTILES_MAGIC.charCodeAt(i)) return false;
  return true;
}

const PAPER = '#ece8dc';

/** Raster fallback: public OpenStreetMap tiles, desaturated so case markers carry the colour. */
export function onlineStyle() {
  return {
    version: 8 as const,
    sources: {
      osm: {
        type: 'raster' as const,
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        maxzoom: 19,
        attribution: '&copy; OpenStreetMap contributors',
      },
    },
    layers: [
      { id: 'paper', type: 'background' as const, paint: { 'background-color': PAPER } },
      { id: 'osm', type: 'raster' as const, source: 'osm', paint: { 'raster-saturation': -0.55, 'raster-contrast': -0.05, 'raster-brightness-max': 0.95 } },
    ],
  };
}

const ROAD_KINDS = ['highway', 'major_road', 'medium_road', 'minor_road'] as const;

/**
 * Vector style over the Protomaps basemap tile schema (earth, landuse, water, roads, buildings).
 * No text layers: that avoids shipping font files, and every named place the user needs is already in the UI.
 */
export function offlineStyle(pmtilesUrl: string) {
  const road = (kind: (typeof ROAD_KINDS)[number], casing: boolean, color: string, widths: [number, number, number]) => ({
    id: `roads-${kind}${casing ? '-casing' : ''}`,
    type: 'line' as const,
    source: 'basemap',
    'source-layer': 'roads',
    filter: ['==', ['get', 'kind'], kind] as unknown[],
    layout: { 'line-cap': 'round' as const, 'line-join': 'round' as const },
    paint: {
      'line-color': color,
      'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 10, widths[0], 14, widths[1], 18, widths[2]] as unknown[],
    },
  });
  return {
    version: 8 as const,
    sources: {
      basemap: {
        type: 'vector' as const,
        url: `pmtiles://${pmtilesUrl}`,
        maxzoom: 14,
        attribution: '&copy; OpenStreetMap contributors &middot; Protomaps',
      },
    },
    layers: [
      { id: 'paper', type: 'background' as const, paint: { 'background-color': PAPER } },
      { id: 'earth', type: 'fill' as const, source: 'basemap', 'source-layer': 'earth', paint: { 'fill-color': '#f3f0e7' } },
      {
        id: 'green', type: 'fill' as const, source: 'basemap', 'source-layer': 'landuse',
        filter: ['in', ['get', 'kind'], ['literal', ['park', 'forest', 'grassland', 'nature_reserve', 'garden', 'golf_course', 'cemetery', 'farmland', 'allotments']]] as unknown[],
        paint: { 'fill-color': '#dfe7cf' },
      },
      { id: 'water', type: 'fill' as const, source: 'basemap', 'source-layer': 'water', filter: ['==', ['geometry-type'], 'Polygon'] as unknown[], paint: { 'fill-color': '#bcd6e4' } },
      {
        id: 'waterway', type: 'line' as const, source: 'basemap', 'source-layer': 'water', filter: ['==', ['geometry-type'], 'LineString'] as unknown[],
        paint: { 'line-color': '#bcd6e4', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1, 16, 4] as unknown[] },
      },
      { id: 'buildings', type: 'fill' as const, source: 'basemap', 'source-layer': 'buildings', minzoom: 13, paint: { 'fill-color': '#e2dccb', 'fill-outline-color': '#d4cdb8' } },
      { id: 'rail', type: 'line' as const, source: 'basemap', 'source-layer': 'roads', filter: ['==', ['get', 'kind'], 'rail'] as unknown[], paint: { 'line-color': '#a39e8c', 'line-width': 1, 'line-dasharray': [3, 2] } },
      { id: 'paths', type: 'line' as const, source: 'basemap', 'source-layer': 'roads', minzoom: 14, filter: ['in', ['get', 'kind'], ['literal', ['path', 'other']]] as unknown[], paint: { 'line-color': '#cfc8b4', 'line-width': 1 } },
      road('minor_road', true, '#d9d2bf', [0.8, 3, 9]),
      road('medium_road', true, '#cfc7ae', [1.2, 4.5, 12]),
      road('major_road', true, '#c9b98a', [1.6, 6, 15]),
      road('highway', true, '#c0a45f', [2, 7.5, 18]),
      road('minor_road', false, '#ffffff', [0.5, 2, 7]),
      road('medium_road', false, '#fffdf6', [0.9, 3.4, 10]),
      road('major_road', false, '#fbe9b5', [1.2, 4.8, 13]),
      road('highway', false, '#f6cf7a', [1.6, 6, 16]),
    ],
  };
}
