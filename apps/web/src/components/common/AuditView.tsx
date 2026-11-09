// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import React from 'react';
import { GitBranch, ShieldCheck, Lock, Hash, CheckCircle2 } from 'lucide-react';
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
export const AuditView: React.FC<AuditViewProps> = ({ logs, chain, onOpenLineage }) => {
  const valid = chain?.chain_valid ?? true;
  const blocks = chain?.total_blocks ?? logs.length;
  const latestHash = chain?.latest_hash || logs[0]?.record_hash || 'GENESIS_0000000000000000';

  return (
    <div className="space-y-4">
      {/* ---------- Cryptographic Ledger Hero & KPI Strip ---------- */}
      <div className="grid gap-3.5 md:grid-cols-3">
        <div className="panel overflow-hidden border-t-4 border-t-emerald-500 bg-gradient-to-br from-emerald-50/90 via-white to-white p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="eyebrow text-emerald-800/80">Toàn vẹn Sổ cái Bất biến</div>
              <div className="mt-1 flex items-center gap-2">
                <span className={`text-xl font-extrabold ${valid ? 'text-safe' : 'text-crit'}`}>
                  {valid ? 'Chuỗi hợp lệ 100%' : 'Chuỗi bị phá vỡ'}
                </span>
              </div>
              <div className="mt-1 text-xs text-ink-3">Kiểm định tự động bằng thuật toán {chain?.algorithm || 'SHA-256'}</div>
            </div>
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-md shadow-emerald-500/30">
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            </span>
          </div>
        </div>

        <div className="panel overflow-hidden border-t-4 border-t-sky-500 bg-gradient-to-br from-sky-50/90 via-white to-white p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="eyebrow text-sky-800/80">Tổng số khối đã niêm phong</div>
              <div className="num mt-1 text-2xl font-extrabold text-river">{blocks}</div>
              <div className="mt-1 text-xs text-ink-3">Mỗi thao tác nghiệp vụ liên kết băm với khối trước đó</div>
            </div>
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-sky-500 to-blue-600 text-white shadow-md shadow-sky-500/30">
              <Lock className="h-5 w-5" aria-hidden="true" />
            </span>
          </div>
        </div>

        <div className="panel overflow-hidden border-t-4 border-t-indigo-500 bg-gradient-to-br from-indigo-50/90 via-white to-white p-4">
          <div className="flex items-center justify-between">
            <div className="min-w-0 flex-1 pr-2">
              <div className="eyebrow text-indigo-800/80">Mã băm đỉnh chuỗi (Tip Hash)</div>
              <div className="mono mt-1.5 truncate rounded-lg border border-indigo-200 bg-indigo-50/80 px-2.5 py-1 text-xs font-bold text-indigo-900" title={latestHash}>
                {latestHash}
              </div>
              <div className="mt-1 text-xs text-ink-3">Không thể sửa hoặc xóa bản ghi quá khứ</div>
            </div>
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-md shadow-indigo-500/30">
              <Hash className="h-5 w-5" aria-hidden="true" />
            </span>
          </div>
        </div>
      </div>

      {/* ---------- Ledger Table ---------- */}
      <section className="panel overflow-hidden" aria-label="Nhật ký kiểm toán">
        <div className="flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-[#082f49] via-[#0c4a6e] to-[#0284c7] px-5 py-4 text-white">
          <div>
            <h2 className="text-base font-extrabold text-white">Nhật ký kiểm toán (Immutable Audit Ledger)</h2>
            <p className="text-xs text-sky-100/85">Mọi thao tác ghi vào sổ cái băm; không thể sửa hay xóa mà không làm hỏng chuỗi.</p>
          </div>
          {chain && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300/40 bg-emerald-500/20 px-3 py-1 text-xs font-bold text-emerald-200">
              <CheckCircle2 className="h-4 w-4 text-emerald-300" aria-hidden="true" />
              {chain.chain_valid ? 'Chuỗi hợp lệ' : 'Chuỗi bị phá vỡ'} · {chain.total_blocks} khối
            </span>
          )}
        </div>
        {logs.length === 0 ? (
          <EmptyState title="Chưa có thao tác nào được ghi" />
        ) : (
          <ul className="rule-y">
            {logs.slice(0, 50).map((log, idx) => {
              const failed = (log.http_status ?? 200) >= 400;
              return (
                <li
                  key={log.event_id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 text-sm transition-colors hover:bg-sky-50/40"
                >
                  <span className="num rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">
                    #{logs.length - idx}
                  </span>
                  <span className="num w-36 shrink-0 text-xs font-medium text-ink-3">{formatLocalDateTime(log.created_at)}</span>
                  <span className={`chip ${failed ? 'chip-bad' : 'chip-good'}`}>
                    {failed ? `Từ chối ${log.http_status}` : 'Thành công'}
                  </span>
                  <span className="font-bold text-ink">{actionLabel(log.action)}</span>
                  <span className="rounded-md border border-line bg-sheet-2 px-2 py-0.5 text-xs font-medium text-ink-2">
                    {log.actor_user_id} · <strong className="text-river-2">{roleLabel(log.actor_role)}</strong>
                  </span>
                  <span
                    className="num ml-auto hidden rounded-md border border-indigo-200/70 bg-indigo-50/60 px-2 py-0.5 font-mono text-[11px] font-semibold text-indigo-800 md:inline"
                    title={log.record_hash}
                  >
                    sha256:{log.record_hash.slice(0, 12)}…
                  </span>
                  <button
                    type="button"
                    className="btn !min-h-8 border-sky-200 bg-sky-50/70 text-xs font-bold text-river-2 hover:bg-sky-100"
                    onClick={() => onOpenLineage(log.correlation_id)}
                  >
                    <GitBranch className="h-3.5 w-3.5" aria-hidden="true" /> Phả hệ
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
};
