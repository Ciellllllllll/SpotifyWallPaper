import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { assertReleaseIdentity } from './build-public-backend-artifact.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const releaseId = 'a'.repeat(40);

function gitResult(overrides = {}) {
  const values = {
    'rev-parse --show-toplevel': repositoryRoot,
    'rev-parse HEAD': releaseId,
    'status --porcelain=v1 --untracked-files=all': '',
    ...overrides
  };
  return (arguments_) => values[arguments_.join(' ')];
}

test('accepts only the exact clean repository HEAD', () => {
  assert.doesNotThrow(() => assertReleaseIdentity(releaseId, gitResult()));
  assert.throws(() => assertReleaseIdentity('not-a-sha', gitResult()));
  assert.throws(() =>
    assertReleaseIdentity(releaseId, gitResult({ 'rev-parse HEAD': 'b'.repeat(40) }))
  );
  assert.throws(() =>
    assertReleaseIdentity(
      releaseId,
      gitResult({ 'status --porcelain=v1 --untracked-files=all': ' M package.json' })
    )
  );
  assert.throws(() =>
    assertReleaseIdentity(
      releaseId,
      gitResult({ 'rev-parse --show-toplevel': resolve(repositoryRoot, '..') })
    )
  );
});

test(
  'builds an isolated allowlisted artifact with a verified manifest',
  { skip: process.env.SWP_ARTIFACT_OUTPUT === undefined },
  () => {
    const output = resolve(process.env.SWP_ARTIFACT_OUTPUT);
    const head = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repositoryRoot,
      encoding: 'utf8'
    }).trim();

    assert.equal(readFileSync(join(output, 'RELEASE_ID'), 'utf8'), `${head}\n`);
    const manifest = readFileSync(join(output, 'SHA256SUMS'), 'utf8')
      .trim()
      .split('\n');
    const paths = [];

    for (const entry of manifest) {
      const match = /^(?<digest>[0-9a-f]{64})  (?<path>.+)$/u.exec(entry);
      assert.ok(match);
      const path = match.groups.path;
      paths.push(path);
      const digest = createHash('sha256')
        .update(readFileSync(join(output, path)))
        .digest('hex');
      assert.equal(digest, match.groups.digest);
      assert.ok(!path.includes('/node_modules/'));
      assert.ok(!path.endsWith('.map'));
      assert.ok(!path.endsWith('.ts') || path.endsWith('.d.ts'));
    }

    assert.ok(paths.includes('RELEASE_ID'));
    assert.ok(paths.some((path) => path.startsWith('apps/public-backend/dist/')));
    assert.ok(paths.some((path) => path.startsWith('apps/public-backend/migrations/')));
    assert.ok(paths.some((path) => path.startsWith('apps/public-backend/legal/')));
    assert.ok(paths.some((path) => path.startsWith('packages/shared-types/dist/')));
  }
);
