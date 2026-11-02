// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import { createContext } from 'react';
import type { UserAccount, UserRole } from '../types';

export interface SafeClaims {
  sub?: string;
  preferred_username?: string;
  name?: string;
  roles?: string[];
  organization_id?: string;
  iss?: string;
  exp?: number;
  iat?: number;
  aud?: string;
}

export interface AuthContextType {
  user: UserAccount | null;
  token: string | null;
  role: UserRole | null;
  tenantId: string | null;
  isLoading: boolean;
  error: string | null;
  safeClaims: SafeClaims | null;
  isAuthenticated: boolean;
  /** loginHint pre-fills the username on the Keycloak page (used by the demo character picker) */
  beginLogin: (loginHint?: string) => Promise<void>;
  loginWithCredentials: (username: string, password: string) => Promise<void>;
  loginWithToken: (token: string, user: UserAccount, idToken?: string) => void;
  /** No argument: full single-sign-out via Keycloak. With a reason: clear the local session only and show the reason. */
  logout: (reason?: string) => void;
  clearError: () => void;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);
