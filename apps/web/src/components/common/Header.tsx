// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../../context/useAuth';
import { ShieldCheck, LogOut, FastForward, RotateCcw, ChevronDown, TriangleAlert, RefreshCw } from 'lucide-react';
import { orgLabel, roleLabel, avatarInitials } from '../../utils/labels';
import { FloodOsLogo } from './FloodOsLogo';

interface HeaderProps {
  simTime: string;
  onTick: () => void;
  onReset: () => void;
  onOpenProofInspector: () => void;
  onRefresh: () => void;
  isRefreshing?: boolean;
  /** staff only, dev builds: step the simulated clock / reset demo data */
  showStaffTools: boolean;
  orgName?: string;
  isStale?: boolean;
  updatedAt?: Date | null;
  dataNotice?: string;
}

export const Header: React.FC<HeaderProps> = ({
  simTime, onTick, onReset, onOpenProofInspector, onRefresh, isRefreshing = false,
  showStaffTools, orgName, isStale = false, updatedAt, dataNotice,
}) => {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const away = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, []);

  return (
    <header className="sticky top-0 z-30 flex h-12 items-center gap-2 overflow-x-clip sm:gap-3 border-b border-line bg-sheet px-3 sm:px-4">
      <FloodOsLogo className="min-w-0 max-w-[42vw] sm:max-w-sm" size={28} showText subtitle={orgLabel(orgName, user?.organization_id)} />

      <span
        className="chip chip-watch"
        title={dataNotice || 'Hệ thống đang chạy trên dữ liệu thí điểm và mô phỏng; không có cảm biến hay nguồn quan trắc chính thức.'}
      >
        <span className="sm:hidden">Mô phỏng</span><span className="hidden sm:inline">Dữ liệu thí điểm / mô phỏng</span>
      </span>

      <div className="ml-auto flex items-center gap-2">
        {isStale && (
          <span className="chip chip-warn"><TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" /> Dữ liệu chậm</span>
        )}
        <button type="button" onClick={onRefresh} className="btn btn-ghost !min-h-9 text-xs text-ink-2" title="Làm mới dữ liệu">
          <RefreshCw aria-hidden="true" className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          <span className="num hidden md:inline">
            {updatedAt ? updatedAt.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Chưa tải'}
          </span>
        </button>

        {showStaffTools && (
          <div className="hidden items-center gap-1 lg:flex">
            <span className="num text-xs text-ink-3">{simTime || '--:--'}</span>
            <button type="button" onClick={onTick} className="btn !min-h-8 text-xs" title="Tua đồng hồ mô phỏng thêm 15 phút">
              <FastForward className="h-3 w-3" aria-hidden="true" /> +15 phút
            </button>
            <button
              type="button"
              className="btn !min-h-8 text-xs"
              title="Khôi phục dữ liệu mô phỏng ban đầu"
              onClick={() => { if (window.confirm('Khôi phục toàn bộ dữ liệu mô phỏng về trạng thái ban đầu?')) onReset(); }}
            >
              <RotateCcw className="h-3 w-3" aria-hidden="true" /> Đặt lại
            </button>
          </div>
        )}

        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-haspopup="true"
            className="flex items-center gap-2 rounded-md border border-line px-2 py-1 text-left hover:bg-sheet-2"
          >
            <span className="grid h-7 w-7 place-items-center rounded bg-river text-[11px] font-bold text-white">
              {avatarInitials(user?.full_name, user?.username)}
            </span>
            <span className="hidden leading-tight sm:block">
              <span className="block text-xs font-semibold">{user?.full_name || user?.username}</span>
              <span className="block text-[11px] text-ink-3">{roleLabel(user?.role)}</span>
            </span>
            <ChevronDown className="h-4 w-4 text-ink-3" aria-hidden="true" />
          </button>

          {open && (
            <div role="menu" className="absolute right-0 mt-1 w-72 rounded-md border border-line bg-sheet p-3 shadow-[var(--shadow-pop)]">
              <div className="eyebrow">Tài khoản</div>
              <div className="mt-1 text-sm font-semibold">{user?.full_name || user?.username}</div>
              <div className="text-xs text-ink-2">{roleLabel(user?.role)}</div>
              <div className="mt-1 text-xs text-ink-3">Đơn vị: {orgLabel(orgName, user?.organization_id)}</div>
              <div className="text-xs text-ink-3">Tên đăng nhập: <span className="font-mono">{user?.username}</span></div>
              <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
                <button type="button" className="btn btn-ghost !min-h-8 text-xs text-river" onClick={() => { setOpen(false); onOpenProofInspector(); }}>
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> Kiểm tra mã truy cập
                </button>
                <button type="button" className="btn !min-h-8 text-xs" onClick={() => logout()}>
                  <LogOut className="h-3.5 w-3.5" aria-hidden="true" /> Đăng xuất
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
