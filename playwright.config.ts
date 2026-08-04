import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/playwright',
  snapshotDir: './tests/playwright/__snapshots__',
  timeout: 30_000,
  expect: {
    timeout: 5_000
  },
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:5173',
    colorScheme: 'dark',
    locale: 'en-US',
    reducedMotion: 'reduce',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  },
  webServer: {
    command: 'npm run dev -w @spotify-wallpaper/wallpaper',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: false,
    timeout: 120_000
  }
});
