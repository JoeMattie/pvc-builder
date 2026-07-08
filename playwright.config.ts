import { defineConfig } from '@playwright/test';

// A tiny smoke suite against the BUILT app (definition of done, planfile §11):
// build + preview, then drive everything through window.__pvc.
const port = Number(process.env.PVC_E2E_PORT ?? 4188);

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  fullyParallel: false,
  use: { baseURL: `http://localhost:${port}` },
  webServer: {
    command: `npm run build && npm run preview -- --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
