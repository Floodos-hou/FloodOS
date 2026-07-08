// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenAgriOS Contributors

import React, { useState } from 'react';
import { AlertCircle, ArrowRight, LockKeyhole, Tractor, Wheat, Map as MapIcon, ShieldCheck, UserCheck } from 'lucide-react';
import { useAuth } from '../../context/useAuth';
import { DEMO_PASSWORD } from '../../demo/demoScript';
import { OpenAgriLogo } from '../common/OpenAgriLogo';

const FEATURES = [
  { icon: Wheat, title: 'Bản đồ số & Giám sát nông nghiệp 3D', text: 'Theo dõi sinh trưởng, mô hình hóa thửa ruộng 3D và đa dạng hóa cây trồng.' },
  { icon: Tractor, title: 'Cơ giới hóa & Tự động phục hồi đứt gãy', text: 'Tự động tính toán radar điều phối máy cứu viện khi phát hiện sự cố máy hỏng.' },
  { icon: MapIcon, title: 'Bảo mật dữ liệu cấp cơ sở dữ liệu (RLS)', text: 'Mỗi nông hộ chỉ thấy ruộng của mình. Chống lộ lọt thông tin canh tác.' },
];

/** Decorative terraced paddy landscape */
const PaddyScene: React.FC = () => (
  <svg viewBox="0 0 600 220" preserveAspectRatio="xMidYMax slice" className="pointer-events-none absolute inset-x-0 bottom-0 h-56 w-full" aria-hidden="true">
    <circle cx="470" cy="62" r="34" fill="#f2cb52" opacity="0.95" />
    <circle cx="470" cy="62" r="52" fill="#f2cb52" opacity="0.18" />
    <path d="M0 130 Q120 80 250 118 T520 104 T600 118 V220 H0Z" fill="#3a7228" opacity="0.55" />
    <path d="M0 158 Q140 116 290 150 T600 144 V220 H0Z" fill="#4b8b34" opacity="0.8" />
    <path d="M0 184 Q160 150 320 178 T600 172 V220 H0Z" fill="#6ba84e" />
    <path d="M0 204 Q180 184 340 200 T600 196 V220 H0Z" fill="#95c47b" />
    {Array.from({ length: 14 }).map((_, i) => (
      <g key={i} className="stalk" style={{ animationDelay: `${(i % 5) * 0.4}s` }} transform={`translate(${30 + i * 42} ${170 - (i % 3) * 6})`}>
        <path d="M0 24V0" stroke="#f2cb52" strokeWidth="2" strokeLinecap="round" />
        <ellipse cx="3" cy="2" rx="3" ry="7" fill="#e7b52b" transform="rotate(18 3 2)" />
        <ellipse cx="-3" cy="6" rx="3" ry="7" fill="#f2cb52" transform="rotate(-18 -3 6)" />
      </g>
    ))}
  </svg>
);

