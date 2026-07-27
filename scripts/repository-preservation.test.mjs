import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  lstat,
  mkdir,
  mkdtemp,
  open as openFile,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  truncate,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';

import { queryWindowsReparsePoint } from './repository-authority.mjs';
import {
  comparePreservationFingerprints,
  computeRecoveredDocumentFingerprint,
  computeStaticLocalMetadataFingerprint,
  formatPreservationComparison,
  parseNullSeparatedRawDiff,
  preservationPolicyMatchesFixedPaths,
  verifyPhase0StagedIndex,
  verifyRecoveredCleanFilterIsRaw,
  verifyRecoveredIndexBytesAndAttributes,
} from './repository-preservation.mjs';

const execFileAsync = promisify(execFile);

function pathsEqualForHost(left, right) {
  const resolvedLeft = path.resolve(left);
  const resolvedRight = path.resolve(right);
  return process.platform === 'win32'
    ? resolvedLeft.toLocaleLowerCase('en-US') ===
        resolvedRight.toLocaleLowerCase('en-US')
    : resolvedLeft === resolvedRight;
}

function stableDirectoryIdentityMatches(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.birthtimeMs === right.birthtimeMs &&
    left.isDirectory() &&
    right.isDirectory()
  );
}

async function withTemporaryDirectory(callback) {
  const canonicalTemp = await realpath(tmpdir());
  const temporaryRoot = await mkdtemp(
    path.join(canonicalTemp, 'spotify-wallpaper-preservation-'),
  );
  const requestedRoot = path.resolve(temporaryRoot);
  assert.equal(pathsEqualForHost(path.dirname(requestedRoot), canonicalTemp), true);
  const initialStats = await lstat(requestedRoot);
  assert.equal(initialStats.isDirectory(), true);
  assert.equal(initialStats.isSymbolicLink(), false);
  assert.equal(await queryWindowsReparsePoint(requestedRoot), false);
  const canonicalRoot = await realpath(requestedRoot);
  assert.equal(pathsEqualForHost(canonicalRoot, requestedRoot), true);
  assert.equal(
    pathsEqualForHost(path.dirname(canonicalRoot), canonicalTemp),
    true,
  );
  try {
    await callback(requestedRoot);
  } finally {
    const finalStats = await lstat(requestedRoot);
    assert.equal(finalStats.isDirectory(), true);
    assert.equal(finalStats.isSymbolicLink(), false);
    assert.equal(
      stableDirectoryIdentityMatches(initialStats, finalStats),
      true,
    );
    assert.equal(await queryWindowsReparsePoint(requestedRoot), false);
    const finalRoot = await realpath(requestedRoot);
    assert.equal(pathsEqualForHost(finalRoot, requestedRoot), true);
    assert.equal(
      pathsEqualForHost(path.dirname(finalRoot), canonicalTemp),
      true,
    );
    await rm(requestedRoot, { recursive: true, force: false });
  }
}

test('fingerprints recovered documents with the fixed binary-safe algorithm', async () => {
  await withTemporaryDirectory(async (repositoryRoot) => {
    await mkdir(path.join(repositoryRoot, 'docs'), { recursive: true });
    await writeFile(
      path.join(repositoryRoot, '.gitattributes'),
      'docs/a.bin -text\ndocs/b.txt -text\n',
      'utf8',
    );
    await writeFile(
      path.join(repositoryRoot, 'docs', 'a.bin'),
      Buffer.from([0, 255, 1]),
    );
    await writeFile(
      path.join(repositoryRoot, 'docs', 'b.txt'),
      Buffer.from('line\r\n', 'utf8'),
    );

    const actual = await computeRecoveredDocumentFingerprint({
      repositoryRoot,
      paths: ['docs/b.txt', 'docs/a.bin'],
      source: 'worktree',
    });

    assert.equal(actual.count, 2);
    assert.equal(
      actual.digest.toString('hex'),
      'a49ee79029ae6f72a8a2c2d5309fd5baf61c53b9f0b58ca372bcdd6f8b908c9f',
    );
    assert.deepEqual(comparePreservationFingerprints(actual, actual), {
      match: true,
      count: 2,
    });
    assert.equal(
      formatPreservationComparison({ match: true, count: 2 }),
      'MATCH count=2',
    );

    const changed = {
      count: actual.count,
      digest: Buffer.from(actual.digest),
    };
    changed.digest[0] ^= 0xff;
    assert.deepEqual(comparePreservationFingerprints(actual, changed), {
      match: false,
      count: 2,
    });
  });
});

test('fails recovered-document inspection without reflecting a hostile path', async () => {
  await withTemporaryDirectory(async (repositoryRoot) => {
    const hostilePath = 'docs/callback?code=do-not-reflect.md';
    await assert.rejects(
      computeRecoveredDocumentFingerprint({
        repositoryRoot,
        paths: [hostilePath],
        source: 'worktree',
      }),
      {
        name: 'TypeError',
        message: 'Recovered document inspection failed.',
      },
    );
  });
});

test('rejects missing and oversized recovered worktree files', async () => {
  await withTemporaryDirectory(async (repositoryRoot) => {
    await mkdir(path.join(repositoryRoot, 'docs'), { recursive: true });
    await assert.rejects(
      computeRecoveredDocumentFingerprint({
        repositoryRoot,
        paths: ['docs/missing.md'],
        source: 'worktree',
      }),
      {
        name: 'TypeError',
        message: 'Recovered document inspection failed.',
      },
    );

    const oversizedPath = path.join(repositoryRoot, 'docs', 'oversized.md');
    await writeFile(oversizedPath, Buffer.alloc(0));
    await truncate(oversizedPath, 32 * 1024 * 1024 + 1);
    await assert.rejects(
      computeRecoveredDocumentFingerprint({
        repositoryRoot,
        paths: ['docs/oversized.md'],
        source: 'worktree',
      }),
      {
        name: 'TypeError',
        message: 'Recovered document inspection failed.',
      },
    );
  });
});

test('rejects a recovered fingerprint when the repository root identity changes', async () => {
  await withTemporaryDirectory(async (repositoryRoot) => {
    const repositoryPath = 'docs/a.md';
    await mkdir(path.join(repositoryRoot, 'docs'));
    await writeFile(
      path.join(repositoryRoot, repositoryPath),
      'fixture\n',
      'utf8',
    );
    let rootInspections = 0;
    let inspectedRoot;

    await assert.rejects(
      computeRecoveredDocumentFingerprint(
        {
          repositoryRoot,
          paths: [repositoryPath],
          source: 'worktree',
        },
        {
          lstat: async (absolutePath) => {
            const stats = await lstat(absolutePath);
            inspectedRoot ??= absolutePath;
            if (!pathsEqualForHost(absolutePath, inspectedRoot)) {
              return stats;
            }
            rootInspections += 1;
            if (rootInspections !== 1) {
              return stats;
            }
            return {
              ...stats,
              dev:
                typeof stats.dev === 'bigint'
                  ? stats.dev === 0n
                    ? 1n
                    : 0n
                  : stats.dev === 0
                    ? 1
                    : 0,
              isFile: () => stats.isFile(),
              isDirectory: () => stats.isDirectory(),
              isSymbolicLink: () => stats.isSymbolicLink(),
            };
          },
        },
      ),
      {
        name: 'TypeError',
        message: 'Recovered document inspection failed.',
      },
    );
    assert.equal(rootInspections >= 2, true);
  });
});

test('rejects a worktree file exchanged immediately before handle open', async () => {
  await withTemporaryDirectory(async (repositoryRoot) => {
    const documentPath = path.join(repositoryRoot, 'docs', 'a.md');
    const replacementPath = path.join(repositoryRoot, 'replacement.md');
    await mkdir(path.dirname(documentPath), { recursive: true });
    await writeFile(documentPath, 'original\n', 'utf8');
    await writeFile(replacementPath, 'replacement\n', 'utf8');
    let openCalled = false;

    await assert.rejects(
      computeRecoveredDocumentFingerprint(
        {
          repositoryRoot,
          paths: ['docs/a.md'],
          source: 'worktree',
        },
        {
          open: async (absolutePath, flags) => {
            openCalled = true;
            await rm(absolutePath);
            await symlink(replacementPath, absolutePath, 'file');
            return openFile(absolutePath, flags);
          },
        },
      ),
      {
        name: 'TypeError',
        message: 'Recovered document inspection failed.',
      },
    );
    assert.equal(openCalled, true);
  });
});

test('detects worktree growth through the bounded handle and always closes it', async () => {
  await withTemporaryDirectory(async (repositoryRoot) => {
    const documentPath = path.join(repositoryRoot, 'docs', 'a.md');
    await mkdir(path.dirname(documentPath), { recursive: true });
    await writeFile(documentPath, 'original\n', 'utf8');
    let closed = false;
    let grew = false;

    await assert.rejects(
      computeRecoveredDocumentFingerprint(
        {
          repositoryRoot,
          paths: ['docs/a.md'],
          source: 'worktree',
        },
        {
          open: async (absolutePath, flags) => {
            const handle = await openFile(absolutePath, flags);
            return {
              stat: (...args) => handle.stat(...args),
              read: async (...args) => {
                const result = await handle.read(...args);
                if (!grew) {
                  grew = true;
                  await writeFile(absolutePath, 'growth', { flag: 'a' });
                }
                return result;
              },
              close: async () => {
                closed = true;
                await handle.close();
              },
            };
          },
        },
      ),
      {
        name: 'TypeError',
        message: 'Recovered document inspection failed.',
      },
    );
    assert.equal(grew, true);
    assert.equal(closed, true);
  });
});

