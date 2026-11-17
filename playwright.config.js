import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  workers: 2,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 45_000,
  reporter: [['list'], ['html', { open: 'never' }]],
  // API contexts carry a secret key. Do not record request headers in traces.
  use: { trace: 'off', screenshot: 'off', video: 'off' },
});
