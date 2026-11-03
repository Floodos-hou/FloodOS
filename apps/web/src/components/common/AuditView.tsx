// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import React from 'react';
import { GitBranch, ShieldCheck } from 'lucide-react';
import type { AuditRecord } from '../../types';
import { formatLocalDateTime } from '../../utils/dateTime';
import { actionLabel, roleLabel } from '../../utils/labels';
import { EmptyState } from '../ui/kit';

interface AuditViewProps {
  logs: AuditRecord[];
  chain?: { chain_valid: boolean; total_blocks: number; latest_hash: string; algorithm: string };
  onOpenLineage: (corrId?: string) => void;
}

/** Hash-chained audit ledger. Each row is a real audit_log record; the chain flag comes from the server. */
export const AuditView: React.FC<AuditViewProps> = ({ logs, chain, onOpenLineage }) => (
  <section className="panel" aria-label="Nhật ký kiểm toán">
    <div className="panel-head">
      <div>
        <h2 className="text-base">Nhật ký kiểm toán</h2>
        <p className="text-xs text-ink-3">Mọi thao tác ghi vào sổ cái băm; không thể sửa hay xóa mà không làm hỏng chuỗi.</p>
      </div>
      {chain && (
        <span className={`chip ${chain.chain_valid ? 'chip-good' : 'chip-bad'}`}>
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
          {chain.chain_valid ? 'Chuỗi hợp lệ' : 'Chuỗi bị phá vỡ'} · {chain.total_blocks} khối
        </span>
      )}
    </div>
    {logs.length === 0 ? (
      <EmptyState title="Chưa có thao tác nào được ghi" />
    ) : (
      <ul className="rule-y">
        {logs.slice(0, 50).map((log) => {
          const failed = (log.http_status ?? 200) >= 400;
          return (
            <li key={log.event_id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm">
              <span className="num w-36 shrink-0 text-xs text-ink-3">{formatLocalDateTime(log.created_at)}</span>
              <span className={`chip ${failed ? 'chip-bad' : 'chip-good'}`}>{failed ? `Từ chối ${log.http_status}` : 'Thành công'}</span>
              <span className="font-semibold">{actionLabel(log.action)}</span>
              <span className="text-xs text-ink-3">{log.actor_user_id} · {roleLabel(log.actor_role)}</span>
              <span className="num ml-auto hidden font-mono text-[11px] text-ink-3 md:inline" title={log.record_hash}>{log.record_hash.slice(0, 12)}…</span>
              <button type="button" className="btn btn-ghost !min-h-8 text-river" onClick={() => onOpenLineage(log.correlation_id)}>
                <GitBranch className="h-3.5 w-3.5" aria-hidden="true" /> Phả hệ
              </button>
            </li>
          );
        })}
      </ul>
    )}
  </section>
);
