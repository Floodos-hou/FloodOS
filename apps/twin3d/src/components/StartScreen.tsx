// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import React, { useState } from 'react';
import { useAuth } from '../../../web/src/context/useAuth';

/** Sign-in for the twin: a normal credentials form, no one-click role switching. */
export const StartScreen: React.FC = () => {
  const { loginWithCredentials, isLoading, error } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const enter = async (u: string, p: string) => {
    try { await loginWithCredentials(u, p); } catch { /* the error is shown below */ } 
  };

  return (
    <div className="start">
      <div className="start-grid" aria-hidden />
      <main className="start-card">
        <p className="eyebrow">FloodOS · Tầng 2</p>
        <h1>Bản sao số 3D</h1>
        <p className="tagline">Ruộng và máy gặt dựng theo tọa độ thật từ nền tảng, đúng tỉ lệ mét. Mỗi hình trên màn hình là một bản ghi dữ liệu.</p>

        <form className="login" onSubmit={(e) => { e.preventDefault(); void enter(username, password); }}>
          <label>Tài khoản<input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" /></label>
          <label>Mật khẩu<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label>
          <button type="submit" disabled={isLoading || !username || !password}>{isLoading ? 'Đang đăng nhập…' : 'Đăng nhập'}</button>
        </form>
        {error && <p className="error" role="alert">{error}</p>}
        <p className="legal">Thiết bị trong môi trường thử nghiệm là mô phỏng. Hướng máy được suy ra từ chuyển động giữa hai lần định vị.</p>
      </main>
    </div>
  );
};
