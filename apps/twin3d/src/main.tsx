// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import React from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider } from '../../web/src/context/AuthContext';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>
);
