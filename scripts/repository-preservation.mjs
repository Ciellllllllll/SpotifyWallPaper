import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { execFile } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import {
  lstat,
  mkdir,
  mkdtemp,
  open as openFile,
  opendir as openDirectory,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  createBoundedReparseInspector,
  createSafeGitArguments,
  createSafeGitEnvironment,
  loadRepositoryAuthorityPolicy,
  parseNullSeparatedIndexEntries,
  queryWindowsReparsePoint,
  resolveTrustedGitExecutable,
  validateCanonicalRepositoryPath,
  validateRepositoryAuthorityPolicy,
} from './repository-authority.mjs';

/**
 * @typedef {object} PreservationFingerprint
 * @property {number} count
 * @property {Buffer} digest
 */

/**
 * @typedef {object} PreservationComparison
 * @property {boolean} match
 * @property {number} count
 */

/**
 * @typedef {object} RawDiffEntry
 * @property {string} oldMode
 * @property {string} mode
 * @property {string} status
 * @property {string|null} oldPath
 * @property {string} path
 */

const RECOVERED_DOMAIN = Buffer.from(
  'spotify-wallpaper/recovered-documents/v1\0',
  'utf8',
);
const STATIC_LOCAL_DOMAIN = Buffer.from(
  'spotify-wallpaper/static-local-metadata/v1\0',
  'utf8',
);
const MAX_RECOVERED_DOCUMENT_BYTES = 32 * 1024 * 1024;
const MAX_RECOVERED_AGGREGATE_BYTES = 512 * 1024 * 1024;
const MAX_GIT_INSPECTION_MS = 10_000;
const STATIC_TRAVERSAL_LIMITS = Object.freeze({
  maxDepth: 64,
  maxEntriesPerDirectory: 1_024,
  maxEntries: 2_048,
  maxPathBytes: 4_096,
  maxAggregatePathBytes: 16 * 1024 * 1024,
});

function boundedStaticTraversalLimits(overrides) {
  if (overrides === undefined) {
    return STATIC_TRAVERSAL_LIMITS;
  }
  if (
    overrides === null ||
    typeof overrides !== 'object' ||
    Array.isArray(overrides)
  ) {
    throw new TypeError('Invalid static traversal limits.');
  }
  const limits = {};
  for (const [name, maximum] of Object.entries(STATIC_TRAVERSAL_LIMITS)) {
    const candidate = overrides[name] ?? maximum;
    if (!Number.isSafeInteger(candidate) || candidate < 0) {
      throw new TypeError('Invalid static traversal limits.');
    }
    limits[name] = Math.min(candidate, maximum);
  }
  return limits;
}

async function readBoundedStaticDirectory(absolutePath) {
  const directory = await openDirectory(absolutePath);
  const entries = [];
  try {
    for (;;) {
      const entry = await directory.read();
      if (entry === null) {
        break;
      }
      if (
        entries.length >= STATIC_TRAVERSAL_LIMITS.maxEntriesPerDirectory
      ) {
        throw new TypeError('Static directory entry limit exceeded.');
      }
      entries.push(entry);
    }
    return entries;
  } finally {
    await directory.close();
  }
}

function encodeUnsigned64(value) {
  const encoded = Buffer.alloc(8);
  encoded.writeBigUInt64BE(BigInt(value));
  return encoded;
}

function pathsEqual(left, right) {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return process.platform === 'win32'
    ? normalizedLeft.toLocaleLowerCase('en-US') ===
        normalizedRight.toLocaleLowerCase('en-US')
    : normalizedLeft === normalizedRight;
}

function isContainedPath(repositoryRoot, candidate) {
  const relative = path.relative(repositoryRoot, candidate);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== '..' &&
      !path.isAbsolute(relative))
  );
}

function createReparseInspector(
  queryReparsePoint = queryWindowsReparsePoint,
) {
  if (
    process.platform !== 'win32' &&
    queryReparsePoint === queryWindowsReparsePoint
  ) {
    return async () => false;
  }
  return createBoundedReparseInspector(queryReparsePoint);
}

async function isReparseEntry(absolutePath, stats, inspectReparsePoint) {
  return (
    stats.isSymbolicLink() ||
    (typeof stats.reparseTag === 'number' && stats.reparseTag !== 0) ||
    (await inspectReparsePoint(absolutePath, stats))
  );
}

function statsIdentityMatches(before, after) {
  return (
    before.dev === after.dev &&
    before.ino === after.ino &&
    before.mode === after.mode &&
    before.size === after.size &&
    before.mtimeMs === after.mtimeMs &&
    before.ctimeMs === after.ctimeMs &&
    before.isFile() === after.isFile() &&
    before.isDirectory() === after.isDirectory()
  );
}

function stableDirectoryIdentityMatches(before, after) {
  return (
    before.dev === after.dev &&
    before.ino === after.ino &&
    before.mode === after.mode &&
    before.birthtimeMs === after.birthtimeMs &&
    before.isDirectory() &&
    after.isDirectory()
  );
}

async function inspectSafePathChain(
  repositoryRoot,
  repositoryPath,
  filesystem,
  inspectReparsePoint,
) {
  const records = [];
  let current = repositoryRoot;
  const components = [null, ...repositoryPath.split('/')];
  for (const [index, component] of components.entries()) {
    if (component !== null) {
      current = path.join(current, component);
    }
    const stats = await filesystem.lstat(current);
    if (await isReparseEntry(current, stats, inspectReparsePoint)) {
      throw new TypeError('Unsafe recovered document.');
    }
    const physicalPath = await filesystem.realpath(current);
    if (!isContainedPath(repositoryRoot, physicalPath)) {
      throw new TypeError('Unsafe recovered document.');
    }
    const isFinal = index === components.length - 1;
    if (
      (isFinal && !stats.isFile()) ||
      (!isFinal && !stats.isDirectory())
    ) {
      throw new TypeError('Unsafe recovered document.');
    }
    records.push({ absolutePath: current, physicalPath, stats });
  }
  return records;
}

async function readSafeWorktreeFile(
  repositoryRoot,
  repositoryPath,
  dependencies = {},
  sharedReparseInspector,
  captureRecords = false,
) {
  const filesystem = {
    lstat,
    open: openFile,
    realpath,
    queryReparsePoint: queryWindowsReparsePoint,
    ...dependencies,
  };
  const inspectReparsePoint =
    sharedReparseInspector ??
    createReparseInspector(filesystem.queryReparsePoint);
  const beforeRecords = await inspectSafePathChain(
    repositoryRoot,
    repositoryPath,
    filesystem,
    inspectReparsePoint,
  );
  const finalRecord = beforeRecords.at(-1);
  const before = finalRecord.stats;
  if (
    !Number.isSafeInteger(before.size) ||
    before.size < 0 ||
    before.size > MAX_RECOVERED_DOCUMENT_BYTES
  ) {
    throw new TypeError('Unsafe recovered document.');
  }

  const noFollow =
    process.platform === 'win32' ? 0 : fsConstants.O_NOFOLLOW;
  if (
    process.platform !== 'win32' &&
    (!Number.isInteger(noFollow) || noFollow === 0)
  ) {
    throw new TypeError('No-follow file open is unavailable.');
  }
  let handle;
  try {
    handle = await filesystem.open(
      finalRecord.absolutePath,
      fsConstants.O_RDONLY | noFollow,
    );
    const opened = await handle.stat();
    if (!statsIdentityMatches(before, opened)) {
      throw new TypeError('Recovered document changed before inspection.');
    }

    const content = Buffer.alloc(before.size + 1);
    let offset = 0;
    while (offset < content.length) {
      const result = await handle.read(
        content,
        offset,
        content.length - offset,
        null,
      );
      if (
        !Number.isSafeInteger(result?.bytesRead) ||
        result.bytesRead < 0 ||
        result.bytesRead > content.length - offset
      ) {
        throw new TypeError('Invalid recovered document read.');
      }
      if (result.bytesRead === 0) {
        break;
      }
      offset += result.bytesRead;
    }
    const openedAfter = await handle.stat();
    if (
      offset !== before.size ||
      !statsIdentityMatches(before, openedAfter)
    ) {
      throw new TypeError('Recovered document changed during inspection.');
    }

    const afterRecords = await inspectSafePathChain(
      repositoryRoot,
      repositoryPath,
      filesystem,
      inspectReparsePoint,
    );
    if (
      beforeRecords.length !== afterRecords.length ||
      beforeRecords.some(
        (record, index) =>
          !statsIdentityMatches(record.stats, afterRecords[index].stats) ||
          !pathsEqual(record.physicalPath, afterRecords[index].physicalPath),
      )
    ) {
      throw new TypeError('Recovered document path changed during inspection.');
    }
    const boundedContent = content.subarray(0, offset);
    return captureRecords
      ? { content: boundedContent, records: afterRecords }
      : boundedContent;
  } finally {
    if (handle !== undefined) {
      await handle.close();
    }
  }
}

