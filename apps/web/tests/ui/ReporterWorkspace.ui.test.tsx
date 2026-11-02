import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ReporterWorkspace } from '../../src/components/workspaces/ReporterWorkspace';

afterEach(cleanup);

const report = {
  report_id: 'R-1', organization_id: 'ORG-1', zone_id: 'Z-1', reporter_user_id: 'U-1',
  channel: 'WEB', lat: 20.98, lng: 105.84, depth_cm: 55, need_type: 'EVACUATION',
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

describe('Reporter workspace business flows and exceptions', () => {
  it('opens report form and rejects a blank field description', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /báo điểm ngập khẩn cấp/i }));
    const form = screen.getByRole('dialog').querySelector('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form!);
    expect(screen.getByText('Vui lòng nhập mô tả tình hình ngập tại hiện trường.')).toBeTruthy();
  });

  it('keeps the report form open and shows the API error when submission fails', async () => {
    const props = setup({ onCreateReport: vi.fn().mockRejectedValue(new Error('Dịch vụ lưu tin báo đang lỗi')) });
    fireEvent.click(screen.getByRole('button', { name: /báo điểm ngập khẩn cấp/i }));
    fireEvent.change(screen.getByPlaceholderText(/nước tràn vào nhà/i), { target: { value: 'Có 5 người bị mắc kẹt' } });
    fireEvent.click(screen.getByRole('button', { name: /gửi tin báo/i }));
    await waitFor(() => expect(screen.getByText('Dịch vụ lưu tin báo đang lỗi')).toBeTruthy());
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(props.onCreateReport).toHaveBeenCalledWith(expect.objectContaining({
      lat: 20.9782, lng: 105.845, depth_cm: 55, people_affected: 5,
      description: 'Có 5 người bị mắc kẹt', need_type: 'EVACUATION',
    }));
  });

  it('closes the report form only after the API call succeeds', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /báo điểm ngập khẩn cấp/i }));
    fireEvent.change(screen.getByPlaceholderText(/nước tràn vào nhà/i), { target: { value: 'Nước ngập tầng một' } });
    fireEvent.click(screen.getByRole('button', { name: /gửi tin báo/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('confirms the backend resolution id and leaves the confirmation open on failure', async () => {
    const props = setup({
      reports: [report as never],
      orders: [{ report_id: 'R-1', order_id: 'ORD-7' } as never],
      onConfirmResolution: vi.fn().mockRejectedValue(new Error('Mất kết nối máy chủ')),
    });
    fireEvent.click(screen.getByRole('button', { name: /nghiệm thu.*xác nhận an toàn ngay/i }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /xác nhận an toàn/i }));
    await waitFor(() => expect(screen.getByText('Mất kết nối máy chủ')).toBeTruthy());
    expect(props.onConfirmResolution).toHaveBeenCalledWith('RES-ORD-7', 'CONFIRMED', expect.any(String));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('does not submit a made-up resolution id when no completed order exists', async () => {
    const props = setup({ reports: [report as never] });
    fireEvent.click(screen.getByRole('button', { name: /nghiệm thu.*xác nhận an toàn ngay/i }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /xác nhận an toàn/i }));
    expect(await screen.findByText('Chưa có mã nghiệm thu từ đội hiện trường. Vui lòng liên hệ điều phối viên.')).toBeTruthy();
    expect(props.onConfirmResolution).not.toHaveBeenCalled();
  });
});
