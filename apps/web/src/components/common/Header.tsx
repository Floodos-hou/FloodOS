// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../../context/useAuth';
import { ShieldCheck, LogOut, FastForward, RotateCcw, ChevronDown, TriangleAlert, RefreshCw, Clock } from 'lucide-react';
import { orgLabel, roleLabel, avatarInitials } from '../../utils/labels';
import { FloodOsLogo } from './FloodOsLogo';

interface HeaderProps {
  simTime: string;
  onTick: () => void;
  onReset: () => void;
  onOpenProofInspector: () => void;
  onRefresh: () => void;
  isRefreshing?: boolean;
  /** staff only: step the simulated clock / reset demo data */
  showStaffTools: boolean;
  orgName?: string;
  isStale?: boolean;
  updatedAt?: Date | null;
  dataNotice?: string;
  deploymentProfile?: string;
  deploymentProfileLabel?: string;
}

export const Header: React.FC<HeaderProps> = ({
  simTime, onTick, onReset, onOpenProofInspector, onRefresh, isRefreshing = false,
  showStaffTools, orgName, isStale = false, updatedAt, dataNotice, deploymentProfile, deploymentProfileLabel,
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
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2.5 overflow-x-clip border-b border-line bg-sheet/95 px-3 shadow-2xs backdrop-blur-md sm:gap-3 sm:px-5">
      <FloodOsLogo className="min-w-0 max-w-[44vw] sm:max-w-md" size={30} showText subtitle={orgLabel(orgName, user?.organization_id)} />

      <span
        className="chip chip-watch"
        title={dataNotice || 'Hệ thống đang chạy trên dữ liệu thí điểm và mô phỏng; không có cảm biến hay nguồn quan trắc chính thức.'}
      >
        <span className="sm:hidden">Mô phỏng</span>
        <span className="hidden sm:inline">Kịch bản thí điểm Hà Nội</span>
      </span>

      {deploymentProfile && (
        <span
          className={`chip hidden md:inline-flex ${
            deploymentProfile === 'EDGE_FIELD'
              ? 'chip-good'
              : deploymentProfile === 'STANDARD'
              ? 'chip-info'
              : 'chip-neutral'
          }`}
          title={`Hồ sơ Tầng 1: ${deploymentProfileLabel || deploymentProfile}`}
        >
          {deploymentProfile === 'EDGE_FIELD' ? 'Dã chiến (Edge)' : deploymentProfile === 'STANDARD' ? 'Khu vực (Standard)' : 'Trung tâm (Full)'}
        </span>
      )}

      <div className="ml-auto flex items-center gap-2">
        {isStale && (
          <span className="chip chip-warn">
            <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" /> Dữ liệu chậm
          </span>
        )}

        <button
          type="button"
          onClick={onRefresh}
          className="btn btn-ghost !min-h-8 !px-2.5 text-xs text-ink-2"
          title="Làm mới dữ liệu trực tiếp"
        >
          <RefreshCw aria-hidden="true" className={`h-3.5 w-3.5 text-river ${isRefreshing ? 'animate-spin' : ''}`} />
          <span className="num hidden md:inline">
            {updatedAt ? updatedAt.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Đang đồng bộ'}
          </span>
        </button>

        {showStaffTools && (
          <div className="hidden items-center gap-1 rounded-lg border border-line bg-sheet-2 px-2 py-1 lg:flex">
            <Clock className="h-3.5 w-3.5 text-river" aria-hidden="true" />
            <span className="num px-1 text-xs font-semibold text-ink">{simTime || '--:--'}</span>
            <button type="button" onClick={onTick} className="btn !min-h-7 !px-2 !py-0.5 text-[11px]" title="Tua đồng hồ mô phỏng thêm 15 phút">
              <FastForward className="h-3 w-3 text-river" aria-hidden="true" /> +15p
            </button>
            <button
              type="button"
              className="btn !min-h-7 !px-2 !py-0.5 text-[11px]"
              title="Khôi phục dữ liệu mô phỏng ban đầu"
              onClick={() => { if (window.confirm('Khôi phục toàn bộ dữ liệu mô phỏng về trạng thái ban đầu?')) onReset(); }}
            >
              <RotateCcw className="h-3 w-3 text-ink-3" aria-hidden="true" /> Đặt lại
            </button>
          </div>
        )}

        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-haspopup="true"
            className="flex items-center gap-2.5 rounded-lg border border-line bg-sheet px-2.5 py-1.5 text-left shadow-2xs transition-colors hover:border-line-2 hover:bg-sheet-2"
          >
            <span className="grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br from-sky-500 to-river-2 text-[11px] font-bold text-white shadow-2xs">
              {avatarInitials(user?.full_name, user?.username)}
            </span>
            <span className="hidden leading-tight sm:block">
              <span className="block text-xs font-bold text-ink">{user?.full_name || user?.username}</span>
              <span className="block text-[11px] font-medium text-river">{roleLabel(user?.role)}</span>
            </span>
            <ChevronDown className="h-4 w-4 text-ink-3" aria-hidden="true" />
          </button>

          {open && (
            <div role="menu" className="absolute right-0 mt-1.5 w-76 rounded-xl border border-line bg-sheet p-4 shadow-[var(--shadow-pop)]">
              <div className="flex items-center justify-between">
                <span className="eyebrow">Phiên làm việc hiện tại</span>
                <span className="chip chip-good">Đang hoạt động</span>
              </div>
              <div className="mt-2 text-sm font-bold text-ink">{user?.full_name || user?.username}</div>
              <div className="text-xs font-semibold text-river">{roleLabel(user?.role)}</div>
              <div className="mt-2 rounded-lg border border-line bg-sheet-2 p-2.5 text-xs text-ink-2 space-y-1">
                <div>Đơn vị: <span className="font-medium text-ink">{orgLabel(orgName, user?.organization_id)}</span></div>
                <div>Tài khoản: <span className="font-mono font-semibold text-ink">{user?.username}</span></div>
              </div>
              <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-3">
                <button type="button" className="btn btn-ghost !min-h-8 text-xs text-river" onClick={() => { setOpen(false); onOpenProofInspector(); }}>
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> Kiểm tra mã JWT
                </button>
                <button type="button" className="btn !min-h-8 text-xs text-crit hover:!border-crit/40 hover:!bg-crit-soft/40" onClick={() => logout()}>
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
