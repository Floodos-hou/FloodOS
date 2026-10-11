// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { FieldTeamWorkspace } from '../../src/components/workspaces/FieldTeamWorkspace';

afterEach(cleanup);

const teams = [
  { team_id: 'T-OTHER', lead_user_id: 'U-OTHER', name: 'Đội khác', member_count: 3, rating: 4, status: 'ON_MISSION' },
  { team_id: 'T-ME', lead_user_id: 'U-ME', name: 'Đội của tôi', member_count: 5, rating: 4.8, status: 'ON_MISSION' },
];
const orders = [
  { order_id: 'ORD-OTHER', team_id: 'T-OTHER', vehicle_id: 'V1', report_id: 'R-1', status: 'IN_PROGRESS', progress_pct: 40, created_at: '2026-11-03T08:00:00Z' },
  { order_id: 'ORD-ME', team_id: 'T-ME', vehicle_id: 'V2', report_id: 'R-2', status: 'CONFIRMED', progress_pct: 0, created_at: '2026-11-03T09:00:00Z' },
];
const reports = [
  { report_id: 'R-1', lat: 21, lng: 105.8, depth_cm: 10, need_type: 'PUMPING', people_affected: 1, priority: 'NORMAL', status: 'DISPATCHED', created_at: '2026-11-03T08:00:00Z' },
  { report_id: 'R-2', lat: 21.01, lng: 105.81, depth_cm: 70, need_type: 'EVACUATION', people_affected: 4, priority: 'URGENT', status: 'DISPATCHED', created_at: '2026-11-03T09:00:00Z', address_hint: 'Ngõ 12 Hoàng Mai' },
];
const vehicles = [{ vehicle_id: 'V2', name: 'Xuồng 2', vehicle_type: 'RESCUE_BOAT', status: 'MOVING', current_lat: 21, current_lng: 105.8 }];

const setup = (currentUserId = 'U-ME', over: Partial<React.ComponentProps<typeof FieldTeamWorkspace>> = {}) => {
  const props: React.ComponentProps<typeof FieldTeamWorkspace> = {
    currentUserId, teams: teams as never, vehicles: vehicles as never, orders: orders as never, reports: reports as never, incidents: [],
    onUpdateOrderStatus: vi.fn().mockResolvedValue(undefined),
    onReportIncident: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
  render(<FieldTeamWorkspace {...props} />);
  return props;
};

describe('Field team workspace', () => {
  it("shows only the mission of the team this account leads, never another team's order", () => {
    setup('U-ME');
    expect(screen.getByText('Đội của tôi')).toBeTruthy();
    expect(screen.getByText(/ORD-ME/)).toBeTruthy();
    expect(screen.queryByText(/ORD-OTHER/)).toBeNull();
    expect(screen.getByText('Ngõ 12 Hoàng Mai')).toBeTruthy();
  });

  it('does not fall back to the first team when the account leads none', () => {
    setup('U-NOBODY');
    expect(screen.getByText(/chưa được gán đội cứu hộ/i)).toBeTruthy();
    expect(screen.queryByText(/ORD-/)).toBeNull();
  });

  it('starts the mission with progress 0 rather than an invented percentage', async () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: /nhận lệnh, bắt đầu di chuyển/i }));
    await waitFor(() => expect(props.onUpdateOrderStatus).toHaveBeenCalledWith('ORD-ME', 'IN_PROGRESS', { progress_pct: 0 }));
  });

  it('reports an incident only with every answer given, using the backend enums and the entered downtime', async () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: /báo sự cố phương tiện/i }));
    const dialog = screen.getByRole('dialog');
    fireEvent.submit(dialog.querySelector('form')!);
    expect(within(dialog).getByText(/chọn loại và mức độ sự cố/i)).toBeTruthy();
    expect(props.onReportIncident).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('radio', { name: /hỏng \/ chết máy/i }));
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Nặng' }));
    fireEvent.change(within(dialog).getByLabelText(/ước tính ngừng hoạt động/i), { target: { value: '2.5' } });
    fireEvent.change(within(dialog).getByLabelText('Mô tả'), { target: { value: 'Động cơ không nổ máy' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /gửi báo cáo sự cố/i }));
    await waitFor(() => expect(props.onReportIncident).toHaveBeenCalledWith(expect.objectContaining({
      order_id: 'ORD-ME', vehicle_id: 'V2', incident_type: 'ENGINE_FAILURE', severity: 'MAJOR', estimated_downtime_hours: 2.5,
    })));
  });
});
