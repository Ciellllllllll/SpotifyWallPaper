import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir as readDirectory,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, test } from 'node:test';

import { main as checkRepositoryAuthority } from './check-repository-authority.mjs';
import {
  collectRepositorySnapshot,
  createBoundedReparseInspector,
  createSafeGitArguments,
  createSafeGitEnvironment,
  evaluateRepositoryAuthority,
  fileIdentityMatches,
  formatRepositoryAuthorityFindings,
  loadRepositoryAuthorityPolicy,
  normalizeDiscoveredRepositoryPath,
  parseNullSeparatedIndexEntries,
  queryWindowsReparsePoint,
  repositoryPathId,
  validateCanonicalRepositoryPath,
  validateGitignoreRule,
  validateRepositoryAuthorityPolicy,
} from './repository-authority.mjs';

const OID = '1111111111111111111111111111111111111111';
const execFileAsync = promisify(execFile);

test('builds a fixed Git environment without inherited control variables', () => {
  const environment = createSafeGitEnvironment(
    {
      PATH: 'trusted-path',
      PATHEXT: '.EXE',
      SystemRoot: 'C:\\Windows',
      TEMP: 'C:\\Temp',
      GIT_DIR: 'hostile-git-dir',
      GIT_INDEX_FILE: 'hostile-index',
      GIT_OBJECT_DIRECTORY: 'hostile-objects',
      GIT_CONFIG_GLOBAL: 'hostile-config',
      ACCESS_TOKEN_CANARY: 'must-not-be-forwarded',
    },
    'win32',
  );

  assert.deepEqual(environment, {
    PATH: 'trusted-path',
    PATHEXT: '.EXE',
    SYSTEMROOT: 'C:\\Windows',
    TEMP: 'C:\\Temp',
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_ATTR_NOSYSTEM: '1',
    GIT_LITERAL_PATHSPECS: '1',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'Never',
    GIT_CONFIG_GLOBAL: 'NUL',
    LC_ALL: 'C',
    LANG: 'C',
  });
  assert.deepEqual(createSafeGitArguments(['status'], 'win32'), [
    '-c',
    'core.attributesFile=NUL',
    '-c',
    'core.excludesFile=NUL',
    'status',
  ]);
  const posixEnvironment = createSafeGitEnvironment(
    {
      PATH: '/trusted/bin',
      Path: '/hostile/bin',
      TMPDIR: '/trusted/tmp',
      git_dir: '/hostile/repository',
    },
    'linux',
  );
  assert.equal(posixEnvironment.PATH, '/trusted/bin');
  assert.equal(posixEnvironment.TMPDIR, '/trusted/tmp');
  assert.equal(Object.hasOwn(posixEnvironment, 'Path'), false);
  assert.equal(Object.hasOwn(posixEnvironment, 'git_dir'), false);
});

test('includes mode and ctime in authority file identity comparisons', () => {
  const base = {
    dev: 1,
    ino: 2,
    mode: 0o100644,
    size: 10,
    mtimeMs: 20,
    ctimeMs: 30,
    isFile: () => true,
    isDirectory: () => false,
  };
  assert.equal(fileIdentityMatches(base, { ...base }), true);
  assert.equal(
    fileIdentityMatches(base, { ...base, mode: 0o100755 }),
    false,
  );
  assert.equal(
    fileIdentityMatches(base, { ...base, ctimeMs: 31 }),
    false,
  );
});

test('bounds generic reparse queries by count and elapsed time', async () => {
  const byCount = createBoundedReparseInspector(async () => false, {
    maxQueries: 2,
  });
  const stats = {
    dev: 1,
    ino: 1,
    mode: 0o100644,
    size: 1,
    mtimeMs: 1,
    ctimeMs: 1,
  };
  assert.equal(await byCount('C:\\one', stats), false);
  assert.equal(await byCount('C:\\two', { ...stats, ino: 2 }), false);
  await assert.rejects(byCount('C:\\three', { ...stats, ino: 3 }));

  let now = 0;
  const byTime = createBoundedReparseInspector(async () => {
    now = 20;
    return false;
  }, {
    maxElapsedMs: 10,
    now: () => now,
  });
  await assert.rejects(byTime('C:\\slow', stats));

  const productionBoundary = createBoundedReparseInspector(
    async () => false,
  );
  for (let index = 0; index < 256; index += 1) {
    assert.equal(
      await productionBoundary(
        `C:\\boundary\\${index}`,
        { ...stats, ino: index + 1 },
      ),
      false,
    );
  }
  await assert.rejects(
    productionBoundary(
      'C:\\boundary\\overflow',
      { ...stats, ino: 257 },
    ),
  );
});

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

function trackedEntry(mode = '100644') {
  return { mode, oid: OID, stage: 0 };
}

function makePolicy(overrides = {}) {
  return {
    schemaVersion: 1,
    markdownRoots: ['docs'],
    documentGroups: [
      {
        name: 'repository-entry',
        classification: 'normative',
        paths: ['AGENTS.md', 'README.md'],
      },
      {
        name: 'project-governance',
        classification: 'normative',
        paths: ['docs/guide.md'],
      },
      {
        name: 'historical',
        classification: 'historical-evidence',
        paths: ['docs/history.md'],
      },
    ],
    ignoredArtifacts: [
      {
        ignorePattern: '/dist/',
        probePath: 'dist/.repository-authority-probe',
        classification: 'generated-output',
        owner: 'build system',
        producer: 'npm run build',
        sourceInputs: ['package.json'],
      },
    ],
    trackedIgnoreExceptions: [
      {
        ignorePattern: '!/**/.env.example',
        probePath: 'apps/example/.env.example',
      },
    ],
    trackedGeneratedSources: [
      {
        path: 'generated.d.ts',
        owner: 'generated boundary',
        producer: 'npm run generate',
        sourceInputs: ['package.json'],
        verificationCommand: 'npm run generate, then verify the diff',
      },
    ],
    preservation: {
      rawByteAttributesFile: '.gitattributes',
      recoveredDocuments: ['docs/history.md'],
      staticLocalPaths: ['local-state'],
    },
    ...overrides,
  };
}

function makeSnapshot(overrides = {}) {
  return {
    existingPaths: new Set([
      '.gitattributes',
      '.gitignore',
      'AGENTS.md',
      'README.md',
      'config/repository-authority.json',
      'docs/guide.md',
      'docs/history.md',
      'generated.d.ts',
      'package.json',
    ]),
    symlinkPaths: new Set(),
    trackedEntries: new Map([
      ['.gitattributes', trackedEntry()],
      ['.gitignore', trackedEntry()],
      ['AGENTS.md', trackedEntry()],
      ['README.md', trackedEntry()],
      ['config/repository-authority.json', trackedEntry()],
      ['docs/guide.md', trackedEntry()],
      ['docs/history.md', trackedEntry()],
      ['generated.d.ts', trackedEntry()],
      ['package.json', trackedEntry()],
    ]),
    trackedIgnoredPaths: new Set(),
    markdownPaths: new Set(['docs/guide.md', 'docs/history.md']),
    gitignoreRules: ['/dist/', '!/**/.env.example'],
    ignoredProbePaths: new Set(['dist/.repository-authority-probe']),
    inspectionFindings: [],
    ...overrides,
  };
}

function findingCodes(findings) {
  return findings.map((finding) => finding.code);
}

async function withTemporaryGitRepository(callback) {
  const canonicalTemp = await realpath(tmpdir());
  const repositoryRoot = await mkdtemp(
    path.join(canonicalTemp, 'spotify-wallpaper-authority-'),
  );
  const requestedRoot = path.resolve(repositoryRoot);
  assert.equal(pathsEqualForHost(path.dirname(requestedRoot), canonicalTemp), true);
  const initialStats = await lstat(requestedRoot);
  assert.equal(initialStats.isDirectory(), true);
  assert.equal(initialStats.isSymbolicLink(), false);
  assert.equal(await queryWindowsReparsePoint(requestedRoot), false);
  const canonicalRepository = await realpath(requestedRoot);
  assert.equal(pathsEqualForHost(canonicalRepository, requestedRoot), true);
  assert.equal(
    pathsEqualForHost(path.dirname(canonicalRepository), canonicalTemp),
    true,
  );

  try {
    await execFileAsync('git', ['init', '--quiet'], {
      cwd: requestedRoot,
      windowsHide: true,
    });
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
    const finalCanonical = await realpath(requestedRoot);
    assert.equal(pathsEqualForHost(finalCanonical, requestedRoot), true);
    assert.equal(
      pathsEqualForHost(path.dirname(finalCanonical), canonicalTemp),
      true,
    );
    await rm(requestedRoot, { recursive: true, force: false });
  }
}