/**
 * @param {{repositoryRoot: string, paths: string[]}} options
 * @returns {Promise<PreservationFingerprint>}
 */
export async function computeStaticLocalMetadataFingerprint(
  options,
  dependencies = {},
) {
  try {
    const { repositoryRoot, paths } = options ?? {};
    if (
      typeof repositoryRoot !== 'string' ||
      !Array.isArray(paths) ||
      paths.length === 0
    ) {
      throw new TypeError('Invalid static metadata options.');
    }
    const filesystem = {
      lstat,
      readDirectory: readBoundedStaticDirectory,
      realpath,
      queryReparsePoint: queryWindowsReparsePoint,
      ...dependencies,
    };
    const traversalLimits = boundedStaticTraversalLimits(
      dependencies.traversalLimits,
    );
    const requestedRoot = path.resolve(repositoryRoot);
    const canonicalRoot = await filesystem.realpath(requestedRoot);
    const rootStats = await filesystem.lstat(canonicalRoot);
    const inspectReparsePoint = createReparseInspector(
      filesystem.queryReparsePoint,
    );
    if (
      !pathsEqual(requestedRoot, canonicalRoot) ||
      !rootStats.isDirectory() ||
      await isReparseEntry(canonicalRoot, rootStats, inspectReparsePoint)
    ) {
      throw new TypeError('Unsafe repository root.');
    }

    const inputPaths = new Set();
    for (const repositoryPath of paths) {
      if (!validateCanonicalRepositoryPath(repositoryPath)) {
        throw new TypeError('Unsafe static metadata path.');
      }
      const folded = repositoryPath.toLocaleLowerCase('en-US');
      if (inputPaths.has(folded)) {
        throw new TypeError('Duplicate static metadata path.');
      }
      inputPaths.add(folded);
    }

    const entries = new Map();
    const traversalBudget = { entries: 0, pathBytes: 0 };
    let snapshotPathRecords = new Map();
    const sortDirectoryEntries = (directoryEntries) =>
      [...directoryEntries].sort((left, right) =>
        Buffer.compare(
          Buffer.from(left.name, 'utf8'),
          Buffer.from(right.name, 'utf8'),
        ),
      );
    const directoryEntriesEqual = (left, right) =>
      left.length === right.length &&
      left.every(
        (entry, index) =>
          entry.name === right[index].name &&
          Boolean(entry.isFile?.()) === Boolean(right[index].isFile?.()) &&
          Boolean(entry.isDirectory?.()) ===
            Boolean(right[index].isDirectory?.()) &&
          Boolean(entry.isSymbolicLink?.()) ===
            Boolean(right[index].isSymbolicLink?.()),
      );
    const revalidatePathRecords = async (records) => {
      for (const record of records) {
        const after = await filesystem.lstat(record.absolutePath);
        const physicalAfter = await filesystem.realpath(
          record.absolutePath,
        );
        if (
          !statsIdentityMatches(record.stats, after) ||
          !pathsEqual(record.physicalPath, physicalAfter) ||
          await isReparseEntry(
            record.absolutePath,
            after,
            inspectReparsePoint,
          )
        ) {
          throw new TypeError('Static metadata path changed.');
        }
      }
    };
    const rememberSnapshotPathRecords = (records) => {
      for (const record of records) {
        const key =
          process.platform === 'win32'
            ? path
                .resolve(record.absolutePath)
                .toLocaleLowerCase('en-US')
            : path.resolve(record.absolutePath);
        const existing = snapshotPathRecords.get(key);
        if (
          existing !== undefined &&
          (!statsIdentityMatches(existing.stats, record.stats) ||
            !pathsEqual(existing.physicalPath, record.physicalPath))
        ) {
          throw new TypeError('Static metadata path changed.');
        }
        snapshotPathRecords.set(key, record);
      }
    };
    const revalidateSnapshotPathRecords = async () =>
      // Reverse traversal checks each earlier record after its later siblings.
      // Sequential filesystem observations are not an atomic filesystem snapshot.
      revalidatePathRecords([...snapshotPathRecords.values()].reverse());
    const inspectEntry = async (
      repositoryPath,
      depth = 0,
      required = false,
    ) => {
      if (depth > traversalLimits.maxDepth) {
        throw new TypeError('Static traversal depth exceeded.');
      }
      let absolutePath = canonicalRoot;
      let stats;
      let physicalPath;
      const pathRecords = [];
      for (const component of repositoryPath.split('/')) {
        absolutePath = path.join(absolutePath, component);
        try {
          stats = await filesystem.lstat(absolutePath);
        } catch (error) {
          if (error?.code === 'ENOENT' && !required) {
            return;
          }
          throw error;
        }
        if (
          await isReparseEntry(
            absolutePath,
            stats,
            inspectReparsePoint,
          )
        ) {
          throw new TypeError('Unsafe static metadata entry.');
        }
        physicalPath = await filesystem.realpath(absolutePath);
        if (!isContainedPath(canonicalRoot, physicalPath)) {
          throw new TypeError('Escaped static metadata entry.');
        }
        pathRecords.push({ absolutePath, stats, physicalPath });
      }

      const repositoryPathBytes = Buffer.byteLength(repositoryPath, 'utf8');
      traversalBudget.entries += 1;
      traversalBudget.pathBytes += repositoryPathBytes;
      if (
        repositoryPathBytes > traversalLimits.maxPathBytes ||
        traversalBudget.entries > traversalLimits.maxEntries ||
        traversalBudget.pathBytes >
          traversalLimits.maxAggregatePathBytes
      ) {
        throw new TypeError('Static traversal budget exceeded.');
      }

      if (stats.isFile()) {
        if (!Number.isSafeInteger(stats.size) || stats.size < 0) {
          throw new TypeError('Unsafe static metadata file size.');
        }
        await revalidatePathRecords(pathRecords);
        rememberSnapshotPathRecords(pathRecords);
        entries.set(repositoryPath, {
          repositoryPath,
          type: 1,
          size: stats.size,
        });
        return;
      }
      if (!stats.isDirectory()) {
        throw new TypeError('Unsupported static metadata entry.');
      }

      const children = sortDirectoryEntries(
        await filesystem.readDirectory(absolutePath),
      );
      if (children.length > traversalLimits.maxEntriesPerDirectory) {
        throw new TypeError('Static directory entry limit exceeded.');
      }
      for (const child of children) {
        const childPath = `${repositoryPath}/${child.name}`;
        if (!validateCanonicalRepositoryPath(childPath)) {
          throw new TypeError('Unsafe static metadata child.');
        }
        await inspectEntry(childPath, depth + 1, true);
      }
      const verificationChildren = sortDirectoryEntries(
        await filesystem.readDirectory(absolutePath),
      );
      if (!directoryEntriesEqual(children, verificationChildren)) {
        throw new TypeError('Static metadata directory changed.');
      }
      await revalidatePathRecords(pathRecords);
      rememberSnapshotPathRecords(pathRecords);
      entries.set(repositoryPath, {
        repositoryPath,
        type: 2,
        size: 0,
      });
    };

    for (const repositoryPath of paths) {
      await inspectEntry(repositoryPath);
    }
    await revalidateSnapshotPathRecords();
    const initialEntries = new Map(
      [...entries].map(([repositoryPath, entry]) => [
        repositoryPath,
        { ...entry },
      ]),
    );
    entries.clear();
    snapshotPathRecords = new Map();
    traversalBudget.entries = 0;
    traversalBudget.pathBytes = 0;
    for (const repositoryPath of paths) {
      await inspectEntry(repositoryPath);
    }
    await revalidateSnapshotPathRecords();
    if (
      initialEntries.size !== entries.size ||
      [...initialEntries].some(([repositoryPath, entry]) => {
        const finalEntry = entries.get(repositoryPath);
        return (
          finalEntry === undefined ||
          entry.type !== finalEntry.type ||
          entry.size !== finalEntry.size
        );
      })
    ) {
      throw new TypeError('Static metadata changed during inspection.');
    }
    const finalRootStats = await filesystem.lstat(canonicalRoot);
    const finalRootPath = await filesystem.realpath(canonicalRoot);
    if (
      !statsIdentityMatches(rootStats, finalRootStats) ||
      !pathsEqual(canonicalRoot, finalRootPath) ||
      await isReparseEntry(
        canonicalRoot,
        finalRootStats,
        inspectReparsePoint,
      )
    ) {
      throw new TypeError('Static metadata root changed.');
    }

    const orderedEntries = [...entries.values()].sort((left, right) =>
      Buffer.compare(
        Buffer.from(left.repositoryPath, 'utf8'),
        Buffer.from(right.repositoryPath, 'utf8'),
      ),
    );
    const hasher = createHash('sha256');
    hasher.update(STATIC_LOCAL_DOMAIN);
    for (const entry of orderedEntries) {
      const pathBytes = Buffer.from(entry.repositoryPath, 'utf8');
      hasher.update(encodeUnsigned64(pathBytes.length));
      hasher.update(pathBytes);
      hasher.update(Buffer.from([entry.type]));
      hasher.update(encodeUnsigned64(entry.size));
    }
    return { count: orderedEntries.length, digest: hasher.digest() };
  } catch {
    throw new TypeError('Static local metadata inspection failed.');
  }
}