test('detects worktree truncation while reading an open handle', async () => {
  await withTemporaryDirectory(async (repositoryRoot) => {
    const documentPath = path.join(repositoryRoot, 'docs', 'a.md');
    await mkdir(path.dirname(documentPath), { recursive: true });
    await writeFile(documentPath, 'original\n', 'utf8');
    let truncated = false;

    await assert.rejects(
      computeRecoveredDocumentFingerprint(
        {
          repositoryRoot,
          paths: ['docs/a.md'],
          source: 'worktree',
        },
        {
          open: async (absolutePath, flags) => {
            const handle = await openFile(absolutePath, flags);
            return {
              stat: (...args) => handle.stat(...args),
              read: async (...args) => {
                const result = await handle.read(...args);
                if (!truncated) {
                  truncated = true;
                  await truncate(absolutePath, 0);
                }
                return result;
              },
              close: () => handle.close(),
            };
          },
        },
      ),
      {
        name: 'TypeError',
        message: 'Recovered document inspection failed.',
      },
    );
    assert.equal(truncated, true);
  });
});

test('detects an ancestor identity change after handle inspection', async () => {
  await withTemporaryDirectory(async (repositoryRoot) => {
    const docsPath = path.join(repositoryRoot, 'docs');
    const documentPath = path.join(docsPath, 'a.md');
    await mkdir(docsPath, { recursive: true });
    await writeFile(documentPath, 'original\n', 'utf8');
    let docsInspections = 0;

    await assert.rejects(
      computeRecoveredDocumentFingerprint(
        {
          repositoryRoot,
          paths: ['docs/a.md'],
          source: 'worktree',
        },
        {
          lstat: async (absolutePath) => {
            const stats = await lstat(absolutePath);
            if (absolutePath !== docsPath) {
              return stats;
            }
            docsInspections += 1;
            if (docsInspections === 1) {
              return stats;
            }
            return new Proxy(stats, {
              get(target, property) {
                if (property === 'dev') {
                  return Number(target.dev) + 1;
                }
                const value = Reflect.get(target, property, target);
                return typeof value === 'function'
                  ? value.bind(target)
                  : value;
              },
            });
          },
        },
      ),
      {
        name: 'TypeError',
        message: 'Recovered document inspection failed.',
      },
    );
    assert.equal(docsInspections >= 2, true);
  });
});

test('revalidates earlier recovered files after later reads', async () => {
  await withTemporaryDirectory(async (repositoryRoot) => {
    const docsPath = path.join(repositoryRoot, 'docs');
    const firstPath = path.join(docsPath, 'a.md');
    const secondPath = path.join(docsPath, 'b.md');
    await mkdir(docsPath);
    await writeFile(firstPath, 'first\n', 'utf8');
    await writeFile(secondPath, 'second\n', 'utf8');
    let changed = false;

    await assert.rejects(
      computeRecoveredDocumentFingerprint(
        {
          repositoryRoot,
          paths: ['docs/a.md', 'docs/b.md'],
          source: 'worktree',
        },
        {
          lstat: async (absolutePath) => {
            const stats = await lstat(absolutePath);
            if (absolutePath === secondPath && !changed) {
              changed = true;
              await writeFile(
                firstPath,
                'changed-after-first-read\n',
                'utf8',
              );
            }
            return stats;
          },
        },
      ),
      {
        name: 'TypeError',
        message: 'Recovered document inspection failed.',
      },
    );
    assert.equal(changed, true);
  });
});

test('fingerprints index and HEAD blobs without checkout or text decoding', async () => {
  await withTemporaryDirectory(async (repositoryRoot) => {
    await execFileAsync('git', ['init', '--quiet'], {
      cwd: repositoryRoot,
      windowsHide: true,
    });
    await execFileAsync('git', ['config', 'user.name', 'Test'], {
      cwd: repositoryRoot,
      windowsHide: true,
    });
    await execFileAsync('git', ['config', 'user.email', 'test@example.invalid'], {
      cwd: repositoryRoot,
      windowsHide: true,
    });
    await mkdir(path.join(repositoryRoot, 'docs'), { recursive: true });
    await writeFile(
      path.join(repositoryRoot, '.gitattributes'),
      'docs/a.bin -text\ndocs/b.txt -text\n',
      'utf8',
    );
    await writeFile(
      path.join(repositoryRoot, 'docs', 'a.bin'),
      Buffer.from([0, 255, 1]),
    );
    await writeFile(
      path.join(repositoryRoot, 'docs', 'b.txt'),
      Buffer.from('line\r\n', 'utf8'),
    );
    await execFileAsync(
      'git',
      ['add', '--', '.gitattributes', 'docs/a.bin', 'docs/b.txt'],
      {
        cwd: repositoryRoot,
        windowsHide: true,
      },
    );
    await execFileAsync('git', ['commit', '--quiet', '-m', 'fixture'], {
      cwd: repositoryRoot,
      windowsHide: true,
    });

    const options = {
      repositoryRoot,
      paths: ['docs/a.bin', 'docs/b.txt'],
    };
    const worktree = await computeRecoveredDocumentFingerprint({
      ...options,
      source: 'worktree',
    });
    const index = await computeRecoveredDocumentFingerprint({
      ...options,
      source: 'index',
    });
    const head = await computeRecoveredDocumentFingerprint({
      ...options,
      source: 'HEAD',
    });

    assert.deepEqual(comparePreservationFingerprints(worktree, index), {
      match: true,
      count: 2,
    });
    assert.deepEqual(comparePreservationFingerprints(worktree, head), {
      match: true,
      count: 2,
    });

    await writeFile(
      path.join(repositoryRoot, 'docs', 'a.bin'),
      Buffer.from([9, 8, 7]),
    );
    const changedWorktree = await computeRecoveredDocumentFingerprint({
      ...options,
      source: 'worktree',
    });
    assert.equal(
      comparePreservationFingerprints(changedWorktree, index).match,
      false,
    );
    assert.deepEqual(
      await computeRecoveredDocumentFingerprint({
        ...options,
        source: 'HEAD',
      }),
      head,
    );
  });
});

test('ignores Git replacement objects and inherited alternate index controls', async () => {
  await withTemporaryDirectory(async (repositoryRoot) => {
    await execFileAsync('git', ['init', '--quiet'], {
      cwd: repositoryRoot,
      windowsHide: true,
    });
    await execFileAsync('git', ['config', 'user.name', 'Test'], {
      cwd: repositoryRoot,
      windowsHide: true,
    });
    await execFileAsync('git', ['config', 'user.email', 'test@example.invalid'], {
      cwd: repositoryRoot,
      windowsHide: true,
    });
    await mkdir(path.join(repositoryRoot, 'docs'), { recursive: true });
    await writeFile(path.join(repositoryRoot, 'docs', 'a.md'), 'original\n', 'utf8');
    await execFileAsync('git', ['add', '--', 'docs/a.md'], {
      cwd: repositoryRoot,
      windowsHide: true,
    });
    await execFileAsync('git', ['commit', '--quiet', '-m', 'fixture'], {
      cwd: repositoryRoot,
      windowsHide: true,
    });
    const expected = await computeRecoveredDocumentFingerprint({
      repositoryRoot,
      paths: ['docs/a.md'],
      source: 'HEAD',
    });

    await writeFile(
      path.join(repositoryRoot, 'replacement.md'),
      'replacement\n',
      'utf8',
    );
    const { stdout: originalObject } = await execFileAsync(
      'git',
      ['rev-parse', 'HEAD:docs/a.md'],
      { cwd: repositoryRoot, windowsHide: true },
    );
    const { stdout: replacementObject } = await execFileAsync(
      'git',
      ['hash-object', '-w', '--', 'replacement.md'],
      { cwd: repositoryRoot, windowsHide: true },
    );
    await execFileAsync(
      'git',
      ['replace', originalObject.trim(), replacementObject.trim()],
      { cwd: repositoryRoot, windowsHide: true },
    );

    assert.deepEqual(
      await computeRecoveredDocumentFingerprint({
        repositoryRoot,
        paths: ['docs/a.md'],
        source: 'HEAD',
      }),
      expected,
    );

    const moduleUrl = new URL('./repository-preservation.mjs', import.meta.url).href;
    const evaluation = [
      `import { computeRecoveredDocumentFingerprint as compute } from ${JSON.stringify(moduleUrl)};`,
      `const value = await compute(${JSON.stringify({
        repositoryRoot,
        paths: ['docs/a.md'],
        source: 'index',
      })});`,
      'process.stdout.write(value.digest.toString("hex"));',
    ].join('');
    const inheritedControlResult = await execFileAsync(
      process.execPath,
      ['--input-type=module', '--eval', evaluation],
      {
        cwd: repositoryRoot,
        env: {
          ...process.env,
          GIT_INDEX_FILE: path.join(repositoryRoot, 'missing-hostile-index'),
          GIT_DIR: path.join(repositoryRoot, 'missing-hostile-git-dir'),
        },
        windowsHide: true,
      },
    );
    assert.equal(
      inheritedControlResult.stdout,
      expected.digest.toString('hex'),
    );
    assert.equal(inheritedControlResult.stderr, '');
  });
});

