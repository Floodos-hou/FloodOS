// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenAgriOS Contributors

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { approach, cropState, daylight, hash01, readinessLabel, seedFromString, skyTint } from '../src/game/crops.ts';
import { deriveQuests, diffQuests, questSummary, type QuestField } from '../src/game/quests.ts';
import { MIN_FIELD_GAP, NEAR_RADIUS, compressFar, fieldSize, fitCamera, headingFromDelta, layoutWorld, toMetres, worldPoint } from '../src/game/world.ts';

const field = (id: string, lat: number, lng: number, area = 2.4) => ({ field_id: id, center_lat: lat, center_lng: lng, area_ha: area });

// ------------------------------------------------------------------ world
test('metres: east is +x, north is -y (screen space), and the origin is (0,0)', () => {
  const o = { lat: 10, lng: 105 };
  assert.deepEqual(toMetres(10, 105, o), { x: 0, y: -0 });
  assert.ok(toMetres(10, 105.001, o).x > 100);
  assert.ok(toMetres(10.001, 105, o).y < -100);
});

test('the layout rescales the map so neighbouring fields are at least the minimum gap apart', () => {
  for (const spread of [0.0005, 0.005, 0.05]) {
    const w = layoutWorld([field('A', 10, 105), field('B', 10 + spread, 105), field('C', 10, 105 + spread)]);
    for (let i = 0; i < w.fields.length; i++) {
      for (let j = i + 1; j < w.fields.length; j++) {
        const d = Math.hypot(w.fields[i].x - w.fields[j].x, w.fields[i].y - w.fields[j].y);
        assert.ok(d >= MIN_FIELD_GAP * 0.97, `spread ${spread}: distance ${d}`);
      }
    }
  }
});

test('no two field rectangles overlap after layout, even for badly clustered inputs', () => {
  const clustered = [field('A', 10, 105, 5), field('B', 10.00001, 105.00001, 5), field('C', 10.00002, 105, 5), field('D', 10, 105.00003, 5)];
  const w = layoutWorld(clustered);
  for (let i = 0; i < w.fields.length; i++) {
    for (let j = i + 1; j < w.fields.length; j++) {
      const a = w.fields[i], b = w.fields[j];
      const separated = Math.abs(a.x - b.x) >= (a.w + b.w) / 2 || Math.abs(a.y - b.y) >= (a.h + b.h) / 2;
      assert.ok(separated, `${a.id} overlaps ${b.id}`);
    }
  }
});

test('layout keeps the real relative directions', () => {
  const w = layoutWorld([field('W', 10, 105), field('E', 10, 105.02), field('N', 10.02, 105.01)]);
  const by = Object.fromEntries(w.fields.map((f) => [f.id, f]));
  assert.ok(by.E.x > by.W.x);
  assert.ok(by.N.y < by.W.y && by.N.y < by.E.y, 'north is up');
});

test('machines use the same projection as fields', () => {
  const w = layoutWorld([field('A', 10.0, 105.0), field('B', 10.0, 105.02)]);
  const p = worldPoint(w, 10.0, 105.02);
  const b = w.fields.find((f) => f.id === 'B')!;
  assert.ok(Math.abs(p.x - b.x) < 1 && Math.abs(p.y - b.y) < 1, 'a machine standing on the field centre is drawn on the field');
});

test('degenerate layouts do not blow up', () => {
  assert.equal(layoutWorld([]).fields.length, 0);
  const one = layoutWorld([field('A', 10, 105)]);
  assert.equal(one.fields.length, 1);
  assert.ok(Number.isFinite(one.scale) && one.bounds.maxX > one.bounds.minX);
  const same = layoutWorld([field('A', 10, 105), field('B', 10, 105)]);
  assert.ok(Number.isFinite(same.fields[0].x));
});

test('field size grows with area inside readable limits', () => {
  assert.ok(fieldSize(0.1).w >= 150 * 1.25 - 1);
  assert.ok(fieldSize(100).w <= 300 * 1.25 + 1);
  assert.ok(fieldSize(4).w > fieldSize(1).w);
});

