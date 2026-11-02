// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenAgriOS Contributors

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildFields, buildMachines, buildWorld, sceneHour, seasonProgress, simHour, visibleFields, type StateField } from '../src/game/scene.ts';

const f = (id: string, lat: number, lng: number, over: Partial<StateField> = {}): StateField => ({
  field_id: id, crop: 'Lúa', owner_user_id: 'usr_ba', readiness_status: 'READY_HARVEST', harvest_progress_pct: 0,
  area_ha: 2.4, center_lat: lat, center_lng: lng, visibility: 'FULL', ...over,
});
const m = (id: string, status: string, lat: number, lng: number, fuel = 80) => ({ machine_id: id, status, fuel_pct: fuel, current_lat: lat, current_lng: lng });

test('fogged fields never enter the world', () => {
  const fields = [f('A', 10, 105), f('B', 10.01, 105, { visibility: 'FOG_OF_WAR' })];
  assert.deepEqual(visibleFields(fields).map((x) => x.field_id), ['A']);
  assert.equal(buildWorld(fields, []).fields.length, 1);
});

test('the camera bounds grow to include a machine far away from the fields', () => {
  const fields = [f('A', 10, 105), f('B', 10.002, 105.002)];
  const near = buildWorld(fields, []);
  const far = buildWorld(fields, [m('M', 'WORKING', 10.1, 105.1)]);
  assert.ok(far.bounds.maxX > near.bounds.maxX || far.bounds.minY < near.bounds.minY);
});

test('machines without a position are skipped', () => {
  const w = buildWorld([f('A', 10, 105)], []);
  assert.equal(buildMachines(w, [m('X', 'IDLE', 0, 0)], []).length, 0);
});

test('a machine on a field centre is drawn at that field', () => {
  const fields = [f('A', 10, 105), f('B', 10, 105.02)];
  const w = buildWorld(fields, []);
  const [mv] = buildMachines(w, [m('M1', 'IDLE', 10, 105.02)], []);
  const b = w.fields.find((x) => x.id === 'B')!;
  assert.ok(Math.hypot(mv.x - b.x, mv.y - b.y) < 2);
});

test('the active assignment decides the field a machine works on; in-progress wins over confirmed', () => {
  const w = buildWorld([f('A', 10, 105), f('B', 10, 105.02)], []);
  const [mv] = buildMachines(w, [m('M1', 'WORKING', 10, 105)], [
    { assignment_id: '1', field_id: 'A', machine_id: 'M1', status: 'CONFIRMED' },
    { assignment_id: '2', field_id: 'B', machine_id: 'M1', status: 'IN_PROGRESS' },
    { assignment_id: '3', field_id: 'A', machine_id: 'M1', status: 'SUPERSEDED' },
  ]);
  assert.equal(mv.fieldId, 'B');
});

test('a replacement shift marks its machine as rescuing, unless that machine itself is broken', () => {
  const w = buildWorld([f('A', 10, 105)], []);
  const asg = [{ assignment_id: 'R1', field_id: 'A', machine_id: 'M2', status: 'IN_PROGRESS', replaces_assignment_id: 'ASG-102' }];
  assert.equal(buildMachines(w, [m('M2', 'WORKING', 10, 105)], asg)[0].rescuing, true);
  assert.equal(buildMachines(w, [m('M2', 'BREAKDOWN', 10, 105)], asg)[0].rescuing, false);
  assert.equal(buildMachines(w, [m('M2', 'WORKING', 10, 105)], [{ ...asg[0], replaces_assignment_id: undefined }])[0].rescuing, false);
});

test('field views flag ownership and carry the quest state', () => {
  const views = buildFields([f('A', 10, 105), f('B', 10.01, 105, { owner_user_id: 'usr_tam' })],
    [{ id: 'Q', fieldId: 'A', state: 'todo', icon: '', title: '', hint: '' }], 'usr_ba');
  assert.equal(views.find((v) => v.id === 'A')!.mine, true);
  assert.equal(views.find((v) => v.id === 'A')!.quest, 'todo');
  assert.equal(views.find((v) => v.id === 'B')!.mine, false);
  assert.equal(views.find((v) => v.id === 'B')!.quest, null);
});

test('season progress averages visible fields only and is clamped', () => {
  assert.equal(seasonProgress([f('A', 1, 1, { harvest_progress_pct: 100 }), f('B', 1, 2, { harvest_progress_pct: 50 }), f('C', 1, 3, { visibility: 'FOG_OF_WAR', harvest_progress_pct: 0 })]), 75);
  assert.equal(seasonProgress([f('A', 1, 1, { harvest_progress_pct: 500 })]), 100);
  assert.equal(seasonProgress([]), 0);
});

test('hour of day from the simulation clock, with a safe default', () => {
  assert.equal(simHour('2026-11-20T09:15:00Z'), 9.25);
  assert.equal(simHour('garbage'), 10);
  assert.equal(simHour(undefined), 10);
});

test('time modes: simulation clock, cosmetic day loop, fixed night', () => {
  assert.equal(sceneHour('sim', '2026-11-20T09:30:00Z', 999), 9.5);
  assert.equal(sceneHour('night', undefined, 0), 22);
  const a = sceneHour('auto', undefined, 0);
  const b = sceneHour('auto', undefined, 60);
  assert.ok(a >= 0 && a < 24 && b >= 0 && b < 24 && a !== b);
  assert.equal(sceneHour('auto', undefined, 144), sceneHour('auto', undefined, 0), 'the loop is periodic');
});