test('rejects index and HEAD modes 120000 and 160000', async () => {
  for (const unsafeMode of ['120000', '160000']) {
    await withTemporaryDirectory(async (repositoryRoot) => {
      await execFileAsync('git', ['init', '--quiet'], {
        cwd: repositoryRoot,
        windowsHide: true,
      });
      await execFileAsync('git', ['config', 'user.name', 'Test'], {
        cwd: repositoryRoot,
        windowsHide: true,
      });
      await execFileAsync(
        'git',
        ['config', 'user.email', 'test@example.invalid'],
        { cwd: repositoryRoot, windowsHide: true },
      );
      await writeFile(path.join(repositoryRoot, '.keep'), 'fixture\n', 'utf8');
      await execFileAsync('git', ['add', '--', '.keep'], {
        cwd: repositoryRoot,
        windowsHide: true,
      });
      await execFileAsync('git', ['commit', '--quiet', '-m', 'baseline'], {
        cwd: repositoryRoot,
        windowsHide: true,
      });
      const { stdout: headObjectId } = await execFileAsync(
        'git',
        ['rev-parse', 'HEAD'],
        { cwd: repositoryRoot, windowsHide: true },
      );
      const { stdout: blobObjectId } = await execFileAsync(
        'git',
        ['hash-object', '-w', '--', '.keep'],
        {
          cwd: repositoryRoot,
          windowsHide: true,
        },
      );
      const objectId =
        unsafeMode === '120000'
          ? blobObjectId.trim()
          : headObjectId.trim();
      await execFileAsync(
        'git',
        [
          'update-index',
          '--add',
          '--cacheinfo',
          unsafeMode,
          objectId,
          'docs/unsafe.md',
        ],
        { cwd: repositoryRoot, windowsHide: true },
      );

      await assert.rejects(
        computeRecoveredDocumentFingerprint({
          repositoryRoot,
          paths: ['docs/unsafe.md'],
          source: 'index',
        }),
        {
          name: 'TypeError',
          message: 'Recovered document inspection failed.',
        },
      );

      await execFileAsync('git', ['commit', '--quiet', '-m', 'unsafe mode'], {
        cwd: repositoryRoot,
        windowsHide: true,
      });
      await assert.rejects(
        computeRecoveredDocumentFingerprint({
          repositoryRoot,
          paths: ['docs/unsafe.md'],
          source: 'HEAD',
        }),
        {
          name: 'TypeError',
          message: 'Recovered document inspection failed.',
        },
      );
    });
  }
});

test('rejects missing and oversized index and HEAD blobs', async () => {
  await withTemporaryDirectory(async (repositoryRoot) => {
    await execFileAsync('git', ['init', '--quiet'], {
      cwd: repositoryRoot,
      windowsHide: true,
    });
    await execFileAsync('git', ['config', 'user.name', 'Test'], {
      cwd: repositoryRoot,
      windowsHide: true,
    });
    await execFileAsync('git', ['config', 'user.email', 'test@example.invalid'], {
      cwd: repositoryRoot,
      windowsHide: true,
    });
    await writeFile(path.join(repositoryRoot, '.keep'), 'fixture\n', 'utf8');
    await execFileAsync('git', ['add', '--', '.keep'], {
      cwd: repositoryRoot,
      windowsHide: true,
    });
    await execFileAsync('git', ['commit', '--quiet', '-m', 'baseline'], {
      cwd: repositoryRoot,
      windowsHide: true,
    });

    for (const source of ['index', 'HEAD']) {
      await assert.rejects(
        computeRecoveredDocumentFingerprint({
          repositoryRoot,
          paths: ['docs/missing.md'],
          source,
        }),
        {
          name: 'TypeError',
          message: 'Recovered document inspection failed.',
        },
      );
    }

    const largePath = path.join(repositoryRoot, 'docs', 'large.bin');
    await mkdir(path.dirname(largePath), { recursive: true });
    await writeFile(largePath, Buffer.alloc(0));
    await truncate(largePath, 32 * 1024 * 1024 + 1);
    await execFileAsync('git', ['add', '--', 'docs/large.bin'], {
      cwd: repositoryRoot,
      windowsHide: true,
    });
    await assert.rejects(
      computeRecoveredDocumentFingerprint({
        repositoryRoot,
        paths: ['docs/large.bin'],
        source: 'index',
      }),
      {
        name: 'TypeError',
        message: 'Recovered document inspection failed.',
      },
    );
    await execFileAsync('git', ['commit', '--quiet', '-m', 'large blob'], {
      cwd: repositoryRoot,
      windowsHide: true,
    });
    await assert.rejects(
      computeRecoveredDocumentFingerprint({
        repositoryRoot,
        paths: ['docs/large.bin'],
        source: 'HEAD',
      }),
      {
        name: 'TypeError',
        message: 'Recovered document inspection failed.',
      },
    );
  });
});

test('fingerprints static local path, type, and size metadata without content', async () => {
  await withTemporaryDirectory(async (repositoryRoot) => {
    await writeFile(path.join(repositoryRoot, 'CLAUDE.md'), 'abc\n', 'utf8');
    await mkdir(path.join(repositoryRoot, 'goal'), { recursive: true });
    await writeFile(path.join(repositoryRoot, 'goal', 'task.txt'), 'ok', 'utf8');

    const options = {
      repositoryRoot,
      paths: ['goal', '.claude', 'CLAUDE.md'],
    };
    const baseline = await computeStaticLocalMetadataFingerprint(options);
    assert.equal(baseline.count, 3);
    assert.equal(
      baseline.digest.toString('hex'),
      '3602e171f4c0a1bb9afaee4e0a58aaeb05a65221565e9d1ae222350e0ebecb2e',
    );

    await writeFile(path.join(repositoryRoot, 'CLAUDE.md'), 'xyz\n', 'utf8');
    const sameSize = await computeStaticLocalMetadataFingerprint(options);
    assert.deepEqual(comparePreservationFingerprints(baseline, sameSize), {
      match: true,
      count: 3,
    });

    await writeFile(path.join(repositoryRoot, 'CLAUDE.md'), 'longer\n', 'utf8');
    const changedSize = await computeStaticLocalMetadataFingerprint(options);
    assert.equal(
      comparePreservationFingerprints(baseline, changedSize).match,
      false,
    );
  });
});

test('rejects a static metadata file size outside the safe integer range', async () => {
  await withTemporaryDirectory(async (repositoryRoot) => {
    const targetPath = path.join(repositoryRoot, 'CLAUDE.md');
    await writeFile(targetPath, 'fixture\n', 'utf8');

    await assert.rejects(
      computeStaticLocalMetadataFingerprint(
        {
          repositoryRoot,
          paths: ['CLAUDE.md'],
        },
        {
          lstat: async (absolutePath) => {
            const stats = await lstat(absolutePath);
            if (!pathsEqualForHost(absolutePath, targetPath)) {
              return stats;
            }
            return {
              ...stats,
              size: Number.MAX_SAFE_INTEGER + 1,
              isFile: () => stats.isFile(),
              isDirectory: () => stats.isDirectory(),
              isSymbolicLink: () => stats.isSymbolicLink(),
            };
          },
        },
      ),
      {
        name: 'TypeError',
        message: 'Static local metadata inspection failed.',
      },
    );
  });
});

test('rejects static file size changes during inspection', async () => {
  await withTemporaryDirectory(async (repositoryRoot) => {
    const targetPath = path.join(repositoryRoot, 'CLAUDE.md');
    await writeFile(targetPath, 'abc', 'utf8');
    let injected = false;

    await assert.rejects(
      computeStaticLocalMetadataFingerprint(
        {
          repositoryRoot,
          paths: ['CLAUDE.md'],
        },
        {
          lstat: async (absolutePath) => {
            const stats = await lstat(absolutePath);
            if (absolutePath === targetPath && !injected) {
              injected = true;
              await writeFile(
                targetPath,
                'changed-size-now',
                'utf8',
              );
            }
            return stats;
          },
        },
      ),
      {
        name: 'TypeError',
        message: 'Static local metadata inspection failed.',
      },
    );
    assert.equal(injected, true);
  });
});

