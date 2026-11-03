// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ReporterWorkspace } from '../../src/components/workspaces/ReporterWorkspace';

afterEach(cleanup);

const report = {
  report_id: 'R-1', organization_id: 'ORG-1', zone_id: 'Z-1', reporter_user_id: 'U-1',
  channel: 'APP', lat: 20.98, lng: 105.84, depth_cm: 55, need_type: 'EVACUATION',
  people_affected: 5, description: 'Nước tràn vào nhà', priority: 'URGENT',
  status: 'AWAITING_CONFIRMATION', created_at: '2026-11-03T08:00:00Z',
};

const setup = (overrides: Partial<React.ComponentProps<typeof ReporterWorkspace>> = {}) => {
  const props: React.ComponentProps<typeof ReporterWorkspace> = {
    reports: [], orders: [], zones: [], shelters: [], resolutions: [],
    onCreateReport: vi.fn().mockResolvedValue(undefined),
    onConfirmResolution: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  render(<ReporterWorkspace {...props} />);
  return props;
};

/** answers every required question of the report form through the UI */
const fillReportForm = (description = 'Có 5 người bị mắc kẹt') => {
  const dialog = screen.getByRole('dialog');
  fireEvent.click(within(dialog).getByRole('radio', { name: /sơ tán khẩn cấp/i }));
  fireEvent.click(within(dialog).getByRole('button', { name: /nhập tọa độ thủ công/i }));
  fireEvent.change(within(dialog).getByLabelText('Vĩ độ'), { target: { value: '20.9782' } });
  fireEvent.change(within(dialog).getByLabelText('Kinh độ'), { target: { value: '105.845' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Dùng' }));
  fireEvent.click(within(dialog).getByRole('button', { name: '50' }));
  fireEvent.change(within(dialog).getByLabelText(/có bao nhiêu người/i), { target: { value: '5' } });
  fireEvent.change(within(dialog).getByLabelText(/mô tả ngắn/i), { target: { value: description } });
};

describe('Reporter workspace business flows and exceptions', () => {
  it('opens an empty report form: nothing is pre-selected and sending is disabled', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /báo điểm ngập/i }));
    const dialog = screen.getByRole('dialog');
    expect((within(dialog).getByLabelText(/có bao nhiêu người/i) as HTMLInputElement).value).toBe('');
    expect((within(dialog).getByLabelText('Độ sâu (cm)') as HTMLInputElement).value).toBe('');
    expect(within(dialog).getAllByRole('radio').every((r) => r.getAttribute('aria-checked') === 'false')).toBe(true);
    expect(within(dialog).getByRole('button', { name: /gửi tin báo/i }).hasAttribute('disabled')).toBe(true);
  });

  it('rejects out-of-range manual coordinates instead of using them', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /báo điểm ngập/i }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /nhập tọa độ thủ công/i }));
    fireEvent.change(within(dialog).getByLabelText('Vĩ độ'), { target: { value: '200' } });
    fireEvent.change(within(dialog).getByLabelText('Kinh độ'), { target: { value: '105' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Dùng' }));
    expect(within(dialog).getByText('Tọa độ không hợp lệ.')).toBeTruthy();
    expect(within(dialog).getByText('Chưa chọn vị trí')).toBeTruthy();
  });

  it('keeps the report form open and shows the API error when submission fails', async () => {
    const props = setup({ onCreateReport: vi.fn().mockRejectedValue(new Error('Dịch vụ lưu tin báo đang lỗi')) });
    fireEvent.click(screen.getByRole('button', { name: /báo điểm ngập/i }));
    fillReportForm();
    fireEvent.click(screen.getByRole('button', { name: /gửi tin báo/i }));
    await waitFor(() => expect(screen.getByText('Dịch vụ lưu tin báo đang lỗi')).toBeTruthy());
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(props.onCreateReport).toHaveBeenCalledWith(expect.objectContaining({
      lat: 20.9782, lng: 105.845, depth_cm: 50, people_affected: 5,
      description: 'Có 5 người bị mắc kẹt', need_type: 'EVACUATION',
    }));
  });

  it('closes the report form only after the API call succeeds', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /báo điểm ngập/i }));
    fillReportForm('Nước ngập tầng một');
    fireEvent.click(screen.getByRole('button', { name: /gửi tin báo/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('offers confirmation only for a report that is waiting for the reporter', () => {
    setup({ reports: [{ ...report, status: 'IN_PROGRESS' } as never] });
    expect(screen.queryByRole('button', { name: /xác nhận đã được hỗ trợ/i })).toBeNull();
  });

  it('confirms the backend resolution id and leaves the confirmation open on failure', async () => {
    const props = setup({
      reports: [report as never],
      orders: [{ report_id: 'R-1', order_id: 'ORD-7' } as never],
      onConfirmResolution: vi.fn().mockRejectedValue(new Error('Mất kết nối máy chủ')),
    });
    fireEvent.click(screen.getByRole('button', { name: /xác nhận đã được hỗ trợ/i }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /đã ổn, đóng tin/i }));
    await waitFor(() => expect(screen.getByText('Mất kết nối máy chủ')).toBeTruthy());
    expect(props.onConfirmResolution).toHaveBeenCalledWith('RES-ORD-7', 'CONFIRMED', expect.any(String));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('requires a reason before disputing a resolution', () => {
    const props = setup({ reports: [report as never], orders: [{ report_id: 'R-1', order_id: 'ORD-7' } as never] });
    fireEvent.click(screen.getByRole('button', { name: /xác nhận đã được hỗ trợ/i }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /chưa ổn/i }));
    expect(screen.getByText(/ít nhất 3 ký tự/i)).toBeTruthy();
    expect(props.onConfirmResolution).not.toHaveBeenCalled();
  });

  it('does not submit a made-up resolution id when no completed order exists', () => {
    const props = setup({ reports: [report as never] });
    fireEvent.click(screen.getByRole('button', { name: /xác nhận đã được hỗ trợ/i }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /đã ổn, đóng tin/i }));
    expect(screen.getByText('Chưa có biên bản xử lý từ đội hiện trường. Vui lòng liên hệ điều phối viên.')).toBeTruthy();
    expect(props.onConfirmResolution).not.toHaveBeenCalled();
  });
});
