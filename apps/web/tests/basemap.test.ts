// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isPmtilesHeader, offlineStyle, onlineStyle, OFFLINE_BASEMAP_PATH } from '../src/components/map/basemap.ts';

const bytes = (s: string) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));

test('only a real PMTiles header counts as the offline basemap, never the SPA fallback page', () => {
  assert.equal(isPmtilesHeader(bytes('PMTiles\x03')), true);
  assert.equal(isPmtilesHeader(bytes('<!doctype html>')), false);
  assert.equal(isPmtilesHeader(bytes('PMT')), false);
  assert.equal(isPmtilesHeader(new Uint8Array()), false);
});

test('offline style reads the self-hosted file and every layer points at a declared source', () => {
  const style = offlineStyle(`http://localhost${OFFLINE_BASEMAP_PATH}`);
  assert.equal(style.sources.basemap.url, `pmtiles://http://localhost${OFFLINE_BASEMAP_PATH}`);
  for (const layer of style.layers) {
    const source = (layer as { source?: string }).source;
    if (source) assert.ok(source in style.sources, `layer ${layer.id} uses undeclared source ${source}`);
  }
  const ids = style.layers.map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length, 'layer ids must be unique');
});

test('offline style needs no font files: it has no text layers', () => {
  assert.equal(offlineStyle('x').layers.some((l) => l.type === 'symbol'), false);
});

test('online fallback keeps the OpenStreetMap attribution', () => {
  assert.match(onlineStyle().sources.osm.attribution, /OpenStreetMap contributors/);
});

test('both styles declare the OpenStreetMap attribution that the ODbL licence requires', () => {
  assert.match(offlineStyle('x').sources.basemap.attribution, /OpenStreetMap contributors/);
});