async function writeValidRepository(repositoryRoot, policy = makePolicy()) {
  const files = new Map([
    ['.gitattributes', '* text=auto eol=lf\n'],
    ['.gitignore', '/dist/\n!/**/.env.example\n'],
    ['AGENTS.md', '# Agent instructions\n'],
    ['README.md', '# Project\n'],
    ['docs/guide.md', '# Guide\n'],
    ['docs/history.md', '# History\n'],
    ['generated.d.ts', 'export {};\n'],
    ['package.json', '{}\n'],
    ['config/repository-authority.json', `${JSON.stringify(policy, null, 2)}\n`],
  ]);

  for (const [repositoryPath, content] of files) {
    const absolutePath = path.join(repositoryRoot, repositoryPath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, 'utf8');
  }

  await execFileAsync('git', ['add', '--', ...files.keys()], {
    cwd: repositoryRoot,
    windowsHide: true,
  });
}

async function gitReportsIgnored(repositoryRoot, repositoryPath) {
  try {
    await execFileAsync(
      'git',
      ['check-ignore', '--quiet', '--no-index', '--', repositoryPath],
      { cwd: repositoryRoot, windowsHide: true },
    );
    return true;
  } catch (error) {
    if (error?.code === 1) {
      return false;
    }
    throw error;
  }
}

function runGitBufferForTest(repositoryRoot, args, stdin = null) {
  return new Promise((resolve) => {
    const child = execFile(
      'git',
      args,
      {
        cwd: repositoryRoot,
        encoding: 'buffer',
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
      },
      (error, stdout) => {
        resolve({
          exitCode:
            error === null
              ? 0
              : Number.isInteger(error?.code)
                ? error.code
                : 2,
          stdout: Buffer.isBuffer(stdout) ? stdout : Buffer.alloc(0),
          stderr: Buffer.alloc(0),
        });
      },
    );
    child.stdin?.on('error', () => {});
    child.stdin?.end(stdin ?? undefined);
  });
}

describe('repository path validation', () => {
  test('normalizes safe discovered paths', () => {
    assert.equal(
      normalizeDiscoveredRepositoryPath('.\\docs\\guide.md'),
      'docs/guide.md',
    );
  });

  test('rejects unsafe discovered repository paths', () => {
    const unsafePaths = [
      '',
      '.',
      '..',
      '../docs/guide.md',
      'docs/../guide.md',
      '/docs/guide.md',
      '\\docs\\guide.md',
      'C:/docs/guide.md',
      '\\\\server\\share\\guide.md',
      'docs/guide.md:stream',
      'docs/trailing.',
      'docs/trailing ',
      'docs/\u0001guide.md',
      'docs/\u061cguide.md',
      'docs/\u200eguide.md',
      'docs/\u200fguide.md',
      'docs/\u202eguide.md',
      'docs/CON',
      'docs/prn.txt',
      'docs/AUX.tar.gz',
      'docs/NUL.md',
      'docs/COM9.txt',
      'docs/lpt1.tar.gz',
      'docs/COM¹',
      'docs/com².txt',
      'docs/COM³.tar.gz',
      'docs/LPT¹',
      'docs/lpt².txt',
      'docs/LPT³.tar.gz',
    ];

    for (const repositoryPath of unsafePaths) {
      assert.throws(
        () => normalizeDiscoveredRepositoryPath(repositoryPath),
        { name: 'TypeError' },
        repositoryPath,
      );
    }
  });

  test('validates canonical policy paths without accepting backslashes', () => {
    assert.equal(validateCanonicalRepositoryPath('docs/guide.md'), true);
    assert.equal(validateCanonicalRepositoryPath('docs\\guide.md'), false);
    assert.equal(validateCanonicalRepositoryPath('docs/COM¹.md'), false);
    assert.equal(validateCanonicalRepositoryPath('docs/lpt³.tar.gz'), false);
  });

  test('validates only safe root-anchored Gitignore rules', () => {
    assert.equal(validateGitignoreRule('/apps/*/dist/', false), true);
    assert.equal(validateGitignoreRule('!/**/.env.example', true), true);
    assert.equal(validateGitignoreRule('/docs/COM¹.md', false), false);
    assert.equal(validateGitignoreRule('/docs/lpt³.tar.gz', false), false);
    assert.equal(validateGitignoreRule('/docs/name*./', false), false);
    assert.equal(validateGitignoreRule('/docs/\u200ename*/', false), false);
    assert.equal(validateGitignoreRule('/docs/COM¹.*/', false), false);
    assert.equal(validateGitignoreRule('/docs/LPT³*/', false), false);
    assert.equal(validateGitignoreRule('/docs/CON*/', false), false);
    assert.equal(validateGitignoreRule('docs/', false), false);
    assert.equal(validateGitignoreRule('/docs/', true), false);
    assert.equal(validateGitignoreRule('!/**/.env.example', false), false);
  });
});

test('queries Windows reparse attributes without emitting command output', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('Windows reparse attributes are host-specific.');
    return;
  }
  await withTemporaryGitRepository(async (repositoryRoot) => {
    const targetPath = path.join(repositoryRoot, 'target-directory');
    const junctionPath = path.join(repositoryRoot, 'junction-directory');
    await mkdir(targetPath);
    await symlink(targetPath, junctionPath, 'junction');

    assert.equal(
      await queryWindowsReparsePoint(targetPath),
      false,
    );
    assert.equal(
      await queryWindowsReparsePoint(junctionPath),
      true,
    );
  });
});

test('pins the reparse query executable and fails a hung query closed', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('Windows reparse attributes are host-specific.');
    return;
  }
  const expectedExecutable = 'C:\\Windows\\System32\\fsutil.exe';
  let capturedCommand;
  let capturedOptions;
  const completedChild = new EventEmitter();
  completedChild.kill = () => true;
  completedChild.stdout = new EventEmitter();
  completedChild.stderr = new EventEmitter();
  const completed = queryWindowsReparsePoint('C:\\safe\\path', {
    resolveExecutable: async () => expectedExecutable,
    spawnProcess: (command, _args, options) => {
      capturedCommand = command;
      capturedOptions = options;
      queueMicrotask(() => {
        completedChild.stderr.emit(
          'data',
          Buffer.from(
            'Error 4390: The file or directory is not a reparse point.\n',
            'utf8',
          ),
        );
        completedChild.emit('close', 1, null);
      });
      return completedChild;
    },
    timeoutMs: 100,
  });
  assert.equal(await completed, false);
  assert.equal(capturedCommand, expectedExecutable);
  assert.equal(capturedOptions?.cwd, 'C:\\Windows\\System32');
  assert.equal(capturedOptions?.shell, false);
  assert.deepEqual(capturedOptions?.stdio, ['ignore', 'pipe', 'pipe']);

  const alternateExecutable = 'D:\\Windows\\System32\\fsutil.exe';
  const alternateChild = new EventEmitter();
  alternateChild.kill = () => true;
  alternateChild.stdout = new EventEmitter();
  alternateChild.stderr = new EventEmitter();
  let alternateCommand;
  const alternate = queryWindowsReparsePoint('D:\\safe\\path', {
    resolveExecutable: async () => alternateExecutable,
    spawnProcess: (command) => {
      alternateCommand = command;
      queueMicrotask(() => {
        alternateChild.stdout.emit(
          'data',
          Buffer.from(
            'Error 4390: The file or directory is not a reparse point.\n',
            'utf8',
          ),
        );
        alternateChild.emit('close', 1, null);
      });
      return alternateChild;
    },
    timeoutMs: 100,
  });
  assert.equal(await alternate, false);
  assert.equal(alternateCommand, alternateExecutable);

  const failedChild = new EventEmitter();
  failedChild.kill = () => true;
  failedChild.stdout = new EventEmitter();
  failedChild.stderr = new EventEmitter();
  await assert.rejects(
    queryWindowsReparsePoint('C:\\safe\\path', {
      resolveExecutable: async () => expectedExecutable,
      spawnProcess: () => {
        queueMicrotask(() => {
          failedChild.stderr.emit(
            'data',
            Buffer.from('Error 5: Access is denied.\n', 'utf8'),
          );
          failedChild.emit('close', 1, null);
        });
        return failedChild;
      },
      timeoutMs: 100,
    }),
    {
      name: 'TypeError',
      message: 'Reparse-point inspection failed.',
    },
  );

  const pathEchoChild = new EventEmitter();
  pathEchoChild.kill = () => true;
  pathEchoChild.stdout = new EventEmitter();
  pathEchoChild.stderr = new EventEmitter();
  await assert.rejects(
    queryWindowsReparsePoint('C:\\safe\\4390\\path', {
      resolveExecutable: async () => expectedExecutable,
      spawnProcess: () => {
        queueMicrotask(() => {
          pathEchoChild.stderr.emit(
            'data',
            Buffer.from(
              'Error 5: Access is denied: C:\\safe\\4390\\path\n',
              'utf8',
            ),
          );
          pathEchoChild.emit('close', 1, null);
        });
        return pathEchoChild;
      },
      timeoutMs: 100,
    }),
    {
      name: 'TypeError',
      message: 'Reparse-point inspection failed.',
    },
  );

  let untrustedSpawned = false;
  await assert.rejects(
    queryWindowsReparsePoint('D:\\safe\\path', {
      resolveExecutable: async () => 'D:\\repo\\fsutil.exe',
      spawnProcess: () => {
        untrustedSpawned = true;
        return new EventEmitter();
      },
      timeoutMs: 100,
    }),
    {
      name: 'TypeError',
      message: 'Reparse-point inspection failed.',
    },
  );
  assert.equal(untrustedSpawned, false);

  let killed = false;
  const hungChild = new EventEmitter();
  hungChild.kill = () => {
    killed = true;
    return true;
  };
  await assert.rejects(
    queryWindowsReparsePoint('C:\\safe\\path', {
      resolveExecutable: async () => expectedExecutable,
      spawnProcess: () => hungChild,
      timeoutMs: 1,
    }),
    {
      name: 'TypeError',
      message: 'Reparse-point inspection failed.',
    },
  );
  assert.equal(killed, true);
});

