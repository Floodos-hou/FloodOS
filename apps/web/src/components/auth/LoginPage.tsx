// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import React, { useState } from 'react';
import { AlertCircle, ArrowRight, LockKeyhole, Waves, ShieldCheck, Radio, Compass } from 'lucide-react';
import { useAuth } from '../../context/useAuth';
import { DEMO_PASSWORD } from '../../demo/demoScript';
import { FloodOsLogo } from '../common/FloodOsLogo';

const FEATURES = [
  {
    icon: Waves,
    title: 'Bản đồ Tác chiến & Giám sát Ngập lụt',
    text: 'Theo dõi vùng ngập, trạm đo mực nước, điểm sơ tán an toàn và vị trí phương tiện cứu hộ thời gian thực.',
  },
  {
    icon: Compass,
    title: 'Chống Trùng lịch Điều động (GiST Exclusion)',
    text: 'Ngăn chặn tuyệt đối tình trạng phân công trùng phương tiện hoặc đội cứu hộ trong cùng khung giờ.',
  },
  {
    icon: Radio,
    title: 'Radar Chi viện & Phục hồi Đứt gãy Sự cố',
    text: 'Tự động tính khoảng cách Haversine xếp hạng phương án thay thế khi phương tiện gặp trục trặc kỹ thuật.',
  },
  {
    icon: ShieldCheck,
    title: 'Bảo mật Cấp Hàng (PostgreSQL RLS) & Sổ cái SHA-256',
    text: 'Người dân chỉ thấy tin của mình. Toàn bộ tiến trình cứu trợ được niêm phong mật mã bất biến.',
  },
];

const WaterBackgroundScene: React.FC = () => (
  <svg
    viewBox="0 0 600 220"
    preserveAspectRatio="xMidYMax slice"
    className="pointer-events-none absolute inset-x-0 bottom-0 h-40 w-full z-0 opacity-15 overflow-hidden"
    aria-hidden="true"
  >
    <path d="M0 130 Q140 90 280 120 T600 110 V220 H0Z" fill="#0369a1" />
    <path d="M0 155 Q160 125 310 150 T600 140 V220 H0Z" fill="#0284c7" />
    <path d="M0 180 Q180 155 350 175 T600 168 V220 H0Z" fill="#0ea5e9" />
    <path d="M0 200 Q200 185 380 195 T600 190 V220 H0Z" fill="#38bdf8" />
  </svg>
);

