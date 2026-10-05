// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import React, { useState } from 'react';
import { useAuth } from '../../context/useAuth';
import { api, ApiError } from '../../services/api';
import { roleLabel } from '../../utils/labels';
import { Modal } from './Modal';

interface ProofInspectorModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type Probe = { status: number; verdict: 'blocked' | 'allowed' | 'other'; message: string };

const Claim: React.FC<{ k: string; v?: string | null }> = ({ k, v }) => (
  <div className="flex justify-between gap-4 py-1.5 text-sm">
    <dt className="font-mono text-xs text-ink-3">{k}</dt>
    <dd className="min-w-0 truncate text-right font-mono text-xs font-semibold" title={v ?? ''}>{v || 'không có'}</dd>
  </div>
);

export const ProofInspectorModal: React.FC<ProofInspectorModalProps> = ({ isOpen, onClose }) => {
  const { user, safeClaims, token } = useAuth();
  const [probe, setProbe] = useState<Probe | null>(null);
  const [testing, setTesting] = useState(false);

  if (!isOpen) return null;

  // sends a dispatch order for a report that does not exist: a role without the permission must get 403 before any lookup
  const runProbe = async () => {
    if (!token) return;
    setTesting(true); setProbe(null);
    try {
      await api.createDispatchOrder(token, { report_id: 'PROBE-NOT-A-REPORT', vehicle_id: 'PROBE', team_id: 'PROBE', start_time: new Date().toISOString(), end_time: new Date(Date.now() + 3_600_000).toISOString() });
      setProbe({ status: 200, verdict: 'allowed', message: 'Yêu cầu không bị từ chối.' });
    } catch (err) {
      if (err instanceof ApiError) {
        const denied = err.status === 403 || err.status === 401;
        setProbe({ status: err.status, verdict: denied ? 'blocked' : 'other', message: err.message });
      } else {
        setProbe({ status: 0, verdict: 'other', message: err instanceof Error ? err.message : 'Lỗi không xác định' });
      }
    } finally { setTesting(false); }
  };

  return (
    <Modal title="Kiểm tra phiên đăng nhập và quyền hạn" onClose={onClose} size="max-w-xl">
      <div className="space-y-5">
        <p className="rounded border border-watch bg-watch-soft p-3 text-xs">
          Các thuộc tính dưới đây chỉ để đối chiếu trên giao diện. Chữ ký token, phân quyền theo vai trò và chính sách phạm vi dữ liệu (RLS) được kiểm tra độc lập tại cổng API và máy chủ.
        </p>

        <section>
          <h4 className="eyebrow mb-1">Thuộc tính token (danh sách cho phép)</h4>
          <dl className="rule-y rounded border border-line px-3">
            <Claim k="sub" v={safeClaims?.sub} />
            <Claim k="preferred_username" v={safeClaims?.preferred_username} />
            <Claim k="name" v={safeClaims?.name || user?.full_name} />
            <Claim k="roles" v={safeClaims?.roles?.join(', ') || user?.role} />
            <Claim k="organization_id" v={safeClaims?.organization_id || user?.organization_id} />
            <Claim k="iss" v={safeClaims?.iss} />
            <Claim k="exp" v={safeClaims?.exp ? new Date(safeClaims.exp * 1000).toLocaleString('vi-VN') : null} />
          </dl>
        </section>

        <section className="border-t border-line pt-4">
          <h4 className="eyebrow mb-1">Thử vượt quyền</h4>
          <p className="mb-3 text-sm text-ink-2">
            Gửi yêu cầu tạo lệnh điều phối (<span className="font-mono text-xs">POST /api/v1/dispatch-orders</span>) bằng vai trò <span className="font-semibold">{roleLabel(user?.role)}</span> với dữ liệu giả. Vai trò không có quyền phải bị từ chối bằng 401/403; điều phối viên sẽ nhận lỗi dữ liệu (không có tin báo như vậy), không phải lỗi quyền.
          </p>
          <button type="button" className="btn" onClick={runProbe} disabled={testing}>{testing ? 'Đang gửi…' : 'Gửi yêu cầu thử'}</button>
          {probe && (
            <p role="status" className={`mt-3 rounded border p-3 text-sm ${probe.verdict === 'blocked' ? 'border-safe bg-safe-soft' : probe.verdict === 'allowed' ? 'border-crit bg-crit-soft' : 'border-line bg-sheet-2'}`}>
              <span className="font-semibold">
                {probe.verdict === 'blocked' ? `Bị chặn đúng (HTTP ${probe.status}).` : probe.verdict === 'allowed' ? 'Không bị chặn: vai trò này được phép điều phối.' : `Không phải lỗi phân quyền (HTTP ${probe.status || 'không rõ'}): vai trò này qua được bước kiểm tra quyền.`}
              </span>{' '}{probe.message}
            </p>
          )}
        </section>
      </div>
    </Modal>
  );
};
