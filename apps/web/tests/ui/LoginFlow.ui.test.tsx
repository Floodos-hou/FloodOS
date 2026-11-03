// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { apiMocks, pkceMocks } = vi.hoisted(() => ({
  apiMocks: {
    initPkceSession: vi.fn(),
    acquirePkceAuthCode: vi.fn(),
    exchangePkceToken: vi.fn(),
  },
  pkceMocks: {
    createPkcePair: vi.fn(),
    randomUrlSafe: vi.fn(),
  },
}));

vi.mock('../../src/services/api', () => ({
  api: apiMocks,
  ApiError: class ApiError extends Error {},
}));
vi.mock('../../src/utils/pkce', () => pkceMocks);

import { AuthProvider } from '../../src/context/AuthContext';
import { useAuth } from '../../src/context/useAuth';
import { LoginPage } from '../../src/components/auth/LoginPage';

afterEach(cleanup);

const SessionStatus = () => {
  const { isAuthenticated, user } = useAuth();
  return <output aria-label="authentication-state">{isAuthenticated ? user?.username : 'signed-out'}</output>;
};

const renderLogin = () => render(
  <AuthProvider>
    <LoginPage />
    <SessionStatus />
  </AuthProvider>,
);

const signIn = (username: string, password: string) => {
  fireEvent.change(screen.getByLabelText('Tên đăng nhập'), { target: { value: username } });
  fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: /^đăng nhập$/i }));
};

describe('login UI and PKCE workflow', () => {
  it('starts with empty credentials: no username or password is pre-filled', () => {
    renderLogin();
    expect((screen.getByLabelText('Tên đăng nhập') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Mật khẩu') as HTMLInputElement).value).toBe('');
  });

  it('refuses to start PKCE with a blank form', () => {
    renderLogin();
    fireEvent.click(screen.getByRole('button', { name: /^đăng nhập$/i }));
    expect(screen.getByRole('alert').textContent).toMatch(/nhập tên đăng nhập và mật khẩu/i);
    expect(apiMocks.initPkceSession).not.toHaveBeenCalled();
  });

  it('completes the username/password UI through authorize URL, code and token exchange', async () => {
    pkceMocks.createPkcePair.mockResolvedValue({ verifier: 'v'.repeat(43), challenge: 'challenge' });
    pkceMocks.randomUrlSafe.mockReturnValue('state-value');
    apiMocks.initPkceSession.mockResolvedValue({ client_id: 'floodos-web' });
    apiMocks.acquirePkceAuthCode.mockResolvedValue({ code: 'auth-code', state: 'state-value', client_id: 'floodos-web' });
    apiMocks.exchangePkceToken.mockResolvedValue({
      access_token: 'header.eyJzdWIiOiJ1MSIsInByZWZlcnJlZF91c2VybmFtZSI6ImRpc3BhdGNoZXJfaG9hIn0.signature',
      id_token: 'id-token', token_type: 'Bearer', expires_in: 300,
      user: { user_id: 'u1', username: 'dispatcher_hoa', full_name: 'Chị Hoa', role: 'DISPATCHER', organization_id: 'ORG_HN' },
    });

    renderLogin();
    signIn('dispatcher_hoa', 'secret-pass');

    await waitFor(() => expect(screen.getByLabelText('authentication-state').textContent).toBe('dispatcher_hoa'));
    expect(apiMocks.initPkceSession).toHaveBeenCalledOnce();
    expect(apiMocks.acquirePkceAuthCode).toHaveBeenCalledWith(expect.objectContaining({
      username: 'dispatcher_hoa', password: 'secret-pass', code_challenge: 'challenge',
      state: 'state-value', client_id: 'floodos-web',
    }));
    expect(apiMocks.exchangePkceToken).toHaveBeenCalledWith(expect.objectContaining({
      code: 'auth-code', code_verifier: 'v'.repeat(43), state: 'state-value', client_id: 'floodos-web',
    }));
  });

  it('shows a clear API/network error and keeps the session signed out', async () => {
    pkceMocks.createPkcePair.mockResolvedValue({ verifier: 'v'.repeat(43), challenge: 'challenge' });
    pkceMocks.randomUrlSafe.mockReturnValue('state-value');
    apiMocks.initPkceSession.mockRejectedValue(new TypeError('Failed to fetch'));

    renderLogin();
    signIn('dispatcher_hoa', 'secret-pass');

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('Failed to fetch')).toBeTruthy();
    expect(screen.getByLabelText('authentication-state').textContent).toBe('signed-out');
    expect(apiMocks.acquirePkceAuthCode).not.toHaveBeenCalled();
  });
});
