// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../../context/useAuth';
import { ShieldCheck, LogOut, Clock, RotateCcw, FastForward, ChevronDown, CheckCircle2 } from 'lucide-react';
import { orgLabel, roleLabel, shortName } from '../../utils/labels';
import { FloodOsLogo } from './FloodOsLogo';

interface HeaderProps {
  simTime: string;
  onTick: () => void;
  onReset: () => void;
  onOpenProofInspector: () => void;
  onSwitchPersona?: (username: string) => Promise<void>;
  /** Coordinator/admin only: simulation clock and access inspector */
  showStaffTools: boolean;
  /** Display name of the user's cooperative (from live state) */
  orgName?: string;
}

const DELEGATION_PROFILES = [
  { username: 'farmer_ba', name: 'Bác Ba', role: 'FARMER', label: 'Nông hộ (Chủ ruộng F01, F03, F07)', icon: '🌾' },
  { username: 'coord_htx01', name: 'Chị Lan', role: 'COORDINATOR', label: 'Chỉ huy Điều phối HTX Thới Lai', icon: '🚜' },
  { username: 'op_minh', name: 'Anh Minh', role: 'OPERATOR', label: 'Kỹ thuật Vận hành máy gặt M01', icon: '⚙️' },
  { username: 'owner_tu', name: 'Chú Tư', role: 'MACHINE_OWNER', label: 'Chủ sở hữu Đoàn máy Cơ giới', icon: '🔧' },
  { username: 'repair_01', name: 'Đội 01', role: 'REPAIR_TEAM', label: 'Trạm Cứu viện Kỹ thuật Cơ động', icon: '🛠️' },
];