describe('recursive Gitignore semantics', () => {
  test('protects root and deep secret paths while preserving examples', async () => {
    await withTemporaryGitRepository(async (repositoryRoot) => {
      const gitignore = await readFile(
        new URL('../.gitignore', import.meta.url),
        'utf8',
      );
      await writeFile(path.join(repositoryRoot, '.gitignore'), gitignore, 'utf8');

      const positivePairs = [
        ['.env', 'a/b/c/.env'],
        ['.env.local', 'a/b/c/.env.local'],
        ['.dev.vars', 'a/b/c/.dev.vars'],
        ['.dev.vars.local', 'a/b/c/.dev.vars.local'],
        ['.envrc', 'a/b/c/.envrc'],
        ['.envrc.local', 'a/b/c/.envrc.local'],
        ['.direnv/probe', 'a/b/c/.direnv/probe'],
      ];
      for (const pair of positivePairs) {
        for (const repositoryPath of pair) {
          assert.equal(
            await gitReportsIgnored(repositoryRoot, repositoryPath),
            true,
            repositoryPath,
          );
        }
      }

      const exceptionPairs = [
        ['.env.example', 'a/b/c/.env.example'],
        ['.dev.vars.example', 'a/b/c/.dev.vars.example'],
        ['.envrc.example', 'a/b/c/.envrc.example'],
      ];
      for (const pair of exceptionPairs) {
        for (const repositoryPath of pair) {
          assert.equal(
            await gitReportsIgnored(repositoryRoot, repositoryPath),
            false,
            repositoryPath,
          );
        }
      }
    });
  });
});

describe('NUL-delimited Git index parsing', () => {
  test('retains safe mode, object id, stage, and path records', () => {
    const input = Buffer.from(
      [
        '100644 1111111111111111111111111111111111111111 0\tdocs/guide.md\0',
        '100755 2222222222222222222222222222222222222222 0\tscripts/check.mjs\0',
      ].join(''),
      'utf8',
    );

    assert.deepEqual(
      [...parseNullSeparatedIndexEntries(input)],
      [
        [
          'docs/guide.md',
          {
            mode: '100644',
            oid: '1111111111111111111111111111111111111111',
            stage: 0,
          },
        ],
        [
          'scripts/check.mjs',
          {
            mode: '100755',
            oid: '2222222222222222222222222222222222222222',
            stage: 0,
          },
        ],
      ],
    );
  });

  test('rejects malformed, duplicate, nonzero-stage, and unsafe records', () => {
    const invalidInputs = [
      Buffer.from('100644 bad 0\tdocs/guide.md\0', 'utf8'),
      Buffer.from(
        '100644 1111111111111111111111111111111111111111 1\tdocs/guide.md\0',
        'utf8',
      ),
      Buffer.from(
        [
          '100644 1111111111111111111111111111111111111111 0\tdocs/guide.md\0',
          '100644 2222222222222222222222222222222222222222 0\tdocs/guide.md\0',
        ].join(''),
        'utf8',
      ),
      Buffer.from(
        '100644 1111111111111111111111111111111111111111 0\tdocs/COM¹.md\0',
        'utf8',
      ),
      Buffer.from(
        '100644 1111111111111111111111111111111111111111 0\tdocs/guide.md',
        'utf8',
      ),
      Buffer.from([0xff, 0x00]),
    ];

    for (const input of invalidInputs) {
      assert.throws(
        () => parseNullSeparatedIndexEntries(input),
        { name: 'TypeError', message: 'Invalid Git index output.' },
      );
    }
  });
});

describe('non-reflective repository findings', () => {
  test('hashes variable repository paths into a stable identifier', () => {
    assert.equal(
      repositoryPathId('docs/guide.md'),
      '@sha256:07fdd026b11c494c3b62c97f764f6939803c453389ebefd6b05e6f187d44859a',
    );
  });

  test('formats only fixed codes and safe path identifiers', () => {
    const hostilePath = 'docs/callback?code=do-not-reflect.md';
    const output = formatRepositoryAuthorityFindings([
      {
        check: 'markdown',
        code: 'MARKDOWN_UNTRACKED',
        path: repositoryPathId(hostilePath),
      },
      {
        check: 'policy',
        code: 'POLICY_INVALID',
        path: 'config/repository-authority.json',
      },
    ]);

    assert.equal(
      output,
      [
        'MARKDOWN_UNTRACKED @sha256:a8b4ea4361b34bdfc3626231580c48b1651b842cfd209cef6a86fcae5684d008',
        'POLICY_INVALID config/repository-authority.json',
      ].join('\n'),
    );
    assert.equal(output.includes(hostilePath), false);
    assert.equal(output.includes('do-not-reflect'), false);
  });
});