test('rejects static directory entry changes during traversal', async () => {
  await withTemporaryDirectory(async (repositoryRoot) => {
    const goalPath = path.join(repositoryRoot, 'goal');
    const childPath = path.join(goalPath, 'task.txt');
    await mkdir(goalPath);
    await writeFile(childPath, 'task', 'utf8');
    let injected = false;

    await assert.rejects(
      computeStaticLocalMetadataFingerprint(
        {
          repositoryRoot,
          paths: ['goal'],
        },
        {
          lstat: async (absolutePath) => {
            const stats = await lstat(absolutePath);
            if (absolutePath === childPath && !injected) {
              injected = true;
              await writeFile(
                path.join(goalPath, 'late.txt'),
                'late',
                'utf8',
              );
            }
            return stats;
          },
        },
      ),
      {
        name: 'TypeError',
        message: 'Static local metadata inspection failed.',
      },
    );
    assert.equal(injected, true);
  });
});

test('revalidates every static file after later siblings', async () => {
  await withTemporaryDirectory(async (repositoryRoot) => {
    const goalPath = path.join(repositoryRoot, 'goal');
    const firstPath = path.join(goalPath, 'a.txt');
    const secondPath = path.join(goalPath, 'b.txt');
    await mkdir(goalPath);
    await writeFile(firstPath, 'old', 'utf8');
    await writeFile(secondPath, 'b', 'utf8');
    let changed = false;

    await assert.rejects(
      computeStaticLocalMetadataFingerprint(
        {
          repositoryRoot,
          paths: ['goal'],
        },
        {
          lstat: async (absolutePath) => {
            const stats = await lstat(absolutePath);
            if (absolutePath === secondPath && !changed) {
              changed = true;
              await writeFile(
                firstPath,
                'changed-size',
                'utf8',
              );
            }
            return stats;
          },
        },
      ),
      {
        name: 'TypeError',
        message: 'Static local metadata inspection failed.',
      },
    );
    assert.equal(changed, true);
  });
});

test('revalidates earlier files after the second static snapshot finishes', async () => {
  await withTemporaryDirectory(async (repositoryRoot) => {
    const goalPath = path.join(repositoryRoot, 'goal');
    const firstPath = path.join(goalPath, 'a.txt');
    const secondPath = path.join(goalPath, 'b.txt');
    await mkdir(goalPath);
    await writeFile(firstPath, 'old', 'utf8');
    await writeFile(secondPath, 'b', 'utf8');
    let goalDirectoryReads = 0;
    let secondSnapshotStarted = false;
    let changed = false;

    await assert.rejects(
      computeStaticLocalMetadataFingerprint(
        {
          repositoryRoot,
          paths: ['goal'],
        },
        {
          readDirectory: async (absolutePath) => {
            if (pathsEqualForHost(absolutePath, goalPath)) {
              goalDirectoryReads += 1;
              secondSnapshotStarted = goalDirectoryReads >= 3;
            }
            return readdir(absolutePath, { withFileTypes: true });
          },
          lstat: async (absolutePath) => {
            const stats = await lstat(absolutePath);
            if (
              pathsEqualForHost(absolutePath, secondPath) &&
              secondSnapshotStarted &&
              !changed
            ) {
              changed = true;
              await writeFile(firstPath, 'changed-size', 'utf8');
            }
            return stats;
          },
        },
      ),
      {
        name: 'TypeError',
        message: 'Static local metadata inspection failed.',
      },
    );
    assert.equal(changed, true);
  });
});

test('revalidates earlier files after later siblings in the final static pass', async () => {
  await withTemporaryDirectory(async (repositoryRoot) => {
    const goalPath = path.join(repositoryRoot, 'goal');
    const firstPath = path.join(goalPath, 'a.txt');
    const secondPath = path.join(goalPath, 'b.txt');
    await mkdir(goalPath);
    await writeFile(firstPath, 'old', 'utf8');
    await writeFile(secondPath, 'b', 'utf8');
    let secondPathReads = 0;
    let changed = false;

    await assert.rejects(
      computeStaticLocalMetadataFingerprint(
        {
          repositoryRoot,
          paths: ['goal'],
        },
        {
          lstat: async (absolutePath) => {
            const stats = await lstat(absolutePath);
            if (
              pathsEqualForHost(absolutePath, secondPath) &&
              ++secondPathReads === 6
            ) {
              changed = true;
              await writeFile(firstPath, 'changed-size', 'utf8');
            }
            return stats;
          },
        },
      ),
      {
        name: 'TypeError',
        message: 'Static local metadata inspection failed.',
      },
    );
    assert.equal(changed, true);
  });
});

test('fails closed when static metadata traversal exceeds a fixed budget', async () => {
  await withTemporaryDirectory(async (repositoryRoot) => {
    await mkdir(path.join(repositoryRoot, 'goal'), { recursive: true });
    await writeFile(path.join(repositoryRoot, 'goal', 'a.txt'), 'a', 'utf8');
    await writeFile(path.join(repositoryRoot, 'goal', 'b.txt'), 'b', 'utf8');

    const boundary = await computeStaticLocalMetadataFingerprint(
      {
        repositoryRoot,
        paths: ['goal'],
      },
      {
        traversalLimits: {
          maxEntries: 3,
        },
      },
    );
    assert.equal(boundary.count, 3);

    await assert.rejects(
      computeStaticLocalMetadataFingerprint(
        {
          repositoryRoot,
          paths: ['goal'],
        },
        {
          traversalLimits: {
            maxEntries: 2,
          },
        },
      ),
      {
        name: 'TypeError',
        message: 'Static local metadata inspection failed.',
      },
    );
    await assert.rejects(
      computeStaticLocalMetadataFingerprint(
        {
          repositoryRoot,
          paths: ['goal'],
        },
        {
          traversalLimits: {
            maxPathBytes: 3,
          },
        },
      ),
      {
        name: 'TypeError',
        message: 'Static local metadata inspection failed.',
      },
    );
  });
});

