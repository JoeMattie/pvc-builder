import { defineConfig } from '@playwright/test';

// A tiny smoke suite against the BUILT app (definition of done, planfile §11):
// build + preview, then drive everything through window.__pvc.
const port = Number(process.env.PVC_E2E_PORT ?? 4188);

export default defineConfig({
  testDir: 'e2e',
  timeout: 45_000,
  fullyParallel: false,
  use: { baseURL: `http://localhost:${port}` },
  projects: [
    {
      name: 'desktop',
      testIgnore: /mobile\.spec\.ts/,
      use: { viewport: { width: 1280, height: 800 } },
    },
    ...[
      ['phone-390-tall', 390, 844, true],
      ['phone-390-short', 390, 667, true],
      ['phone-320', 320, 568, true],
      ['tablet-768', 768, 1024, false],
      ['phone-landscape', 844, 390, true],
    ].map(([name, width, height, isMobile]) => ({
      name: String(name),
      testMatch: /mobile\.spec\.ts/,
      use: {
        viewport: { width: Number(width), height: Number(height) },
        hasTouch: true,
        isMobile: Boolean(isMobile),
      },
    })),
  ],
  webServer: {
    command: `npm run build && npm run preview -- --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