describe('repository authority evaluator', () => {
  test('accepts a complete safe policy and repository snapshot', () => {
    const policy = makePolicy();
    assert.deepEqual(validateRepositoryAuthorityPolicy(policy), []);
    assert.deepEqual(evaluateRepositoryAuthority(policy, makeSnapshot()), []);
  });

  test('reports a missing required document by non-reversible path id', () => {
    const snapshot = makeSnapshot();
    snapshot.existingPaths.delete('docs/guide.md');
    snapshot.trackedEntries.delete('docs/guide.md');
    snapshot.markdownPaths.delete('docs/guide.md');

    assert.deepEqual(evaluateRepositoryAuthority(makePolicy(), snapshot), [
      {
        check: 'required-document',
        code: 'REQUIRED_DOCUMENT_MISSING',
        path: repositoryPathId('docs/guide.md'),
      },
    ]);
  });

  test('distinguishes untracked and ignored required documents', () => {
    const untracked = makeSnapshot();
    untracked.trackedEntries.delete('docs/guide.md');
    assert.deepEqual(
      findingCodes(evaluateRepositoryAuthority(makePolicy(), untracked)),
      ['MARKDOWN_UNTRACKED', 'REQUIRED_DOCUMENT_UNTRACKED'],
    );

    const ignored = makeSnapshot({
      trackedIgnoredPaths: new Set(['docs/guide.md']),
    });
    assert.deepEqual(findingCodes(evaluateRepositoryAuthority(makePolicy(), ignored)), [
      'AUTHORITY_IS_IGNORED',
      'TRACKED_PATH_IGNORED',
    ]);
  });

  test('requires every discovered Markdown file to be tracked and classified', () => {
    const snapshot = makeSnapshot();
    snapshot.existingPaths.add('docs/unclassified.md');
    snapshot.markdownPaths.add('docs/unclassified.md');

    assert.deepEqual(findingCodes(evaluateRepositoryAuthority(makePolicy(), snapshot)), [
      'MARKDOWN_UNCLASSIFIED',
      'MARKDOWN_UNTRACKED',
    ]);

    snapshot.trackedEntries.set('docs/unclassified.md', trackedEntry());
    assert.deepEqual(findingCodes(evaluateRepositoryAuthority(makePolicy(), snapshot)), [
      'MARKDOWN_UNCLASSIFIED',
    ]);

    snapshot.trackedEntries.set(
      'docs/unclassified.md',
      trackedEntry('120000'),
    );
    assert.deepEqual(
      findingCodes(evaluateRepositoryAuthority(makePolicy(), snapshot)),
      ['MARKDOWN_UNCLASSIFIED', 'TRACKED_PATH_UNSAFE_MODE'],
    );
  });

  test('classifies index-only Markdown and rejects every discovered reparse path', () => {
    const snapshot = makeSnapshot();
    snapshot.trackedEntries.set('docs/index-only.md', trackedEntry());
    snapshot.trackedEntries.set(
      'docs/index-only-link',
      trackedEntry('120000'),
    );
    snapshot.symlinkPaths.add('docs/undeclared-junction');

    assert.deepEqual(
      findingCodes(evaluateRepositoryAuthority(makePolicy(), snapshot)),
      [
        'TRACKED_PATH_UNSAFE_MODE',
        'AUTHORITY_SYMLINK',
        'MARKDOWN_UNCLASSIFIED',
      ],
    );
  });

  test('treats Markdown-root membership case-insensitively for portability', () => {
    const snapshot = makeSnapshot();
    snapshot.trackedEntries.set('Docs/index-only.md', trackedEntry());
    assert.equal(
      findingCodes(
        evaluateRepositoryAuthority(makePolicy(), snapshot),
      ).includes('MARKDOWN_UNCLASSIFIED'),
      true,
    );
  });

  test('does not amplify a repository inspection failure', () => {
    const snapshot = makeSnapshot({
      existingPaths: new Set(),
      trackedEntries: new Map(),
      markdownPaths: new Set(),
      inspectionFindings: [
        {
          check: 'repository',
          code: 'REPOSITORY_INSPECTION_FAILED',
          path: '.',
        },
      ],
    });

    assert.deepEqual(evaluateRepositoryAuthority(makePolicy(), snapshot), [
      {
        check: 'repository',
        code: 'REPOSITORY_INSPECTION_FAILED',
        path: '.',
      },
    ]);
  });

  test('requires complete correspondence between Gitignore rules and policy', () => {
    const undocumented = makeSnapshot({
      gitignoreRules: ['/dist/', '/unexpected/', '!/**/.env.example'],
    });
    assert.deepEqual(
      findingCodes(evaluateRepositoryAuthority(makePolicy(), undocumented)),
      ['IGNORE_RULE_UNDOCUMENTED'],
    );

    const missing = makeSnapshot({ gitignoreRules: ['!/**/.env.example'] });
    assert.deepEqual(findingCodes(evaluateRepositoryAuthority(makePolicy(), missing)), [
      'IGNORE_RULE_MISSING',
    ]);
  });

  test('verifies positive ignored probes and representative exception probes', () => {
    const exposed = makeSnapshot({ ignoredProbePaths: new Set() });
    assert.deepEqual(findingCodes(evaluateRepositoryAuthority(makePolicy(), exposed)), [
      'IGNORED_ARTIFACT_EXPOSED',
    ]);

    const hiddenException = makeSnapshot({
      ignoredProbePaths: new Set([
        'dist/.repository-authority-probe',
        'apps/example/.env.example',
      ]),
    });
    assert.deepEqual(
      findingCodes(evaluateRepositoryAuthority(makePolicy(), hiddenException)),
      ['TRACKED_EXCEPTION_IGNORED'],
    );

    assert.deepEqual(
      findingCodes(evaluateRepositoryAuthority(makePolicy(), makeSnapshot())),
      [],
    );
  });

  test('rejects unsafe Git modes for every authority input', () => {
    const snapshot = makeSnapshot();
    snapshot.trackedEntries.set('docs/guide.md', trackedEntry('120000'));
    snapshot.trackedEntries.set('package.json', trackedEntry('160000'));

    assert.deepEqual(findingCodes(evaluateRepositoryAuthority(makePolicy(), snapshot)), [
      'TRACKED_PATH_UNSAFE_MODE',
      'TRACKED_PATH_UNSAFE_MODE',
    ]);
  });

  test('requires repository control files to be tracked and non-ignored', () => {
    for (const repositoryPath of [
      '.gitattributes',
      '.gitignore',
      'config/repository-authority.json',
    ]) {
      const missing = makeSnapshot();
      missing.existingPaths.delete(repositoryPath);
      missing.trackedEntries.delete(repositoryPath);
      assert.deepEqual(
        findingCodes(evaluateRepositoryAuthority(makePolicy(), missing)),
        ['AUTHORITY_INPUT_MISSING'],
      );

      const untracked = makeSnapshot();
      untracked.trackedEntries.delete(repositoryPath);
      assert.deepEqual(
        findingCodes(evaluateRepositoryAuthority(makePolicy(), untracked)),
        ['AUTHORITY_INPUT_UNTRACKED'],
      );

      const ignored = makeSnapshot({
        trackedIgnoredPaths: new Set([repositoryPath]),
      });
      assert.deepEqual(
        findingCodes(evaluateRepositoryAuthority(makePolicy(), ignored)),
        ['AUTHORITY_INPUT_IGNORED', 'TRACKED_PATH_IGNORED'],
      );
    }
  });

  test('rejects symlinks for roots, probes, and static local paths', () => {
    const snapshot = makeSnapshot({
      symlinkPaths: new Set([
        'docs',
        'dist/.repository-authority-probe',
        'local-state',
      ]),
    });
    assert.deepEqual(
      findingCodes(evaluateRepositoryAuthority(makePolicy(), snapshot)),
      ['AUTHORITY_SYMLINK', 'AUTHORITY_SYMLINK', 'AUTHORITY_SYMLINK'],
    );
  });

  test('verifies tracked generated source state and its source inputs', () => {
    const missing = makeSnapshot();
    missing.existingPaths.delete('generated.d.ts');
    missing.trackedEntries.delete('generated.d.ts');
    assert.deepEqual(findingCodes(evaluateRepositoryAuthority(makePolicy(), missing)), [
      'TRACKED_GENERATED_MISSING',
    ]);

    const untracked = makeSnapshot();
    untracked.trackedEntries.delete('generated.d.ts');
    assert.deepEqual(findingCodes(evaluateRepositoryAuthority(makePolicy(), untracked)), [
      'TRACKED_GENERATED_UNTRACKED',
    ]);

    const ignored = makeSnapshot({
      trackedIgnoredPaths: new Set(['generated.d.ts']),
    });
    assert.deepEqual(findingCodes(evaluateRepositoryAuthority(makePolicy(), ignored)), [
      'TRACKED_GENERATED_IGNORED',
      'TRACKED_PATH_IGNORED',
    ]);

    const sourceMissing = makeSnapshot();
    sourceMissing.existingPaths.delete('package.json');
    sourceMissing.trackedEntries.delete('package.json');
    assert.deepEqual(
      findingCodes(evaluateRepositoryAuthority(makePolicy(), sourceMissing)),
      ['TRACKED_SOURCE_INPUT_MISSING'],
    );
  });

  test('rejects authority symlinks and preserves deterministic findings', () => {
    const snapshot = makeSnapshot({
      symlinkPaths: new Set(['docs/guide.md']),
      trackedIgnoredPaths: new Set(['docs/guide.md']),
    });
    const first = evaluateRepositoryAuthority(makePolicy(), snapshot);
    const second = evaluateRepositoryAuthority(makePolicy(), snapshot);

    assert.deepEqual(first, second);
    assert.deepEqual(findingCodes(first), [
      'AUTHORITY_IS_IGNORED',
      'AUTHORITY_SYMLINK',
      'TRACKED_PATH_IGNORED',
    ]);
  });
});

describe('repository authority policy validation', () => {
  test('rejects malformed schema, unsafe metadata, duplicates, and collisions', () => {
    const invalidPolicies = [];

    invalidPolicies.push(makePolicy({ schemaVersion: 2 }));
    invalidPolicies.push({ ...makePolicy(), unexpected: true });
    invalidPolicies.push(makePolicy({ markdownRoots: ['docs', 'docs'] }));
    invalidPolicies.push(makePolicy({ markdownRoots: ['other-docs'] }));

    const duplicateDocument = structuredClone(makePolicy());
    duplicateDocument.documentGroups[2].paths.push('docs/guide.md');
    invalidPolicies.push(duplicateDocument);

    const caseCollision = structuredClone(makePolicy());
    caseCollision.documentGroups[2].paths.push('docs/GUIDE.md');
    invalidPolicies.push(caseCollision);

    const invalidClassification = structuredClone(makePolicy());
    invalidClassification.documentGroups[0].classification = 'current';
    invalidPolicies.push(invalidClassification);

    const nonMarkdownDocument = structuredClone(makePolicy());
    nonMarkdownDocument.documentGroups[1].paths = ['docs/guide.txt'];
    invalidPolicies.push(nonMarkdownDocument);

    const invalidRule = structuredClone(makePolicy());
    invalidRule.ignoredArtifacts[0].ignorePattern = 'dist/';
    invalidPolicies.push(invalidRule);

    const blankOwner = structuredClone(makePolicy());
    blankOwner.ignoredArtifacts[0].owner = ' ';
    invalidPolicies.push(blankOwner);

    const missingGeneratedInput = structuredClone(makePolicy());
    missingGeneratedInput.ignoredArtifacts[0].sourceInputs = [];
    invalidPolicies.push(missingGeneratedInput);

    const invalidException = structuredClone(makePolicy());
    invalidException.trackedIgnoreExceptions[0].extra = true;
    invalidPolicies.push(invalidException);

    const positiveException = structuredClone(makePolicy());
    positiveException.trackedIgnoreExceptions[0].ignorePattern =
      '/**/.env.example';
    invalidPolicies.push(positiveException);

    const invalidGeneratedSource = structuredClone(makePolicy());
    invalidGeneratedSource.trackedGeneratedSources[0].verificationCommand = '';
    invalidPolicies.push(invalidGeneratedSource);

    const duplicateSourceInput = structuredClone(makePolicy());
    duplicateSourceInput.trackedGeneratedSources[0].sourceInputs.push(
      'package.json',
    );
    invalidPolicies.push(duplicateSourceInput);

    const invalidPreservation = structuredClone(makePolicy());
    invalidPreservation.preservation.rawByteAttributesFile = 'attributes';
    invalidPolicies.push(invalidPreservation);

    const recoveredOutsideDocuments = structuredClone(makePolicy());
    recoveredOutsideDocuments.preservation.recoveredDocuments = [
      'evidence/recovered.bin',
    ];
    invalidPolicies.push(recoveredOutsideDocuments);

    const preservationOverlap = structuredClone(makePolicy());
    preservationOverlap.preservation.staticLocalPaths = ['docs/history.md'];
    invalidPolicies.push(preservationOverlap);

    const missingRootReadme = structuredClone(makePolicy());
    missingRootReadme.documentGroups[0].paths = ['AGENTS.md'];
    invalidPolicies.push(missingRootReadme);

    const extraRootDocument = structuredClone(makePolicy());
    extraRootDocument.documentGroups[0].paths.push('SECURITY.md');
    invalidPolicies.push(extraRootDocument);

    for (const policy of invalidPolicies) {
      assert.deepEqual(findingCodes(validateRepositoryAuthorityPolicy(policy)), [
        'POLICY_METADATA_INVALID',
      ]);
    }
  });

  test('permits empty source inputs only for local ownership classes', () => {
    for (const classification of [
      'local-secret',
      'local-evidence',
      'local-tool-state',
      'local-archive',
    ]) {
      const policy = structuredClone(makePolicy());
      policy.ignoredArtifacts[0] = {
        ...policy.ignoredArtifacts[0],
        classification,
        sourceInputs: [],
      };
      assert.deepEqual(validateRepositoryAuthorityPolicy(policy), []);
    }

    const dependencyCache = structuredClone(makePolicy());
    dependencyCache.ignoredArtifacts[0].classification = 'dependency-cache';
    dependencyCache.ignoredArtifacts[0].sourceInputs = [];
    assert.deepEqual(
      findingCodes(validateRepositoryAuthorityPolicy(dependencyCache)),
      ['POLICY_METADATA_INVALID'],
    );
  });
});