test('rejects a reparse point in every static metadata ancestor', async (t) => {
  await withTemporaryDirectory(async (repositoryRoot) => {
    const actualDocs = path.join(repositoryRoot, 'actual-docs');
    const linkedDocs = path.join(repositoryRoot, 'docs');
    await mkdir(actualDocs, { recursive: true });
    await writeFile(path.join(actualDocs, 'phase-reports.zip'), 'fixture', 'utf8');
    try {
      await symlink(
        actualDocs,
        linkedDocs,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    } catch (error) {
      if (error?.code === 'EPERM' || error?.code === 'EACCES') {
        t.skip('This host cannot create the required reparse-point fixture.');
        return;
      }
      throw error;
    }

    await assert.rejects(
      computeStaticLocalMetadataFingerprint({
        repositoryRoot,
        paths: ['docs/phase-reports.zip'],
      }),
      {
        name: 'TypeError',
        message: 'Static local metadata inspection failed.',
      },
    );
  });
});

test('parses NUL-delimited raw staged entries without newline assumptions', () => {
  const zero = '0000000000000000000000000000000000000000';
  const one = '1111111111111111111111111111111111111111';
  const two = '2222222222222222222222222222222222222222';
  const input = Buffer.from(
    [
      `:000000 100644 ${zero} ${one} A\0docs/new.md\0`,
      `:100644 100644 ${one} ${two} M\0docs/guide.md\0`,
    ].join(''),
    'utf8',
  );

  assert.deepEqual(parseNullSeparatedRawDiff(input), [
    {
      oldMode: '000000',
      mode: '100644',
      status: 'A',
      oldPath: null,
      path: 'docs/new.md',
    },
    {
      oldMode: '100644',
      mode: '100644',
      status: 'M',
      oldPath: null,
      path: 'docs/guide.md',
    },
  ]);
});

test('parses rename, copy, and type-change raw staged metadata', () => {
  const one = '1111111111111111111111111111111111111111';
  const two = '2222222222222222222222222222222222222222';
  const input = Buffer.from(
    [
      `:100644 100644 ${one} ${two} R100\0docs/old.md\0docs/new.md\0`,
      `:100644 100644 ${one} ${two} C075\0docs/source.md\0docs/copy.md\0`,
      `:100644 120000 ${one} ${two} T\0docs/type.md\0`,
    ].join(''),
    'utf8',
  );

  assert.deepEqual(parseNullSeparatedRawDiff(input), [
    {
      oldMode: '100644',
      mode: '100644',
      status: 'R100',
      oldPath: 'docs/old.md',
      path: 'docs/new.md',
    },
    {
      oldMode: '100644',
      mode: '100644',
      status: 'C075',
      oldPath: 'docs/source.md',
      path: 'docs/copy.md',
    },
    {
      oldMode: '100644',
      mode: '120000',
      status: 'T',
      oldPath: null,
      path: 'docs/type.md',
    },
  ]);
});

test('rejects malformed, duplicate, and unsafe raw staged records', () => {
  const zero = '0000000000000000000000000000000000000000';
  const one = '1111111111111111111111111111111111111111';
  const invalidInputs = [
    Buffer.from(`:000000 100644 ${zero} ${one} A\0docs/new.md`, 'utf8'),
    Buffer.from(`:000000 100644 ${zero} bad A\0docs/new.md\0`, 'utf8'),
    Buffer.from(
      [
        `:000000 100644 ${zero} ${one} A\0docs/new.md\0`,
        `:000000 100644 ${zero} ${one} A\0docs/new.md\0`,
      ].join(''),
      'utf8',
    ),
    Buffer.from(`:000000 100644 ${zero} ${one} A\0docs/COM¹.md\0`, 'utf8'),
    Buffer.from([0xff, 0x00]),
  ];

  for (const input of invalidInputs) {
    assert.throws(
      () => parseNullSeparatedRawDiff(input),
      { name: 'TypeError', message: 'Invalid staged raw diff.' },
    );
  }
});

const PHASE0_MODIFIED_PATHS = [
  '.gitattributes',
  '.gitignore',
  '.github/workflows/ci.yml',
  'AGENTS.md',
  'package.json',
  'docs/README.md',
  'docs/02-repository-structure.md',
  'docs/24-docs-and-reporting.md',
];

const PHASE0_ADDED_PATHS = [
  'config/repository-authority.json',
  'scripts/repository-authority.mjs',
  'scripts/check-repository-authority.mjs',
  'scripts/repository-authority.test.mjs',
  'scripts/repository-preservation.mjs',
  'scripts/repository-preservation.test.mjs',
  'docs/00-codex-entrypoint.md',
  'docs/05-repository-authority.md',
  'docs/phase-reports/README.md',
  'docs/superpowers/plans/README.md',
  'docs/superpowers/plans/2026-07-27-system-wide-refactor-phase-0-repository-specification-truth.md',
  'docs/phase-reports/system-wide-refactor-phase-0-repository-specification-truth.md',
  'docs/12-rust-wasm-core.md',
  'docs/14-ui-layout.md',
  'docs/15-background-theme.md',
  'docs/16-visualizer.md',
  'docs/17-lyrics.md',
  'docs/18-transitions.md',
  'docs/21-rainmeter.md',
  'docs/release-notes-v0.0.1.md',
  'docs/superpowers/plans/2026-07-18-cloudflare-worker-public-backend.md',
  'docs/phase-reports/final-implementation-report.md',
  'docs/phase-reports/lyrics-deferred-spec-update.md',
  'docs/phase-reports/one-click-spotify-auth-token.md',
  'docs/phase-reports/phase-0-scaffold-and-mock-preview.md',
  'docs/phase-reports/phase-1-spotify-mvp.md',
  'docs/phase-reports/phase-2-wallpaper-engine-bridge.md',
  'docs/phase-reports/phase-3-rust-wasm-core.md',
  'docs/phase-reports/phase-4-settings-layout-customization.md',
  'docs/phase-reports/phase-5-background-theme.md',
  'docs/phase-reports/phase-6-visualizer.md',
  'docs/phase-reports/phase-7-lyrics.md',
  'docs/phase-reports/phase-8-transitions.md',
  'docs/phase-reports/phase-9-player-clock.md',
  'docs/phase-reports/phase-10-tauri-configurator.md',
  'docs/phase-reports/phase-11-rainmeter.md',
  'docs/phase-reports/phase-12-final-qa-docs.md',
  'docs/phase-reports/post-v0.0.1-stabilization.md',
];

const RECOVERED_DOCUMENT_PATHS = [
  'docs/12-rust-wasm-core.md',
  'docs/14-ui-layout.md',
  'docs/15-background-theme.md',
  'docs/16-visualizer.md',
  'docs/17-lyrics.md',
  'docs/18-transitions.md',
  'docs/21-rainmeter.md',
  'docs/release-notes-v0.0.1.md',
  'docs/superpowers/plans/2026-07-18-cloudflare-worker-public-backend.md',
  'docs/phase-reports/final-implementation-report.md',
  'docs/phase-reports/lyrics-deferred-spec-update.md',
  'docs/phase-reports/one-click-spotify-auth-token.md',
  'docs/phase-reports/phase-0-scaffold-and-mock-preview.md',
  'docs/phase-reports/phase-1-spotify-mvp.md',
  'docs/phase-reports/phase-2-wallpaper-engine-bridge.md',
  'docs/phase-reports/phase-3-rust-wasm-core.md',
  'docs/phase-reports/phase-4-settings-layout-customization.md',
  'docs/phase-reports/phase-5-background-theme.md',
  'docs/phase-reports/phase-6-visualizer.md',
  'docs/phase-reports/phase-7-lyrics.md',
  'docs/phase-reports/phase-8-transitions.md',
  'docs/phase-reports/phase-9-player-clock.md',
  'docs/phase-reports/phase-10-tauri-configurator.md',
  'docs/phase-reports/phase-11-rainmeter.md',
  'docs/phase-reports/phase-12-final-qa-docs.md',
  'docs/phase-reports/post-v0.0.1-stabilization.md',
];

test('requires policy preservation sets to exactly match fixed safety paths', () => {
  const exact = {
    preservation: {
      rawByteAttributesFile: '.gitattributes',
      recoveredDocuments: [...RECOVERED_DOCUMENT_PATHS],
      staticLocalPaths: [
        'docs/phase-reports.zip',
        'CLAUDE.md',
        'goal',
        '.superpowers',
        '.claude',
      ],
    },
  };
  assert.equal(preservationPolicyMatchesFixedPaths(exact), true);

  const reordered = structuredClone(exact);
  reordered.preservation.recoveredDocuments.reverse();
  reordered.preservation.staticLocalPaths.reverse();
  assert.equal(preservationPolicyMatchesFixedPaths(reordered), true);

  for (const mutate of [
    (policy) => policy.preservation.recoveredDocuments.pop(),
    (policy) => policy.preservation.recoveredDocuments.push('docs/extra.md'),
    (policy) =>
      policy.preservation.recoveredDocuments.push(
        policy.preservation.recoveredDocuments[0],
      ),
    (policy) => policy.preservation.staticLocalPaths.pop(),
    (policy) => policy.preservation.staticLocalPaths.push('extra-local'),
    (policy) =>
      policy.preservation.staticLocalPaths.push(
        policy.preservation.staticLocalPaths[0],
      ),
    (policy) => {
      policy.preservation.recoveredDocuments[0] =
        policy.preservation.recoveredDocuments[0].toLocaleUpperCase('en-US');
    },
  ]) {
    const changed = structuredClone(exact);
    mutate(changed);
    assert.equal(preservationPolicyMatchesFixedPaths(changed), false);
  }
});

function buildRawDiff(entries) {
  const zero = '0000000000000000000000000000000000000000';
  const one = '1111111111111111111111111111111111111111';
  const two = '2222222222222222222222222222222222222222';
  return Buffer.from(
    entries
      .map(({ path: repositoryPath, status, mode = '100644' }) =>
        status === 'A'
          ? `:000000 ${mode} ${zero} ${one} A\0${repositoryPath}\0`
          : `:100644 ${mode} ${one} ${two} ${status}\0${repositoryPath}\0`,
      )
      .join(''),
    'utf8',
  );
}

function replaceFirstRawDiffEntry(entries, replacement) {
  return Buffer.concat([
    replacement,
    buildRawDiff(entries.slice(1)),
  ]);
}

test('accepts only the exact 46-path Phase 0 staged allowlist', async () => {
  const exactEntries = [
    ...PHASE0_MODIFIED_PATHS.map((repositoryPath) => ({
      path: repositoryPath,
      status: 'M',
    })),
    ...PHASE0_ADDED_PATHS.map((repositoryPath) => ({
      path: repositoryPath,
      status: 'A',
    })),
  ];
  assert.equal(exactEntries.length, 46);

  const exact = await verifyPhase0StagedIndex('D:\\repository', {
    runGit: async () => buildRawDiff(exactEntries),
  });
  assert.deepEqual(exact, { match: true, count: 46 });

  const missing = await verifyPhase0StagedIndex('D:\\repository', {
    runGit: async () => buildRawDiff(exactEntries.slice(1)),
  });
  assert.deepEqual(missing, { match: false, count: 45 });

  const extra = await verifyPhase0StagedIndex('D:\\repository', {
    runGit: async () =>
      buildRawDiff([
        ...exactEntries,
        { path: 'apps/wallpaper/src/main.ts', status: 'A' },
      ]),
  });
  assert.deepEqual(extra, { match: false, count: 47 });

  const wrongMode = structuredClone(exactEntries);
  wrongMode[0].mode = '100755';
  assert.deepEqual(
    await verifyPhase0StagedIndex('D:\\repository', {
      runGit: async () => buildRawDiff(wrongMode),
    }),
    { match: false, count: 46 },
  );

  const deleted = structuredClone(exactEntries);
  deleted[0].status = 'D';
  assert.deepEqual(
    await verifyPhase0StagedIndex('D:\\repository', {
      runGit: async () => buildRawDiff(deleted),
    }),
    { match: false, count: 46 },
  );

  const one = '1111111111111111111111111111111111111111';
  const two = '2222222222222222222222222222222222222222';
  for (const replacement of [
    Buffer.from(
      `:100644 100644 ${one} ${two} R100\0old.gitattributes\0.gitattributes\0`,
      'utf8',
    ),
    Buffer.from(
      `:100644 100644 ${one} ${two} C100\0old.gitattributes\0.gitattributes\0`,
      'utf8',
    ),
    Buffer.from(
      `:100644 120000 ${one} ${two} T\0.gitattributes\0`,
      'utf8',
    ),
  ]) {
    assert.deepEqual(
      await verifyPhase0StagedIndex('D:\\repository', {
        runGit: async () => replaceFirstRawDiffEntry(exactEntries, replacement),
      }),
      { match: false, count: 46 },
    );
  }
});

test('forces staged diff visibility for submodules and external diff settings', async () => {
  const exactEntries = [
    ...PHASE0_MODIFIED_PATHS.map((repositoryPath) => ({
      path: repositoryPath,
      status: 'M',
    })),
    ...PHASE0_ADDED_PATHS.map((repositoryPath) => ({
      path: repositoryPath,
      status: 'A',
    })),
  ];
  let capturedArguments;
  const result = await verifyPhase0StagedIndex('D:\\repository', {
    runGit: async (_repositoryRoot, args) => {
      capturedArguments = args;
      return buildRawDiff(exactEntries);
    },
  });

  assert.deepEqual(result, { match: true, count: 46 });
  assert.deepEqual(capturedArguments, [
    'diff',
    '--cached',
    '--raw',
    '-z',
    '--abbrev=64',
    '--no-renames',
    '--ignore-submodules=none',
    '--no-ext-diff',
  ]);
});

test('verifies the production staged diff with full object ids and visible gitlinks', async () => {
  await withTemporaryDirectory(async (repositoryRoot) => {
    await execFileAsync('git', ['init', '--quiet'], {
      cwd: repositoryRoot,
      windowsHide: true,
    });
    await execFileAsync('git', ['config', 'user.name', 'Test'], {
      cwd: repositoryRoot,
      windowsHide: true,
    });
    await execFileAsync('git', ['config', 'user.email', 'test@example.invalid'], {
      cwd: repositoryRoot,
      windowsHide: true,
    });
    await execFileAsync('git', ['config', 'diff.ignoreSubmodules', 'all'], {
      cwd: repositoryRoot,
      windowsHide: true,
    });

    for (const repositoryPath of PHASE0_MODIFIED_PATHS) {
      const absolutePath = path.join(repositoryRoot, repositoryPath);
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, 'before\n', 'utf8');
    }
    await execFileAsync('git', ['add', '--', ...PHASE0_MODIFIED_PATHS], {
      cwd: repositoryRoot,
      windowsHide: true,
    });
    await execFileAsync('git', ['commit', '--quiet', '-m', 'baseline'], {
      cwd: repositoryRoot,
      windowsHide: true,
    });

    for (const repositoryPath of PHASE0_MODIFIED_PATHS) {
      await writeFile(
        path.join(repositoryRoot, repositoryPath),
        'after\n',
        'utf8',
      );
    }
    for (const repositoryPath of PHASE0_ADDED_PATHS) {
      const absolutePath = path.join(repositoryRoot, repositoryPath);
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(
        absolutePath,
        repositoryPath === 'config/repository-authority.json'
          ? await readFile(
              path.join(
                process.cwd(),
                'config',
                'repository-authority.json',
              ),
            )
          : 'added\n',
      );
    }
    await execFileAsync(
      'git',
      ['add', '--', ...PHASE0_MODIFIED_PATHS, ...PHASE0_ADDED_PATHS],
      { cwd: repositoryRoot, windowsHide: true },
    );

    assert.deepEqual(await verifyPhase0StagedIndex(repositoryRoot), {
      match: true,
      count: 46,
    });
    assert.deepEqual(
      await runPreservationCli([
        'verify-phase0-staged-index',
        `--repository-root=${repositoryRoot}`,
      ]),
      {
        exitCode: 0,
        stdout: 'MATCH count=46\n',
        stderr: '',
      },
    );

    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
      cwd: repositoryRoot,
      windowsHide: true,
    });
    await execFileAsync(
      'git',
      [
        'update-index',
        '--add',
        '--cacheinfo',
        '160000',
        stdout.trim(),
        'vendor/hidden-submodule',
      ],
      { cwd: repositoryRoot, windowsHide: true },
    );
    assert.deepEqual(await verifyPhase0StagedIndex(repositoryRoot), {
      match: false,
      count: 47,
    });
    assert.deepEqual(
      await runPreservationCli([
        'verify-phase0-staged-index',
        `--repository-root=${repositoryRoot}`,
      ]),
      {
        exitCode: 1,
        stdout: 'MISMATCH count=47\n',
        stderr: '',
      },
    );
  });
});