export const LoginPage: React.FC = () => {
  const { beginLogin, loginWithCredentials, error, clearError, isLoading } = useAuth();
  const [username, setUsername] = useState('farmer_ba');
  const [password, setPassword] = useState(DEMO_PASSWORD);
  const [localError, setLocalError] = useState<string | null>(null);

  const startKeycloak = async () => {
    clearError();
    setLocalError(null);
    try {
      await beginLogin();
    } catch (err: any) {
      setLocalError(err?.message || 'Không thể kết nối tới trang đăng nhập SSO. Bạn thử lại sau ít phút.');
    }
  };

  const handleCredentialLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!username.trim()) {
      setLocalError('Vui lòng nhập tên đăng nhập hoặc chọn tài khoản ủy quyền.');
      return;
    }
    clearError();
    setLocalError(null);
    try {
      await loginWithCredentials(username.trim(), password);
    } catch (err: any) {
      setLocalError(err?.message || 'Đăng nhập không thành công. Vui lòng kiểm tra lại thông tin.');
    }
  };

  const handleSelectDelegation = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (!val) return;
    setUsername(val);
    setPassword(DEMO_PASSWORD);
    setLocalError(null);
  };

  const shownError = error || localError;

  return (
    <main className="grid min-h-screen lg:grid-cols-[1.1fr_1fr] bg-slate-50">
      {/* Hero Left Column */}
      <section className="relative overflow-hidden bg-gradient-to-b from-emerald-950 via-emerald-900 to-emerald-800 px-8 pb-48 pt-12 text-emerald-50 sm:px-14 lg:pb-12 lg:pt-16 shadow-2xl">
        <OpenAgriLogo size={52} showText textVariant="white" subtitle="Cổng Điều Hành Nông Nghiệp Mở Quốc Gia" />

        <div className="mt-12 max-w-xl">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3.5 py-1 text-xs font-semibold text-amber-300 ring-1 ring-white/15 mb-4">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            Nền tảng Tác chiến Nông nghiệp Số DX-OS
          </div>
          <h1 className="text-4xl font-extrabold leading-tight text-white sm:text-5xl">
            Điều hành Cơ giới hóa &<br />
            <span className="text-amber-300">Phục hồi Đứt gãy Mùa vụ</span>
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-emerald-100/90 font-medium">
            Hạ tầng số kết nối nông hộ, hợp tác xã, trạm máy cơ giới và kỹ thuật cứu viện: 
            Giám sát bản đồ 3D thời gian thực, lập lịch tự động chống trùng và bảo mật dữ liệu tuyệt đối.
          </p>
        </div>

        <ul className="mt-10 grid max-w-xl gap-4">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <li key={title} className="flex gap-3.5 p-3 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-sm">
              <span className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-700/60 text-amber-300 ring-1 ring-white/15">
                <Icon aria-hidden="true" className="h-5 w-5" />
              </span>
              <span>
                <span className="block text-base font-bold text-white">{title}</span>
                <span className="block text-sm leading-snug text-emerald-200/90 mt-0.5">{text}</span>
              </span>
            </li>
          ))}
        </ul>

        <PaddyScene />
      </section>

      {/* Login Right Column */}
      <section className="flex flex-col items-center justify-center p-6 sm:p-12 lg:p-16">
        <div className="w-full max-w-md rounded-3xl bg-white p-8 sm:p-10 shadow-2xl border border-slate-200/80">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <div>
              <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Đăng nhập Điều hành</h2>
              <p className="text-xs text-slate-500 mt-1">Xác thực chuẩn OpenID Connect / PKCE</p>
            </div>
            <div className="h-10 w-10 rounded-2xl bg-emerald-50 text-emerald-700 flex items-center justify-center ring-1 ring-emerald-200">
              <LockKeyhole className="h-5 w-5" />
            </div>
          </div>

          {shownError && (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-900 flex items-start gap-2.5">
              <AlertCircle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
              <div className="leading-snug">{shownError}</div>
            </div>
          )}

          {/* Quick Delegation Selector */}
          <div className="mt-5 rounded-2xl bg-slate-50 p-3.5 border border-slate-200">
            <label htmlFor="quick-delegation" className="flex items-center gap-1.5 text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
              <UserCheck className="h-3.5 w-3.5 text-emerald-700" />
              <span>Ủy quyền Phiên làm việc Tác chiến:</span>
            </label>
            <select
              id="quick-delegation"
              value={username}
              onChange={handleSelectDelegation}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            >
              <option value="farmer_ba">🌾 Bác Ba — Nông hộ Thới Lai (Chủ ruộng F01, F03, F07)</option>
              <option value="coord_htx01">🚜 Chị Lan — Chỉ huy Điều phối HTX (Chỉ huy Tác chiến)</option>
              <option value="op_minh">⚙️ Anh Minh — Kỹ thuật Lái máy gặt M01</option>
              <option value="owner_tu">🔧 Chú Tư — Chủ sở hữu Đoàn máy Cơ giới</option>
              <option value="repair_01">🛠️ Đội Kỹ thuật 01 — Trạm Cứu hộ Cơ động Lưu động</option>
            </select>
          </div>

          <form onSubmit={handleCredentialLogin} className="mt-5 space-y-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">
                Tài khoản Định danh
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Nhập mã định danh hoặc email..."
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm font-medium text-slate-900 shadow-sm focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                disabled={isLoading}
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">
                Mật khẩu Bảo mật
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm font-medium text-slate-900 shadow-sm focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                disabled={isLoading}
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full mt-2 flex items-center justify-center gap-2 rounded-xl bg-emerald-800 py-3 text-sm font-bold text-white shadow-lg shadow-emerald-900/20 hover:bg-emerald-700 active:scale-[0.99] transition disabled:opacity-60"
            >
              {isLoading ? (
                <span>Đang kết nối phiên an toàn...</span>
              ) : (
                <>
                  <span>Vào Hệ thống Điều hành</span>
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>

          <div className="relative my-6 text-center">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200" /></div>
            <span className="relative bg-white px-3 text-xs uppercase font-semibold text-slate-400">Hoặc</span>
          </div>

          <button
            type="button"
            onClick={startKeycloak}
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-2 rounded-xl border-2 border-slate-300 bg-white py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 hover:border-slate-400 transition shadow-sm disabled:opacity-60"
          >
            <ShieldCheck className="h-4 w-4 text-emerald-700" />
            <span>Đăng nhập Keycloak OIDC SSO</span>
          </button>

          <p className="mt-6 text-center text-xs text-slate-500 leading-relaxed">
            Tuân thủ chuẩn bảo mật Zero-Trust RFC 7636 (PKCE). Token được lưu trong bộ nhớ RAM, chống sao chép và chống rò rỉ dữ liệu.
          </p>
        </div>
      </section>
    </main>
  );
};
