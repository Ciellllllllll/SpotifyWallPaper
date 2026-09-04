import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(
  fileURLToPath(new URL('..', import.meta.url))
);
const scanner = join(repositoryRoot, 'scripts/check-public-backend-secrets.mjs');

test('rejects every forbidden artifact pattern with a failing exit code', () => {
  const directory = mkdtempSync(join(tmpdir(), 'spotify-wallpaper-secret-scan-'));
  const fixture = join(directory, 'bundle.js');
  const cases = [
    ['pairing-token', `swpb1.${'a'.repeat(22)}.${'b'.repeat(43)}`],
    ['legacy-pairing-token', `swpt1.${'a'.repeat(20)}`],
    ['oauth-callback-query', '/auth/callback?code=fixture'],
    [
      'vite-spotify-secret',
      'const env = { VITE_SPOTIFY_ACCESS_TOKEN: "fixture" };'
    ],
    ['vite-spotify-secret', 'const env = VITE_SPOTIFY_PAIRING_TOKEN;'],
    ['vite-spotify-secret', 'const env = VITE_OAUTH_STATE;'],
    ['vite-spotify-secret', 'const env = VITE_UNREVIEWED_VALUE;'],
    ['access-token-canary', 'SWPB_CI_ACCESS_TOKEN_CANARY'],
    ['refresh-token-canary', 'SWPB_CI_REFRESH_TOKEN_CANARY'],
    ['pkce-verifier-canary', 'SWPB_CI_PKCE_VERIFIER_CANARY'],
    ['worker-key-canary', 'SWPB_CI_WORKER_KEY_CANARY']
  ];

  try {
    for (const [label, value] of cases) {
      writeFileSync(fixture, `const fixture = ${JSON.stringify(value)};\n`);
      const result = spawnSync(process.execPath, [scanner, directory], {
        encoding: 'utf8'
      });
      assert.equal(result.status, 1, `${label} must fail the scan`);
      assert.match(result.stderr, new RegExp(`Forbidden ${label} pattern`));
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('accepts the reviewed Vite environment names', () => {
  const directory = mkdtempSync(join(tmpdir(), 'spotify-wallpaper-secret-scan-'));
  const fixture = join(directory, 'bundle.js');

  try {
    writeFileSync(
      fixture,
      'const id = VITE_SPOTIFY_CLIENT_ID; const origin = VITE_SPOTIFY_BACKEND_ORIGIN;\n'
    );
    const result = spawnSync(process.execPath, [scanner, directory], {
      encoding: 'utf8'
    });
    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('accepts ordinary built text without forbidden patterns', () => {
  const directory = mkdtempSync(join(tmpdir(), 'spotify-wallpaper-secret-scan-'));
  const fixture = join(directory, 'bundle.js');

  try {
    writeFileSync(
      fixture,
      'const callbackPath = "/auth/callback"; const token = "";\n'
    );
    const result = spawnSync(process.execPath, [scanner, directory], {
      encoding: 'utf8'
    });
    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
