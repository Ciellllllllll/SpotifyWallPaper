import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

const testKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
process.env.TOKEN_ENCRYPTION_KEYRING = JSON.stringify({ test: testKey });
process.env.TOKEN_ENCRYPTION_ACTIVE_KEY_ID = 'test';
process.env.PAIRING_HMAC_KEYRING = JSON.stringify({ test: testKey });
process.env.PAIRING_HMAC_ACTIVE_KEY_ID = 'test';
process.env.OAUTH_STATE_HMAC_KEY = testKey;

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: './src/index.ts',
      wrangler: {
        configPath: './wrangler.jsonc'
      }
    })
  ]
});
