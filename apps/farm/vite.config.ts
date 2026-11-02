import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The farm game is served by the gateway under /farm/ and shares the Tier-1 API client, auth and pure helpers
// with the operations portal (apps/web) through relative imports.
export default defineConfig({
  base: '/farm/',
  plugins: [react()],
  // the shared modules of apps/web must resolve the SAME React instance as the game (two copies break hooks)
  resolve: { dedupe: ['react', 'react-dom'] },
  server: {
    port: 3100,
    host: '0.0.0.0',
    fs: { allow: ['..'] },
    proxy: { '/api': { target: process.env.VITE_API_GATEWAY_URL || 'http://localhost:9080', changeOrigin: true } },
  },
});
