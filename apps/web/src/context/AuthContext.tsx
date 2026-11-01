// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenAgriOS Contributors

import React, { useCallback, useState, useEffect, useRef, ReactNode } from 'react';
import type { UserAccount } from '../types';
import { AuthContext, type SafeClaims } from './authCore';
import { api, ApiError } from '../services/api';
import { createPkcePair, randomUrlSafe } from '../utils/pkce';

function decodeSafeJwtClaims(token: string): SafeClaims | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='));
    // JWT payloads are UTF-8; atob alone mangles non-ASCII names (e.g. Vietnamese)
    const payloadJson = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    const raw = JSON.parse(payloadJson);
    
    // Strict allowlist: never dump sensitive internal claims or raw headers
    return {
      sub: raw.sub,
      preferred_username: raw.preferred_username,
      name: raw.name,
      roles: raw.realm_access?.roles || (raw.role ? [raw.role] : []),
      organization_id: raw.organization_id,
      iss: raw.iss,
      exp: raw.exp,
      iat: raw.iat,
      aud: Array.isArray(raw.aud) ? raw.aud.join(', ') : raw.aud,
    };
  } catch {
    return null;
  }
}

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  // CRITICAL SECURITY: Access token is stored strictly in in-memory state, NEVER in localStorage!
  const [token, setToken] = useState<string | null>(null);
  const [idToken, setIdToken] = useState<string | null>(null);
  const [user, setUser] = useState<UserAccount | null>(null);
  const [safeClaims, setSafeClaims] = useState<SafeClaims | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const callbackProcessed = useRef(false);

  const role = user?.role || null;
  const tenantId = user?.organization_id || null;

  const beginLogin = async (loginHint?: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const origin = window.location.origin.replace('127.0.0.1', 'localhost');
      const redirectUri = `${origin}/auth/callback`;
      const { verifier, challenge } = await createPkcePair();
      const state = randomUrlSafe(24);
      const session = await api.initPkceSession(redirectUri, challenge, state);
      sessionStorage.setItem('oidc_pkce_session', JSON.stringify({
        verifier,
        state,
        clientId: session.client_id,
        redirectUri,
      }));
      const authUrl = new URL(session.authorization_url);
      if (loginHint) authUrl.searchParams.set('login_hint', loginHint);
      window.location.assign(authUrl.toString());
    } catch (err: any) {
      if (err instanceof ApiError) {
        setError(err.message || 'Đăng nhập OIDC PKCE thất bại');
      } else {
        setError(err.message || 'Không thể kết nối tới máy chủ định danh Keycloak');
      }
      setToken(null);
      setIdToken(null);
      setUser(null);
      setSafeClaims(null);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const loginWithCredentials = async (username: string, password: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const origin = window.location.origin.replace('127.0.0.1', 'localhost');
      const redirectUri = `${origin}/auth/callback`;
      const { verifier, challenge } = await createPkcePair();
      const state = randomUrlSafe(24);
      const session = await api.initPkceSession(redirectUri, challenge, state);
      
      const authCodeRes = await api.acquirePkceAuthCode({
        username,
        password,
        code_challenge: challenge,
        state,
        redirect_uri: redirectUri,
        client_id: session.client_id,
      });

      const tokenRes = await api.exchangePkceToken({
        code: authCodeRes.code,
        code_verifier: verifier,
        state: authCodeRes.state || state,
        client_id: authCodeRes.client_id,
        redirect_uri: redirectUri,
      });

      loginWithToken(tokenRes.access_token, tokenRes.user, tokenRes.id_token);
    } catch (err: any) {
      if (err instanceof ApiError) {
        setError(err.message || 'Xác thực OIDC thất bại');
      } else {
        setError(err.message || 'Không thể kết nối tới Keycloak');
      }
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  // Complete the authorization-code callback once. The verifier lives only in
  // sessionStorage across the redirect; access tokens remain in React memory.
  useEffect(() => {
    const callbackUrl = new URL(window.location.href);
    const code = callbackUrl.searchParams.get('code');
    if (!window.location.pathname.endsWith('/auth/callback')) return;
    const run = () => {
    if (callbackProcessed.current) return;
    callbackProcessed.current = true;
    const oidcError = callbackUrl.searchParams.get('error_description') || callbackUrl.searchParams.get('error');
    if (oidcError) {
      window.history.replaceState({}, document.title, '/');
      sessionStorage.removeItem('oidc_pkce_session');
      setError(`Đăng nhập Keycloak không thành công: ${oidcError}`);
      return;
    }
    if (!code) { window.history.replaceState({}, document.title, '/'); setError('Keycloak không trả về mã xác thực.'); return; }
    const raw = sessionStorage.getItem('oidc_pkce_session');
    sessionStorage.removeItem('oidc_pkce_session');
    const returnedState = callbackUrl.searchParams.get('state');
    window.history.replaceState({}, document.title, '/');
    if (!raw) { setError('Phiên đăng nhập PKCE không còn hợp lệ. Vui lòng thử lại.'); return; }
    let session: { verifier: string; state: string; clientId: string; redirectUri: string };
    try { session = JSON.parse(raw); } catch { setError('Dữ liệu phiên đăng nhập không hợp lệ.'); return; }
    if (!returnedState || returnedState !== session.state) { setError('Xác thực state thất bại; yêu cầu đăng nhập đã bị từ chối.'); return; }
    setIsLoading(true);
    api.exchangePkceToken({
      code, code_verifier: session.verifier, state: session.state,
      client_id: session.clientId, redirect_uri: session.redirectUri,
    }).then((tokenRes) => {
      setToken(tokenRes.access_token);
      setIdToken(tokenRes.id_token || null);
      setUser(tokenRes.user);
      setSafeClaims(decodeSafeJwtClaims(tokenRes.access_token));
      setError(null);
    }).catch((err: any) => {
      setError(err.message || 'Không thể hoàn tất đăng nhập OIDC.');
    }).finally(() => setIsLoading(false));
    };
    // Deferred so state updates do not happen synchronously inside the effect body
    const t = window.setTimeout(run, 0);
    return () => window.clearTimeout(t);
  }, []);

  const loginWithToken = (newToken: string, newUser: UserAccount, newIdToken?: string) => {
    setToken(newToken);
    setIdToken(newIdToken || null);
    setUser(newUser);
    setSafeClaims(decodeSafeJwtClaims(newToken));
    setError(null);
  };

  const logout = useCallback((reason?: string) => {
    sessionStorage.removeItem('oidc_pkce_session');
    const issuer = safeClaims?.iss;
    const endSessionUrl = !reason && issuer ? new URL(`${issuer.replace(/\/+$/, '')}/protocol/openid-connect/logout`) : null;
    if (endSessionUrl) {
      endSessionUrl.searchParams.set('client_id', 'agriops-web');
      endSessionUrl.searchParams.set('post_logout_redirect_uri', `${window.location.origin}/`);
      if (idToken) endSessionUrl.searchParams.set('id_token_hint', idToken);
    }
    setToken(null);
    setIdToken(null);
    setUser(null);
    setSafeClaims(null);
    setError(reason ?? null);
    if (endSessionUrl) window.location.assign(endSessionUrl.toString());
  }, [safeClaims, idToken]);

  const clearError = () => setError(null);

  // Auto-clear session when token expires (local clear keeps the message visible)
  const expiresAt = safeClaims?.exp;
  useEffect(() => {
    if (!expiresAt) return;
    const remainingMs = expiresAt * 1000 - Date.now();
    const expire = () => logout('Phiên làm việc đã hết hạn. Vui lòng đăng nhập lại.');
    if (remainingMs <= 0) {
      const t = window.setTimeout(expire, 0);
      return () => window.clearTimeout(t);
    }
    // setTimeout overflows past ~24.8 days; clamp to stay safe
    const timer = window.setTimeout(expire, Math.min(remainingMs, 2_147_000_000));
    return () => window.clearTimeout(timer);
  }, [expiresAt, logout]);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        role,
        tenantId,
        isLoading,
        error,
        safeClaims,
        isAuthenticated: !!token && !!user,
        beginLogin,
        loginWithCredentials,
        loginWithToken,
        logout,
        clearError,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