test('collapses staged Git failures and overflow to a fixed error', async () => {
  for (const runGit of [
    async () => {
      throw new Error('access-token-do-not-reflect');
    },
    async () => Buffer.alloc(4 * 1024 * 1024 + 1),
  ]) {
    await assert.rejects(
      verifyPhase0StagedIndex('D:\\repository', { runGit }),
      {
        name: 'TypeError',
        message: 'Phase 0 staged index inspection failed.',
      },
    );
  }
});

test('proves recovered clean filters and staged blobs preserve raw bytes', async () => {
  await withTemporaryDirectory(async (repositoryRoot) => {
    await execFileAsync('git', ['init', '--quiet'], {
      cwd: repositoryRoot,
      windowsHide: true,
    });
    await execFileAsync('git', ['config', 'core.autocrlf', 'true'], {
      cwd: repositoryRoot,
      windowsHide: true,
    });
    await mkdir(path.join(repositoryRoot, 'docs'), { recursive: true });
    await writeFile(
      path.join(repositoryRoot, 'docs', 'a.md'),
      Buffer.from('a\r\n', 'utf8'),
    );
    await writeFile(
      path.join(repositoryRoot, 'docs', 'b.md'),
      Buffer.from('b\r\n', 'utf8'),
    );
    const safeAttributes = [
      '* text=auto eol=lf',
      'docs/a.md -text whitespace=-trailing-space',
      'docs/b.md -text whitespace=-trailing-space',
      '',
    ].join('\n');
    await writeFile(
      path.join(repositoryRoot, '.gitattributes'),
      safeAttributes,
      'utf8',
    );
    const dependencies = {
      paths: ['docs/a.md', 'docs/b.md'],
      whitespacePaths: ['docs/a.md', 'docs/b.md'],
    };

    assert.deepEqual(
      await verifyRecoveredCleanFilterIsRaw(repositoryRoot, dependencies),
      { match: true, count: 2 },
    );

    await writeFile(
      path.join(repositoryRoot, '.gitattributes'),
      '* text=auto eol=lf\ndocs/a.md -text whitespace=-trailing-space\n',
      'utf8',
    );
    assert.deepEqual(
      await verifyRecoveredCleanFilterIsRaw(repositoryRoot, dependencies),
      { match: false, count: 2 },
    );

    await execFileAsync(
      'git',
      [
        'config',
        'filter.evil.clean',
        "sh -c 'echo invoked > filter-invoked'",
      ],
      { cwd: repositoryRoot, windowsHide: true },
    );
    for (const unsafeAttributes of [
      '* text=auto eol=lf\ndocs/** -text whitespace=-trailing-space\n',
      [
        '* text=auto eol=lf',
        'docs/a.md -text whitespace=-trailing-space',
        'docs/b.md -text whitespace=-trailing-space',
        'docs/a.md ident',
        '',
      ].join('\n'),
      [
        safeAttributes.trimEnd(),
        'docs/a.md -text whitespace=-trailing-space',
        '',
      ].join('\n'),
      [
        '* text=auto eol=lf',
        'docs/a.md -text whitespace=-trailing-space',
        'docs/b.md -text',
        '',
      ].join('\n'),
      [
        '* text=auto eol=lf',
        'docs/a.md -text whitespace=-trailing-space',
        'docs/b.md -text whitespace=-trailing-space',
        'docs/c.md -text whitespace=-trailing-space',
        '',
      ].join('\n'),
      [
        '* text=auto eol=lf',
        'docs/a.md -text whitespace=-trailing-space filter=evil',
        'docs/b.md -text whitespace=-trailing-space',
        '',
      ].join('\n'),
    ]) {
      await writeFile(
        path.join(repositoryRoot, '.gitattributes'),
        unsafeAttributes,
        'utf8',
      );
      assert.deepEqual(
        await verifyRecoveredCleanFilterIsRaw(repositoryRoot, dependencies),
        { match: false, count: 2 },
      );
    }
    await assert.rejects(
      lstat(path.join(repositoryRoot, 'filter-invoked')),
      { code: 'ENOENT' },
    );

    await writeFile(
      path.join(repositoryRoot, '.gitattributes'),
      safeAttributes,
      'utf8',
    );
    await execFileAsync(
      'git',
      ['add', '--', '.gitattributes', 'docs/a.md', 'docs/b.md'],
      { cwd: repositoryRoot, windowsHide: true },
    );
    assert.deepEqual(
      await execFileAsync('git', ['diff', '--cached', '--check'], {
        cwd: repositoryRoot,
        windowsHide: true,
      }),
      { stdout: '', stderr: '' },
    );
    assert.deepEqual(
      await verifyRecoveredIndexBytesAndAttributes(
        repositoryRoot,
        dependencies,
      ),
      { match: true, count: 2 },
    );

    await writeFile(
      path.join(repositoryRoot, '.gitattributes'),
      '* text=auto eol=lf\ndocs/** -text whitespace=-trailing-space\n',
      'utf8',
    );
    await execFileAsync('git', ['add', '--', '.gitattributes'], {
      cwd: repositoryRoot,
      windowsHide: true,
    });
    await writeFile(
      path.join(repositoryRoot, '.gitattributes'),
      safeAttributes,
      'utf8',
    );
    assert.deepEqual(
      await verifyRecoveredIndexBytesAndAttributes(
        repositoryRoot,
        dependencies,
      ),
      { match: false, count: 2 },
    );
    await execFileAsync('git', ['add', '--', '.gitattributes'], {
      cwd: repositoryRoot,
      windowsHide: true,
    });

    await writeFile(
      path.join(repositoryRoot, 'docs', 'b.md'),
      Buffer.from('changed\r\n', 'utf8'),
    );
    assert.deepEqual(
      await verifyRecoveredIndexBytesAndAttributes(
        repositoryRoot,
        dependencies,
      ),
      { match: false, count: 2 },
    );
  });
});

