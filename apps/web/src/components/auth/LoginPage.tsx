// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import React, { useState } from 'react';
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
    if (!username.trim() || !password) { setLocalError('Nhập tên đăng nhập và mật khẩu.'); return; }
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
    <main className="grid min-h-screen bg-paper text-ink lg:grid-cols-[1.1fr_1fr]">
      <section className="flex flex-col justify-between bg-river-2 px-8 py-10 text-sheet sm:px-12 lg:px-16">
        <FloodOsLogo size={36} showText inverse subtitle="Điều phối ứng phó ngập lụt đô thị" />

        <div className="my-12 max-w-xl">
          <h1 className="text-3xl font-bold leading-tight text-sheet sm:text-4xl">Từ tin báo ngập đến đội cứu hộ có mặt, mỗi bước đều có người chịu trách nhiệm.</h1>
          <p className="mt-4 text-sm leading-relaxed text-sheet/80">
            Người dân báo ngập, điều phối viên xác minh và chọn lực lượng, đội hiện trường nhận lệnh, người báo xác nhận. Mọi bước ghi vào nhật ký kiểm chứng không sửa được.
          </p>
          <div className="mt-8 rounded-md bg-sheet p-4 text-ink">
            <div className="eyebrow mb-3">Một vụ việc đi qua năm trạm</div>
            <CaseRiver stages={reportStages('IN_PROGRESS')} />
          </div>
        </div>

        <p className="max-w-xl text-xs leading-relaxed text-sheet/70">
          Bản thí điểm: dữ liệu mực nước, vị trí xe và điểm trú là mô phỏng, chưa kết nối cảm biến hay nguồn quan trắc chính thức.
        </p>
      </section>

      <section className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm">
          <h2 className="text-xl">Đăng nhập</h2>
          <p className="mt-1 text-sm text-ink-3">Dùng tài khoản do đơn vị cấp.</p>

          {shownError && <p role="alert" className="mt-4 rounded border border-crit bg-crit-soft p-3 text-sm text-crit">{shownError}</p>}

          <form onSubmit={submit} className="mt-5 space-y-4">
            <div>
              <label className="label" htmlFor="username">Tên đăng nhập</label>
              <input id="username" className="input" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="password">Mật khẩu</label>
              <input id="password" type="password" className="input" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <button type="submit" disabled={isLoading} className="btn btn-primary btn-lg w-full">{isLoading ? 'Đang đăng nhập…' : 'Đăng nhập'}</button>
          </form>

          {DEMO_MODE && (
            <div className="mt-8">
              <div className="eyebrow mb-2">Tài khoản thí điểm (chỉ có ở bản demo)</div>
              <ul className="rule-y rounded border border-line bg-sheet">
                {DEMO_CHARACTERS.map((c) => (
                  <li key={c.username}>
                    <button type="button" className="block w-full px-3 py-2 text-left hover:bg-sheet-2" onClick={() => { setUsername(c.username); setPassword(DEMO_PASSWORD); setLocalError(null); }}>
                      <span className="block text-sm font-semibold">{c.name} <span className="font-normal text-ink-3">· {c.role}</span></span>
                      <span className="block text-xs text-ink-3">{c.blurb}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>
    </main>
  );
};
