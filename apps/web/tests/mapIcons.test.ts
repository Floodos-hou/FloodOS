// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COLOR, GLYPH, gaugeSpec, markerClassName, markerInnerHtml, needGlyph, reportSpec, shelterSpec, vehicleSpec } from '../src/components/map/mapIcons.ts';

test('every need type has its own pictogram, and an unknown need falls back to a plain alert', () => {
  const glyphs = ['EVACUATION', 'MEDICAL', 'FOOD_WATER', 'PUMPING', 'ROAD_BLOCKED'].map(needGlyph);
  assert.equal(new Set(glyphs).size, 5);
  assert.equal(needGlyph('SOMETHING_NEW'), 'alert');
  assert.equal(needGlyph(undefined), 'alert');
});

test('an open urgent report is a red pulsing beacon; a closed one is grey and dimmed', () => {
  const urgent = reportSpec({ need_type: 'EVACUATION', priority: 'URGENT', status: 'VERIFIED', depth_cm: 70.4 });
  assert.deepEqual([urgent.shape, urgent.color, urgent.pulse, urgent.chip], ['beacon', COLOR.crit, true, '70']);
  const done = reportSpec({ need_type: 'EVACUATION', priority: 'URGENT', status: 'RESOLVED', depth_cm: 70 });
  assert.deepEqual([done.color, done.pulse, done.dim], [COLOR.mute, false, true]);
});

test('a new unverified report is amber, and a report without a depth shows no number rather than 0', () => {
  const fresh = reportSpec({ need_type: 'MEDICAL', priority: 'NORMAL', status: 'RECEIVED', depth_cm: null });
  assert.equal(fresh.color, COLOR.watch);
  assert.equal(fresh.chip, undefined);
});

test('vehicles show type when usable and a wrench when not; colour is availability', () => {
  assert.deepEqual([vehicleSpec({ vehicle_type: 'RESCUE_BOAT', status: 'IDLE' }).glyph, vehicleSpec({ vehicle_type: 'RESCUE_BOAT', status: 'IDLE' }).color], ['boat', COLOR.safe]);
  assert.equal(vehicleSpec({ vehicle_type: 'HIGH_CLEARANCE_TRUCK', status: 'WORKING' }).color, COLOR.river);
  assert.equal(vehicleSpec({ vehicle_type: 'MOBILE_PUMP', status: 'MOVING' }).glyph, 'pump');
  const broken = vehicleSpec({ vehicle_type: 'RESCUE_BOAT', status: 'BREAKDOWN' });
  assert.deepEqual([broken.glyph, broken.color, broken.pulse], ['wrench', COLOR.crit, true]);
  assert.equal(vehicleSpec({ status: 'MAINTENANCE' }).color, COLOR.warn);
});

test('a shelter bar and colour follow its real occupancy, capped at full', () => {
  assert.deepEqual([shelterSpec({ capacity: 100, occupancy: 35 }).fill, shelterSpec({ capacity: 100, occupancy: 35 }).color], [35, COLOR.safe]);
  assert.equal(shelterSpec({ capacity: 100, occupancy: 80 }).color, COLOR.warn);
  assert.deepEqual([shelterSpec({ capacity: 100, occupancy: 140 }).fill, shelterSpec({ capacity: 100, occupancy: 140 }).color], [100, COLOR.crit]);
  assert.equal(shelterSpec({ capacity: 0, occupancy: 0 }).fill, 0);
  assert.equal(shelterSpec({ capacity: 100, occupancy: 10, status: 'CLOSED' }).color, COLOR.mute);
});

test('a gauge follows the alarm scale and shows no level when there is no reading', () => {
  assert.equal(gaugeSpec({ alert_state: 'CRITICAL', level_cm: 130 }).color, COLOR.crit);
  assert.equal(gaugeSpec({ alert_state: 'WARNING', level_cm: 100 }).color, COLOR.warn);
  assert.equal(gaugeSpec({ alert_state: 'WATCH', level_cm: 80 }).color, COLOR.watch);
  assert.equal(gaugeSpec({ alert_state: 'NORMAL', level_cm: 40 }).color, COLOR.safe);
  const none = gaugeSpec({ alert_state: 'UNKNOWN', level_cm: null });
  assert.deepEqual([none.color, none.chip], [COLOR.mute, undefined]);
});

test('marker markup contains its pictogram, number and bar, and escapes nothing it was not given', () => {
  const html = markerInnerHtml(shelterSpec({ capacity: 100, occupancy: 50 }), 'Nhà văn hóa');
  assert.match(html, /<svg/);
  assert.match(html, /width:50%/);
  assert.match(html, /Nhà văn hóa/);
  assert.match(markerInnerHtml(reportSpec({ need_type: 'PUMPING', priority: 'HIGH', status: 'VERIFIED', depth_cm: 30 })), />30</);
  assert.equal(Object.keys(GLYPH).length, 11);
  assert.equal(markerClassName(vehicleSpec({ status: 'BREAKDOWN' }), 'is-selected'), 'fo-pin fo-disc is-pulse is-selected');
});
