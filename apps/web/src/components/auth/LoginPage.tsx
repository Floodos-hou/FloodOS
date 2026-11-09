// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import React, { useState } from 'react';
import { ShieldCheck, Sparkles, GitBranch, Lock, ArrowRight, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../../context/useAuth';
import { DEMO_CHARACTERS, DEMO_MODE, DEMO_PASSWORD } from '../../demo/demoScript';
import { FloodOsLogo } from '../common/FloodOsLogo';
import { CaseRiver } from '../ui/kit';
import { reportStages } from '../../utils/caseFlow';

export const LoginPage: React.FC = () => {
  const { loginWithCredentials, error, clearError, isLoading } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!username.trim() || !password) {
      setLocalError('Nhập tên đăng nhập và mật khẩu.');
      return;
    }
    clearError();
    setLocalError(null);
    try {
      await loginWithCredentials(username.trim(), password);
    } catch (err) {
      setLocalError(err instanceof Error && err.message ? err.message : 'Đăng nhập không thành công. Kiểm tra lại thông tin.');
    }
  };

  const shownError = error || localError;

  return (
    <main className="grid min-h-screen bg-paper text-ink lg:grid-cols-[1.15fr_1fr]">
      {/* ---------- Left Brand & Command Overview ---------- */}
      <section className="relative flex flex-col justify-between overflow-hidden bg-gradient-to-br from-[#082f49] via-[#0c4a6e] to-[#0369a1] px-8 py-10 text-white sm:px-12 lg:px-16">
        <div
          className="pointer-events-none absolute inset-0 opacity-15"
          style={{
            backgroundImage: 'radial-gradient(circle at 2px 2px, rgba(255,255,255,0.35) 1px, transparent 0)',
            backgroundSize: '28px 28px',
          }}
          aria-hidden="true"
        />

        <div className="relative z-10 flex flex-wrap items-center justify-between gap-3">
          <FloodOsLogo size={38} showText inverse subtitle="Hệ điều hành Chuyển đổi số Ứng phó Ngập lụt Đô thị" />
          <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-300/30 bg-sky-950/50 px-3 py-1 text-[11px] font-semibold text-sky-200 backdrop-blur-xs">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            DX-OS Open-Core v0.3
          </span>
        </div>

        <div className="relative z-10 my-10 max-w-xl space-y-6">
          <div className="inline-flex items-center gap-2 rounded-md bg-white/10 px-3 py-1 text-xs font-semibold text-sky-200">
            Ban Chỉ huy Phòng chống Thiên tai & Tìm kiếm Cứu nạn
          </div>
          <h1 className="text-3xl font-bold leading-tight text-white sm:text-4xl">
            Từ tin báo ngập đến đội cứu hộ có mặt, mỗi bước đều minh bạch và có người chịu trách nhiệm.
          </h1>
          <p className="text-sm leading-relaxed text-sky-100/85">
            Người dân báo ngập kèm tọa độ và mực nước, điều phối viên thẩm định cùng trợ lý AI và phát lệnh, đội hiện trường cập nhật tiến độ trực tiếp, người báo xác nhận kết quả. Toàn bộ lịch sử được niêm phong bằng chuỗi băm SHA-256 bất biến.
          </p>

          <div className="grid grid-cols-2 gap-2.5 pt-1 sm:grid-cols-4">
            <div className="rounded-lg border border-white/15 bg-white/10 p-2.5 backdrop-blur-xs">
              <Lock className="h-4 w-4 text-sky-300" aria-hidden="true" />
              <div className="mt-1.5 text-xs font-bold text-white">Zero-Trust</div>
              <div className="text-[11px] text-sky-200/80">OAuth 2.0 PKCE + RLS</div>
            </div>
            <div className="rounded-lg border border-white/15 bg-white/10 p-2.5 backdrop-blur-xs">
              <GitBranch className="h-4 w-4 text-sky-300" aria-hidden="true" />
              <div className="mt-1.5 text-xs font-bold text-white">BPMN 2.0</div>
              <div className="text-[11px] text-sky-200/80">Flowable Engine</div>
            </div>
            <div className="rounded-lg border border-white/15 bg-white/10 p-2.5 backdrop-blur-xs">
              <ShieldCheck className="h-4 w-4 text-sky-300" aria-hidden="true" />
              <div className="mt-1.5 text-xs font-bold text-white">Sổ cái SHA-256</div>
              <div className="text-[11px] text-sky-200/80">Chống sửa đổi nhật ký</div>
            </div>
            <div className="rounded-lg border border-white/15 bg-white/10 p-2.5 backdrop-blur-xs">
              <Sparkles className="h-4 w-4 text-sky-300" aria-hidden="true" />
              <div className="mt-1.5 text-xs font-bold text-white">AI Co-pilot</div>
              <div className="text-[11px] text-sky-200/80">Gợi ý & Báo cáo AAR</div>
            </div>
          </div>

          <div className="rounded-xl border border-white/20 bg-white p-4 text-ink shadow-lg">
            <div className="eyebrow mb-3 flex items-center justify-between">
              <span>Quy trình chuẩn 5 trạm kiểm soát</span>
              <span className="text-[10px] font-semibold text-river">Trạng thái trực tuyến</span>
            </div>
            <CaseRiver stages={reportStages('IN_PROGRESS')} />
          </div>
        </div>

        <p className="relative z-10 max-w-xl text-xs leading-relaxed text-sky-200/75">
          Bản thí điểm Hà Nội: dữ liệu mực nước, vị trí phương tiện và điểm tránh trú đang chạy kịch bản mô phỏng kiểm thử điều hành, chưa đấu nối cảm biến quan trắc thực địa.
        </p>
      </section>

      {/* ---------- Right Sign-In & Quick Persona Picker ---------- */}
      <section className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-md space-y-6">
          <div className="panel p-6 sm:p-7">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-ink">Đăng nhập hệ thống</h2>
                <p className="mt-1 text-xs text-ink-3">Xác thực OAuth 2.0 PKCE theo phân quyền đơn vị (RBAC/RLS).</p>
              </div>
              <span className="chip chip-info">PKCE S256</span>
            </div>

            {shownError && (
              <p role="alert" className="mt-4 rounded-lg border border-crit/30 bg-crit-soft p-3 text-xs font-medium text-crit">
                {shownError}
              </p>
            )}

            <form onSubmit={submit} className="mt-5 space-y-4">
              <div>
                <label className="label" htmlFor="username">Tên đăng nhập</label>
                <input
                  id="username"
                  className="input"
                  autoComplete="username"
                  placeholder="Ví dụ: dispatcher_hoa"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
              <div>
                <label className="label" htmlFor="password">Mật khẩu</label>
                <input
                  id="password"
                  type="password"
                  className="input"
                  autoComplete="current-password"
                  placeholder="Nhập mật khẩu"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <button type="submit" disabled={isLoading} className="btn btn-primary btn-lg w-full">
                {isLoading ? 'Đang đăng nhập…' : 'Đăng nhập'}
              </button>
            </form>
          </div>

          {DEMO_MODE && (
            <div className="panel overflow-hidden">
              <div className="panel-head">
                <div>
                  <div className="eyebrow">Tài khoản thí điểm (chỉ có ở bản demo)</div>
                  <div className="text-xs text-ink-2">Bấm chọn 1 vai trò để tự động điền tài khoản trải nghiệm</div>
                </div>
                <span className="chip chip-good">Mật khẩu: {DEMO_PASSWORD}</span>
              </div>
              <ul className="rule-y max-h-72 overflow-y-auto">
                {DEMO_CHARACTERS.map((c) => {
                  const selected = username === c.username;
                  return (
                    <li key={c.username}>
                      <button
                        type="button"
                        className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors ${
                          selected ? 'bg-river-soft/70' : 'hover:bg-sheet-2'
                        }`}
                        onClick={() => {
                          setUsername(c.username);
                          setPassword(DEMO_PASSWORD);
                          setLocalError(null);
                        }}
                      >
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line bg-sheet text-base shadow-2xs">
                          {c.emoji}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center justify-between gap-2">
                            <span className="text-sm font-bold text-ink">
                              {c.name} <span className="font-medium text-river">· {c.role}</span>
                            </span>
                            {selected ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-safe">
                                <CheckCircle2 className="h-3.5 w-3.5" /> Đã chọn
                              </span>
                            ) : (
                              <ArrowRight className="h-3.5 w-3.5 text-ink-3" />
                            )}
                          </span>
                          <span className="mt-0.5 block text-xs leading-snug text-ink-3">{c.blurb}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      </section>
    </main>
  );
};
