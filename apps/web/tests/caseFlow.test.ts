// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reportStages } from '../src/utils/caseFlow.ts';

const states = (status: string) => reportStages(status).map((s) => s.state).join(',');

test('a new report is at the first station and everything after it is still to do', () => {
  assert.equal(states('RECEIVED'), 'current,todo,todo,todo,todo');
});

test('stations before the current one are done, in lifecycle order', () => {
  assert.equal(states('VERIFIED'), 'done,current,todo,todo,todo');
  assert.equal(states('DISPATCHED'), 'done,done,current,todo,todo');
  assert.equal(states('IN_PROGRESS'), 'done,done,done,current,todo');
  assert.equal(states('AWAITING_CONFIRMATION'), 'done,done,done,done,current');
  assert.equal(states('RESOLVED'), 'done,done,done,done,done');
});

test('a rejected report stops at verification and marks it as failed instead of pretending progress', () => {
  assert.equal(states('REJECTED'), 'done,bad,todo,todo,todo');
});

test('a report impacted by a vehicle breakdown flags the handling station, not the whole case', () => {
  assert.equal(states('IMPACTED'), 'done,done,done,bad,todo');
});

test('the five stations always carry Vietnamese labels', () => {
  assert.deepEqual(reportStages('RECEIVED').map((s) => s.label), ['Tiếp nhận', 'Xác minh', 'Điều phối', 'Xử lý', 'Xác nhận']);
});
