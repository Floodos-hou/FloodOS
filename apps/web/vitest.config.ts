// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['tests/ui/**/*.ui.test.tsx'],
    restoreMocks: true,
    clearMocks: true,
  },
});
