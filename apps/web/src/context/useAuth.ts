// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import { useContext } from 'react';
import { AuthContext } from './authCore';

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
};