async function runGitBuffer(
  repositoryRoot,
  args,
  maxBuffer,
  options = {},
) {
  const stdin = options.stdin ?? null;
  const timeout = Math.min(
    options.timeout ?? MAX_GIT_INSPECTION_MS,
    MAX_GIT_INSPECTION_MS,
  );
  if (
    (stdin !== null && !Buffer.isBuffer(stdin)) ||
    !Number.isSafeInteger(timeout) ||
    timeout < 1
  ) {
    throw new TypeError('Git inspection failed.');
  }
  const gitExecutable = await resolveTrustedGitExecutable(repositoryRoot);
  return new Promise((resolve, reject) => {
    const child = execFile(
      gitExecutable,
      createSafeGitArguments(args),
      {
        cwd: repositoryRoot,
        encoding: 'buffer',
        env: createSafeGitEnvironment(process.env),
        maxBuffer,
        shell: false,
        timeout,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error !== null || !Buffer.isBuffer(stdout)) {
          reject(new TypeError('Git inspection failed.'));
          return;
        }
        resolve(stdout);
      },
    );
    child.stdin?.on('error', () => {});
    child.stdin?.end(stdin ?? undefined);
  });
}

function decodeFatalUtf8(input) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(input);
  } catch {
    throw new TypeError('Git inspection failed.');
  }
}

function nestedAttributesPaths(inspectedPaths) {
  const candidates = new Set();
  for (const repositoryPath of inspectedPaths) {
    let directory = path.posix.dirname(repositoryPath);
    while (directory !== '.') {
      candidates.add(`${directory}/.gitattributes`);
      directory = path.posix.dirname(directory);
    }
  }
  return [...candidates];
}

async function noAdditionalAttributesSources(
  repositoryRoot,
  source,
  inspectedPaths,
) {
  const nestedPaths = nestedAttributesPaths(inspectedPaths);
  if (source === 'index' && nestedPaths.length > 0) {
    const output = await runGitBuffer(
      repositoryRoot,
      ['ls-files', '--stage', '-z', '--', ...nestedPaths],
      MAX_ATTRIBUTES_BYTES,
    );
    if (parseNullSeparatedIndexEntries(output).size !== 0) {
      return false;
    }
  } else if (source === 'worktree') {
    for (const repositoryPath of nestedPaths) {
      try {
        await lstat(path.join(repositoryRoot, repositoryPath));
        return false;
      } catch (error) {
        if (error?.code !== 'ENOENT') {
          throw error;
        }
      }
    }
  }

  const gitInfoOutput = await runGitBuffer(
    repositoryRoot,
    [
      'rev-parse',
      '--path-format=absolute',
      '--git-path',
      'info/attributes',
    ],
    16 * 1024,
  );
  const decodedInfoPath = decodeFatalUtf8(gitInfoOutput);
  const infoPathMatch = /^(?<path>[^\r\n\0]+)\r?\n$/u.exec(
    decodedInfoPath,
  );
  if (
    infoPathMatch?.groups?.path === undefined ||
    !path.isAbsolute(infoPathMatch.groups.path)
  ) {
    throw new TypeError('Git inspection failed.');
  }
  try {
    await lstat(infoPathMatch.groups.path);
    return false;
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }
  return true;
}

