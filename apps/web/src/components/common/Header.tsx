// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import React, { useState } from 'react';
import { Clock, RotateCcw, FastForward, ShieldCheck, LogOut, RefreshCw, ChevronDown, Radio } from 'lucide-react';
import { useAuth } from '../../context/useAuth';
import { roleLabel } from '../../utils/labels';
import { FloodOsLogo } from './FloodOsLogo';

interface HeaderProps {
  simTime: string;
  onTick: () => void;
  onReset: () => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  onOpenProofInspector: () => void;
  showStaffTools: boolean;
  orgName?: string;
  isStale?: boolean;
  updatedAt?: Date | null;
  dataNotice?: string;
}

export const Header: React.FC<HeaderProps> = ({
  simTime,
  onTick,
  onReset,
  onRefresh,
  isRefreshing,
  onOpenProofInspector,
  showStaffTools,
  orgName,
  isStale,
  updatedAt,
  dataNotice,
}) => {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  const initials = (user?.full_name || user?.username || 'FO')
    .split(/\s+/)
    .slice(-2)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('');

  return (
    <header className="sticky top-0 z-30 border-b border-sky-400/20 bg-gradient-to-r from-[#06182c] via-[#0b2948] to-[#0c3b60] text-white shadow-md">
      <div className="mx-auto flex h-14 max-w-[1920px] items-center justify-between gap-3 px-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-3.5">
          <FloodOsLogo size={32} showText inverse subtitle={orgName || 'Trung tâm Chỉ huy Ứng phó Ngập lụt Đô thị'} />
          <span
            className="hidden items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-bold text-emerald-300 lg:inline-flex"
            title={dataNotice || 'Mực nước trạm đo, vị trí phương tiện và điểm trú trong bản thí điểm này là dữ liệu mô phỏng để kiểm thử quy trình.'}
          >
            <Radio className="h-3 w-3 text-emerald-400 animate-pulse" aria-hidden="true" />
            TRỰC TUYẾN · Kịch bản Hà Nội
          </span>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
            title={updatedAt ? `Cập nhật lúc ${updatedAt.toLocaleTimeString('vi-VN')} — bấm để làm mới` : 'Làm mới dữ liệu'}
            className={`inline-flex min-h-8 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors ${
              isStale
                ? 'border-amber-400/50 bg-amber-500/20 text-amber-200'
                : 'border-white/15 bg-white/10 text-sky-100 hover:bg-white/15'
            }`}
          >
            <RefreshCw className={`h-3.5 w-3.5 text-sky-300 ${isRefreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span className="num hidden sm:inline">
              {isStale ? 'Dữ liệu trễ' : updatedAt ? updatedAt.toLocaleTimeString('vi-VN') : 'Làm mới'}
            </span>
          </button>

          {showStaffTools && (
            <div
              className="hidden items-center gap-1 rounded-lg border border-white/15 bg-slate-950/45 px-2.5 py-1 md:flex"
              aria-label="Đồng hồ kịch bản thử nghiệm"
            >
              <Clock className="h-3.5 w-3.5 text-sky-300" aria-hidden="true" />
              <span className="num px-1 font-semibold text-white">{simTime || '--:--'}</span>
              <button
                type="button"
                onClick={onTick}
                disabled={isRefreshing}
                className="inline-flex items-center gap-1 rounded-md border border-sky-400/30 bg-sky-500/20 px-2 py-0.5 text-[11px] font-bold text-sky-200 hover:bg-sky-500/30"
                title="Tua kịch bản thêm 15 phút"
              >
                <FastForward className="h-3 w-3" aria-hidden="true" /> +15p
              </button>
              <button
                type="button"
                onClick={onReset}
                disabled={isRefreshing}
                className="inline-flex items-center gap-1 rounded-md border border-white/15 bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-slate-200 hover:bg-white/20"
                title="Đưa kịch bản về trạng thái ban đầu"
              >
                <RotateCcw className="h-3 w-3" aria-hidden="true" /> Đặt lại
              </button>
            </div>
          )}

          {user && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((o) => !o)}
                aria-expanded={menuOpen}
                className="flex min-h-9 items-center gap-2 rounded-lg border border-sky-300/30 bg-white/10 px-2.5 py-1 text-left text-white shadow-xs transition-colors hover:bg-white/15"
              >
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-gradient-to-br from-sky-400 to-blue-600 text-[11px] font-bold text-white shadow-xs">
                  {initials}
                </span>
                <span className="hidden leading-tight sm:block">
                  <span className="block text-xs font-bold text-white">{user.full_name}</span>
                  <span className="block text-[10px] font-semibold text-sky-300">{roleLabel(user.role)}</span>
                </span>
                <ChevronDown className="h-3.5 w-3.5 text-sky-200" aria-hidden="true" />
              </button>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} aria-hidden="true" />
                  <div
                    role="menu"
                    className="panel absolute right-0 z-20 mt-1.5 w-64 p-1.5 text-xs text-ink shadow-[var(--shadow-pop)]"
                  >
                    <div className="border-b border-line px-3 py-2.5">
                      <div className="font-bold text-ink">{user.full_name}</div>
                      <div className="mt-0.5 text-ink-3">
                        {roleLabel(user.role)} · <span className="mono">{user.username}</span>
                      </div>
                    </div>
                    {showStaffTools && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMenuOpen(false);
                          onOpenProofInspector();
                        }}
                        className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left font-medium text-ink hover:bg-sheet-2"
                      >
                        <ShieldCheck className="h-4 w-4 text-river" aria-hidden="true" /> Thông tin phiên đăng nhập (JWT)
                      </button>
                    )}
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        logout();
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left font-semibold text-crit hover:bg-crit-soft"
                    >
                      <LogOut className="h-4 w-4" aria-hidden="true" /> Đăng xuất
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
