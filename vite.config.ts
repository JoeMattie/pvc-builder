/// <reference types="vitest/config" />

import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { pvcBridgePlugin } from './vite/pvcBridgePlugin';

export default defineConfig({
  plugins: [react(), tailwindcss(), pvcBridgePlugin()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'vite/**/*.test.ts'],
  },
});