async function withIsolatedAttributesRepository(
  attributesContent,
  callback,
) {
  if (
    !Buffer.isBuffer(attributesContent) ||
    typeof callback !== 'function'
  ) {
    throw new TypeError('Invalid isolated attributes repository.');
  }
  const canonicalTemp = await realpath(tmpdir());
  const temporaryRoot = await mkdtemp(
    path.join(canonicalTemp, 'spotify-wallpaper-attributes-'),
  );
  const canonicalRoot = await realpath(temporaryRoot);
  const initialStats = await lstat(canonicalRoot);
  const inspectReparsePoint = createReparseInspector();
  if (
    !pathsEqual(temporaryRoot, canonicalRoot) ||
    !pathsEqual(path.dirname(canonicalRoot), canonicalTemp) ||
    !initialStats.isDirectory() ||
    await isReparseEntry(
      canonicalRoot,
      initialStats,
      inspectReparsePoint,
    )
  ) {
    throw new TypeError('Unsafe isolated attributes repository.');
  }

  const markerPath = path.join(canonicalRoot, '.codex-owned-temp');
  const markerHandle = await openFile(markerPath, 'wx');
  const markerStats = await markerHandle.stat();
  try {
    const worktree = path.join(canonicalRoot, 'worktree');
    const gitDirectory = path.join(canonicalRoot, 'git');
    await mkdir(worktree);
    await runGitBuffer(
      canonicalRoot,
      [
        'init',
        '--quiet',
        `--separate-git-dir=${gitDirectory}`,
        '--',
        worktree,
      ],
      64 * 1024,
    );
    await writeFile(
      path.join(worktree, '.gitattributes'),
      attributesContent,
      { flag: 'wx' },
    );
    const copiedAttributes = await readSafeWorktreeFile(
      worktree,
      '.gitattributes',
      {},
    );
    if (!attributesContent.equals(copiedAttributes)) {
      throw new TypeError('Isolated attributes copy mismatch.');
    }
    return await callback({ gitDirectory, worktree });
  } finally {
    const cleanupRoot = path.join(
      canonicalTemp,
      `spotify-wallpaper-cleanup-${randomUUID()}`,
    );
    await markerHandle.close();
    await rename(canonicalRoot, cleanupRoot);
    const finalStats = await lstat(cleanupRoot);
    const finalRoot = await realpath(cleanupRoot);
    const markerPathStats = await lstat(
      path.join(cleanupRoot, '.codex-owned-temp'),
    );
    const safeToRemove =
      pathsEqual(finalRoot, cleanupRoot) &&
      pathsEqual(path.dirname(finalRoot), canonicalTemp) &&
      stableDirectoryIdentityMatches(initialStats, finalStats) &&
      statsIdentityMatches(markerStats, markerPathStats) &&
      !(await isReparseEntry(
        cleanupRoot,
        finalStats,
        inspectReparsePoint,
      ));
    if (!safeToRemove) {
      throw new TypeError('Unsafe isolated attributes cleanup.');
    }
    await rm(cleanupRoot, { recursive: true, force: false });
  }
}

function parseGitObjectId(input) {
  const decoded = decodeFatalUtf8(input);
  const match = /^(?<oid>[0-9a-f]{40}|[0-9a-f]{64})\n$/u.exec(decoded);
  if (match?.groups?.oid === undefined) {
    throw new TypeError('Git inspection failed.');
  }
  return match.groups.oid;
}

async function readGitBlob(repositoryRoot, repositoryPath, source) {
  let objectId;
  if (source === 'index') {
    const indexOutput = await runGitBuffer(
      repositoryRoot,
      ['ls-files', '--stage', '-z', '--', repositoryPath],
      1024 * 1024,
    );
    const entries = parseNullSeparatedIndexEntries(indexOutput);
    const entry = entries.get(repositoryPath);
    if (
      entries.size !== 1 ||
      entry === undefined ||
      (entry.mode !== '100644' && entry.mode !== '100755')
    ) {
      throw new TypeError('Unsafe index entry.');
    }
    objectId = entry.oid;
  } else {
    const treeOutput = await runGitBuffer(
      repositoryRoot,
      ['ls-tree', '-z', source, '--', repositoryPath],
      1024 * 1024,
    );
    if (treeOutput.length === 0 || treeOutput.at(-1) !== 0) {
      throw new TypeError('Unsafe HEAD entry.');
    }
    const decoded = decodeFatalUtf8(treeOutput);
    const records = decoded.slice(0, -1).split('\0');
    if (records.length !== 1) {
      throw new TypeError('Unsafe HEAD entry.');
    }
    const match =
      /^(?<mode>[0-9]{6}) blob (?<oid>[0-9a-f]{40}|[0-9a-f]{64})\t(?<path>.+)$/u.exec(
        records[0],
      );
    if (
      match?.groups === undefined ||
      (match.groups.mode !== '100644' &&
        match.groups.mode !== '100755') ||
      match.groups.path !== repositoryPath
    ) {
      throw new TypeError('Unsafe HEAD entry.');
    }
    objectId = match.groups.oid;
  }

  const content = await runGitBuffer(
    repositoryRoot,
    ['cat-file', 'blob', objectId],
    MAX_RECOVERED_DOCUMENT_BYTES + 1,
  );
  if (content.length > MAX_RECOVERED_DOCUMENT_BYTES) {
    throw new TypeError('Recovered blob exceeds limit.');
  }
  return content;
}

async function resolveHeadCommit(repositoryRoot) {
  return parseGitObjectId(
    await runGitBuffer(
      repositoryRoot,
      ['rev-parse', '--verify', 'HEAD^{commit}'],
      4 * 1024,
    ),
  );
}

async function readIndexSnapshot(repositoryRoot, paths) {
  const output = await runGitBuffer(
    repositoryRoot,
    ['ls-files', '--stage', '-z', '--', ...paths],
    16 * 1024 * 1024,
  );
  const entries = parseNullSeparatedIndexEntries(output);
  if (
    entries.size !== paths.length ||
    paths.some((repositoryPath) => {
      const entry = entries.get(repositoryPath);
      return (
        entry === undefined ||
        (entry.mode !== '100644' && entry.mode !== '100755')
      );
    })
  ) {
    throw new TypeError('Unsafe index snapshot.');
  }
  return { output, entries };
}

/**
 * @param {{repositoryRoot: string, paths: string[], source: 'worktree'|'index'|'HEAD'}} options
 * @returns {Promise<PreservationFingerprint>}
 */
