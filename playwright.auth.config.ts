import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/playwright', testMatch: 'spotify-auth.spec.ts',
  outputDir: './artifacts/playwright-auth',
  timeout: 30000, retries: 0, reporter: 'list',
  use: { screenshot: 'off', trace: 'off', video: 'off' },
  webServer: { command: 'node scripts/serve-pages-test.mjs', url: 'http://127.0.0.1:1431/SpotifyWallPaper/spotify-auth/', reuseExistingServer: false }
});
