// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../../context/useAuth';
import { ShieldCheck, LogOut, Clock, RotateCcw, FastForward, ChevronDown, CheckCircle2, AlertTriangle } from 'lucide-react';
import { orgLabel, roleLabel, shortName } from '../../utils/labels';
import { FloodOsLogo } from './FloodOsLogo';

interface HeaderProps {
  simTime: string;
  onTick: () => void;
  onReset: () => void;
  onOpenProofInspector: () => void;
  onSwitchPersona?: (username: string) => Promise<void>;
  /** Staff only: simulation clock and reset */
  showStaffTools: boolean;
  /** Display name of the user's cooperative/organization */
  orgName?: string;
  isStale?: boolean;
}

const DELEGATION_PROFILES = [
  { username: 'dispatcher_hoa', name: 'Chị Hoa', role: 'DISPATCHER', label: 'Ban Chỉ huy PCTT Hà Nội (Điều phối)', icon: '👩‍💼' },
  { username: 'reporter_lan', name: 'Chị Lan', role: 'REPORTER', label: 'Người dân vùng ven sông (Báo tin)', icon: '🙋‍♀️' },
  { username: 'reporter_hung', name: 'Anh Hùng', role: 'REPORTER', label: 'Người dân cụm dân cư B (Báo tin)', icon: '👨‍💼' },
  { username: 'team_cuong', name: 'Anh Cường', role: 'FIELD_TEAM', label: 'Đội trưởng Cơ động 02 (Xuồng V02)', icon: '🧑‍🚒' },
  { username: 'team_binh', name: 'Anh Bình', role: 'FIELD_TEAM', label: 'Đội trưởng Xuồng 01 (Chi viện)', icon: '👷' },
  { username: 'team_dung', name: 'Anh Dũng', role: 'FIELD_TEAM', label: 'Đội trưởng Bơm tiêu úng 03', icon: '🧑‍🔧' },
  { username: 'resource_giang', name: 'Chị Giang', role: 'RESOURCE_MANAGER', label: 'Quản lý Nguồn lực & Sửa chữa', icon: '📋' },
  { username: 'platform_admin', name: 'Admin', role: 'PLATFORM_ADMIN', label: 'Quản trị Nền tảng (Sổ cái SHA-256)', icon: '🛡️' },
];