export async function computeRecoveredDocumentFingerprint(
  options,
  dependencies = {},
) {
  try {
    const { repositoryRoot, paths, source } = options ?? {};
    if (
      typeof repositoryRoot !== 'string' ||
      !Array.isArray(paths) ||
      paths.length === 0 ||
      !['worktree', 'index', 'HEAD'].includes(source)
    ) {
      throw new TypeError('Invalid fingerprint options.');
    }
    const requestedRoot = path.resolve(repositoryRoot);
    const filesystem = {
      lstat,
      open: openFile,
      realpath,
      queryReparsePoint: queryWindowsReparsePoint,
      ...dependencies,
    };
    const canonicalRoot = await filesystem.realpath(requestedRoot);
    const rootStats = await filesystem.lstat(canonicalRoot);
    const inspectReparsePoint = createReparseInspector(
      filesystem.queryReparsePoint,
    );
    if (
      !pathsEqual(requestedRoot, canonicalRoot) ||
      !rootStats.isDirectory() ||
      await isReparseEntry(canonicalRoot, rootStats, inspectReparsePoint)
    ) {
      throw new TypeError('Unsafe repository root.');
    }

    const foldedPaths = new Set();
    const orderedPaths = paths.map((repositoryPath) => {
      if (!validateCanonicalRepositoryPath(repositoryPath)) {
        throw new TypeError('Unsafe recovered path.');
      }
      const folded = repositoryPath.toLocaleLowerCase('en-US');
      if (foldedPaths.has(folded)) {
        throw new TypeError('Duplicate recovered path.');
      }
      foldedPaths.add(folded);
      return repositoryPath;
    });
    orderedPaths.sort((left, right) =>
      Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8')),
    );

    const pinnedSource =
      source === 'HEAD'
        ? await resolveHeadCommit(canonicalRoot)
        : source;
    const initialIndexSnapshot =
      source === 'index'
        ? await readIndexSnapshot(canonicalRoot, orderedPaths)
        : null;
    const worktreeSnapshots = [];
    const hasher = createHash('sha256');
    hasher.update(RECOVERED_DOMAIN);
    let aggregateBytes = 0;
    for (const repositoryPath of orderedPaths) {
      let content;
      if (source === 'worktree') {
        const worktreeSnapshot = await readSafeWorktreeFile(
          canonicalRoot,
          repositoryPath,
          filesystem,
          inspectReparsePoint,
          true,
        );
        content = worktreeSnapshot.content;
        worktreeSnapshots.push({
          repositoryPath,
          records: worktreeSnapshot.records,
        });
      } else if (source === 'index') {
        content = await runGitBuffer(
          canonicalRoot,
          [
            'cat-file',
            'blob',
            initialIndexSnapshot.entries.get(repositoryPath).oid,
          ],
          MAX_RECOVERED_DOCUMENT_BYTES + 1,
        );
        if (content.length > MAX_RECOVERED_DOCUMENT_BYTES) {
          throw new TypeError('Recovered blob exceeds limit.');
        }
      } else {
        content = await readGitBlob(
          canonicalRoot,
          repositoryPath,
          pinnedSource,
        );
      }
      aggregateBytes += content.length;
      if (aggregateBytes > MAX_RECOVERED_AGGREGATE_BYTES) {
        throw new TypeError('Recovered aggregate exceeds limit.');
      }
      const pathBytes = Buffer.from(repositoryPath, 'utf8');
      hasher.update(encodeUnsigned64(pathBytes.length));
      hasher.update(pathBytes);
      hasher.update(encodeUnsigned64(content.length));
      hasher.update(createHash('sha256').update(content).digest());
    }
    for (const snapshot of worktreeSnapshots) {
      const finalRecords = await inspectSafePathChain(
        canonicalRoot,
        snapshot.repositoryPath,
        filesystem,
        inspectReparsePoint,
      );
      if (
        snapshot.records.length !== finalRecords.length ||
        snapshot.records.some(
          (record, index) =>
            !statsIdentityMatches(
              record.stats,
              finalRecords[index].stats,
            ) ||
            !pathsEqual(
              record.physicalPath,
              finalRecords[index].physicalPath,
            ),
        )
      ) {
        throw new TypeError(
          'Recovered document set changed during inspection.',
        );
      }
    }
    if (source === 'index') {
      const finalIndexSnapshot = await readIndexSnapshot(
        canonicalRoot,
        orderedPaths,
      );
      if (!initialIndexSnapshot.output.equals(finalIndexSnapshot.output)) {
        throw new TypeError('Recovered index changed during inspection.');
      }
    }
    if (
      source === 'HEAD' &&
      pinnedSource !== await resolveHeadCommit(canonicalRoot)
    ) {
      throw new TypeError('HEAD changed during inspection.');
    }
    const finalRootStats = await filesystem.lstat(canonicalRoot);
    const finalCanonicalRoot = await filesystem.realpath(canonicalRoot);
    if (
      !statsIdentityMatches(rootStats, finalRootStats) ||
      !pathsEqual(canonicalRoot, finalCanonicalRoot) ||
      await isReparseEntry(
        canonicalRoot,
        finalRootStats,
        inspectReparsePoint,
      )
    ) {
      throw new TypeError('Repository root changed during inspection.');
    }
    return { count: orderedPaths.length, digest: hasher.digest() };
  } catch {
    throw new TypeError('Recovered document inspection failed.');
  }
}

/**
 * @param {PreservationFingerprint} expected
 * @param {PreservationFingerprint} actual
 * @returns {PreservationComparison}
 */
export function comparePreservationFingerprints(expected, actual) {
  const expectedDigest = expected?.digest;
  const actualDigest = actual?.digest;
  const valid =
    Number.isSafeInteger(expected?.count) &&
    expected.count >= 0 &&
    Number.isSafeInteger(actual?.count) &&
    actual.count >= 0 &&
    Buffer.isBuffer(expectedDigest) &&
    expectedDigest.length === 32 &&
    Buffer.isBuffer(actualDigest) &&
    actualDigest.length === 32;
  const match =
    valid &&
    expected.count === actual.count &&
    timingSafeEqual(expectedDigest, actualDigest);
  return {
    match,
    count: Number.isSafeInteger(actual?.count) && actual.count >= 0
      ? actual.count
      : 0,
  };
}

/**
 * @param {PreservationComparison} result
 * @returns {string}
 */
export function formatPreservationComparison(result) {
  const count =
    Number.isSafeInteger(result?.count) && result.count >= 0
      ? result.count
      : 0;
  return `${result?.match === true ? 'MATCH' : 'MISMATCH'} count=${count}`;
}

/**
 * @param {Buffer} input
 * @returns {RawDiffEntry[]}
 */
export function parseNullSeparatedRawDiff(input) {
  const fail = () => {
    throw new TypeError('Invalid staged raw diff.');
  };
  if (!Buffer.isBuffer(input)) {
    fail();
  }
  if (input.length === 0) {
    return [];
  }
  if (input.at(-1) !== 0) {
    fail();
  }

  let decoded;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(input);
  } catch {
    fail();
  }
  const fields = decoded.slice(0, -1).split('\0');
  const entries = [];
  const seenPaths = new Set();
  let cursor = 0;
  let objectIdLength;

  while (cursor < fields.length) {
    const header = fields[cursor++];
    const match =
      /^:(?<oldMode>[0-9]{6}) (?<mode>[0-9]{6}) (?<oldOid>[0-9a-f]+) (?<oid>[0-9a-f]+) (?<status>[A-Z][0-9]*)$/u.exec(
        header,
      );
    if (match?.groups === undefined) {
      fail();
    }
    const { oldMode, mode, oldOid, oid, status } = match.groups;
    if (
      (oid.length !== 40 && oid.length !== 64) ||
      oldOid.length !== oid.length ||
      (objectIdLength !== undefined && objectIdLength !== oid.length)
    ) {
      fail();
    }
    objectIdLength = oid.length;

    const statusKind = status[0];
    const pathCount =
      statusKind === 'R' || statusKind === 'C' ? 2 : 1;
    if (cursor + pathCount > fields.length) {
      fail();
    }
    const rawPaths = fields.slice(cursor, cursor + pathCount);
    cursor += pathCount;

    const normalizedPaths = rawPaths.map((repositoryPath) => {
      try {
        return validateCanonicalRepositoryPath(repositoryPath)
          ? repositoryPath
          : fail();
      } catch {
        return fail();
      }
    });
    for (const repositoryPath of normalizedPaths) {
      if (seenPaths.has(repositoryPath)) {
        fail();
      }
      seenPaths.add(repositoryPath);
    }

    entries.push({
      oldMode,
      mode,
      status,
      oldPath: pathCount === 2 ? normalizedPaths[0] : null,
      path: normalizedPaths.at(-1),
    });
  }

  return entries;
}

export const RECOVERED_DOCUMENT_PATHS = Object.freeze([
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
]);

export const STATIC_LOCAL_PATHS = Object.freeze([
  'docs/phase-reports.zip',
  'CLAUDE.md',
  'goal',
  '.superpowers',
  '.claude',
]);

export const RECOVERED_WHITESPACE_PATHS = Object.freeze([
  'docs/phase-reports/phase-7-lyrics.md',
  'docs/phase-reports/phase-8-transitions.md',
]);

function hasExactUniqueSet(candidate, expected) {
  return (
    Array.isArray(candidate) &&
    candidate.length === expected.length &&
    new Set(candidate).size === candidate.length &&
    candidate.every((value) => expected.includes(value))
  );
}

export function preservationPolicyMatchesFixedPaths(policy) {
  return (
    policy?.preservation?.rawByteAttributesFile === '.gitattributes' &&
    hasExactUniqueSet(
      policy.preservation.recoveredDocuments,
      RECOVERED_DOCUMENT_PATHS,
    ) &&
    hasExactUniqueSet(
      policy.preservation.staticLocalPaths,
      STATIC_LOCAL_PATHS,
    )
  );
}