test('heading follows the compass in world space', () => {
  assert.equal(Math.round(headingFromDelta(0, -10)), 0, 'up = north');
  assert.equal(Math.round(headingFromDelta(10, 0)), 90);
  assert.equal(Math.round(headingFromDelta(0, 10)), 180);
  assert.equal(Math.round(headingFromDelta(-10, 0)), 270);
});

test('fit camera centres the world and shows all of it', () => {
  const c = fitCamera({ minX: -500, maxX: 500, minY: -250, maxY: 250 }, 1000, 500);
  assert.equal(c.x, 0);
  assert.equal(c.y, 0);
  assert.equal(c.zoom, 1);
  assert.ok(fitCamera({ minX: -500, maxX: 500, minY: -250, maxY: 250 }, 500, 500).zoom < 1);
});

// ------------------------------------------------------------------ crops
test('crop stage from readiness and progress', () => {
  assert.deepEqual(cropState('GROWING', 0), { stage: 'GROWING', harvested: 0, blocked: false });
  assert.deepEqual(cropState('READY_HARVEST', 0), { stage: 'RIPE', harvested: 0, blocked: false });
  assert.deepEqual(cropState('HARVESTING', 45), { stage: 'HARVESTING', harvested: 0.45, blocked: false });
  assert.deepEqual(cropState('COMPLETED', 100), { stage: 'HARVESTED', harvested: 1, blocked: false });
  assert.equal(cropState('HARVESTING', 100).stage, 'HARVESTED');
});

test('an impacted field is blocked and keeps the part already harvested', () => {
  assert.deepEqual(cropState('IMPACTED', 0), { stage: 'RIPE', harvested: 0, blocked: true });
  assert.deepEqual(cropState('IMPACTED', 30), { stage: 'HARVESTING', harvested: 0.3, blocked: true });
});

test('crop progress is clamped and NaN-safe', () => {
  assert.equal(cropState('HARVESTING', 250).harvested, 1);
  assert.equal(cropState('HARVESTING', -5).harvested, 0);
  assert.equal(cropState('HARVESTING', Number.NaN).harvested, 0);
  assert.equal(cropState('???', 10).stage, 'GROWING');
});

test('approach moves towards the target without overshooting and is frame-rate independent', () => {
  let v = 0;
  for (let i = 0; i < 20; i++) {
    v = approach(v, 1, 0.016);
    assert.ok(v >= 0 && v <= 1);
  }
  const once = approach(0, 1, 0.1);
  const twice = approach(approach(0, 1, 0.05), 1, 0.05);
  assert.ok(Math.abs(once - twice) < 1e-9);
  assert.equal(approach(0.99999, 1, 0.016), 1, 'snaps when close');
  assert.equal(approach(0.4, 0.4, 1), 0.4);
});

test('daylight: noon bright, midnight dark, smooth dusk and dawn, 24h wrap', () => {
  assert.equal(daylight(12), 1);
  assert.equal(daylight(0), 0);
  assert.equal(daylight(23.9), 0);
  assert.ok(daylight(18) > 0 && daylight(18) < 1);
  assert.ok(daylight(6) > 0 && daylight(6) < 1);
  assert.equal(daylight(36), daylight(12));
  assert.equal(daylight(-12), daylight(12));
});

test('deterministic noise is stable and in range', () => {
  for (let i = 0; i < 200; i++) {
    const v = hash01(i);
    assert.ok(v >= 0 && v < 1);
    assert.equal(v, hash01(i));
  }
  assert.notEqual(hash01(1), hash01(2));
  assert.equal(seedFromString('F01'), seedFromString('F01'));
  assert.notEqual(seedFromString('F01'), seedFromString('F02'));
});

test('readiness labels are Vietnamese with a safe fallback', () => {
  assert.equal(readinessLabel('COMPLETED'), 'Đã gặt xong');
  assert.equal(readinessLabel('SOMETHING_NEW'), 'SOMETHING_NEW');
});