test('rejects nested and repository-local attribute sources', async () => {
  await withTemporaryDirectory(async (repositoryRoot) => {
    await execFileAsync('git', ['init', '--quiet'], {
      cwd: repositoryRoot,
      windowsHide: true,
    });
    await mkdir(path.join(repositoryRoot, 'docs'), { recursive: true });
    await writeFile(
      path.join(repositoryRoot, 'docs', 'a.md'),
      'recovered\r\n',
      'utf8',
    );
    await writeFile(
      path.join(repositoryRoot, 'docs', 'current.md'),
      'current\n',
      'utf8',
    );
    await writeFile(
      path.join(repositoryRoot, '.gitattributes'),
      '* text=auto eol=lf\ndocs/a.md -text\n',
      'utf8',
    );
    const dependencies = {
      paths: ['docs/a.md'],
      whitespacePaths: [],
      ordinaryPaths: ['docs/current.md'],
    };

    assert.deepEqual(
      await verifyRecoveredCleanFilterIsRaw(
        repositoryRoot,
        dependencies,
      ),
      { match: true, count: 1 },
    );

    await writeFile(
      path.join(repositoryRoot, 'docs', '.gitattributes'),
      'a.md -text\ncurrent.md text=auto eol=lf\n',
      'utf8',
    );
    assert.deepEqual(
      await verifyRecoveredCleanFilterIsRaw(
        repositoryRoot,
        dependencies,
      ),
      { match: false, count: 1 },
    );
    await rm(path.join(repositoryRoot, 'docs', '.gitattributes'));

    await writeFile(
      path.join(repositoryRoot, '.git', 'info', 'attributes'),
      'docs/a.md -text\n',
      'utf8',
    );
    assert.deepEqual(
      await verifyRecoveredCleanFilterIsRaw(
        repositoryRoot,
        dependencies,
      ),
      { match: false, count: 1 },
    );
    await rm(path.join(repositoryRoot, '.git', 'info', 'attributes'));

    await execFileAsync(
      'git',
      [
        'add',
        '--',
        '.gitattributes',
        'docs/a.md',
        'docs/current.md',
      ],
      { cwd: repositoryRoot, windowsHide: true },
    );
    assert.deepEqual(
      await verifyRecoveredIndexBytesAndAttributes(
        repositoryRoot,
        dependencies,
      ),
      { match: true, count: 1 },
    );
    await writeFile(
      path.join(repositoryRoot, 'docs', '.gitattributes'),
      'a.md -text\n',
      'utf8',
    );
    await execFileAsync(
      'git',
      ['add', '--', 'docs/.gitattributes'],
      { cwd: repositoryRoot, windowsHide: true },
    );
    await rm(path.join(repositoryRoot, 'docs', '.gitattributes'));
    assert.deepEqual(
      await verifyRecoveredIndexBytesAndAttributes(
        repositoryRoot,
        dependencies,
      ),
      { match: false, count: 1 },
    );
  });
});

