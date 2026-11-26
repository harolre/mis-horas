import { defineConfig } from '@playwright/test';

const channel =
  process.env.PLAYWRIGHT_CHANNEL ??
  (process.platform === 'win32' ? 'msedge' : undefined);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: 'http://127.0.0.1:5173',
    channel,
    headless: true,
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
    viewport: { width: 390, height: 844 },
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5173',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