async function assertFixedPreservationPolicy(repositoryRoot) {
  const policy = await loadRepositoryAuthorityPolicy(repositoryRoot);
  if (
    validateRepositoryAuthorityPolicy(policy).length !== 0 ||
    !preservationPolicyMatchesFixedPaths(policy)
  ) {
    throw new TypeError('Preservation policy mismatch.');
  }
  return policy;
}

const RECOVERED_ATTRIBUTE_NAMES = Object.freeze([
  'text',
  'eol',
  'filter',
  'working-tree-encoding',
  'ident',
  'whitespace',
]);
const MAX_ATTRIBUTES_BYTES = 1024 * 1024;

function parseAttributes(input, expectedPaths) {
  if (!Buffer.isBuffer(input) || input.length === 0 || input.at(-1) !== 0) {
    throw new TypeError('Invalid Git attribute output.');
  }
  const decoded = decodeFatalUtf8(input);
  const fields = decoded.slice(0, -1).split('\0');
  if (
    fields.length !==
    expectedPaths.length * RECOVERED_ATTRIBUTE_NAMES.length * 3
  ) {
    throw new TypeError('Invalid Git attribute output.');
  }
  const values = new Map();
  for (let index = 0; index < fields.length; index += 3) {
    const [repositoryPath, attribute, value] = fields.slice(index, index + 3);
    if (
      !validateCanonicalRepositoryPath(repositoryPath) ||
      !RECOVERED_ATTRIBUTE_NAMES.includes(attribute)
    ) {
      throw new TypeError('Invalid Git attribute output.');
    }
    const pathValues = values.get(repositoryPath) ?? new Map();
    if (pathValues.has(attribute)) {
      throw new TypeError('Invalid Git attribute output.');
    }
    pathValues.set(attribute, value);
    values.set(repositoryPath, pathValues);
  }
  if (
    values.size !== expectedPaths.length ||
    expectedPaths.some(
      (repositoryPath) =>
        values.get(repositoryPath)?.size !== RECOVERED_ATTRIBUTE_NAMES.length,
    )
  ) {
    throw new TypeError('Invalid Git attribute output.');
  }
  return values;
}

function attributesFileMatchesContract(content, paths, whitespacePaths) {
  if (
    !Buffer.isBuffer(content) ||
    content.length > MAX_ATTRIBUTES_BYTES ||
    content.includes(0)
  ) {
    throw new TypeError('Invalid attributes file.');
  }
  const semanticRules = decodeFatalUtf8(content)
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => line.split(/[ \t]+/u).join(' '));
  const whitespaceSet = new Set(whitespacePaths);
  const expectedRules = [
    '* text=auto eol=lf',
    ...paths.map(
      (repositoryPath) =>
        `${repositoryPath} -text${
          whitespaceSet.has(repositoryPath)
            ? ' whitespace=-trailing-space'
            : ''
        }`,
    ),
  ];
  return (
    semanticRules[0] === expectedRules[0] &&
    semanticRules.length === expectedRules.length &&
    new Set(semanticRules).size === semanticRules.length &&
    expectedRules.every((rule) => semanticRules.includes(rule))
  );
}

function attributesValuesMatchContract(
  values,
  paths,
  whitespacePaths,
  ordinaryPaths,
) {
  const whitespaceSet = new Set(whitespacePaths);
  return (
    paths.every((repositoryPath) => {
      const pathValues = values.get(repositoryPath);
      return (
        pathValues?.get('text') === 'unset' &&
        pathValues.get('eol') === 'lf' &&
        pathValues.get('filter') === 'unspecified' &&
        pathValues.get('working-tree-encoding') === 'unspecified' &&
        pathValues.get('ident') === 'unspecified' &&
        pathValues.get('whitespace') ===
          (whitespaceSet.has(repositoryPath)
            ? '-trailing-space'
            : 'unspecified')
      );
    }) &&
    ordinaryPaths.every((repositoryPath) => {
      const pathValues = values.get(repositoryPath);
      return (
        pathValues?.get('text') === 'auto' &&
        pathValues.get('eol') === 'lf' &&
        pathValues.get('filter') === 'unspecified' &&
        pathValues.get('working-tree-encoding') === 'unspecified' &&
        pathValues.get('ident') === 'unspecified' &&
        pathValues.get('whitespace') === 'unspecified'
      );
    })
  );
}

function validateWhitespacePaths(paths, whitespacePaths) {
  return (
    Array.isArray(whitespacePaths) &&
    new Set(whitespacePaths).size === whitespacePaths.length &&
    whitespacePaths.every((repositoryPath) => paths.includes(repositoryPath))
  );
}

function deriveOrdinaryDocumentPaths(policy, recoveredPaths) {
  const recoveredSet = new Set(recoveredPaths);
  const documentPaths = policy.documentGroups.flatMap((group) => group.paths);
  const ordinaryPaths = documentPaths.filter(
    (repositoryPath) => !recoveredSet.has(repositoryPath),
  );
  if (
    new Set(documentPaths).size !== documentPaths.length ||
    ordinaryPaths.some(
      (repositoryPath) =>
        !validateCanonicalRepositoryPath(repositoryPath) ||
        recoveredSet.has(repositoryPath),
    )
  ) {
    throw new TypeError('Invalid ordinary document path set.');
  }
  return ordinaryPaths;
}

function validateOrdinaryPaths(paths, ordinaryPaths) {
  const recoveredSet = new Set(paths);
  return (
    Array.isArray(ordinaryPaths) &&
    new Set(ordinaryPaths).size === ordinaryPaths.length &&
    ordinaryPaths.every(
      (repositoryPath) =>
        validateCanonicalRepositoryPath(repositoryPath) &&
        !recoveredSet.has(repositoryPath),
    )
  );
}

async function verifyAttributesContract(
  repositoryRoot,
  paths,
  whitespacePaths,
  ordinaryPaths,
  source,
) {
  const content =
    source === 'worktree'
      ? await readSafeWorktreeFile(
          await realpath(repositoryRoot),
          '.gitattributes',
          {},
        )
      : await readGitBlob(repositoryRoot, '.gitattributes', 'index');
  if (!attributesFileMatchesContract(content, paths, whitespacePaths)) {
    return false;
  }
  const inspectedPaths = [...paths, ...ordinaryPaths];
  if (
    !(await noAdditionalAttributesSources(
      repositoryRoot,
      source,
      inspectedPaths,
    ))
  ) {
    return false;
  }
  const output = await withIsolatedAttributesRepository(
    content,
    ({ gitDirectory, worktree }) =>
      runGitBuffer(
        worktree,
        [
          `--git-dir=${gitDirectory}`,
          `--work-tree=${worktree}`,
          'check-attr',
          '-z',
          ...RECOVERED_ATTRIBUTE_NAMES,
          '--',
          ...inspectedPaths,
        ],
        1024 * 1024,
      ),
  );
  const finalContent =
    source === 'worktree'
      ? await readSafeWorktreeFile(
          await realpath(repositoryRoot),
          '.gitattributes',
          {},
        )
      : await readGitBlob(repositoryRoot, '.gitattributes', 'index');
  return (
    content.equals(finalContent) &&
    attributesValuesMatchContract(
      parseAttributes(output, inspectedPaths),
      paths,
      whitespacePaths,
      ordinaryPaths,
    ) &&
    await noAdditionalAttributesSources(
      repositoryRoot,
      source,
      inspectedPaths,
    )
  );
}