test('rejects recovered clean-filter paths behind a reparse point', async (t) => {
  await withTemporaryDirectory(async (repositoryRoot) => {
    await execFileAsync('git', ['init', '--quiet'], {
      cwd: repositoryRoot,
      windowsHide: true,
    });
    const actualDocs = path.join(repositoryRoot, 'actual-docs');
    const linkedDocs = path.join(repositoryRoot, 'docs');
    await mkdir(actualDocs, { recursive: true });
    await writeFile(path.join(actualDocs, 'a.md'), 'fixture\r\n', 'utf8');
    await writeFile(
      path.join(repositoryRoot, '.gitattributes'),
      '* text=auto eol=lf\ndocs/a.md -text\n',
      'utf8',
    );
    try {
      await symlink(
        actualDocs,
        linkedDocs,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    } catch (error) {
      if (error?.code === 'EPERM' || error?.code === 'EACCES') {
        t.skip('This host cannot create the required reparse-point fixture.');
        return;
      }
      throw error;
    }

    await assert.rejects(
      verifyRecoveredCleanFilterIsRaw(repositoryRoot, {
        paths: ['docs/a.md'],
      }),
      {
        name: 'TypeError',
        message: 'Recovered clean-filter inspection failed.',
      },
    );
  });
});

async function runPreservationCli(args) {
  const scriptPath = path.join(
    process.cwd(),
    'scripts',
    'repository-preservation.mjs',
  );
  try {
    const result = await execFileAsync(process.execPath, [scriptPath, ...args], {
      windowsHide: true,
    });
    return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return {
      exitCode: error.code,
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? '',
    };
  }
}

async function initializeRecoveredCliRepository(repositoryRoot) {
  await execFileAsync('git', ['init', '--quiet'], {
    cwd: repositoryRoot,
    windowsHide: true,
  });
  await execFileAsync('git', ['config', 'user.name', 'Test'], {
    cwd: repositoryRoot,
    windowsHide: true,
  });
  await execFileAsync('git', ['config', 'user.email', 'test@example.invalid'], {
    cwd: repositoryRoot,
    windowsHide: true,
  });
  await execFileAsync('git', ['config', 'core.autocrlf', 'true'], {
    cwd: repositoryRoot,
    windowsHide: true,
  });
  await mkdir(path.join(repositoryRoot, 'config'), { recursive: true });
  await writeFile(
    path.join(repositoryRoot, 'config', 'repository-authority.json'),
    await readFile(
      path.join(process.cwd(), 'config', 'repository-authority.json'),
    ),
  );
  await writeFile(
    path.join(repositoryRoot, '.gitattributes'),
    [
      '* text=auto eol=lf',
      ...RECOVERED_DOCUMENT_PATHS.map(
        (repositoryPath) =>
          `${repositoryPath} -text${
            [
              'docs/phase-reports/phase-7-lyrics.md',
              'docs/phase-reports/phase-8-transitions.md',
            ].includes(repositoryPath)
              ? ' whitespace=-trailing-space'
              : ''
          }`,
      ),
      '',
    ].join('\n'),
    'utf8',
  );
  for (const repositoryPath of RECOVERED_DOCUMENT_PATHS) {
    const absolutePath = path.join(repositoryRoot, repositoryPath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, `${repositoryPath}\r\n`, 'utf8');
  }
  await execFileAsync(
    'git',
    ['add', '--', '.gitattributes', ...RECOVERED_DOCUMENT_PATHS],
    { cwd: repositoryRoot, windowsHide: true },
  );
  await execFileAsync('git', ['commit', '--quiet', '-m', 'recovered fixture'], {
    cwd: repositoryRoot,
    windowsHide: true,
  });
}

test('CLI enforces fixed policy in every compare and verify mode', async () => {
  await withTemporaryDirectory(async (repositoryRoot) => {
    await initializeRecoveredCliRepository(repositoryRoot);
    const rootArgument = `--repository-root=${repositoryRoot}`;
    const policyPath = path.join(
      repositoryRoot,
      'config',
      'repository-authority.json',
    );
    const exactPolicy = JSON.parse(await readFile(policyPath, 'utf8'));
    exactPolicy.preservation.recoveredDocuments.reverse();
    exactPolicy.preservation.staticLocalPaths.reverse();
    await writeFile(
      policyPath,
      `${JSON.stringify(exactPolicy, null, 2)}\n`,
      'utf8',
    );
    assert.deepEqual(
      await runPreservationCli([
        'verify-recovered-clean-filter',
        rootArgument,
      ]),
      {
        exitCode: 0,
        stdout: 'MATCH count=26\n',
        stderr: '',
      },
    );

    const recoveredCapture = await runPreservationCli([
      'capture-recovered',
      '--source=worktree',
      rootArgument,
    ]);
    const staticCapture = await runPreservationCli([
      'capture-static-local',
      rootArgument,
    ]);
    assert.equal(recoveredCapture.exitCode, 0);
    assert.equal(staticCapture.exitCode, 0);
    const compareAndVerifyModes = [
      [
        'compare-recovered',
        '--source=worktree',
        `--expected-token=${recoveredCapture.stdout.trim()}`,
      ],
      [
        'compare-static-local',
        `--expected-token=${staticCapture.stdout.trim()}`,
      ],
      ['verify-recovered-clean-filter'],
      ['verify-recovered-index'],
      ['verify-phase0-staged-index'],
    ];
    const mutations = [
      (policy) => policy.preservation.recoveredDocuments.pop(),
      (policy) =>
        policy.preservation.recoveredDocuments.push(
          'docs/access-token-policy-canary.md',
        ),
      (policy) => policy.preservation.staticLocalPaths.pop(),
      (policy) =>
        policy.preservation.staticLocalPaths.push(
          'refresh-token-policy-canary',
        ),
    ];

    for (const mutate of mutations) {
      const changedPolicy = structuredClone(exactPolicy);
      mutate(changedPolicy);
      await writeFile(
        policyPath,
        `${JSON.stringify(changedPolicy, null, 2)}\n`,
        'utf8',
      );
      for (const mode of compareAndVerifyModes) {
        const result = await runPreservationCli([
          ...mode,
          rootArgument,
        ]);
        assert.deepEqual(result, {
          exitCode: 2,
          stdout: '',
          stderr: 'PRESERVATION_INSPECTION_FAILED .\n',
        });
        assert.equal(result.stderr.includes('token'), false);
      }
    }

    const captureWithDrift = await runPreservationCli([
      'capture-recovered',
      '--source=worktree',
      rootArgument,
    ]);
    const staticCaptureWithDrift = await runPreservationCli([
      'capture-static-local',
      rootArgument,
    ]);
    assert.equal(captureWithDrift.exitCode, 0);
    assert.equal(staticCaptureWithDrift.exitCode, 0);
  });
});

test('CLI captures and compares only fixed preservation tokens', async () => {
  await withTemporaryDirectory(async (repositoryRoot) => {
    await initializeRecoveredCliRepository(repositoryRoot);
    const rootArgument = `--repository-root=${repositoryRoot}`;
    const capture = await runPreservationCli([
      'capture-recovered',
      '--source=worktree',
      rootArgument,
    ]);
    assert.equal(capture.exitCode, 0);
    assert.match(capture.stdout, /^v1:26:[0-9a-f]{64}\r?\n$/u);
    assert.equal(capture.stderr, '');

    const token = capture.stdout.trim();
    for (const source of ['index', 'HEAD']) {
      const sourceCapture = await runPreservationCli([
        'capture-recovered',
        `--source=${source}`,
        rootArgument,
      ]);
      assert.deepEqual(sourceCapture, {
        exitCode: 0,
        stdout: `${token}\n`,
        stderr: '',
      });
      assert.deepEqual(
        await runPreservationCli([
          'compare-recovered',
          `--source=${source}`,
          `--expected-token=${token}`,
          rootArgument,
        ]),
        {
          exitCode: 0,
          stdout: 'MATCH count=26\n',
          stderr: '',
        },
      );
    }
    const comparison = await runPreservationCli([
      'compare-recovered',
      '--source=worktree',
      `--expected-token=${token}`,
      rootArgument,
    ]);
    assert.deepEqual(comparison, {
      exitCode: 0,
      stdout: 'MATCH count=26\n',
      stderr: '',
    });

    for (const mode of [
      'verify-recovered-clean-filter',
      'verify-recovered-index',
    ]) {
      assert.deepEqual(
        await runPreservationCli([mode, rootArgument]),
        {
          exitCode: 0,
          stdout: 'MATCH count=26\n',
          stderr: '',
        },
      );
    }

    await writeFile(
      path.join(repositoryRoot, 'docs', 'phase-reports.zip'),
      'archive',
      'utf8',
    );
    await writeFile(path.join(repositoryRoot, 'CLAUDE.md'), 'abc\n', 'utf8');
    await mkdir(path.join(repositoryRoot, 'goal'), { recursive: true });
    await writeFile(
      path.join(repositoryRoot, 'goal', 'task.txt'),
      'task',
      'utf8',
    );
    await mkdir(path.join(repositoryRoot, '.superpowers'), { recursive: true });
    await writeFile(
      path.join(repositoryRoot, '.superpowers', 'state'),
      'state',
      'utf8',
    );
    const staticCapture = await runPreservationCli([
      'capture-static-local',
      rootArgument,
    ]);
    assert.equal(staticCapture.exitCode, 0);
    assert.match(staticCapture.stdout, /^v1:[0-9]+:[0-9a-f]{64}\r?\n$/u);
    assert.equal(staticCapture.stderr, '');
    const staticToken = staticCapture.stdout.trim();
    const staticCount = staticToken.split(':')[1];
    const staticComparison = await runPreservationCli([
      'compare-static-local',
      `--expected-token=${staticToken}`,
      rootArgument,
    ]);
    assert.deepEqual(staticComparison, {
      exitCode: 0,
      stdout: `MATCH count=${staticCount}\n`,
      stderr: '',
    });

    await writeFile(path.join(repositoryRoot, 'CLAUDE.md'), 'longer\n', 'utf8');
    const staticMismatch = await runPreservationCli([
      'compare-static-local',
      `--expected-token=${staticToken}`,
      rootArgument,
    ]);
    assert.equal(staticMismatch.exitCode, 1);
    assert.match(staticMismatch.stdout, /^MISMATCH count=[0-9]+\n$/u);
    assert.equal(staticMismatch.stderr, '');

    await writeFile(
      path.join(repositoryRoot, RECOVERED_DOCUMENT_PATHS[0]),
      'changed\n',
      'utf8',
    );
    const mismatch = await runPreservationCli([
      'compare-recovered',
      '--source=worktree',
      `--expected-token=${token}`,
      rootArgument,
    ]);
    assert.equal(mismatch.exitCode, 1);
    assert.equal(mismatch.stdout, 'MISMATCH count=26\n');
    assert.equal(mismatch.stderr, '');
    assert.deepEqual(
      await runPreservationCli(['verify-recovered-index', rootArgument]),
      {
        exitCode: 1,
        stdout: 'MISMATCH count=26\n',
        stderr: '',
      },
    );
    assert.deepEqual(
      await runPreservationCli(['verify-phase0-staged-index', rootArgument]),
      {
        exitCode: 1,
        stdout: 'MISMATCH count=0\n',
        stderr: '',
      },
    );

    const attributesWithoutFirstRecoveredPath = [
      '* text=auto eol=lf',
      ...RECOVERED_DOCUMENT_PATHS.slice(1).map(
        (repositoryPath) => `${repositoryPath} -text`,
      ),
      '',
    ].join('\n');
    await writeFile(
      path.join(repositoryRoot, '.gitattributes'),
      attributesWithoutFirstRecoveredPath,
      'utf8',
    );
    assert.deepEqual(
      await runPreservationCli([
        'verify-recovered-clean-filter',
        rootArgument,
      ]),
      {
        exitCode: 1,
        stdout: 'MISMATCH count=26\n',
        stderr: '',
      },
    );

    const nonexistentRoot = path.join(repositoryRoot, 'does-not-exist');
    for (const mode of [
      ['capture-recovered', '--source=worktree'],
      ['capture-static-local'],
      [
        'compare-recovered',
        '--source=worktree',
        `--expected-token=${token}`,
      ],
      [
        'compare-static-local',
        `--expected-token=${staticToken}`,
      ],
      ['verify-recovered-clean-filter'],
      ['verify-recovered-index'],
      ['verify-phase0-staged-index'],
    ]) {
      const inspectionFailure = await runPreservationCli([
        ...mode,
        `--repository-root=${nonexistentRoot}`,
      ]);
      assert.deepEqual(inspectionFailure, {
        exitCode: 2,
        stdout: '',
        stderr: 'PRESERVATION_INSPECTION_FAILED .\n',
      });
    }
  });
});

test('CLI rejects unknown, mixed, duplicate, relative-root, and malformed-token arguments', async () => {
  const invalidArgumentSets = [
    [],
    ['unknown-mode'],
    ['capture-recovered'],
    ['capture-recovered', '--source=worktree', '--source=HEAD'],
    ['capture-static-local', '--source=worktree'],
    ['capture-static-local', '--repository-root=relative'],
    [
      'compare-static-local',
      '--expected-token=v1:1:not-a-digest',
    ],
    [
      'compare-recovered',
      '--source=index',
      '--expected-token=v1:1:1111111111111111111111111111111111111111111111111111111111111111',
      '--unexpected',
    ],
  ];

  for (const args of invalidArgumentSets) {
    const result = await runPreservationCli(args);
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, 'PRESERVATION_ARGUMENT_INVALID .\n');
  }
});
