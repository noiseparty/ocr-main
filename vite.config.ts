/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

// Served at https://www.skabene.id.lv/demo/ocr/ and Caddy passes the full path through,
// so every asset URL must carry the prefix.
const BASE = '/demo/ocr/';

export default defineConfig({
  base: BASE,
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1500,
  },
  server: {
    port: 5173,
    proxy: {
      // In production the shell serves /theme.css on the same origin. Locally, borrow it.
      '/theme.css': { target: 'https://www.skabene.id.lv', changeOrigin: true },
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