// ------------------------------------------------------------------ quests
const mkField = (id: string, readiness: string, progress = 0, owner = 'usr_ba'): QuestField => ({
  field_id: id, owner_user_id: owner, readiness_status: readiness, harvest_progress_pct: progress, visibility: 'FULL',
});
const req = (field: string, status: string, at = '2026-11-20T00:00:00Z') => ({ request_id: `R-${field}-${status}`, field_id: field, status, created_at: at });
const quest = (fields: QuestField[], reqs = [] as ReturnType<typeof req>[], asg = [] as any[], acc = [] as any[], role = 'FARMER') =>
  deriveQuests(fields, reqs, asg, acc, 'usr_ba', role);

test('a ripe field without a request invites the farmer to call a harvester', () => {
  const [q] = quest([mkField('F07', 'READY_HARVEST')]);
  assert.equal(q.state, 'todo');
  assert.equal(q.action, 'CALL_HARVESTER');
});

test('every request status maps to the right quest state', () => {
  const f = [mkField('F1', 'READY_HARVEST')];
  const expect: Record<string, string> = {
    SUBMITTED: 'waiting', PENDING_SCHEDULE: 'waiting', SCHEDULED: 'active', IN_PROGRESS: 'active',
    IMPACTED_BY_INCIDENT: 'alert', RESCHEDULED: 'active',
  };
  for (const [status, state] of Object.entries(expect)) {
    assert.equal(quest(f, [req('F1', status)])[0].state, state, status);
  }
});

test('an incident is the top priority quest', () => {
  const qs = quest([mkField('A', 'READY_HARVEST'), mkField('B', 'HARVESTING', 40), mkField('C', 'COMPLETED', 100)],
    [req('B', 'IMPACTED_BY_INCIDENT')]);
  assert.equal(qs[0].fieldId, 'B');
  assert.equal(qs[0].state, 'alert');
  assert.equal(qs[qs.length - 1].state, 'done');
});

test('a finished assignment awaiting acceptance becomes a confirm quest, and disappears once accepted', () => {
  const fields = [mkField('F1', 'HARVESTING', 100)];
  const asg = [{ assignment_id: 'ASG-1', field_id: 'F1', status: 'COMPLETED', machine_id: 'M1' }];
  const [pending] = quest(fields, [req('F1', 'WAITING_ACCEPTANCE')], asg, []);
  assert.equal(pending.action, 'CONFIRM_DONE');
  assert.equal(pending.assignmentId, 'ASG-1');
  const [accepted] = quest(fields, [req('F1', 'COMPLETED')], asg, [{ assignment_id: 'ASG-1' }]);
  assert.equal(accepted.state, 'done');
  assert.equal(accepted.action, undefined);
});

test('a farmer only gets quests for their own fields; a coordinator sees all but cannot call harvesters', () => {
  const fields = [mkField('MINE', 'READY_HARVEST'), mkField('OTHER', 'READY_HARVEST', 0, 'usr_tam')];
  assert.deepEqual(quest(fields).map((q) => q.fieldId), ['MINE']);
  const coord = quest(fields, [], [], [], 'COORDINATOR');
  assert.equal(coord.length, 2);
  assert.ok(coord.every((q) => q.action !== 'CALL_HARVESTER'));
});

test('fogged fields never produce quests', () => {
  const fogged = { ...mkField('X', 'READY_HARVEST'), visibility: 'FOG_OF_WAR' };
  assert.deepEqual(quest([fogged]), []);
});

test('cancelled requests are ignored and the latest open request wins', () => {
  const f = [mkField('F1', 'READY_HARVEST')];
  assert.equal(quest(f, [req('F1', 'CANCELLED')])[0].action, 'CALL_HARVESTER');
  const q = quest(f, [req('F1', 'SUBMITTED', '2026-11-01T00:00:00Z'), req('F1', 'IN_PROGRESS', '2026-11-02T00:00:00Z')]);
  assert.equal(q[0].state, 'active');
});

test('growing fields wait quietly', () => {
  assert.equal(quest([mkField('G', 'GROWING')])[0].state, 'waiting');
});

