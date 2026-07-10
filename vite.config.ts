/// <reference types="vitest/config" />

import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { pvcBridgePlugin } from './vite/pvcBridgePlugin';

export default defineConfig({
  // Unit tests exercise pure TS/TSX and do not need the app's serve/build
  // plugins. Keeping native build scanners out of Vitest also gives the Vite
  // process a clean owner teardown on Node 26.
  plugins: process.env.VITEST ? [] : [react(), tailwindcss(), pvcBridgePlugin()],
  build: {
    rolldownOptions: {
      output: {
        strictExecutionOrder: true,
        codeSplitting: {
          groups: [
            {
              name: 'vendor',
              test: /node_modules[\\/]/,
              maxSize: 400_000,
              priority: 10,
            },
            {
              name: 'app',
              test: /[\\/]src[\\/]/,
              maxSize: 400_000,
              priority: 5,
            },
          ],
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'vite/**/*.test.ts'],
  },
});
