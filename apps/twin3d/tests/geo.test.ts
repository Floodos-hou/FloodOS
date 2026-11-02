// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  bearingDeg, centroid, chooseZoom, clipHalfPlane, enu, geoOfEnu, lerpAngle, lngLatToTile, longEdgeAxis, metersPerPixel,
  polygonArea, ringToLocal, splitByFraction, sunPosition, sunVector, tileCount, tileRange, tileToLngLat, yawForBearing,
} from '../src/geo/geo.ts';

const O = { lat: 10.07, lng: 105.57 };
const sq = (a: number, b: number = a) => [{ x: 0, z: 0 }, { x: a, z: 0 }, { x: a, z: b }, { x: 0, z: b }];
const near = (a: number, b: number, eps: number, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} expected ${b} got ${a}`);

test('local metres: east is +x, north is -z, and the origin maps to (0,0)', () => {
  assert.deepEqual(enu(O, O.lat, O.lng), { x: 0, z: -0 });
  assert.ok(enu(O, O.lat, O.lng + 0.001).x > 100);
  assert.ok(enu(O, O.lat + 0.001, O.lng).z < -100);
  near(enu(O, O.lat + 0.001, O.lng).z, -111.32, 0.01);
});

test('enu and geoOfEnu are inverse', () => {
  for (const [dlat, dlng] of [[0.01, 0.02], [-0.03, 0.005], [0, 0]]) {
    const p = enu(O, O.lat + dlat, O.lng + dlng);
    const g = geoOfEnu(O, p.x, p.z);
    near(g.lat, O.lat + dlat, 1e-9); near(g.lng, O.lng + dlng, 1e-9);
  }
});

test('a GeoJSON ring becomes local points without the closing duplicate', () => {
  const ring = [[105.57, 10.07], [105.572, 10.07], [105.572, 10.072], [105.57, 10.072], [105.57, 10.07]];
  const pts = ringToLocal(O, ring);
  assert.equal(pts.length, 4);
  near(polygonArea(pts), 0.002 * 111320 * Math.cos(10.07 * Math.PI / 180) * 0.002 * 111320, 5);
});

test('polygon area and centroid of rectangles and an L shape', () => {
  assert.equal(polygonArea(sq(10, 20)), 200);
  assert.deepEqual(centroid(sq(10, 20)), { x: 5, z: 10 });
  const L = [{ x: 0, z: 0 }, { x: 20, z: 0 }, { x: 20, z: 10 }, { x: 10, z: 10 }, { x: 10, z: 20 }, { x: 0, z: 20 }];
  assert.equal(polygonArea(L), 300);
  const c = centroid(L);
  near(c.x, 2500 / 300, 1e-9); near(c.z, 2500 / 300, 1e-9); // (5*200+15*100)/300 for the two rectangles
  assert.equal(polygonArea([]), 0);
  assert.deepEqual(centroid([]), { x: 0, z: 0 });
  assert.equal(polygonArea(sq(10).reverse()), 100, 'orientation independent');
});

test('half-plane clipping keeps exactly the requested side', () => {
  const left = clipHalfPlane(sq(10), 1, 0, 4);
  near(polygonArea(left), 40, 1e-9);
  assert.equal(clipHalfPlane(sq(10), 1, 0, -1).length, 0, 'nothing on that side');
  near(polygonArea(clipHalfPlane(sq(10), 1, 0, 99)), 100, 1e-9);
  near(polygonArea(clipHalfPlane(sq(10), 1, 1, 10)), 50, 1e-9, 'diagonal cut');
});

test('splitByFraction reproduces the harvested share of area for any shape', () => {
  const L = [{ x: 0, z: 0 }, { x: 20, z: 0 }, { x: 20, z: 10 }, { x: 10, z: 10 }, { x: 10, z: 20 }, { x: 0, z: 20 }];
  for (const shape of [sq(100, 60), L]) {
    const axis = longEdgeAxis(shape);
    const total = polygonArea(shape);
    for (const f of [0, 0.1, 0.45, 0.8, 1]) {
      const { low, high } = splitByFraction(shape, f, axis);
      near(polygonArea(low) / total, f, 1e-6, `low share ${f}`);
      near(polygonArea(low) + polygonArea(high), total, total * 1e-6, 'the two parts add up to the field');
    }
  }
});

test('the cutting axis follows the long side of the field', () => {
  const a = longEdgeAxis(sq(100, 20));
  near(Math.abs(a.x), 1, 1e-9);
  const b = longEdgeAxis(sq(20, 100));
  near(Math.abs(b.z), 1, 1e-9);
});

test('compass bearing from a local movement, and the matching three.js yaw', () => {
  near(bearingDeg(0, -10), 0, 1e-9, 'north');
  near(bearingDeg(10, 0), 90, 1e-9, 'east');
  near(bearingDeg(0, 10), 180, 1e-9, 'south');
  near(bearingDeg(-10, 0), 270, 1e-9, 'west');
  near(yawForBearing(90), -Math.PI / 2, 1e-12);
  near(yawForBearing(0), 0, 1e-12);
});

test('angle interpolation takes the short way round', () => {
  near(lerpAngle(350, 10, 0.5), 0, 1e-9);
  near(lerpAngle(10, 350, 0.5), 0, 1e-9);
  near(lerpAngle(0, 90, 0.5), 45, 1e-9);
  near(lerpAngle(90, 90, 0.7), 90, 1e-9);
});

test('tile maths: round trip, known tile, resolution', () => {
  const t = lngLatToTile(105.57, 10.07, 14);
  const g = tileToLngLat(t.x, t.y, 14);
  near(g.lng, 105.57, 1e-9); near(g.lat, 10.07, 1e-9);
  assert.equal(Math.floor(t.x), 12996);
  assert.equal(Math.floor(t.y), 7731);
  near(metersPerPixel(10.07, 14), 9.41, 0.02);
  near(metersPerPixel(0, 0), 156543.03, 0.01);
});

test('tile range covers the box and zoom selection respects the tile budget', () => {
  const r = tileRange(10.05, 10.09, 105.55, 105.60, 14);
  const nw = tileToLngLat(r.x0, r.y0, 14); const se = tileToLngLat(r.x1 + 1, r.y1 + 1, 14);
  assert.ok(nw.lng <= 105.55 && nw.lat >= 10.09 && se.lng >= 105.60 && se.lat <= 10.05, 'the block covers the whole box');
  const z = chooseZoom(10.05, 10.09, 105.55, 105.60, 17, 16);
  assert.ok(tileCount(tileRange(10.05, 10.09, 105.55, 105.60, z)) <= 16);
  assert.ok(z === 17 || tileCount(tileRange(10.05, 10.09, 105.55, 105.60, z + 1)) > 16, 'it is the highest zoom within budget');
  assert.ok(chooseZoom(-80, 80, -170, 170, 14, 4) >= 1);
});

test('sun: rises in the east, is highest at noon in the south, sets in the west, below the horizon at night', () => {
  const noon = sunPosition(12);
  near(noon.elevationDeg, 78, 1e-9); near(noon.azimuthDeg, 180, 1e-9);
  assert.ok(sunPosition(6.0).elevationDeg < 1 && sunPosition(6.0).azimuthDeg === 90);
  assert.ok(sunPosition(0).elevationDeg < 0 && sunPosition(23).elevationDeg < 0);
  const v = sunVector(180, 45);
  assert.ok(v.z > 0 && v.y > 0, 'a noon sun in the south is on the +z side and above the horizon');
  near(Math.hypot(v.x, v.y, v.z), 1, 1e-9, 'unit vector');
  const east = sunVector(90, 0); near(east.x, 1, 1e-9);
  const south = sunVector(180, 0); near(south.z, 1, 1e-9, 'south is +z');
  near(sunVector(0, 90).y, 1, 1e-9, 'overhead');
});
