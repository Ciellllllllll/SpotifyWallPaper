import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

const testEncryptionKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const testPairingKey = 'ggggggggggggggggggggggggggggggggggggggggggg';
process.env.TOKEN_ENCRYPTION_KEYRING = JSON.stringify({ test: testEncryptionKey });
process.env.TOKEN_ENCRYPTION_ACTIVE_KEY_ID = 'test';
process.env.PAIRING_HMAC_KEYRING = JSON.stringify({ test: testPairingKey });
process.env.PAIRING_HMAC_ACTIVE_KEY_ID = 'test';
process.env.OAUTH_STATE_HMAC_KEY = testEncryptionKey;

export default defineConfig({
  test: {
    setupFiles: ['./test/setup.ts']
  },
  plugins: [
    cloudflareTest(async () => ({
      main: './src/index.ts',
      wrangler: {
        configPath: './wrangler.jsonc'
      },
      miniflare: {
        bindings: {
          TEST_PRIMARY_MIGRATIONS: await readD1Migrations('./migrations'),
          TEST_DELETION_MIGRATIONS: await readD1Migrations('./migrations/deletion-ledger')
        }
      }
    }))
  ]
});