async function rawAndFilteredHashesMatch(
  repositoryRoot,
  paths,
  attributesContent,
) {
  const canonicalRoot = await realpath(repositoryRoot);
  const inspectReparsePoint = createReparseInspector(
    queryWindowsReparsePoint,
  );
  return withIsolatedAttributesRepository(
    attributesContent,
    async ({ gitDirectory, worktree }) => {
      let aggregateBytes = 0;
      for (const repositoryPath of paths) {
        const content = await readSafeWorktreeFile(
          canonicalRoot,
          repositoryPath,
          {},
          inspectReparsePoint,
        );
        aggregateBytes += content.length;
        if (aggregateBytes > MAX_RECOVERED_AGGREGATE_BYTES) {
          throw new TypeError('Recovered aggregate exceeds limit.');
        }
        const commonArguments = [
          `--git-dir=${gitDirectory}`,
          `--work-tree=${worktree}`,
          'hash-object',
        ];
        const rawObjectId = parseGitObjectId(
          await runGitBuffer(
            worktree,
            [...commonArguments, '--no-filters', '--stdin'],
            4 * 1024,
            { stdin: content },
          ),
        );
        const filteredObjectId = parseGitObjectId(
          await runGitBuffer(
            worktree,
            [
              ...commonArguments,
              `--path=${repositoryPath}`,
              '--stdin',
            ],
            4 * 1024,
            { stdin: content },
          ),
        );
        if (rawObjectId !== filteredObjectId) {
          return false;
        }
      }
      return true;
    },
  );
}

/**
 * @param {string} repositoryRoot
 * @param {{paths?: string[]}} [dependencies]
 * @returns {Promise<PreservationComparison>}
 */
export async function verifyRecoveredCleanFilterIsRaw(
  repositoryRoot,
  dependencies = {},
) {
  try {
    const paths = dependencies.paths ?? RECOVERED_DOCUMENT_PATHS;
    const whitespacePaths =
      dependencies.whitespacePaths ?? RECOVERED_WHITESPACE_PATHS;
    let policy;
    if (dependencies.paths === undefined) {
      policy = await assertFixedPreservationPolicy(repositoryRoot);
    }
    const ordinaryPaths =
      dependencies.ordinaryPaths ??
      (policy === undefined
        ? []
        : deriveOrdinaryDocumentPaths(policy, paths));
    if (
      !Array.isArray(paths) ||
      paths.length === 0 ||
      new Set(paths).size !== paths.length ||
      paths.some(
        (repositoryPath) =>
          !validateCanonicalRepositoryPath(repositoryPath),
      )
    ) {
      throw new TypeError('Invalid recovered path set.');
    }
    if (!validateWhitespacePaths(paths, whitespacePaths)) {
      throw new TypeError('Invalid recovered whitespace path set.');
    }
    if (!validateOrdinaryPaths(paths, ordinaryPaths)) {
      throw new TypeError('Invalid ordinary document path set.');
    }
    const attributesMatch = await verifyAttributesContract(
      repositoryRoot,
      paths,
      whitespacePaths,
      ordinaryPaths,
      'worktree',
    );
    if (!attributesMatch) {
      return { match: false, count: paths.length };
    }
    const worktreeFingerprint = await computeRecoveredDocumentFingerprint({
      repositoryRoot,
      paths,
      source: 'worktree',
    });
    if (worktreeFingerprint.count !== paths.length) {
      throw new TypeError('Invalid recovered path set.');
    }
    const attributesContent = await readSafeWorktreeFile(
      await realpath(repositoryRoot),
      '.gitattributes',
      {},
    );
    if (
      !attributesFileMatchesContract(
        attributesContent,
        paths,
        whitespacePaths,
      )
    ) {
      return { match: false, count: paths.length };
    }
    const hashesMatch = await rawAndFilteredHashesMatch(
      repositoryRoot,
      paths,
      attributesContent,
    );
    const finalAttributesMatch = await verifyAttributesContract(
      repositoryRoot,
      paths,
      whitespacePaths,
      ordinaryPaths,
      'worktree',
    );
    return {
      match: hashesMatch && finalAttributesMatch,
      count: paths.length,
    };
  } catch {
    throw new TypeError('Recovered clean-filter inspection failed.');
  }
}

/**
 * @param {string} repositoryRoot
 * @param {{paths?: string[]}} [dependencies]
 * @returns {Promise<PreservationComparison>}
 */
export async function verifyRecoveredIndexBytesAndAttributes(
  repositoryRoot,
  dependencies = {},
) {
  try {
    const paths = dependencies.paths ?? RECOVERED_DOCUMENT_PATHS;
    const whitespacePaths =
      dependencies.whitespacePaths ?? RECOVERED_WHITESPACE_PATHS;
    let policy;
    if (dependencies.paths === undefined) {
      policy = await assertFixedPreservationPolicy(repositoryRoot);
    }
    const ordinaryPaths =
      dependencies.ordinaryPaths ??
      (policy === undefined
        ? []
        : deriveOrdinaryDocumentPaths(policy, paths));
    if (!validateWhitespacePaths(paths, whitespacePaths)) {
      throw new TypeError('Invalid recovered whitespace path set.');
    }
    if (!validateOrdinaryPaths(paths, ordinaryPaths)) {
      throw new TypeError('Invalid ordinary document path set.');
    }
    const filterResult = await verifyRecoveredCleanFilterIsRaw(
      repositoryRoot,
      { paths, whitespacePaths, ordinaryPaths },
    );
    const indexAttributesMatch = await verifyAttributesContract(
      repositoryRoot,
      paths,
      whitespacePaths,
      ordinaryPaths,
      'index',
    );
    const worktree = await computeRecoveredDocumentFingerprint({
      repositoryRoot,
      paths,
      source: 'worktree',
    });
    const index = await computeRecoveredDocumentFingerprint({
      repositoryRoot,
      paths,
      source: 'index',
    });
    const comparison = comparePreservationFingerprints(worktree, index);
    const finalWorktreeAttributesMatch = await verifyAttributesContract(
      repositoryRoot,
      paths,
      whitespacePaths,
      ordinaryPaths,
      'worktree',
    );
    const finalIndexAttributesMatch = await verifyAttributesContract(
      repositoryRoot,
      paths,
      whitespacePaths,
      ordinaryPaths,
      'index',
    );
    const finalWorktree = await computeRecoveredDocumentFingerprint({
      repositoryRoot,
      paths,
      source: 'worktree',
    });
    const finalIndex = await computeRecoveredDocumentFingerprint({
      repositoryRoot,
      paths,
      source: 'index',
    });
    return {
      match:
        filterResult.match &&
        indexAttributesMatch &&
        comparison.match &&
        finalWorktreeAttributesMatch &&
        finalIndexAttributesMatch &&
        comparePreservationFingerprints(
          worktree,
          finalWorktree,
        ).match &&
        comparePreservationFingerprints(index, finalIndex).match &&
        comparePreservationFingerprints(
          finalWorktree,
          finalIndex,
        ).match,
      count: paths.length,
    };
  } catch {
    throw new TypeError('Recovered index inspection failed.');
  }
}

const PHASE0_MODIFIED_PATHS = Object.freeze([
  '.gitattributes',
  '.gitignore',
  '.github/workflows/ci.yml',
  'AGENTS.md',
  'package.json',
  'docs/README.md',
  'docs/02-repository-structure.md',
  'docs/24-docs-and-reporting.md',
]);

const PHASE0_ADDED_PATHS = Object.freeze([
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
]);