describe('repository snapshot collection', () => {
  test('collects a real NUL-delimited Git repository without reading ignored output', async () => {
    await withTemporaryGitRepository(async (repositoryRoot) => {
      const policy = makePolicy();
      await writeValidRepository(repositoryRoot, policy);

      const loaded = await loadRepositoryAuthorityPolicy(repositoryRoot);
      assert.deepEqual(loaded, policy);

      const snapshot = await collectRepositorySnapshot(repositoryRoot, loaded);
      assert.deepEqual(snapshot.inspectionFindings, []);
      assert.deepEqual(
        [...snapshot.markdownPaths].sort(),
        ['docs/guide.md', 'docs/history.md'],
      );
      assert.equal(
        snapshot.trackedEntries.get('docs/guide.md')?.mode,
        '100644',
      );
      assert.equal(
        snapshot.ignoredProbePaths.has(
          'dist/.repository-authority-probe',
        ),
        true,
      );
      assert.deepEqual(evaluateRepositoryAuthority(loaded, snapshot), []);
    });
  });

  test('does not execute a repository-local git.exe', async (t) => {
    if (process.platform !== 'win32') {
      t.skip('Windows executable search order is host-specific.');
      return;
    }
    await withTemporaryGitRepository(async (repositoryRoot) => {
      const policy = makePolicy();
      await writeValidRepository(repositoryRoot, policy);
      const systemRoot = process.env.SystemRoot;
      assert.equal(typeof systemRoot, 'string');
      await copyFile(
        path.join(systemRoot, 'System32', 'where.exe'),
        path.join(repositoryRoot, 'git.exe'),
      );

      const snapshot = await collectRepositorySnapshot(repositoryRoot, policy);
      assert.deepEqual(snapshot.inspectionFindings, []);
      assert.deepEqual(evaluateRepositoryAuthority(policy, snapshot), []);
    });
  });

  test('fails closed for unsafe index paths and unsafe Git modes', async () => {
    await withTemporaryGitRepository(async (repositoryRoot) => {
      const policy = makePolicy();
      await writeValidRepository(repositoryRoot, policy);
      await execFileAsync('git', ['config', 'core.symlinks', 'false'], {
        cwd: repositoryRoot,
        windowsHide: true,
      });

      const { stdout } = await execFileAsync(
        'git',
        ['hash-object', '-w', '--', 'docs/guide.md'],
        {
          cwd: repositoryRoot,
          windowsHide: true,
        },
      );
      const objectId = stdout.trim();
      await execFileAsync(
        'git',
        [
          'update-index',
          '--add',
          '--cacheinfo',
          '120000',
          objectId,
          'docs/guide.md',
        ],
        { cwd: repositoryRoot, windowsHide: true },
      );

      const symlinkSnapshot = await collectRepositorySnapshot(
        repositoryRoot,
        policy,
      );
      assert.equal(
        findingCodes(
          evaluateRepositoryAuthority(policy, symlinkSnapshot),
        ).includes('TRACKED_PATH_UNSAFE_MODE'),
        true,
      );

      await execFileAsync(
        'git',
        [
          'update-index',
          '--add',
          '--cacheinfo',
          '100644',
          objectId,
          'docs/index-only.md',
        ],
        { cwd: repositoryRoot, windowsHide: true },
      );
      await execFileAsync(
        'git',
        [
          'update-index',
          '--add',
          '--cacheinfo',
          '120000',
          objectId,
          'docs/index-only-link',
        ],
        { cwd: repositoryRoot, windowsHide: true },
      );
      const indexOnlySnapshot = await collectRepositorySnapshot(
        repositoryRoot,
        policy,
      );
      const indexOnlyCodes = findingCodes(
        evaluateRepositoryAuthority(policy, indexOnlySnapshot),
      );
      assert.equal(indexOnlyCodes.includes('MARKDOWN_UNCLASSIFIED'), true);
      assert.equal(indexOnlyCodes.includes('TRACKED_PATH_UNSAFE_MODE'), true);

      await execFileAsync(
        'git',
        [
          'update-index',
          '--add',
          '--cacheinfo',
          '100644',
          objectId,
          'docs/COM¹.md',
        ],
        { cwd: repositoryRoot, windowsHide: true },
      );
      const unsafePathSnapshot = await collectRepositorySnapshot(
        repositoryRoot,
        policy,
      );
      assert.deepEqual(findingCodes(unsafePathSnapshot.inspectionFindings), [
        'REPOSITORY_INSPECTION_FAILED',
      ]);
      assert.equal(
        formatRepositoryAuthorityFindings(
          unsafePathSnapshot.inspectionFindings,
        ),
        'REPOSITORY_INSPECTION_FAILED .',
      );
    });
  });

  test('fails closed when Markdown traversal exceeds a fixed budget', async () => {
    await withTemporaryGitRepository(async (repositoryRoot) => {
      const policy = makePolicy();
      await writeValidRepository(repositoryRoot, policy);
      const boundary = await collectRepositorySnapshot(
        repositoryRoot,
        policy,
        {
          traversalLimits: {
            maxEntries: 2,
          },
        },
      );
      assert.deepEqual(boundary.inspectionFindings, []);

      const snapshot = await collectRepositorySnapshot(repositoryRoot, policy, {
        traversalLimits: {
          maxEntries: 1,
        },
      });
      assert.deepEqual(findingCodes(snapshot.inspectionFindings), [
        'REPOSITORY_INSPECTION_FAILED',
      ]);
    });
  });

  test('rejects inconsistent Markdown directory enumerations', async () => {
    await withTemporaryGitRepository(async (repositoryRoot) => {
      const policy = makePolicy();
      await writeValidRepository(repositoryRoot, policy);
      const docsPath = path.join(repositoryRoot, 'docs');
      let docsReads = 0;
      const snapshot = await collectRepositorySnapshot(repositoryRoot, policy, {
        readdir: async (absolutePath) => {
          if (absolutePath === docsPath) {
            docsReads += 1;
            if (docsReads === 1) {
              return [];
            }
          }
          return readDirectory(absolutePath, { withFileTypes: true });
        },
      });
      assert.equal(docsReads >= 2, true);
      assert.deepEqual(findingCodes(snapshot.inspectionFindings), [
        'REPOSITORY_INSPECTION_FAILED',
      ]);
    });
  });

  test('rejects Gitignore changes during probe evaluation', async () => {
    await withTemporaryGitRepository(async (repositoryRoot) => {
      const policy = makePolicy();
      await writeValidRepository(repositoryRoot, policy);
      let changed = false;
      const snapshot = await collectRepositorySnapshot(repositoryRoot, policy, {
        runGit: async (root, args, stdin) => {
          if (args.includes('check-ignore') && !changed) {
            changed = true;
            await writeFile(
              path.join(repositoryRoot, '.gitignore'),
              '/dist/\n!/**/.env.example\n/secret/\n',
              'utf8',
            );
          }
          return runGitBufferForTest(root, args, stdin);
        },
      });

      assert.equal(changed, true);
      assert.deepEqual(findingCodes(snapshot.inspectionFindings), [
        'REPOSITORY_INSPECTION_FAILED',
      ]);
    });
  });

  test('rejects policy file changes during snapshot collection', async () => {
    await withTemporaryGitRepository(async (repositoryRoot) => {
      const policy = makePolicy();
      await writeValidRepository(repositoryRoot, policy);
      let changed = false;
      const snapshot = await collectRepositorySnapshot(repositoryRoot, policy, {
        runGit: async (root, args, stdin) => {
          if (args.includes('check-ignore') && !changed) {
            changed = true;
            await writeFile(
              path.join(
                repositoryRoot,
                'config',
                'repository-authority.json',
              ),
              `${JSON.stringify(policy, null, 2)}\n\n`,
              'utf8',
            );
          }
          return runGitBufferForTest(root, args, stdin);
        },
      });

      assert.equal(changed, true);
      assert.deepEqual(findingCodes(snapshot.inspectionFindings), [
        'REPOSITORY_INSPECTION_FAILED',
      ]);
    });
  });

  test('rejects Git index changes during snapshot collection', async () => {
    await withTemporaryGitRepository(async (repositoryRoot) => {
      const policy = makePolicy();
      await writeValidRepository(repositoryRoot, policy);
      const { stdout } = await execFileAsync(
        'git',
        ['rev-parse', ':docs/guide.md'],
        { cwd: repositoryRoot, windowsHide: true },
      );
      let changed = false;
      const snapshot = await collectRepositorySnapshot(repositoryRoot, policy, {
        runGit: async (root, args, stdin) => {
          if (args.includes('check-ignore') && !changed) {
            changed = true;
            await execFileAsync(
              'git',
              [
                'update-index',
                '--add',
                '--cacheinfo',
                '100644',
                stdout.trim(),
                'docs/rogue.md',
              ],
              { cwd: repositoryRoot, windowsHide: true },
            );
          }
          return runGitBufferForTest(root, args, stdin);
        },
      });

      assert.equal(changed, true);
      assert.deepEqual(findingCodes(snapshot.inspectionFindings), [
        'REPOSITORY_INSPECTION_FAILED',
      ]);
    });
  });

  test('revalidates declared worktree paths at the end', async () => {
    await withTemporaryGitRepository(async (repositoryRoot) => {
      const policy = makePolicy();
      await writeValidRepository(repositoryRoot, policy);
      const packagePath = path.join(repositoryRoot, 'package.json');
      let changed = false;
      const snapshot = await collectRepositorySnapshot(repositoryRoot, policy, {
        runGit: async (root, args, stdin) => {
          if (args.includes('check-ignore') && !changed) {
            changed = true;
            await rm(packagePath);
            await mkdir(packagePath);
          }
          return runGitBufferForTest(root, args, stdin);
        },
      });

      assert.equal(changed, true);
      assert.deepEqual(findingCodes(snapshot.inspectionFindings), [
        'REPOSITORY_INSPECTION_FAILED',
      ]);
    });
  });

  test('revalidates repository root identity at the end', async () => {
    await withTemporaryGitRepository(async (repositoryRoot) => {
      const policy = makePolicy();
      await writeValidRepository(repositoryRoot, policy);
      let rootReads = 0;
      const snapshot = await collectRepositorySnapshot(repositoryRoot, policy, {
        isReparsePoint: async () => false,
        lstat: async (absolutePath) => {
          const stats = await lstat(absolutePath);
          if (!pathsEqualForHost(absolutePath, repositoryRoot)) {
            return stats;
          }
          rootReads += 1;
          if (rootReads === 1) {
            return stats;
          }
          return {
            dev: stats.dev,
            ino: stats.ino + 1,
            mode: stats.mode ^ 1,
            size: stats.size + 1,
            mtimeMs: stats.mtimeMs,
            ctimeMs: stats.ctimeMs + 1,
            isDirectory: () => true,
            isFile: () => false,
            isSymbolicLink: () => false,
          };
        },
      });

      assert.equal(rootReads >= 2, true);
      assert.deepEqual(findingCodes(snapshot.inspectionFindings), [
        'REPOSITORY_INSPECTION_FAILED',
      ]);
    });
  });

  test('rejects Markdown added after a child is inspected', async () => {
    await withTemporaryGitRepository(async (repositoryRoot) => {
      const policy = makePolicy();
      await writeValidRepository(repositoryRoot, policy);
      const childPath = path.join(repositoryRoot, 'docs', 'guide.md');
      const injectedPath = path.join(
        repositoryRoot,
        'docs',
        'access-token-hidden.md',
      );
      let injected = false;
      let docsEnumerated = false;
      const snapshot = await collectRepositorySnapshot(repositoryRoot, policy, {
        readdir: async (absolutePath) => {
          const entries = await readDirectory(absolutePath, {
            withFileTypes: true,
          });
          if (absolutePath === path.join(repositoryRoot, 'docs')) {
            docsEnumerated = true;
          }
          return entries;
        },
        lstat: async (absolutePath) => {
          const stats = await lstat(absolutePath);
          if (
            absolutePath === childPath &&
            docsEnumerated &&
            !injected
          ) {
            injected = true;
            await writeFile(injectedPath, '# Injected\n', 'utf8');
          }
          return stats;
        },
      });

      assert.equal(injected, true);
      assert.deepEqual(findingCodes(snapshot.inspectionFindings), [
        'REPOSITORY_INSPECTION_FAILED',
      ]);
    });
  });

  test('revalidates child directories after later siblings', async () => {
    await withTemporaryGitRepository(async (repositoryRoot) => {
      const policy = makePolicy();
      policy.documentGroups[1].paths.push(
        'docs/sub/a.md',
        'docs/z.md',
      );
      await writeValidRepository(repositoryRoot, policy);
      await mkdir(path.join(repositoryRoot, 'docs', 'sub'));
      await writeFile(
        path.join(repositoryRoot, 'docs', 'sub', 'a.md'),
        '# A\n',
        'utf8',
      );
      await writeFile(
        path.join(repositoryRoot, 'docs', 'z.md'),
        '# Z\n',
        'utf8',
      );
      await execFileAsync(
        'git',
        ['add', '--', 'docs/sub/a.md', 'docs/z.md'],
        { cwd: repositoryRoot, windowsHide: true },
      );
      const subPath = path.join(repositoryRoot, 'docs', 'sub');
      const siblingPath = path.join(repositoryRoot, 'docs', 'z.md');
      let subReads = 0;
      let subFinalized = false;
      let injected = false;
      const snapshot = await collectRepositorySnapshot(repositoryRoot, policy, {
        readdir: async (absolutePath) => {
          const entries = await readDirectory(absolutePath, {
            withFileTypes: true,
          });
          if (absolutePath === subPath) {
            subReads += 1;
            if (subReads === 2) {
              subFinalized = true;
            }
          }
          return entries;
        },
        lstat: async (absolutePath) => {
          const stats = await lstat(absolutePath);
          if (
            absolutePath === siblingPath &&
            subFinalized &&
            !injected
          ) {
            injected = true;
            await writeFile(
              path.join(subPath, 'late.md'),
              '# Late\n',
              'utf8',
            );
          }
          return stats;
        },
      });

      assert.equal(injected, true);
      assert.deepEqual(findingCodes(snapshot.inspectionFindings), [
        'REPOSITORY_INSPECTION_FAILED',
      ]);
    });
  });

  test('rejects both superscript device names inserted directly in the index', async () => {
    await withTemporaryGitRepository(async (repositoryRoot) => {
      const policy = makePolicy();
      await writeValidRepository(repositoryRoot, policy);
      const { stdout } = await execFileAsync(
        'git',
        ['hash-object', '-w', '--', 'docs/guide.md'],
        { cwd: repositoryRoot, windowsHide: true },
      );
      const objectId = stdout.trim();

      for (const unsafePath of ['docs/COM¹.md', 'docs/lpt³.txt']) {
        await execFileAsync(
          'git',
          [
            'update-index',
            '--add',
            '--cacheinfo',
            '100644',
            objectId,
            unsafePath,
          ],
          { cwd: repositoryRoot, windowsHide: true },
        );
        const snapshot = await collectRepositorySnapshot(repositoryRoot, policy);
        assert.deepEqual(findingCodes(snapshot.inspectionFindings), [
          'REPOSITORY_INSPECTION_FAILED',
        ]);
        assert.equal(
          formatRepositoryAuthorityFindings(snapshot.inspectionFindings),
          'REPOSITORY_INSPECTION_FAILED .',
        );
        await execFileAsync(
          'git',
          ['update-index', '--force-remove', '--', unsafePath],
          { cwd: repositoryRoot, windowsHide: true },
        );
      }
    });
  });

  test('reports an index-only case-fold collision without path disclosure', async () => {
    await withTemporaryGitRepository(async (repositoryRoot) => {
      const policy = makePolicy();
      await writeValidRepository(repositoryRoot, policy);
      const { stdout } = await execFileAsync(
        'git',
        ['hash-object', '-w', '--', 'docs/guide.md'],
        { cwd: repositoryRoot, windowsHide: true },
      );
      await execFileAsync(
        'git',
        [
          'update-index',
          '--add',
          '--cacheinfo',
          '100644',
          stdout.trim(),
          'docs/GUIDE.md',
        ],
        { cwd: repositoryRoot, windowsHide: true },
      );

      const snapshot = await collectRepositorySnapshot(repositoryRoot, policy);
      assert.equal(
        findingCodes(snapshot.inspectionFindings).includes(
          'REPOSITORY_PATH_COLLISION',
        ),
        true,
      );
      assert.equal(
        formatRepositoryAuthorityFindings(
          snapshot.inspectionFindings,
        ).includes('GUIDE'),
        false,
      );
    });
  });

  test('collapses injected Git and filesystem failures to fixed findings', async () => {
    await withTemporaryGitRepository(async (repositoryRoot) => {
      const policy = makePolicy();
      await writeValidRepository(repositoryRoot, policy);
      const hostile = 'access-token-and-callback-url-do-not-reflect';
      const failureDependencies = [
        {
          runGit: async () => ({
            exitCode: 2,
            stdout: Buffer.from(hostile, 'utf8'),
            stderr: Buffer.from(hostile, 'utf8'),
          }),
        },
        {
          runGit: async () => ({
            exitCode: 0,
            stdout: Buffer.alloc(16 * 1024 * 1024 + 1),
            stderr: Buffer.alloc(0),
          }),
        },
        {
          lstat: async () => {
            throw new Error(hostile);
          },
        },
        {
          realpath: async () => {
            throw new Error(hostile);
          },
        },
        {
          readGitignore: async () => {
            throw new Error(hostile);
          },
        },
        {
          readdir: async () => {
            throw new Error(hostile);
          },
        },
      ];

      for (const dependencies of failureDependencies) {
        const snapshot = await collectRepositorySnapshot(
          repositoryRoot,
          policy,
          dependencies,
        );
        const output = formatRepositoryAuthorityFindings(
          snapshot.inspectionFindings,
        );
        assert.match(
          output,
          /^(?:REPOSITORY_INSPECTION_FAILED|AUTHORITY_OUTSIDE_REPOSITORY)(?: \.| @sha256:[0-9a-f]{64})$/u,
        );
        assert.equal(output.includes(hostile), false);
      }

      await assert.rejects(
        loadRepositoryAuthorityPolicy(repositoryRoot, {
          readPolicy: async () => {
            throw new Error(hostile);
          },
        }),
        {
          name: 'TypeError',
          message: 'Repository authority policy could not be read.',
        },
      );
      for (const input of [
        Buffer.from([0xff]),
        Buffer.from(`{"value":"${hostile}"`, 'utf8'),
      ]) {
        await assert.rejects(
          loadRepositoryAuthorityPolicy(repositoryRoot, {
            readPolicy: async () => input,
          }),
          {
            name: 'TypeError',
            message: 'Repository authority policy could not be read.',
          },
        );
      }
    });
  });

  test('collapses an abnormal check-ignore exit without stderr reflection', async () => {
    await withTemporaryGitRepository(async (repositoryRoot) => {
      const policy = makePolicy();
      await writeValidRepository(repositoryRoot, policy);
      const hostile = 'refresh-token-do-not-reflect';
      const snapshot = await collectRepositorySnapshot(repositoryRoot, policy, {
        runGit: async (root, args, stdin) => {
          if (args.includes('check-ignore')) {
            return {
              exitCode: 2,
              stdout: Buffer.from(hostile, 'utf8'),
              stderr: Buffer.from(hostile, 'utf8'),
            };
          }
          return runGitBufferForTest(root, args, stdin);
        },
      });

      assert.deepEqual(evaluateRepositoryAuthority(policy, snapshot), [
        {
          check: 'repository',
          code: 'REPOSITORY_INSPECTION_FAILED',
          path: '.',
        },
      ]);
      assert.equal(
        formatRepositoryAuthorityFindings(snapshot.inspectionFindings),
        'REPOSITORY_INSPECTION_FAILED .',
      );
    });
  });

  test('rejects check-ignore output overflow even for exit 1', async () => {
    await withTemporaryGitRepository(async (repositoryRoot) => {
      const policy = makePolicy();
      await writeValidRepository(repositoryRoot, policy);
      const snapshot = await collectRepositorySnapshot(repositoryRoot, policy, {
        runGit: async (root, args, stdin) => {
          if (args.includes('check-ignore')) {
            return {
              exitCode: 1,
              stdout: Buffer.alloc(16 * 1024 * 1024 + 1),
              stderr: Buffer.alloc(0),
            };
          }
          return runGitBufferForTest(root, args, stdin);
        },
      });

      assert.deepEqual(evaluateRepositoryAuthority(policy, snapshot), [
        {
          check: 'repository',
          code: 'REPOSITORY_INSPECTION_FAILED',
          path: '.',
        },
      ]);
    });
  });

  test('does not traverse a path whose real path escapes the repository', async () => {
    await withTemporaryGitRepository(async (repositoryRoot) => {
      const policy = makePolicy();
      await writeValidRepository(repositoryRoot, policy);
      const docsPath = path.join(repositoryRoot, 'docs');
      let readdirCalls = 0;
      const snapshot = await collectRepositorySnapshot(repositoryRoot, policy, {
        realpath: async (absolutePath) =>
          absolutePath === docsPath
            ? path.dirname(repositoryRoot)
            : realpath(absolutePath),
        readdir: async () => {
          readdirCalls += 1;
          throw new Error('escaped-path-must-not-be-read');
        },
      });

      assert.equal(readdirCalls, 0);
      assert.equal(snapshot.inspectionFindings.length > 0, true);
      assert.equal(
        findingCodes(snapshot.inspectionFindings).every(
          (code) => code === 'AUTHORITY_OUTSIDE_REPOSITORY',
        ),
        true,
      );
      assert.equal(
        formatRepositoryAuthorityFindings(snapshot.inspectionFindings)
          .split('\n')
          .every((line) =>
            /^AUTHORITY_OUTSIDE_REPOSITORY @sha256:[0-9a-f]{64}$/u.test(line),
          ),
        true,
      );
    });
  });

  test('rejects a repository root reached through a junction', async (t) => {
    await withTemporaryGitRepository(async (repositoryRoot) => {
      const policy = makePolicy();
      await writeValidRepository(repositoryRoot, policy);
      const junctionRoot = path.join(repositoryRoot, 'root-junction');
      try {
        await symlink(
          repositoryRoot,
          junctionRoot,
          process.platform === 'win32' ? 'junction' : 'dir',
        );
      } catch (error) {
        if (error?.code === 'EPERM' || error?.code === 'EACCES') {
          t.skip('This host cannot create the required root junction.');
          return;
        }
        throw error;
      }

      const snapshot = await collectRepositorySnapshot(junctionRoot, policy);
      assert.deepEqual(snapshot.inspectionFindings, [
        {
          check: 'repository',
          code: 'REPOSITORY_INSPECTION_FAILED',
          path: '.',
        },
      ]);
    });
  });

  test('rejects an undeclared junction without traversing its target', async (t) => {
    await withTemporaryGitRepository(async (repositoryRoot) => {
      const policy = makePolicy();
      await writeValidRepository(repositoryRoot, policy);
      const targetPath = path.join(repositoryRoot, 'junction-target');
      const junctionPath = path.join(
        repositoryRoot,
        'docs',
        'undeclared-junction',
      );
      await mkdir(targetPath);
      await writeFile(path.join(targetPath, 'hidden.md'), '# hidden\n', 'utf8');
      try {
        await symlink(
          targetPath,
          junctionPath,
          process.platform === 'win32' ? 'junction' : 'dir',
        );
      } catch (error) {
        if (error?.code === 'EPERM' || error?.code === 'EACCES') {
          t.skip('This host cannot create the required nested junction.');
          return;
        }
        throw error;
      }

      try {
        const snapshot = await collectRepositorySnapshot(repositoryRoot, policy);
        assert.equal(
          snapshot.symlinkPaths.has('docs/undeclared-junction'),
          true,
        );
        assert.equal(
          snapshot.markdownPaths.has(
            'docs/undeclared-junction/hidden.md',
          ),
          false,
        );
        const findings = evaluateRepositoryAuthority(policy, snapshot);
        assert.equal(
          findingCodes(findings).includes('AUTHORITY_SYMLINK'),
          true,
        );
        const formatted = formatRepositoryAuthorityFindings(findings);
        assert.equal(formatted.includes('undeclared-junction'), false);
        assert.equal(formatted.includes('junction-target'), false);
      } finally {
        await rm(junctionPath, { force: false });
      }
    });
  });

  test('rejects a tracked required document replaced by a directory', async () => {
    await withTemporaryGitRepository(async (repositoryRoot) => {
      const policy = makePolicy();
      await writeValidRepository(repositoryRoot, policy);
      const documentPath = path.join(repositoryRoot, 'docs', 'guide.md');
      await rm(documentPath);
      await mkdir(documentPath);

      const snapshot = await collectRepositorySnapshot(repositoryRoot, policy);
      assert.deepEqual(findingCodes(snapshot.inspectionFindings), [
        'AUTHORITY_UNSAFE_TYPE',
      ]);
      assert.match(
        formatRepositoryAuthorityFindings(snapshot.inspectionFindings),
        /^AUTHORITY_UNSAFE_TYPE @sha256:[0-9a-f]{64}$/u,
      );
      assert.deepEqual(
        evaluateRepositoryAuthority(policy, snapshot),
        snapshot.inspectionFindings,
      );
    });
  });

  test('does not traverse a Markdown root after detecting a reparse point', async () => {
    await withTemporaryGitRepository(async (repositoryRoot) => {
      const policy = makePolicy();
      await writeValidRepository(repositoryRoot, policy);
      const docsPath = path.join(repositoryRoot, 'docs');
      let readdirCalls = 0;
      const snapshot = await collectRepositorySnapshot(repositoryRoot, policy, {
        lstat: async (absolutePath) => {
          if (absolutePath === docsPath) {
            return {
              isDirectory: () => true,
              isFile: () => false,
              isSymbolicLink: () => true,
              reparseTag: 0xa0000003,
            };
          }
          return lstat(absolutePath);
        },
        readdir: async () => {
          readdirCalls += 1;
          throw new Error('reparse-target-must-not-be-read');
        },
      });

      assert.equal(readdirCalls, 0);
      assert.equal(snapshot.symlinkPaths.has('docs'), true);
      assert.equal(
        findingCodes(evaluateRepositoryAuthority(policy, snapshot)).includes(
          'AUTHORITY_SYMLINK',
        ),
        true,
      );
    });
  });

  test('does not read Gitignore after detecting its reparse point', async () => {
    await withTemporaryGitRepository(async (repositoryRoot) => {
      const policy = makePolicy();
      await writeValidRepository(repositoryRoot, policy);
      const gitignorePath = path.join(repositoryRoot, '.gitignore');
      let gitignoreRead = false;
      const gitCalls = [];
      const snapshot = await collectRepositorySnapshot(repositoryRoot, policy, {
        runGit: async (root, args, stdin) => {
          gitCalls.push(args);
          return runGitBufferForTest(root, args, stdin);
        },
        lstat: async (absolutePath) => {
          if (absolutePath === gitignorePath) {
            return {
              isDirectory: () => false,
              isFile: () => true,
              isSymbolicLink: () => true,
              reparseTag: 0xa000000c,
            };
          }
          return lstat(absolutePath);
        },
        readGitignore: async (absolutePath) => {
          gitignoreRead = true;
          return readFile(absolutePath);
        },
      });

      assert.equal(gitignoreRead, false);
      assert.equal(snapshot.symlinkPaths.has('.gitignore'), true);
      assert.equal(
        gitCalls.some(
          (args) =>
            args[0] === 'ls-files' &&
            args.includes('-ci') &&
            args.includes('--exclude-standard'),
        ),
        false,
      );
    });
  });

  test('does not read policy after detecting a reparse ancestor', async () => {
    await withTemporaryGitRepository(async (repositoryRoot) => {
      const configPath = path.join(repositoryRoot, 'config');
      let policyRead = false;
      await assert.rejects(
        loadRepositoryAuthorityPolicy(repositoryRoot, {
          lstat: async (absolutePath) => {
            if (absolutePath === configPath) {
              return {
                isDirectory: () => true,
                isFile: () => false,
                isSymbolicLink: () => true,
                reparseTag: 0xa0000003,
              };
            }
            return lstat(absolutePath);
          },
          readPolicy: async () => {
            policyRead = true;
            return Buffer.from('{}', 'utf8');
          },
        }),
        {
          name: 'TypeError',
          message: 'Repository authority policy could not be read.',
        },
      );
      assert.equal(policyRead, false);
    });
  });

  test('rejects an oversized policy through the production bounded reader', async () => {
    await withTemporaryGitRepository(async (repositoryRoot) => {
      const policyPath = path.join(
        repositoryRoot,
        'config',
        'repository-authority.json',
      );
      await mkdir(path.dirname(policyPath), { recursive: true });
      await writeFile(policyPath, Buffer.alloc(4 * 1024 * 1024 + 1, 0x20));

      await assert.rejects(
        loadRepositoryAuthorityPolicy(repositoryRoot),
        {
          name: 'TypeError',
          message: 'Repository authority policy could not be read.',
        },
      );
    });
  });

  test('rejects a control file identity swap before bounded reading', async () => {
    await withTemporaryGitRepository(async (repositoryRoot) => {
      const policy = makePolicy();
      await writeValidRepository(repositoryRoot, policy);
      const policyPath = path.join(
        repositoryRoot,
        'config',
        'repository-authority.json',
      );
      const decoyPath = path.join(repositoryRoot, 'decoy.json');
      await writeFile(decoyPath, '{"decoy":true}\n', 'utf8');
      const decoyStats = await lstat(decoyPath);

      await assert.rejects(
        loadRepositoryAuthorityPolicy(repositoryRoot, {
          lstat: async (absolutePath) =>
            absolutePath === policyPath
              ? decoyStats
              : lstat(absolutePath),
        }),
        {
          name: 'TypeError',
          message: 'Repository authority policy could not be read.',
        },
      );
    });
  });
});

