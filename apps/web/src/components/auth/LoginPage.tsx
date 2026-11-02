// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import React, { useState } from 'react';
import { AlertCircle, ArrowRight, LockKeyhole, ShieldCheck, Radio, Compass, Waves, CheckCircle2, Server } from 'lucide-react';
import { useAuth } from '../../context/useAuth';
import { DEMO_PASSWORD } from '../../demo/demoScript';
import { FloodOsLogo } from '../common/FloodOsLogo';

const CAPABILITIES = [
  {
    icon: Waves,
    title: 'Bản đồ Tác chiến & Trạm đo Mực nước',
    text: 'Giám sát vùng ngập thời gian thực, đo cảm biến mực nước tự động và theo dõi lộ trình phương tiện cứu hộ.',
  },
  {
    icon: Compass,
    title: 'Chống Trùng lịch Điều động (GiST)',
    text: 'Ngăn chặn 100% tình trạng trùng phương tiện hoặc kíp trực cứu hộ trong cùng khung giờ qua PostgreSQL GiST.',
  },
  {
    icon: Radio,
    title: 'Radar Chi viện & Phục hồi Đứt gãy Sự cố',
    text: 'Tự động tính khoảng cách Haversine xếp hạng phương án thay thế tức thì khi phương tiện gặp trục trặc kỹ thuật.',
  },
  {
    icon: ShieldCheck,
    title: 'Bảo mật Cấp Hàng (RLS) & Sổ cái SHA-256',
    text: 'Người dân chỉ thấy dữ liệu của mình. Mọi quyết định điều phối được niêm phong mật mã bất biến từ Genesis block.',
  },
];

export const LoginPage: React.FC = () => {
  const { loginWithCredentials, error, clearError, isLoading } = useAuth();
  const [username, setUsername] = useState('dispatcher_hoa');
  const [password, setPassword] = useState(DEMO_PASSWORD);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleCredentialLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!username.trim()) {
      setLocalError('Vui lòng nhập tên đăng nhập tài khoản công vụ.');
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

  const shownError = error || localError;

  return (
    <main className="grid min-h-screen lg:grid-cols-[1.15fr_1fr] bg-slate-900 text-slate-100">
      {/* Tactical EOC Left Column */}
      <section className="relative overflow-hidden bg-slate-950 px-8 py-10 sm:px-12 lg:px-16 lg:py-12 border-b lg:border-b-0 lg:border-r border-slate-800 flex flex-col justify-between">
        <div>
          <FloodOsLogo
            size={48}
            showText
            textVariant="white"
            subtitle="Hệ Thống Điều Hành Phối Hợp Ứng Phó Ngập Lụt Đô Thị"
          />

          <div className="mt-8 max-w-xl">
            <div className="inline-flex items-center gap-2 rounded-full bg-cyan-950/80 px-3.5 py-1 text-xs font-semibold text-cyan-400 border border-cyan-800/50 mb-3">
              <span className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />
              Trung tâm Chỉ huy Điều phối Ứng phó Thiên tai & Tìm kiếm Cứu nạn
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl leading-tight">
              Điều hành Tác chiến &<br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-sky-400">
                Phục hồi Đứt gãy Ngập lụt
              </span>
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-slate-400 font-normal">
              Nền tảng số phân tầng kết nối Người dân vùng trũng, Ban chỉ huy PCTT, Đội cơ động xung kích và Trạm bơm tiêu úng: 
              Bản đồ tác chiến GIS, chống xung đột điều động và niêm phong kiểm toán mật mã.
            </p>
          </div>

          {/* Capabilities Grid - Crisp cards, zero overlap */}
          <div className="mt-8">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
              Kiến trúc kỹ thuật cốt lõi
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 max-w-xl">
              {CAPABILITIES.map(({ icon: Icon, title, text }) => (
                <div 
                  key={title} 
                  className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 hover:border-slate-700 transition"
                >
                  <div className="flex items-center gap-2.5 mb-1.5">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-sky-950 text-cyan-400 border border-sky-800/40">
                      <Icon aria-hidden="true" className="h-3.5 w-3.5" />
                    </span>
                    <span className="text-xs font-bold text-slate-200 leading-snug">{title}</span>
                  </div>
                  <p className="text-[11px] leading-relaxed text-slate-400">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Tactical Status Footer */}
        <div className="mt-8 pt-4 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <Server className="h-3.5 w-3.5 text-cyan-500" />
            <span>APISIX Zero-Trust Edge</span>
            <span className="text-slate-700">•</span>
            <span>Keycloak OIDC PKCE</span>
            <span className="text-slate-700">•</span>
            <span>Postgres RLS</span>
          </div>
          <div className="flex items-center gap-1.5 text-emerald-400 text-[11px]">
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>Cụm dịch vụ sẵn sàng</span>
          </div>
        </div>
      </section>

      {/* Login Right Column - Single Unified Secure Form */}
      <section className="flex flex-col items-center justify-center p-6 sm:p-12 lg:p-16 bg-slate-900/50">
        <div className="w-full max-w-md rounded-2xl bg-slate-950 p-8 sm:p-10 shadow-2xl border border-slate-800">
          <div className="flex items-center justify-between pb-4 border-b border-slate-800">
            <div>
              <h2 className="text-xl font-bold text-white tracking-tight">Đăng nhập Điều hành</h2>
              <p className="text-xs text-slate-400 mt-0.5">Xác thực chuẩn OpenID Connect (PKCE RFC 7636)</p>
            </div>
            <div className="rounded-xl bg-sky-950 p-2.5 text-cyan-400 border border-sky-800/50">
              <LockKeyhole className="h-5 w-5" />
            </div>
          </div>

          {shownError && (
            <div role="alert" className="mt-5 flex items-start gap-2.5 rounded-xl bg-red-950/60 p-3.5 text-xs text-red-200 border border-red-800/60">
              <AlertCircle className="h-4 w-4 shrink-0 text-red-400 mt-0.5" />
              <div className="flex-1">
                <span className="font-semibold block text-red-300">Thông báo xác thực:</span>
                <span className="block mt-0.5 leading-relaxed">{shownError}</span>
              </div>
            </div>
          )}

          {/* Single Unified Login Form */}
          <form onSubmit={handleCredentialLogin} className="mt-6 space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5" htmlFor="username">
                Tài khoản công vụ
              </label>
              <input
                id="username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 transition"
                placeholder="Nhập tên đăng nhập (ví dụ: dispatcher_hoa)"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5" htmlFor="password">
                Mật khẩu
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 transition"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 active:bg-cyan-700 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-cyan-950 transition disabled:opacity-50 mt-2"
            >
              <span>{isLoading ? 'Đang xác thực PKCE…' : 'Đăng nhập vào Trung tâm Tác chiến'}</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>

          {/* Unified Identity Note */}
          <div className="mt-6 pt-4 border-t border-slate-800 text-center">
            <p className="text-[11px] leading-relaxed text-slate-500">
              Hệ thống tự động khởi tạo cặp khóa PKCE S256 ngầm để xác thực với Keycloak SSO. Quyền truy cập và tầm nhìn dữ liệu được phân tầng nghiêm ngặt qua 5 vai trò RBAC và PostgreSQL RLS.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
};
