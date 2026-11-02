// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenAgriOS Contributors

import React, { useState } from 'react';
import { useAuth } from '../../../web/src/context/useAuth';
import { DEMO_CHARACTERS, DEMO_MODE, DEMO_PASSWORD } from '../../../web/src/demo/demoScript';

/** Character-select screen: the demo accounts are the "characters" of the farm (demo builds only). */
export const StartScreen: React.FC = () => {
  const { loginWithCredentials, isLoading, error } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState<string | null>(null);

  const enter = async (u: string, p: string) => {
    setPending(u);
    try { await loginWithCredentials(u, p); } catch { /* the error is shown below */ } finally { setPending(null); }
  };

  return (
    <div className="start">
      <div className="sun" aria-hidden />
      <div className="cloud c1" aria-hidden /><div className="cloud c2" aria-hidden /><div className="cloud c3" aria-hidden />
      <svg className="hills" viewBox="0 0 1440 320" preserveAspectRatio="none" aria-hidden>
        <path d="M0 220 Q220 120 460 200 T940 190 T1440 160 V320 H0Z" fill="#7bc65a" />
        <path d="M0 260 Q300 190 620 250 T1200 230 T1440 250 V320 H0Z" fill="#5aa845" />
      </svg>
      <main className="start-card">
        <div className="logo-bounce" aria-hidden>🌾</div>
        <h1>Nông Trại Số</h1>
        <p className="tagline">Nhìn thấy cả mùa gặt của bạn, sống động như một trò chơi, nhưng mọi con số đều là thật.</p>

        {DEMO_MODE ? (
          <>
            <h2>Chọn nhân vật để vào nông trại</h2>
            <div className="characters">
              {DEMO_CHARACTERS.map((c, i) => (
                <button key={c.username} className={`character ${i === 0 ? 'recommended' : ''}`} disabled={isLoading} onClick={() => enter(c.username, DEMO_PASSWORD)}>
                  {i === 0 && <span className="ribbon">Bắt đầu từ đây</span>}
                  <span className="emoji">{c.emoji}</span>
                  <strong>{c.name}</strong>
                  <em>{c.role}</em>
                  <span className="blurb">{pending === c.username ? 'Đang vào nông trại…' : c.blurb}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <form className="login" onSubmit={(e) => { e.preventDefault(); void enter(username, password); }}>
            <label>Tài khoản<input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" /></label>
            <label>Mật khẩu<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label>
            <button type="submit" disabled={isLoading || !username || !password}>{isLoading ? 'Đang vào…' : 'Vào nông trại'}</button>
          </form>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        <p className="legal">Dữ liệu lấy từ nền tảng OpenAgriOS (Tầng 1). Hình ảnh là minh họa vẽ bằng mã, thiết bị trong bản demo là mô phỏng.</p>
      </main>
    </div>
  );
};
