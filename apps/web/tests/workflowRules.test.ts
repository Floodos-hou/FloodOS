// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isActiveDispatchOrder,
  isActiveIncident,
  isTeamAvailable,
  isVehicleAvailable,
  reportDepthCm,
  reportPeopleAffected,
  resolutionIdForReport,
  validateDisputeReason,
  validateReportDescription,
  validateRejectionReason,
} from '../src/utils/workflowRules.ts';

test('active orders include backend states and exclude terminal states', () => {
  for (const status of ['CONFIRMED', 'IN_PROGRESS', 'IMPACTED']) {
    assert.equal(isActiveDispatchOrder(status), true, `${status} should be active`);
  }
  for (const status of ['COMPLETED', 'CANCELLED', 'SUPERSEDED']) {
    assert.equal(isActiveDispatchOrder(status), false, `${status} should be terminal`);
  }
});

test('open replanning incidents remain visible to dispatchers', () => {
  assert.equal(isActiveIncident('OPEN_REPLANNING'), true);
  assert.equal(isActiveIncident('RESOLVED'), false);
});

test('report display reads canonical API fields and accepts legacy aliases', () => {
  assert.equal(reportDepthCm({ depth_cm: 72, flood_depth_cm: 50 }), 72);
  assert.equal(reportPeopleAffected({ people_affected: 4, people_count: 2 }), 4);
  assert.equal(reportDepthCm({ flood_depth_cm: 33 }), 33);
  assert.equal(reportPeopleAffected({ people_count: 6 }), 6);
});

test('report confirmation uses a real resolution id or the backend order-derived id', () => {
  assert.equal(resolutionIdForReport('R-1', [{ report_id: 'R-1', resolution_id: 'RES-REAL' }], []), 'RES-REAL');
  assert.equal(resolutionIdForReport('R-1', [], [{ report_id: 'R-1', order_id: 'ORD-1' }]), 'RES-ORD-1');
  assert.equal(resolutionIdForReport('R-1', [], []), null, 'must not invent an id from a report id');
});

test('resource availability rejects an offline vehicle and a team already assigned to an active order', () => {
  assert.equal(isVehicleAvailable({ vehicle_id: 'v1', status: 'OFFLINE' }, new Set()), false);
  assert.equal(isTeamAvailable({ team_id: 't1', status: 'READY' }, new Set(['t1'])), false);
  assert.equal(isVehicleAvailable({ vehicle_id: 'v2', status: 'IDLE' }, new Set()), true);
});

test('business forms reject blank report descriptions and reasonless rejection/dispute actions', () => {
  assert.ok(validateReportDescription('   '));
  assert.equal(validateReportDescription('Nước tràn vào nhà'), null);
  assert.ok(validateRejectionReason(' '));
  assert.equal(validateRejectionReason('Tin báo trùng'), null);
  assert.ok(validateDisputeReason('x'));
  assert.equal(validateDisputeReason('Nước vẫn còn ngập'), null);
});
