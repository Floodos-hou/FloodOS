// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  bearingDegrees,
  computeKpis,
  detectFleetEvents,
  metresBetween,
  nextHeading,
  screenRotation,
  snapshotStatuses,
  type MachineLike,
} from '../src/utils/fleetInsights.ts';

const m = (id: string, status: string, fuel = 80, lat = 10, lng = 105): MachineLike => ({
  machine_id: id,
  status,
  fuel_pct: fuel,
  current_lat: lat,
  current_lng: lng,
});

test('bearing follows the compass: north 0, east 90, south 180, west 270', () => {
  assert.equal(Math.round(bearingDegrees(10, 105, 10.001, 105)), 0);
  assert.equal(Math.round(bearingDegrees(10, 105, 10, 105.001)), 90);
  assert.equal(Math.round(bearingDegrees(10, 105, 9.999, 105)), 180);
  assert.equal(Math.round(bearingDegrees(10, 105, 10, 104.999)), 270);
});

test('bearing is always inside [0, 360)', () => {
  for (const [a, b] of [[0.001, -0.001], [-0.001, -0.001], [0, 0.0001], [-0.0001, 0]]) {
    const d = bearingDegrees(10, 105, 10 + a, 105 + b);
    assert.ok(d >= 0 && d < 360, String(d));
  }
});

test('distance: 0.001 degree of latitude is about 111 m, and a degree of longitude shrinks with latitude', () => {
  assert.ok(Math.abs(metresBetween(10, 105, 10.001, 105) - 111.32) < 0.01);
  assert.ok(metresBetween(60, 105, 60, 105.001) < metresBetween(0, 105, 0, 105.001));
});

test('screen rotation subtracts the map bearing and takes the short way round', () => {
  assert.equal(screenRotation(90, 0), 90);
  assert.equal(screenRotation(90, -22), 112);
  assert.equal(screenRotation(350, 0), -10);
  assert.equal(screenRotation(10, 350), 20);
  assert.equal(screenRotation(180, 0), 180);
  assert.equal(screenRotation(0, 180), 180);
  for (let b = 0; b < 360; b += 17) {
    for (let mb = -180; mb <= 180; mb += 23) {
      const r = screenRotation(b, mb);
      assert.ok(r > -180 && r <= 180, `${b} ${mb} -> ${r}`);
    }
  }
});

test('a machine keeps its heading when it only jitters, and turns when it really moves', () => {
  const first = nextHeading(null, 10, 105);
  assert.equal(first.heading, 0);
  const parked = nextHeading({ ...first, heading: 123 }, 10.000005, 105); // about 0.5 m
  assert.equal(parked.heading, 123, 'GPS noise must not spin a parked machine');
  const east = nextHeading(first, 10, 105.001);
  assert.equal(Math.round(east.heading), 90);
  assert.equal(east.lng, 105.001, 'the reference position advances with real movement');
});

test('KPIs count statuses, average fuel and progress, and ignore fogged fields', () => {
  const k = computeKpis(
    [m('A', 'WORKING', 90), m('B', 'WORKING', 50), m('C', 'IDLE', 20), m('D', 'BREAKDOWN', 10), m('E', 'MAINTENANCE', 40)],
    [
      { harvest_progress_pct: 100, visibility: 'FULL' },
      { harvest_progress_pct: 50, visibility: 'FULL' },
      { harvest_progress_pct: 0, visibility: 'FOG_OF_WAR' },
    ],
    [{ status: 'IN_PROGRESS' }, { status: 'CONFIRMED' }, { status: 'IN_PROGRESS' }]
  );
  assert.deepEqual(
    { machines: k.machines, working: k.working, idle: k.idle, broken: k.broken, maintenance: k.maintenance },
    { machines: 5, working: 2, idle: 1, broken: 1, maintenance: 1 }
  );
  assert.equal(k.avgFuelPct, 42);
  assert.equal(k.lowFuel, 2);
  assert.equal(k.avgHarvestPct, 75, 'the fogged field is excluded');
  assert.equal(k.activeShifts, 2);
});

test('KPIs of an empty fleet are zeros, never NaN', () => {
  const k = computeKpis([], [], []);
  assert.equal(k.avgFuelPct, 0);
  assert.equal(k.avgHarvestPct, 0);
  assert.equal(k.machines, 0);
});

test('the first snapshot produces no events', () => {
  assert.deepEqual(detectFleetEvents(new Map(), [m('A', 'WORKING')]), []);
});

test('a breakdown is reported once and as danger', () => {
  const prev = snapshotStatuses([m('M01', 'WORKING')]);
  const ev = detectFleetEvents(prev, [m('M01', 'BREAKDOWN')]);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].tone, 'danger');
  assert.match(ev[0].text, /M01 gặp sự cố/);
  assert.deepEqual(detectFleetEvents(snapshotStatuses([m('M01', 'BREAKDOWN')]), [m('M01', 'BREAKDOWN')]), [], 'no change, no event');
});

test('recovery and normal completion are worded differently', () => {
  const fixed = detectFleetEvents(snapshotStatuses([m('M01', 'BREAKDOWN')]), [m('M01', 'IDLE')]);
  assert.match(fixed[0].text, /sửa xong/);
  const done = detectFleetEvents(snapshotStatuses([m('M01', 'WORKING')]), [m('M01', 'IDLE')]);
  assert.match(done[0].text, /xong ca/);
  assert.equal(done[0].tone, 'success');
});

test('the rescue sequence M02 IDLE -> MOVING -> WORKING yields two ordered events', () => {
  const a = detectFleetEvents(snapshotStatuses([m('M02', 'IDLE')]), [m('M02', 'MOVING')]);
  const b = detectFleetEvents(snapshotStatuses([m('M02', 'MOVING')]), [m('M02', 'WORKING')]);
  assert.match(a[0].text, /di chuyển/);
  assert.match(b[0].text, /bắt đầu gặt/);
});

test('several machines changing at once give one event each, with unique keys', () => {
  const prev = snapshotStatuses([m('A', 'WORKING'), m('B', 'IDLE'), m('C', 'WORKING')]);
  const ev = detectFleetEvents(prev, [m('A', 'BREAKDOWN'), m('B', 'WORKING'), m('C', 'WORKING')]);
  assert.equal(ev.length, 2);
  assert.equal(new Set(ev.map((e) => e.key)).size, 2);
});

test('machines that appear later (a new roster entry) are not events', () => {
  assert.deepEqual(detectFleetEvents(snapshotStatuses([m('A', 'IDLE')]), [m('A', 'IDLE'), m('NEW', 'BREAKDOWN')]), []);
});
