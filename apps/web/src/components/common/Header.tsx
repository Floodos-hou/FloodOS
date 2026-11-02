// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../../context/useAuth';
import { ShieldCheck, LogOut, Clock, RotateCcw, FastForward, ChevronDown, AlertTriangle } from 'lucide-react';
import { orgLabel, roleLabel, shortName } from '../../utils/labels';
import { FloodOsLogo } from './FloodOsLogo';

interface HeaderProps {
  simTime: string;
  onTick: () => void;
  onReset: () => void;
  onOpenProofInspector: () => void;
  /** Staff only: simulation clock and reset */
  showStaffTools: boolean;
  /** Display name of the user's cooperative/organization */
  orgName?: string;
  isStale?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  simTime,
  onTick,
  onReset,
  onOpenProofInspector,
  showStaffTools,
  orgName,
  isStale = false,
}) => {
  const { user, logout } = useAuth();
  const [profileOpen, setProfileOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <header className="sticky top-0 z-30 bg-gradient-to-r from-slate-950 via-sky-950 to-slate-900 text-white shadow-lg border-b border-sky-900/40">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-2.5 sm:px-6">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <FloodOsLogo size={36} showText textVariant="white" subtitle="Điều phối PCTT Hà Nội" />
          <div className="hidden h-6 w-px bg-sky-800/60 md:block" />
          <div className="hidden items-center gap-2 rounded-full bg-cyan-500/10 px-3 py-0.5 text-xs font-medium text-cyan-300 ring-1 ring-cyan-500/20 md:inline-flex">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse" />
            <span>Phân hệ tác chiến Tầng 2</span>
          </div>
        </div>

        {/* Right side controls */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Simulation clock controls (staff only in dev) */}
          {showStaffTools && (
            <div className="flex items-center gap-1.5 rounded-xl bg-sky-900/40 p-1 ring-1 ring-sky-700/40 text-xs">
              <div className="flex items-center gap-1 px-2 text-slate-300">
                <Clock className="h-3.5 w-3.5 text-cyan-400" />
                <span className="font-mono">{simTime || '00:00:00'}</span>
              </div>
              <button
                type="button"
                onClick={onTick}
                title="Tua tới +15 phút tác chiến"
                className="rounded-lg bg-sky-800/80 px-2 py-1 text-slate-100 hover:bg-sky-700 transition flex items-center gap-1 font-medium"
              >
                <FastForward className="h-3 w-3" />
                <span>+15p</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm('Khôi phục toàn bộ tình huống về thời điểm trực ban đầu?')) {
                    onReset();
                  }
                }}
                title="Khôi phục trạng thái ban đầu"
                className="rounded-lg px-2 py-1 text-slate-300 hover:bg-sky-800/50 hover:text-white transition flex items-center gap-1"
              >
                <RotateCcw className="h-3 w-3" />
                <span>Đặt lại</span>
              </button>
            </div>
          )}

          {/* Stale data warning */}
          {isStale && (
            <div className="hidden items-center gap-1 rounded-xl bg-amber-500/10 px-2.5 py-1 text-xs text-amber-300 ring-1 ring-amber-500/30 sm:flex">
              <AlertTriangle className="h-3.5 w-3.5" />
              <span>Dữ liệu chậm</span>
            </div>
          )}

          {/* User profile dropdown - Real Enterprise Account View */}
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setProfileOpen(!profileOpen)}
              className="flex items-center gap-2 rounded-xl bg-sky-900/50 px-3 py-1.5 text-left text-xs ring-1 ring-sky-700/50 hover:bg-sky-900/80 transition"
              aria-expanded={profileOpen}
              aria-haspopup="true"
            >
              <div className="h-7 w-7 rounded-lg bg-cyan-500/20 text-cyan-300 font-bold grid place-items-center ring-1 ring-cyan-400/30">
                {shortName(user?.full_name, user?.username)}
              </div>
              <div className="hidden sm:block">
                <div className="font-bold text-slate-100 leading-tight">
                  {user?.full_name || user?.username}
                </div>
                <div className="text-[10px] text-cyan-300 leading-tight">
                  {roleLabel(user?.role)}
                </div>
              </div>
              <ChevronDown className="h-4 w-4 text-sky-300 shrink-0" />
            </button>

            {profileOpen && (
              <div
                className="absolute right-0 mt-2 w-72 rounded-2xl bg-white p-3 text-slate-900 shadow-2xl border border-slate-200 z-50 animate-in fade-in zoom-in-95 duration-150"
                role="menu"
              >
                <div className="pb-3 px-1 border-b border-slate-100">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Tài khoản công vụ</div>
                  <div className="font-bold text-slate-900 text-sm mt-1">{user?.full_name || user?.username}</div>
                  <div className="inline-block rounded-md bg-sky-100 text-sky-800 px-2 py-0.5 text-xs font-semibold mt-1">
                    {roleLabel(user?.role)}
                  </div>
                  <div className="text-xs text-slate-500 mt-1.5">
                    Đơn vị: {orgLabel(orgName, user?.organization_id)}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    Tên đăng nhập: <code className="font-mono text-slate-600">{user?.username}</code>
                  </div>
                </div>

                <div className="mt-3 pt-1 flex items-center justify-between px-1">
                  <button
                    type="button"
                    onClick={() => {
                      setProfileOpen(false);
                      onOpenProofInspector();
                    }}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-sky-700 hover:text-sky-900"
                  >
                    <ShieldCheck className="h-3.5 w-3.5" />
                    <span>Kiểm tra JWT</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => logout()}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-red-50 hover:bg-red-100 px-2.5 py-1 text-xs font-bold text-red-600 transition"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    <span>Đăng xuất</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
