import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The 3D digital twin is served by the gateway under /twin/ and shares the Tier-1 API client, auth and pure helpers
// with the operations portal (apps/web) through relative imports.
export default defineConfig({
  base: '/twin/',
  plugins: [react()],
  build: {
    minify: false,
    sourcemap: false,
  },
  // the shared modules of apps/web must resolve the SAME React instance as the twin (two copies break hooks)
  resolve: { dedupe: ['react', 'react-dom'] },
  server: {
    port: 3100,
    host: '0.0.0.0',
    fs: { allow: ['..'] },
    proxy: { '/api': { target: process.env.VITE_API_GATEWAY_URL || 'http://localhost:9080', changeOrigin: true } },
  },
});