export const Header: React.FC<HeaderProps> = ({
  simTime,
  onTick,
  onReset,
  onOpenProofInspector,
  onSwitchPersona,
  showStaffTools,
  orgName,
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
    <header className="sticky top-0 z-30 bg-gradient-to-r from-emerald-950 via-emerald-900 to-teal-950 text-white shadow-xl border-b border-emerald-700/60 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
        {/* Brand with Official Repo Logo */}
        <div className="flex min-w-0 items-center gap-3">
          <FloodOsLogo
            size={42}
            showText={true}
            textVariant="white"
            subtitle="Cổng Điều Hành Nông Nghiệp Mở"
          />
        </div>

        {/* Tactical Simulation Clock Controls */}
        {showStaffTools && (
          <div
            className="hidden items-center gap-2 rounded-xl border border-emerald-600/80 bg-emerald-950/80 px-3.5 py-1.5 text-xs shadow-inner xl:flex"
            title="Đồng hồ điều hành thời gian thực nghiệm"
          >
            <Clock aria-hidden="true" className="h-4 w-4 text-amber-300 animate-pulse" />
            <span className="whitespace-nowrap font-medium text-emerald-200">Giờ thực nghiệm:</span>
            <span className="whitespace-nowrap rounded-md bg-emerald-900/90 border border-emerald-700/60 px-2.5 py-0.5 font-mono font-bold text-amber-300">
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
              onClick={onTick}
              title="Tiến thêm 30 phút"
              aria-label="Tiến thêm 30 phút"
              className="rounded-lg p-1.5 text-emerald-100 hover:bg-emerald-700 hover:text-white transition flex items-center gap-1 font-semibold text-[11px]"
            >
              <FastForward aria-hidden="true" className="h-3.5 w-3.5" />
              <span>+30m</span>
            </button>
            <button
              type="button"
              onClick={onReset}
              title="Đặt lại dữ liệu mẫu mặc định"
              aria-label="Đặt lại dữ liệu mẫu mặc định"
              className="rounded-lg p-1.5 text-emerald-200 hover:bg-emerald-700 hover:text-white transition"
            >
              <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* User Identity & Executive Dropdown */}
        {user && (
          <div className="relative flex min-w-0 items-center gap-2.5" ref={menuRef}>
            {/* User Profile Trigger Button */}
            <button
              type="button"
              onClick={() => setProfileOpen(!profileOpen)}
              className="flex items-center gap-2.5 rounded-2xl bg-white/10 hover:bg-white/15 border border-white/15 px-3 py-1.5 text-left transition shadow-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              aria-expanded={profileOpen}
              aria-haspopup="true"
            >
              <div className="h-8 w-8 rounded-xl bg-emerald-700 border border-emerald-500/60 flex items-center justify-center font-bold text-sm text-amber-200 shadow-inner">
                {user.full_name?.charAt(0) || 'U'}
              </div>
              <div className="hidden sm:block text-right">
                <div className="flex items-center gap-1.5 justify-end">
                  <span className="h-2 w-2 rounded-full bg-emerald-400" />
                  <p className="truncate text-xs font-bold text-white tracking-wide max-w-[10rem]">
                    {shortName(user.full_name)}
                  </p>
                </div>
                <p className="truncate text-[11px] text-emerald-200 font-medium">
                  {roleLabel(user.role)}
                </p>
              </div>
              <ChevronDown className={`h-4 w-4 text-emerald-200 transition-transform ${profileOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* Profile Popover / Delegation Menu */}
            {profileOpen && (
              <div className="absolute right-0 top-14 w-80 rounded-2xl bg-white text-slate-800 shadow-2xl border border-slate-200 p-3 z-50 animate-in fade-in slide-in-from-top-2 duration-150">
                {/* User Info Header */}
                <div className="rounded-xl bg-slate-50 p-3 border border-slate-100">
                  <div className="flex items-center gap-2.5">
                    <div className="h-10 w-10 rounded-xl bg-emerald-800 text-white flex items-center justify-center font-bold text-base shadow">
                      {user.full_name?.charAt(0)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-slate-900">{user.full_name}</p>
                      <p className="truncate text-xs text-slate-500 font-medium">
                        {orgLabel(orgName || user.organization_name, user.organization_id)}
                      </p>
                    </div>
                  </div>
                  <div className="mt-2.5 flex items-center justify-between pt-2 border-t border-slate-200 text-xs">
                    <span className="rounded-md bg-emerald-100 px-2 py-0.5 font-bold text-emerald-800">
                      {roleLabel(user.role)}
                    </span>
                    <span className="text-slate-400 font-mono text-[11px]">OIDC / PKCE Active</span>
                  </div>
                </div>

                {/* Delegation / Persona Switcher Section */}
                <div className="mt-3">
                  <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider px-1 mb-1.5">
                    Ủy quyền & Đổi Phiên Tác chiến:
                  </p>
                  <div className="space-y-1">
                    {DELEGATION_PROFILES.map((p) => {
                      const isCurrent = user.username === p.username;
                      return (
                        <button
                          key={p.username}
                          type="button"
                          onClick={() => handleSwitch(p.username)}
                          disabled={isCurrent || switching !== null}
                          className={`w-full flex items-center justify-between rounded-xl px-2.5 py-2 text-left text-xs transition ${
                            isCurrent
                              ? 'bg-emerald-50 text-emerald-900 font-bold border border-emerald-200'
                              : 'text-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-base shrink-0">{p.icon}</span>
                            <div className="truncate">
                              <span className="font-bold text-slate-900">{p.name}</span>
                              <span className="block text-[11px] text-slate-500 truncate">{p.label}</span>
                            </div>
                          </div>
                          {isCurrent && <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 ml-1" />}
                          {switching === p.username && (
                            <span className="text-[10px] text-amber-600 font-semibold animate-pulse shrink-0">
                              Đang chuyển...
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Footer Tools & Logout */}
                <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between gap-2">
                  {showStaffTools && (
                    <button
                      type="button"
                      onClick={() => {
                        setProfileOpen(false);
                        onOpenProofInspector();
                      }}
                      className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 transition"
                    >
                      <ShieldCheck className="h-4 w-4 text-emerald-700" />
                      <span>Thanh tra Quyền</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => logout()}
                    className="ml-auto flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-50 transition"
                  >
                    <LogOut className="h-4 w-4" />
                    <span>Đăng xuất</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Decorative Golden Agricultural Ribbon */}
      <div className="h-1 bg-gradient-to-r from-amber-400 via-emerald-400 to-amber-400 opacity-80" aria-hidden="true" />
    </header>
  );
};