const PHASE0_EXPECTED_STAGED = new Map([
  ...PHASE0_MODIFIED_PATHS.map((repositoryPath) => [
    repositoryPath,
    { status: 'M', oldMode: '100644', mode: '100644' },
  ]),
  ...PHASE0_ADDED_PATHS.map((repositoryPath) => [
    repositoryPath,
    { status: 'A', oldMode: '000000', mode: '100644' },
  ]),
]);

/**
 * @param {string} repositoryRoot
 * @param {{runGit?: (repositoryRoot: string, args: string[]) => Promise<Buffer>}} [dependencies]
 * @returns {Promise<PreservationComparison>}
 */
export async function verifyPhase0StagedIndex(
  repositoryRoot,
  dependencies = {},
) {
  try {
    const gitArguments = [
      'diff',
      '--cached',
      '--raw',
      '-z',
      '--abbrev=64',
      '--no-renames',
      '--ignore-submodules=none',
      '--no-ext-diff',
    ];
    const run =
      dependencies.runGit ??
      ((root, args) => runGitBuffer(root, args, 4 * 1024 * 1024));
    const output = await run(repositoryRoot, gitArguments);
    if (!Buffer.isBuffer(output) || output.length > 4 * 1024 * 1024) {
      throw new TypeError('Invalid staged diff output.');
    }
    const entries = parseNullSeparatedRawDiff(output);
    let match = entries.length === PHASE0_EXPECTED_STAGED.size;
    for (const entry of entries) {
      const expected = PHASE0_EXPECTED_STAGED.get(entry.path);
      if (
        expected === undefined ||
        entry.oldPath !== null ||
        entry.status !== expected.status ||
        entry.oldMode !== expected.oldMode ||
        entry.mode !== expected.mode
      ) {
        match = false;
      }
    }
    return { match, count: entries.length };
  } catch {
    throw new TypeError('Phase 0 staged index inspection failed.');
  }
}

function parseFingerprintToken(token) {
  const match = /^v1:(?<count>0|[1-9][0-9]*):(?<digest>[0-9a-f]{64})$/u.exec(
    token ?? '',
  );
  if (match?.groups === undefined) {
    throw new TypeError('Invalid fingerprint token.');
  }
  const count = Number(match.groups.count);
  if (!Number.isSafeInteger(count)) {
    throw new TypeError('Invalid fingerprint token.');
  }
  return {
    count,
    digest: Buffer.from(match.groups.digest, 'hex'),
  };
}

function parseCliArguments(argv) {
  if (!Array.isArray(argv) || argv.length === 0) {
    throw new TypeError('Invalid preservation arguments.');
  }
  const [mode, ...rawOptions] = argv;
  const modes = new Set([
    'capture-recovered',
    'capture-static-local',
    'compare-recovered',
    'compare-static-local',
    'verify-recovered-index',
    'verify-recovered-clean-filter',
    'verify-phase0-staged-index',
  ]);
  if (!modes.has(mode)) {
    throw new TypeError('Invalid preservation arguments.');
  }

  const options = new Map();
  for (const rawOption of rawOptions) {
    const separator = rawOption.indexOf('=');
    if (
      !rawOption.startsWith('--') ||
      separator <= 2 ||
      separator === rawOption.length - 1
    ) {
      throw new TypeError('Invalid preservation arguments.');
    }
    const name = rawOption.slice(2, separator);
    const value = rawOption.slice(separator + 1);
    if (
      !['source', 'expected-token', 'repository-root'].includes(name) ||
      options.has(name)
    ) {
      throw new TypeError('Invalid preservation arguments.');
    }
    options.set(name, value);
  }

  const repositoryRoot = options.get('repository-root') ?? process.cwd();
  if (!path.isAbsolute(repositoryRoot)) {
    throw new TypeError('Invalid preservation arguments.');
  }
  const source = options.get('source');
  const expectedToken = options.get('expected-token');
  const actualOptionNames = new Set(options.keys());
  actualOptionNames.delete('repository-root');

  const requireOptions = (expectedNames) => {
    if (
      actualOptionNames.size !== expectedNames.length ||
      expectedNames.some((name) => !actualOptionNames.has(name))
    ) {
      throw new TypeError('Invalid preservation arguments.');
    }
  };

  if (mode === 'capture-recovered') {
    requireOptions(['source']);
  } else if (mode === 'compare-recovered') {
    requireOptions(['source', 'expected-token']);
  } else if (mode === 'compare-static-local') {
    requireOptions(['expected-token']);
  } else {
    requireOptions([]);
  }
  if (
    (mode === 'capture-recovered' || mode === 'compare-recovered') &&
    !['worktree', 'index', 'HEAD'].includes(source)
  ) {
    throw new TypeError('Invalid preservation arguments.');
  }
  if (expectedToken !== undefined) {
    parseFingerprintToken(expectedToken);
  }

  return { mode, repositoryRoot, source, expectedToken };
}

/**
 * @param {string[]} [argv]
 * @param {{stdout: {write(value: string): unknown}, stderr: {write(value: string): unknown}}} [output]
 * @returns {Promise<number>}
 */
export async function main(
  argv = process.argv.slice(2),
  output = {
    stdout: process.stdout,
    stderr: process.stderr,
  },
) {
  let parsed;
  try {
    parsed = parseCliArguments(argv);
  } catch {
    output.stderr.write('PRESERVATION_ARGUMENT_INVALID .\n');
    return 2;
  }

  try {
    const { mode, repositoryRoot, source, expectedToken } = parsed;
    if (mode === 'capture-recovered') {
      const fingerprint = await computeRecoveredDocumentFingerprint({
        repositoryRoot,
        paths: RECOVERED_DOCUMENT_PATHS,
        source,
      });
      output.stdout.write(
        `v1:${fingerprint.count}:${fingerprint.digest.toString('hex')}\n`,
      );
      return 0;
    }
    if (mode === 'capture-static-local') {
      const fingerprint = await computeStaticLocalMetadataFingerprint({
        repositoryRoot,
        paths: STATIC_LOCAL_PATHS,
      });
      output.stdout.write(
        `v1:${fingerprint.count}:${fingerprint.digest.toString('hex')}\n`,
      );
      return 0;
    }

    await assertFixedPreservationPolicy(repositoryRoot);

    let result;
    if (mode === 'compare-recovered') {
      result = comparePreservationFingerprints(
        parseFingerprintToken(expectedToken),
        await computeRecoveredDocumentFingerprint({
          repositoryRoot,
          paths: RECOVERED_DOCUMENT_PATHS,
          source,
        }),
      );
    } else if (mode === 'compare-static-local') {
      result = comparePreservationFingerprints(
        parseFingerprintToken(expectedToken),
        await computeStaticLocalMetadataFingerprint({
          repositoryRoot,
          paths: STATIC_LOCAL_PATHS,
        }),
      );
    } else if (mode === 'verify-recovered-index') {
      result = await verifyRecoveredIndexBytesAndAttributes(repositoryRoot);
    } else if (mode === 'verify-recovered-clean-filter') {
      result = await verifyRecoveredCleanFilterIsRaw(repositoryRoot);
    } else {
      result = await verifyPhase0StagedIndex(repositoryRoot);
    }
    await assertFixedPreservationPolicy(repositoryRoot);
    output.stdout.write(`${formatPreservationComparison(result)}\n`);
    return result.match ? 0 : 1;
  } catch {
    output.stderr.write('PRESERVATION_INSPECTION_FAILED .\n');
    return 2;
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  process.exitCode = await main();
}
