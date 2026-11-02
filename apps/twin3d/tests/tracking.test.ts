// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ageText, fieldColor, requestSteps, shiftSteps, sortFields, sortMachines } from '../src/logic/tracking.ts';

const states = (s: { state: string }[]) => s.map((x) => x.state).join(',');

test('request steps move forward with the workflow and end complete', () => {
  assert.equal(states(requestSteps('SUBMITTED')), 'current,todo,todo,todo,todo');
  assert.equal(states(requestSteps('SCHEDULED')), 'done,current,todo,todo,todo');
  assert.equal(states(requestSteps('IN_PROGRESS')), 'done,done,current,todo,todo');
  assert.equal(states(requestSteps('WAITING_ACCEPTANCE')), 'done,done,done,current,todo');
  assert.equal(states(requestSteps('COMPLETED')), 'done,done,done,done,done');
});

test('an incident shows a red step instead of pretending progress', () => {
  for (const st of ['IMPACTED_BY_INCIDENT', 'RESCHEDULED']) {
    const s = requestSteps(st);
    assert.equal(s[2].state, 'bad');
    assert.match(s[2].label, /Sự cố/);
  }
  assert.deepEqual(requestSteps('CANCELLED'), [{ label: 'Đã hủy', state: 'bad' }]);
});

test('unknown request status falls back to the first step, never throws', () => {
  assert.equal(requestSteps('???')[0].state, 'current');
});

test('shift steps, including a superseded shift handed to another machine', () => {
  assert.equal(states(shiftSteps('CONFIRMED')), 'current,todo,todo');
  assert.equal(states(shiftSteps('IN_PROGRESS')), 'done,current,todo');
  assert.equal(states(shiftSteps('COMPLETED')), 'done,done,done');
  assert.equal(states(shiftSteps('IMPACTED')), 'done,bad,todo');
  assert.equal(shiftSteps('SUPERSEDED')[0].label, 'Đã chuyển cho máy khác');
  assert.deepEqual(shiftSteps(undefined), []);
});

test('machines needing attention come first and sorting does not mutate the input', () => {
  const input = [
    { machine_id: 'M04', status: 'MAINTENANCE' }, { machine_id: 'M02', status: 'IDLE' },
    { machine_id: 'M03', status: 'WORKING' }, { machine_id: 'M01', status: 'BREAKDOWN' }, { machine_id: 'M00', status: 'WORKING' },
  ];
  const copy = JSON.stringify(input);
  assert.deepEqual(sortMachines(input).map((m) => m.machine_id), ['M01', 'M00', 'M03', 'M02', 'M04']);
  assert.equal(JSON.stringify(input), copy);
});

test('fields: blocked and harvesting first, finished last', () => {
  const f = [{ field_id: 'A', readiness_status: 'COMPLETED' }, { field_id: 'B', readiness_status: 'GROWING' }, { field_id: 'C', readiness_status: 'HARVESTING' }, { field_id: 'D', readiness_status: 'IMPACTED' }];
  assert.deepEqual(sortFields(f).map((x) => x.field_id), ['D', 'C', 'B', 'A']);
});

test('field colours: blocked is red whatever the stage, each stage is distinct', () => {
  assert.equal(fieldColor('HARVESTING', true), '#e5484d');
  const cols = ['GROWING', 'READY_HARVEST', 'HARVESTING', 'COMPLETED'].map((s) => fieldColor(s, false));
  assert.equal(new Set(cols).size, 4);
  assert.equal(fieldColor('???', false), fieldColor('GROWING', false));
});

test('age text in seconds, minutes and hours; bad input is "không rõ"', () => {
  const now = Date.parse('2026-11-02T10:00:00Z');
  assert.equal(ageText('2026-11-02T09:59:30Z', now), '30 giây trước');
  assert.equal(ageText('2026-11-02T09:50:00Z', now), '10 phút trước');
  assert.equal(ageText('2026-11-02T07:00:00Z', now), '3 giờ trước');
  assert.equal(ageText('', now), 'không rõ');
  assert.equal(ageText('2026-11-02T10:05:00Z', now), '0 giây trước', 'future timestamps clamp to zero');
});