export const Header: React.FC<HeaderProps> = ({
  simTime,
  onTick,
  onReset,
  onOpenProofInspector,
  onSwitchPersona,
  showStaffTools,
  orgName,
  isStale = false,
}) => {
  const { user, logout } = useAuth();
  const [profileOpen, setProfileOpen] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
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

  const handleSwitch = async (uname: string) => {
    if (!onSwitchPersona || uname === user?.username) return;
    setSwitching(uname);
    try {
      await onSwitchPersona(uname);
      setProfileOpen(false);
    } finally {
      setSwitching(null);
    }
  };

  return (
    <header className="sticky top-0 z-30 bg-gradient-to-r from-slate-950 via-sky-950 to-blue-950 text-white shadow-xl border-b border-sky-800/60 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
        {/* Brand with Official Repo Logo */}
        <div className="flex min-w-0 items-center gap-3">
          <FloodOsLogo
            size={42}
            showText={true}
            textVariant="white"
            subtitle="Hệ Thống Điều Hành Ứng Phó Ngập Lụt — Thí điểm Hà Nội"
          />
        </div>

        {/* Tactical Simulation Clock Controls */}
        {showStaffTools && (
          <div
            className="hidden items-center gap-2 rounded-xl border border-sky-700/80 bg-slate-900/80 px-3.5 py-1.5 text-xs shadow-inner xl:flex"
            title="Đồng hồ điều hành tác chiến"
          >
            <Clock aria-hidden="true" className="h-4 w-4 text-cyan-300 animate-pulse" />
            <span className="whitespace-nowrap font-medium text-sky-200">Giờ tác chiến:</span>
            <span className="whitespace-nowrap rounded-md bg-slate-800 border border-sky-700/60 px-2.5 py-0.5 font-mono font-bold text-amber-300">
              {simTime
                ? new Date(simTime).toLocaleString('vi-VN', {
                    hour: '2-digit',
                    minute: '2-digit',
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                  })
                : '--:--'}
            </span>
            <button
              type="button"
              onClick={() => {
                if (window.confirm('Khôi phục dữ liệu mô phỏng về ca trực ban đầu? Thao tác này chỉ dùng khi chuẩn bị lại buổi trực.')) {
                  onReset();
                }
              }}
              className="ml-1 inline-flex items-center gap-1 rounded-md bg-slate-800 px-2 py-1 text-slate-300 hover:bg-slate-700 hover:text-white transition"
              title="Dữ liệu mô phỏng: Khôi phục trạng thái trực ban đầu"
            >
              <RotateCcw className="h-3 w-3" />
              <span>Khôi phục mẫu</span>
            </button>
          </div>
        )}

        {/* Right Section: Identity & Actions */}
        <div className="flex items-center gap-2.5">
          {/* Stale Warning Indicator */}
          {isStale && (
            <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2.5 py-1 text-xs font-semibold text-amber-300 border border-amber-500/40 animate-pulse">
              <AlertTriangle className="h-3.5 w-3.5" />
              Dữ liệu lưu tạm
            </span>
          )}

          {/* User Profile & Demo Switcher */}
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setProfileOpen(!profileOpen)}
              className="flex items-center gap-2 rounded-xl bg-slate-900/90 border border-sky-700/70 px-3 py-1.5 text-left text-sm hover:bg-slate-800 transition shadow"
              aria-expanded={profileOpen}
              aria-haspopup="true"
            >
              <div className="hidden sm:block">
                <div className="font-bold text-white leading-tight">{shortName(user?.full_name, user?.username)}</div>
                <div className="text-[11px] text-cyan-300 font-medium">{roleLabel(user?.role)}</div>
              </div>
              <ChevronDown className="h-4 w-4 text-sky-300 shrink-0" />
            </button>

            {profileOpen && (
              <div
                className="absolute right-0 mt-2 w-80 rounded-2xl bg-white p-3 text-slate-900 shadow-2xl border border-slate-200 z-50 animate-in fade-in zoom-in-95 duration-150"
                role="menu"
              >
                <div className="border-b border-slate-100 pb-2.5 px-1">
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Tài khoản đang đăng nhập</div>
                  <div className="font-bold text-slate-900 mt-1">{user?.full_name || user?.username}</div>
                  <div className="inline-block rounded-md bg-sky-100 text-sky-800 px-2 py-0.5 text-xs font-semibold mt-1">
                    {roleLabel(user?.role)}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">Đơn vị: {orgLabel(orgName, user?.organization_id)}</div>
                </div>

                <div className="pt-2.5 px-1">
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                    Chuyển vai trò tác chiến
                  </div>
                  <div className="space-y-1 max-h-56 overflow-y-auto">
                    {DELEGATION_PROFILES.map((p) => {
                      const isCurrent = p.username === user?.username;
                      const isWorking = switching === p.username;
                      return (
                        <button
                          key={p.username}
                          type="button"
                          onClick={() => handleSwitch(p.username)}
                          disabled={isCurrent || !!switching}
                          className={`w-full flex items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-left text-xs transition ${
                            isCurrent
                              ? 'bg-sky-50 text-sky-900 font-semibold border border-sky-200'
                              : 'hover:bg-slate-100 text-slate-700'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-base shrink-0">{p.icon}</span>
                            <div className="truncate">
                              <div className="font-medium text-slate-900 truncate">{p.name}</div>
                              <div className="text-[11px] text-slate-500 truncate">{p.label}</div>
                            </div>
                          </div>
                          {isCurrent && <CheckCircle2 className="h-4 w-4 text-sky-600 shrink-0" />}
                          {isWorking && <span className="text-[10px] text-amber-600 animate-pulse shrink-0">Đang đổi…</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="mt-3 border-t border-slate-100 pt-2 flex items-center justify-between px-1">
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
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-600 hover:text-red-800"
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
