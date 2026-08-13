// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import React, { useState } from 'react';
import { useAuth } from '../../context/useAuth';
import { AuditRecord } from '../../types';
import { formatLocalTime } from '../../utils/dateTime';
import { actionLabel, orgLabel, roleLabel } from '../../utils/labels';
import { Terminal, ChevronUp, ChevronDown, GitBranch, Radio } from 'lucide-react';

interface BottomCombatLogProps {
  orgName?: string;
  auditLogs: AuditRecord[];
  onOpenLineage: (corrId?: string) => void;
}

export const BottomCombatLog: React.FC<BottomCombatLogProps> = ({ auditLogs, onOpenLineage, orgName }) => {
  const { tenantId } = useAuth();
  // Collapsed by default: an open fixed bar would cover the main action buttons on small screens
  const [collapsed, setCollapsed] = useState(true);

  return (
    <aside 
      aria-label="Nhật ký giao dịch kiểm toán được đồng bộ định kỳ"
      className="fixed bottom-0 left-0 right-0 z-20 bg-slate-900 border-t border-slate-700 shadow-2xl transition-all duration-300"
    >
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-slate-950 text-slate-300 text-sm border-b border-slate-800">
        <div className="flex items-center space-x-3">
          <Terminal className="w-4 h-4 text-emerald-400" />
          <span className="font-bold text-slate-200">Nhật ký hoạt động</span>
          <div className="flex items-center space-x-1.5 px-2 py-0.5 rounded-full bg-slate-800 text-sm">
            <Radio className="w-3 h-3 text-amber-400" />
            <span>Tự cập nhật · 20 giây</span>
          </div>
          <span className="text-slate-500 hidden sm:inline">|</span>
          <span className="text-slate-400 hidden sm:inline">Đơn vị: {tenantId ? orgLabel(orgName, tenantId) : 'Tất cả'}</span>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={() => onOpenLineage('CORR-GOLDEN-F03')}
            className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded bg-emerald-900/60 hover:bg-emerald-800 text-emerald-200 border border-emerald-700/50 text-sm font-medium transition"
            title="Mở sơ đồ phả hệ dữ liệu xuyên suốt các giao dịch"
          >
            <GitBranch className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Xem lịch sử dữ liệu</span>
          </button>
          
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white transition"
            title={collapsed ? 'Mở rộng nhật ký' : 'Thu gọn'}
          >
            {collapsed ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Log Feed */}
      {!collapsed && (
        <div className="max-h-36 overflow-y-auto p-3 font-mono text-sm space-y-1.5 bg-slate-900 text-slate-300">
          {auditLogs && auditLogs.length > 0 ? (
            auditLogs.slice(0, 15).map((log, idx) => (
              <div 
                key={log.event_id || idx}
                className="flex items-center justify-between hover:bg-slate-800/80 px-2 py-1 rounded transition border-l-2 border-emerald-500/60"
              >
                <div className="flex items-center space-x-2.5 truncate">
                  <span className="text-slate-500 shrink-0">
                    {formatLocalTime(log.created_at)}
                  </span>
                  <span className={`px-1.5 py-0.2 rounded font-semibold text-sm shrink-0 ${
                    (log.http_status ?? 200) < 400 
                      ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' 
                      : log.http_status === 403 
                      ? 'bg-rose-950 text-rose-400 border border-rose-800' 
                      : 'bg-amber-950 text-amber-400 border border-amber-800'
                  }`}>
                    {(log.http_status ?? 200) >= 400 ? '✕' : '✓'}
                  </span>
                  <span className="text-slate-200 font-semibold">{actionLabel(log.action)}</span>
                  <span className="text-slate-400 truncate hidden md:inline">
                    bởi {log.actor_user_id} ({roleLabel(log.actor_role)})
                  </span>
                </div>

                <div className="flex items-center space-x-2 shrink-0 text-slate-400 text-sm">
                  <button
                    onClick={() => onOpenLineage(log.correlation_id)}
                    className="text-emerald-400 hover:text-emerald-300 underline"
                  >
                    Xem chi tiết
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="text-center py-2 text-slate-500 text-sm">
              Chưa có hoạt động mới.
            </div>
          )}
        </div>
      )}
    </aside>
  );
};
