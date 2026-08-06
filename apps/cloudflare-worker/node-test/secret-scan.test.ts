import {
  mkdtempSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('release artifact secret scanner', () => {
  it('passes a secret-free artifact directory', () => {
    withTemporaryDirectory((directory) => {
      writeFileSync(resolve(directory, 'bundle.js'), 'const mode="backend";');

      expect(runScanner(directory).status).toBe(0);
    });
  });

  it('fails without echoing a detected secret', () => {
    withTemporaryDirectory((directory) => {
      const secret =
        'swpb1.AAAAAAAAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
      writeFileSync(resolve(directory, 'bundle.js'), `const token="${secret}";`);

      const result = runScanner(directory);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('pairing-token');
      expect(result.stderr).not.toContain(secret);
    });
  });

  it('detects persisted OAuth callback query values without echoing them', () => {
    withTemporaryDirectory((directory) => {
      const callback =
        'https://api.wallpaper.example/auth/callback?code=sensitive&state=sensitive';
      writeFileSync(resolve(directory, 'cache.txt'), callback);

      const result = runScanner(directory);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('oauth-callback-query');
      expect(result.stderr).not.toContain(callback);
    });
  });

  it('detects legacy pairing tokens', () => {
    withTemporaryDirectory((directory) => {
      const token = `swpt1.${'A'.repeat(48)}`;
      writeFileSync(resolve(directory, 'legacy.txt'), token);

      const result = runScanner(directory);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('legacy-pairing-token');
      expect(result.stderr).not.toContain(token);
    });
  });

  it('detects escaped OAuth callback query values', () => {
    withTemporaryDirectory((directory) => {
      const callback =
        'https:\\/\\/api.wallpaper.example\\/auth\\/callback?code\\u003dsensitive\\u0026state\\u003dsensitive';
      writeFileSync(resolve(directory, 'escaped.js'), callback);

      const result = runScanner(directory);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('oauth-callback-query');
      expect(result.stderr).not.toContain(callback);
    });
  });

  it('scans NUL-containing artifacts instead of skipping the whole file', () => {
    withTemporaryDirectory((directory) => {
      const token =
        'swpb1.AAAAAAAAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
      writeFileSync(
        resolve(directory, 'binary.bin'),
        Buffer.concat([Buffer.from([0]), Buffer.from(token), Buffer.from([0])])
      );

      const result = runScanner(directory);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('pairing-token');
      expect(result.stderr).not.toContain(token);
    });
  });

  it.each([
    ['access-token-canary', 'SWPB_CI_ACCESS_TOKEN_CANARY'],
    ['refresh-token-canary', 'SWPB_CI_REFRESH_TOKEN_CANARY'],
    ['pkce-verifier-canary', 'SWPB_CI_PKCE_VERIFIER_CANARY'],
    ['worker-key-canary', 'SWPB_CI_WORKER_KEY_CANARY']
  ])('detects %s without echoing it', (label, canary) => {
    withTemporaryDirectory((directory) => {
      writeFileSync(resolve(directory, 'artifact.js'), canary);

      const result = runScanner(directory);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(label);
      expect(result.stderr).not.toContain(canary);
    });
  });
});

const withTemporaryDirectory = (run: (directory: string) => void): void => {
  const directory = mkdtempSync(resolve(tmpdir(), 'spotify-secret-scan-'));
  try {
    run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

const runScanner = (directory: string) => {
  const testDir = fileURLToPath(new URL('.', import.meta.url));
  const scriptPath = resolve(
    testDir,
    '../../../scripts/check-public-backend-secrets.mjs'
  );
  return spawnSync(process.execPath, [scriptPath, directory], {
    encoding: 'utf8'
  });
};
