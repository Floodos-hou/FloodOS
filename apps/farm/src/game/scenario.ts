// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenAgriOS Contributors

import { api } from '../../../web/src/services/api';

const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

/**
 * "Sự kiện bất ngờ": a breakdown on a working machine, the system's rescue proposal, approval and the rescuer driving
 * to the field. It calls the real API (coordinator role), so every effect in the game is caused by real state changes.
 */
export async function runBreakdownEvent(
  token: string,
  machineId: string,
  onStep: (text: string) => void,
  refresh: () => Promise<void>
): Promise<void> {
  onStep(`Báo sự cố cho máy ${machineId}…`);
  const inc: any = await api.reportIncident(token, {
    machine_id: machineId, severity: 'CRITICAL', incident_type: 'Động cơ quá nóng',
    description: 'Sự kiện bất ngờ từ Nông trại số', estimated_downtime_hours: 24, evidence_filename: 'su_co_nong_trai.jpg',
  });
  await refresh();
  const options: any[] = inc.candidate_options ?? [];
  if (options.length === 0) {
    onStep('Không có máy nào rảnh để thay thế (đúng như hệ thống sẽ làm).');
    return;
  }
  await sleep(2200);
  const best = options[0];
  onStep(`Hệ thống đề xuất ${best.machine_id}: ${best.score} điểm, cách ${best.distance_km} km`);
  await sleep(2200);
  const approved: any = await api.approveReplan(token, inc.incident_id, { option_id: best.option_id });
  await refresh();
  onStep(`${best.machine_id} xuất phát cứu viện`);
  await sleep(1200);
  await api.updateAssignmentStatus(token, approved.new_assignment_id, { status: 'IN_PROGRESS', progress_pct: 5, note: 'Nông trại số: máy thay thế xuất phát' });
  await refresh();
  for (let i = 1; i <= 4; i++) {
    await sleep(1800);
    await api.simTick(token);
    await refresh();
  }
  onStep(`${best.machine_id} đã tới ruộng`);
}