describe('repository authority CLI', () => {
  test('reports fixed PASS for the current repository authority', async () => {
    const stdout = [];
    const stderr = [];
    const options = {
      repositoryRoot: process.cwd(),
      stdout: { write: (value) => stdout.push(value) },
      stderr: { write: (value) => stderr.push(value) },
    };

    assert.equal(await checkRepositoryAuthority(options), 0);
    assert.deepEqual(stdout, ['Repository authority: PASS\n']);
    assert.deepEqual(stderr, []);
  });

  test('imports the CLI module without output or process exit side effects', async () => {
    const moduleUrl = new URL(
      './check-repository-authority.mjs',
      import.meta.url,
    ).href;
    const result = await execFileAsync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `await import(${JSON.stringify(moduleUrl)});`,
      ],
      { windowsHide: true },
    );
    assert.deepEqual(result, { stdout: '', stderr: '' });
  });

  test('real CLI process preserves fixed exit and output contracts', async () => {
    const scriptPath = path.join(
      process.cwd(),
      'scripts',
      'check-repository-authority.mjs',
    );
    const valid = await execFileAsync(process.execPath, [scriptPath], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        GIT_DIR: path.join(process.cwd(), 'missing-hostile-git-dir'),
        GIT_INDEX_FILE: path.join(process.cwd(), 'missing-hostile-index'),
        GIT_CONFIG_GLOBAL: path.join(
          process.cwd(),
          'missing-hostile-config',
        ),
      },
      windowsHide: true,
    });
    assert.deepEqual(valid, {
      stdout: 'Repository authority: PASS\n',
      stderr: '',
    });

    await withTemporaryGitRepository(async (repositoryRoot) => {
      await writeValidRepository(repositoryRoot);
      let violation;
      try {
        await execFileAsync(process.execPath, [scriptPath], {
          cwd: repositoryRoot,
          windowsHide: true,
        });
      } catch (error) {
        violation = error;
      }
      assert.equal(violation?.code, 1);
      assert.equal(
        violation?.stdout,
        'POLICY_METADATA_INVALID config/repository-authority.json\n',
      );
      assert.equal(violation?.stderr, '');
    });

    await withTemporaryGitRepository(async (repositoryRoot) => {
      const scriptPath = path.join(
        process.cwd(),
        'scripts',
        'check-repository-authority.mjs',
      );
      let inspectionFailure;
      try {
        await execFileAsync(process.execPath, [scriptPath], {
          cwd: repositoryRoot,
          windowsHide: true,
        });
      } catch (error) {
        inspectionFailure = error;
      }
      assert.equal(inspectionFailure?.code, 1);
      assert.equal(
        inspectionFailure?.stdout,
        'POLICY_READ_FAILED config/repository-authority.json\n',
      );
      assert.equal(inspectionFailure?.stderr, '');
    });
  });

  test('malformed MainOptions return fixed exit 2 without throwing', async () => {
    const moduleUrl = new URL(
      './check-repository-authority.mjs',
      import.meta.url,
    ).href;
    let result;
    try {
      await execFileAsync(
        process.execPath,
        [
          '--input-type=module',
          '--eval',
          [
            `const { main } = await import(${JSON.stringify(moduleUrl)});`,
            'process.exitCode = await main({',
            '  repositoryRoot: 1,',
            '  stdout: {},',
            '  stderr: { write: "not-callable" },',
            '});',
          ].join('\n'),
        ],
        { windowsHide: true },
      );
    } catch (error) {
      result = error;
    }

    assert.equal(result?.code, 2);
    assert.equal(result?.stdout, '');
    assert.equal(result?.stderr, 'REPOSITORY_CHECK_ARGUMENT_INVALID .\n');
  });
});
