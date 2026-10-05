// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import React, { useState, useEffect } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useAuth } from '../../context/useAuth';
import { api } from '../../services/api';
import { formatLocalDateTime } from '../../utils/dateTime';
import { actionLabel, roleLabel } from '../../utils/labels';
import { Modal } from './Modal';
import { TraceLink } from './TraceLink';
import { EmptyState } from '../ui/kit';

interface DataLineageModalProps {
  isOpen: boolean;
  onClose: () => void;
  correlationId: string;
}

interface Lineage {
  correlation_id: string;
  chain_proof: { chain_valid: boolean; total_blocks: number; latest_hash: string; algorithm: string };
  lineage_steps: Array<{
    seq_no: number; event_id: string; action: string; entity_type: string; entity_id: string;
    actor_user_id: string; actor_role: string; created_at: string; record_hash: string;
  }>;
}

/** Who did what to this case, in order, with the hash that chains each step to the previous one. */
export const DataLineageModal: React.FC<DataLineageModalProps> = ({ isOpen, onClose, correlationId }) => {
  const { token } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Lineage | null>(null);

  useEffect(() => {
    if (!isOpen || !token || !correlationId) return;
    let cancelled = false;
    const t = window.setTimeout(() => { if (!cancelled) { setLoading(true); setError(null); setData(null); } }, 0);
    api.getLineage(token, correlationId)
      .then((d) => { if (!cancelled) setData(d as Lineage); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Không tải được nhật ký.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; window.clearTimeout(t); };
  }, [isOpen, token, correlationId]);

  if (!isOpen) return null;
  const proof = data?.chain_proof;

  return (
    <Modal title="Nhật ký kiểm chứng của vụ việc" onClose={onClose} size="max-w-2xl">
      <div className="space-y-4">
        {proof && (
          <div className={`rounded border p-3 ${proof.chain_valid ? 'border-safe bg-safe-soft' : 'border-crit bg-crit-soft'}`}>
            <div className="flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck className={`h-5 w-5 ${proof.chain_valid ? 'text-safe' : 'text-crit'}`} aria-hidden="true" />
              {proof.chain_valid ? 'Chuỗi băm hợp lệ: chưa có bản ghi nào bị sửa' : 'Cảnh báo: chuỗi băm bị phá vỡ'}
            </div>
            <p className="mt-1 text-xs text-ink-2">
              Mã vụ việc <span className="font-mono">{data?.correlation_id}</span> · {proof.total_blocks} khối toàn sổ · thuật toán {proof.algorithm} · khối mới nhất <span className="font-mono" title={proof.latest_hash}>{proof.latest_hash?.slice(0, 12)}…</span>
            </p>
            <div className="mt-2"><TraceLink traceId={String(data?.correlation_id)} /></div>
          </div>
        )}

        <h4 className="eyebrow">Ai đã làm gì, theo thứ tự thời gian</h4>
        {loading ? (
          <p className="py-6 text-center text-sm text-ink-3">Đang tải…</p>
        ) : error ? (
          <p role="alert" className="rounded border border-crit bg-crit-soft p-3 text-sm text-crit">{error}</p>
        ) : data && data.lineage_steps.length > 0 ? (
          <ol className="relative space-y-3 border-l-2 border-line-2 pl-5">
            {data.lineage_steps.map((s) => (
              <li key={s.event_id} className="relative">
                <span className="absolute -left-[27px] top-1 h-3 w-3 rounded-full border-2 border-river bg-sheet" />
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold">{actionLabel(s.action)}</span>
                  <span className="num text-xs text-ink-3">{formatLocalDateTime(s.created_at)}</span>
                </div>
                <div className="text-xs text-ink-2">{s.actor_user_id} · {roleLabel(s.actor_role)} · {s.entity_type} {s.entity_id}</div>
                <div className="num truncate font-mono text-[11px] text-ink-3" title={s.record_hash}>#{s.seq_no} · {s.record_hash}</div>
              </li>
            ))}
          </ol>
        ) : (
          <EmptyState title="Chưa có bản ghi cho mã giao dịch này" />
        )}
      </div>
    </Modal>
  );
};
