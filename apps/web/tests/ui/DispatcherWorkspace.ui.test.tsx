// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { DispatcherWorkspace } from '../../src/components/workspaces/DispatcherWorkspace';

afterEach(cleanup);

const report = {
  report_id: 'R-2', organization_id: 'ORG-1', zone_id: 'Z-1', reporter_user_id: 'U-2',
  channel: 'WEB', lat: 21.01, lng: 105.81, depth_cm: 68, need_type: 'EVACUATION',
  people_affected: 3, description: 'Ngập nhanh, cần sơ tán', priority: 'URGENT',
  status: 'VERIFIED', created_at: '2026-11-03T08:00:00Z',
};

describe('Dispatcher workspace safety rules', () => {
  it('shows canonical report measurements and blocks dispatch when all resources are unavailable', () => {
    const onDispatchOrder = vi.fn().mockResolvedValue(undefined);
    render(<DispatcherWorkspace
      reports={[report as never]}
      orders={[{ order_id: 'ORD-1', report_id: 'R-1', team_id: 'T-1', vehicle_id: 'V-1', status: 'CONFIRMED' } as never]}
      teams={[{ team_id: 'T-1', team_name: 'Đội 1', leader_name: 'Lê An', status: 'READY' } as never]}
      vehicles={[{ vehicle_id: 'V-1', vehicle_name: 'Xuồng 1', vehicle_type: 'RESCUE_BOAT', status: 'AVAILABLE', fuel_percent: 80 } as never]}
      incidents={[]}
      zones={[]}
      onVerifyReport={vi.fn().mockResolvedValue(undefined)}
      onDispatchOrder={onDispatchOrder}
    />);

    fireEvent.click(screen.getByRole('button', { name: /cần điều phối/i }));
    expect(screen.getByText('68 cm')).toBeTruthy();
    expect(screen.getByText('3 người')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /xuất lệnh điều phối/i }));
    const dialog = screen.getByRole('dialog');
    const dispatchButton = within(dialog).getByRole('button', { name: /phát lệnh tác chiến/i });
    expect(dispatchButton.hasAttribute('disabled')).toBe(true);
    expect((within(dialog).getByRole('combobox', { name: /đội xung kích cứu hộ/i }) as HTMLSelectElement).value).toBe('');
    expect(onDispatchOrder).not.toHaveBeenCalled();
  });

  it('requires a rejection reason and keeps the verification dialog open after an API failure', async () => {
    const onVerifyReport = vi.fn().mockRejectedValue(new Error('Không lưu được kết quả thẩm định'));
    const receivedReport = { ...report, status: 'RECEIVED' };
    render(<DispatcherWorkspace
      reports={[receivedReport as never]} orders={[]} teams={[]} vehicles={[]} incidents={[]} zones={[]}
      onVerifyReport={onVerifyReport}
      onDispatchOrder={vi.fn().mockResolvedValue(undefined)}
    />);

    fireEvent.click(screen.getByRole('button', { name: /thẩm định ngay/i }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /từ chối \/ tin giả/i }));
    fireEvent.submit(dialog.querySelector('form')!);
    expect(screen.getByText('Từ chối tin báo yêu cầu ghi rõ lý do (ít nhất 3 ký tự).')).toBeTruthy();
    expect(onVerifyReport).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByPlaceholderText(/ghi rõ lý do từ chối/i), { target: { value: 'Tin trùng lặp' } });
    fireEvent.submit(dialog.querySelector('form')!);
    await waitFor(() => expect(screen.getByText('Không lưu được kết quả thẩm định')).toBeTruthy());
    expect(onVerifyReport).toHaveBeenCalledWith('R-2', 'URGENT', 'Tin trùng lặp', 'REJECTED');
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