test('quest diff: first list is a baseline; transitions produce notifications', () => {
  const a = quest([mkField('F1', 'READY_HARVEST')]);
  assert.deepEqual(diffQuests(null, a), []);
  const b = quest([mkField('F1', 'READY_HARVEST')], [req('F1', 'IMPACTED_BY_INCIDENT')]);
  const ev = diffQuests(a, b);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].tone, 'danger');
  assert.deepEqual(diffQuests(b, b), [], 'no change, no event');
  const done = quest([mkField('F1', 'COMPLETED', 100)]);
  assert.equal(diffQuests(b, done)[0].tone, 'success');
});

test('quest summary counts completed quests', () => {
  const qs = quest([mkField('A', 'COMPLETED', 100), mkField('B', 'READY_HARVEST'), mkField('C', 'COMPLETED', 100)]);
  assert.deepEqual(questSummary(qs), { done: 2, total: 3 });
});

test('sky tint: white at noon, blue at midnight, warm in between, always valid RGB', () => {
  assert.deepEqual(skyTint(12), [255, 255, 255]);
  assert.deepEqual(skyTint(0), [58, 76, 138]);
  const dusk = skyTint(18);
  assert.ok(dusk[0] > dusk[2], 'dusk is warm (more red than blue)');
  for (let h = -3; h < 30; h += 0.25) {
    const c = skyTint(h);
    assert.ok(c.every((v) => Number.isInteger(v) && v >= 0 && v <= 255), `${h}: ${c}`);
  }
  assert.deepEqual(skyTint(36), skyTint(12));
});

test('far machines are compressed but keep direction, monotonicity and continuity', () => {
  const w = layoutWorld([field('A', 10, 105), field('B', 10, 105.02)]);
  const a = w.fields.find((f) => f.id === 'A')!;
  const near = compressFar(w, a.x + 100, a.y + 50);
  assert.deepEqual(near, { x: a.x + 100, y: a.y + 50 }, 'inside the near radius nothing changes');
  let prev = 0;
  for (let d = 0; d <= 20000; d += 250) {
    const p = compressFar(w, a.x + d, a.y);        // march due east from field A (B is east too, so use y offset)
    const dist = Math.hypot(p.x - a.x, p.y - a.y);
    assert.ok(dist >= prev - 1e-6, `monotonic at ${d}`);
    prev = dist;
  }
  const far = compressFar(w, a.x - 50_000, a.y + 50_000);
  assert.ok(far.x < a.x && far.y > a.y, 'direction preserved (south-west)');
  assert.ok(Math.hypot(far.x - a.x, far.y - a.y) < NEAR_RADIUS + 1500, 'even a very distant machine stays in the picture');
  const just = compressFar(w, a.x, a.y - NEAR_RADIUS - 1);
  assert.ok(Math.abs(just.y - (a.y - NEAR_RADIUS)) < 2, 'continuous at the boundary');
});

test('compression with no fields is the identity', () => {
  assert.deepEqual(compressFar(layoutWorld([]), 5, 6), { x: 5, y: 6 });
});

test('fit camera honours HUD padding: the world is centred in the free rectangle and fully visible there', () => {
  const b = { minX: -500, maxX: 500, minY: -250, maxY: 250 };
  const pad = { top: 100, right: 300, bottom: 0, left: 0 };
  const c = fitCamera(b, 1300, 600, pad);
  // free rectangle is 1000 x 500: exactly the world size
  assert.equal(c.zoom, 1);
  // screen position of a world point: (p - cam) * zoom + viewport centre
  const screen = (x: number, y: number) => ({ x: (x - c.x) * c.zoom + 650, y: (y - c.y) * c.zoom + 300 });
  const tl = screen(b.minX, b.minY); const br = screen(b.maxX, b.maxY);
  assert.ok(tl.x >= pad.left - 1e-6 && tl.y >= pad.top - 1e-6, 'top-left clear of the top bar');
  assert.ok(br.x <= 1300 - pad.right + 1e-6 && br.y <= 600 - pad.bottom + 1e-6, 'bottom-right clear of the side panel');
});

test('fit camera never produces a degenerate zoom, even when the padding exceeds the viewport', () => {
  const c = fitCamera({ minX: 0, maxX: 100, minY: 0, maxY: 100 }, 300, 300, { top: 400, right: 400, bottom: 400, left: 400 });
  assert.ok(Number.isFinite(c.zoom) && c.zoom >= 0.1);
});
