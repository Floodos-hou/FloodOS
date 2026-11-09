// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { DispatcherWorkspace } from '../../src/components/workspaces/DispatcherWorkspace';

afterEach(cleanup);

const baseReport = {
  report_id: 'R-2', organization_id: 'ORG-1', zone_id: 'Z-1', reporter_user_id: 'U-2',
  channel: 'APP', lat: 21.0, lng: 105.8, depth_cm: 68, need_type: 'EVACUATION',
  people_affected: 3, description: 'Ngập nhanh, cần sơ tán', priority: 'URGENT',
  status: 'RECEIVED', created_at: '2026-11-03T08:00:00Z',
};

const team = (id: string, status = 'READY') => ({ team_id: id, name: `Đội ${id}`, member_count: 4, rating: 4.5, status });
const vehicle = (id: string, lat: number, status = 'IDLE') => ({
  vehicle_id: id, name: `Xe ${id}`, vehicle_type: 'RESCUE_BOAT', status, fuel_pct: 80, current_lat: lat, current_lng: 105.8,
});

const setup = (overrides: Partial<React.ComponentProps<typeof DispatcherWorkspace>> = {}) => {
  const props: React.ComponentProps<typeof DispatcherWorkspace> = {
    reports: [], orders: [], teams: [], vehicles: [], incidents: [], zones: [],
    onVerifyReport: vi.fn().mockResolvedValue(undefined),
    onDispatchOrder: vi.fn().mockResolvedValue(undefined),
    onApproveReplan: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  render(<DispatcherWorkspace {...props} />);
  return props;
};

const openQueue = (name: RegExp) => fireEvent.click(screen.getByRole('tab', { name }));
const pickFirstRow = () => {
  const queue = screen.getByLabelText('Hàng đợi vụ việc');
  const row = within(queue).getAllByRole('button').find((b) => b.getAttribute('role') !== 'tab');
  fireEvent.click(row!);
};

describe('Dispatcher console safety rules', () => {
  it('shows an unverified report with its measurements and starts the verification note empty', () => {
    setup({ reports: [baseReport as never] });
    pickFirstRow();
    const form = screen.getByRole('form', { name: /xác minh tin báo/i });
    expect(within(screen.getByLabelText(/hồ sơ R-2/i)).getByText('68 cm')).toBeTruthy();
    // the system never writes "đã liên lạc" on the dispatcher's behalf
    expect((within(form).getByLabelText(/ghi chú xác minh/i) as HTMLTextAreaElement).value).toBe('');
  });

  it('requires a rejection reason and keeps the form open after an API failure', async () => {
    const onVerifyReport = vi.fn().mockRejectedValue(new Error('Không lưu được kết quả xác minh'));
    setup({ reports: [baseReport as never], onVerifyReport });
    pickFirstRow();
    const form = screen.getByRole('form', { name: /xác minh tin báo/i });
    fireEvent.click(within(form).getByRole('radio', { name: /từ chối/i }));
    fireEvent.submit(form);
    expect(screen.getByText('Từ chối tin báo yêu cầu ghi rõ lý do (ít nhất 3 ký tự).')).toBeTruthy();
    expect(onVerifyReport).not.toHaveBeenCalled();

    fireEvent.change(within(form).getByLabelText(/lý do từ chối/i), { target: { value: 'Tin trùng lặp' } });
    fireEvent.submit(form);
    await waitFor(() => expect(screen.getByText('Không lưu được kết quả xác minh')).toBeTruthy());
    expect(onVerifyReport).toHaveBeenCalledWith('R-2', 'URGENT', 'Tin trùng lặp', 'REJECTED');
    expect(screen.getByRole('form', { name: /xác minh tin báo/i })).toBeTruthy();
  });

  it('blocks dispatch and says why when every vehicle and team is busy', () => {
    const verified = { ...baseReport, status: 'VERIFIED' };
    const onDispatchOrder = vi.fn().mockResolvedValue(undefined);
    setup({
      reports: [verified as never],
      orders: [{ order_id: 'ORD-1', report_id: 'R-1', team_id: 'T1', vehicle_id: 'V1', status: 'CONFIRMED' } as never],
      teams: [team('T1') as never], vehicles: [vehicle('V1', 21.0) as never], onDispatchOrder,
    });
    openQueue(/chờ điều phối/i);
    pickFirstRow();
    expect(screen.getByText(/không có phương tiện nào sẵn sàng/i)).toBeTruthy();
    expect(screen.getByText(/không có đội nào sẵn sàng/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /phát lệnh điều phối/i }).hasAttribute('disabled')).toBe(true);
    expect(onDispatchOrder).not.toHaveBeenCalled();
  });

  it('lists the nearest vehicle first, preselects nothing, and dispatches only what the dispatcher chose', async () => {
    const verified = { ...baseReport, status: 'VERIFIED', lat: 21.0, lng: 105.8 };
    const onDispatchOrder = vi.fn().mockResolvedValue(undefined);
    setup({
      reports: [verified as never],
      teams: [team('T1') as never, team('T2') as never],
      vehicles: [vehicle('FAR', 21.05) as never, vehicle('NEAR', 21.001) as never],
      onDispatchOrder,
    });
    openQueue(/chờ điều phối/i);
    pickFirstRow();

    const radios = screen.getAllByRole('radio').filter((r) => (r as HTMLInputElement).name === 'vehicle');
    expect(radios.map((r) => r.getAttribute('aria-label'))).toEqual(['Phương tiện Xe NEAR', 'Phương tiện Xe FAR']);
    expect(radios.some((r) => (r as HTMLInputElement).checked)).toBe(false);
    expect(screen.getByRole('button', { name: /phát lệnh điều phối/i }).hasAttribute('disabled')).toBe(true);

    fireEvent.click(screen.getByRole('radio', { name: 'Phương tiện Xe NEAR' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Đội T2' }));
    fireEvent.click(screen.getByRole('radio', { name: '2 giờ' }));
    fireEvent.click(screen.getByRole('button', { name: /phát lệnh điều phối/i }));
    await waitFor(() => expect(onDispatchOrder).toHaveBeenCalledOnce());
    const sent = onDispatchOrder.mock.calls[0][0];
    expect(sent).toMatchObject({ report_id: 'R-2', vehicle_id: 'NEAR', team_id: 'T2' });
    expect(Date.parse(sent.target_time) - Date.now()).toBeGreaterThan(110 * 60_000);
  });

  it('shows the server error (for example a double booking) and keeps the dispatch form', async () => {
    const verified = { ...baseReport, status: 'VERIFIED' };
    setup({
      reports: [verified as never], teams: [team('T1') as never], vehicles: [vehicle('V1', 21.0) as never],
      onDispatchOrder: vi.fn().mockRejectedValue(new Error('Trùng lịch: xe đã có lệnh trong khung giờ này.')),
    });
    openQueue(/chờ điều phối/i);
    pickFirstRow();
    fireEvent.click(screen.getByRole('radio', { name: 'Phương tiện Xe V1' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Đội T1' }));
    fireEvent.click(screen.getByRole('radio', { name: '1 giờ' }));
    fireEvent.click(screen.getByRole('button', { name: /phát lệnh điều phối/i }));
    await waitFor(() => expect(screen.getByText(/trùng lịch/i)).toBeTruthy());
    expect(screen.getByRole('form', { name: /lệnh điều phối/i })).toBeTruthy();
  });

  it('makes the dispatcher choose a replacement option; approving sends exactly that option id', async () => {
    const onApproveReplan = vi.fn().mockResolvedValue(undefined);
    setup({
      vehicles: [vehicle('V2', 21.0, 'BREAKDOWN') as never],
      incidents: [{
        incident_id: 'INC-1', vehicle_id: 'V2', incident_type: 'ENGINE_FAILURE', status: 'OPEN_REPLANNING',
        description: 'Chết máy giữa dòng', estimated_downtime_hours: 3, created_at: '2026-11-03T08:00:00Z',
        candidate_options: [
          { option_id: 'OPT-A', vehicle_id: 'V5', team_id: 'T5', distance_km: 1.2, distance_kind: 'STRAIGHT_LINE_HAVERSINE', score: 82.4, suitability: 1, capacity_fit: 1, rank: 1 },
          { option_id: 'OPT-B', vehicle_id: 'V6', team_id: 'T6', distance_km: 3.4, distance_kind: 'STRAIGHT_LINE_HAVERSINE', score: 61, suitability: 1, capacity_fit: 1, rank: 2 },
        ],
      } as never],
      onApproveReplan,
    });
    openQueue(/sự cố xe/i);
    pickFirstRow();
    expect(screen.getAllByText(/đường chim bay/i).length).toBeGreaterThan(0);
    const approve = screen.getByRole('button', { name: /duyệt phương án đã chọn/i });
    expect(approve.hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: 'Phương án 2' }));
    fireEvent.click(approve);
    await waitFor(() => expect(onApproveReplan).toHaveBeenCalledWith('INC-1', 'OPT-B'));
  });

  it('exposes AI Tactical Summary and After-Action Report actions on reports', async () => {
    const resolvedReport = { ...baseReport, report_id: 'R-RESOLVED', status: 'RESOLVED' };
    setup({ reports: [baseReport as never, resolvedReport as never] });
    pickFirstRow();
    expect(screen.getByRole('button', { name: /tóm tắt ai/i })).toBeTruthy();

    openQueue(/tất cả/i);
    const rows = screen.getByLabelText('Hàng đợi vụ việc');
    const resolvedBtn = within(rows).getByText(/đã xử lý xong/i);
    fireEvent.click(resolvedBtn);
    expect(screen.getByRole('button', { name: /xem báo cáo sau vụ việc/i })).toBeTruthy();
  });
});