export const LoginPage: React.FC = () => {
  const { beginLogin, loginWithCredentials, error, clearError, isLoading } = useAuth();
  const [username, setUsername] = useState('dispatcher_hoa');
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
      <section className="relative overflow-hidden bg-gradient-to-b from-slate-950 via-sky-950 to-blue-950 px-8 py-10 text-slate-100 sm:px-14 lg:py-14 shadow-2xl flex flex-col justify-between">
        <div className="relative z-10">
          <FloodOsLogo
            size={52}
            showText
            textVariant="white"
            subtitle="Hệ Thống Điều Hành Ứng Phó Ngập Lụt — Thí điểm Hà Nội"
          />

          <div className="mt-8 max-w-xl">
            <div className="inline-flex items-center gap-2 rounded-full bg-cyan-500/10 px-3.5 py-1 text-xs font-semibold text-cyan-300 ring-1 ring-cyan-500/25 mb-3">
              <span className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />
              Nền tảng Điều phối Ứng phó Thiên tai & Khẩn cấp
            </div>
            <h1 className="text-3xl font-extrabold leading-tight text-white sm:text-4xl">
              Điều hành Ứng cứu &<br />
              <span className="text-cyan-300">Phục hồi Đứt gãy Ngập lụt</span>
            </h1>
            <p className="mt-4 text-base leading-relaxed text-slate-300 font-medium">
              Hạ tầng số phân tầng kết nối người dân vùng trũng, ban chỉ huy PCTT, đội xung kích hiện trường và trạm bơm tiêu úng:
              Giám sát bản đồ tác chiến, kiểm tra xung đột thời gian và niêm phong kiểm toán SHA-256 bất biến.
            </p>
          </div>
        </div>

        {/* Feature Cards in 2x2 grid strictly above background */}
        <div className="relative z-10 mt-8">
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex flex-col gap-1.5 p-3.5 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-md shadow-inner">
                <div className="flex items-center gap-2.5">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-sky-800/60 text-cyan-300 ring-1 ring-white/15">
                    <Icon aria-hidden="true" className="h-4 w-4" />
                  </span>
                  <span className="text-sm font-bold text-white leading-tight">{title}</span>
                </div>
                <p className="text-xs leading-relaxed text-slate-300">{text}</p>
              </li>
            ))}
          </ul>
        </div>

        <WaterBackgroundScene />
      </section>

      {/* Login Right Column - Single Unified Login */}
      <section className="flex flex-col items-center justify-center p-6 sm:p-12 lg:p-16">
        <div className="w-full max-w-md rounded-3xl bg-white p-8 sm:p-10 shadow-2xl border border-slate-200/80">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <div>
              <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Đăng nhập Điều hành</h2>
              <p className="text-xs text-slate-500 mt-1">Xác thực OpenID Connect / PKCE (Keycloak)</p>
            </div>
            <div className="rounded-2xl bg-sky-50 p-2.5 text-sky-700">
              <LockKeyhole className="h-6 w-6" />
            </div>
          </div>

          {shownError && (
            <div role="alert" className="mt-5 flex items-start gap-2.5 rounded-2xl bg-red-50 p-3.5 text-sm text-red-800 border border-red-200">
              <AlertCircle className="h-5 w-5 shrink-0 text-red-600 mt-0.5" />
              <div className="flex-1">
                <span className="font-semibold block">Lỗi kết nối máy chủ điều phối:</span>
                <span className="text-xs text-red-700 block mt-0.5">{shownError}</span>
              </div>
            </div>
          )}

          {/* Quick Persona Delegation for Testing */}
          <div className="mt-6 rounded-2xl bg-sky-50/60 border border-sky-100 p-4">
            <label htmlFor="delegation-select" className="block text-xs font-bold uppercase tracking-wider text-sky-900 mb-1.5">
              Chọn vai trò tác chiến (Ủy quyền OIDC):
            </label>
            <select
              id="delegation-select"
              value={username}
              onChange={handleSelectDelegation}
              className="w-full rounded-xl border border-sky-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
            >
              <option value="dispatcher_hoa">👩‍💼 Chị Hoa — Điều phối viên PCTT (Ban Chỉ huy)</option>
              <option value="reporter_lan">🙋‍♀️ Chị Lan — Người dân vùng trũng (Báo tin ngập)</option>
              <option value="reporter_hung">👨‍💼 Anh Hùng — Người dân cụm B (Báo tin cấp cứu)</option>
              <option value="team_cuong">🧑‍🚒 Anh Cường — Đội trưởng Cơ động 02 (Xuồng V02)</option>
              <option value="team_binh">👷 Anh Bình — Đội trưởng Xuồng 01 (Chi viện V01)</option>
              <option value="team_dung">🧑‍🔧 Anh Dũng — Đội trưởng Bơm tiêu úng 03 (Máy bơm V04)</option>
              <option value="resource_giang">📋 Chị Giang — Quản lý Nguồn lực & Sửa chữa</option>
              <option value="platform_admin">🛡️ Quản trị Nền tảng (Sổ cái SHA-256)</option>
            </select>
          </div>

          {/* Single Unified Login Form */}
          <form onSubmit={handleCredentialLogin} className="mt-5 space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1" htmlFor="username">
                Tên đăng nhập
              </label>
              <input
                id="username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-200"
                placeholder="Nhập tên tài khoản"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1" htmlFor="password">
                Mật khẩu
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-200"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-sky-800 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-sky-900/20 hover:bg-sky-700 transition disabled:opacity-50"
            >
              <span>{isLoading ? 'Đang xác thực PKCE…' : 'Đăng nhập vào Trung tâm Tác chiến'}</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>

          <div className="mt-6 pt-4 border-t border-slate-100 text-center">
            <p className="text-xs text-slate-500">
              Bảo mật phân quyền 5 vai trò (RBAC) & PostgreSQL Row Level Security.
            </p>
            <button
              type="button"
              onClick={startKeycloak}
              disabled={isLoading}
              className="mt-2 text-xs text-sky-700 hover:text-sky-900 font-medium underline underline-offset-2 transition"
            >
              Mở trang đăng nhập SSO trực tiếp trên máy chủ Keycloak
            </button>
          </div>
        </div>
      </section>
    </main>
  );
};
