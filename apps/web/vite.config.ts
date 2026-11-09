// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    minify: false,
    sourcemap: false,
  },
  server: {
    port: 3000,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: process.env.VITE_API_GATEWAY_URL || 'http://localhost:9080',
        changeOrigin: true,
      }
    }
  }
})
