import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entries = [
  'package.json',
  'package-lock.json',
  'apps/public-backend/package.json',
  'apps/public-backend/dist',
  'apps/public-backend/migrations',
  'apps/public-backend/legal',
  'packages/shared-types/package.json',
  'packages/shared-types/dist'
];

export function assertReleaseIdentity(releaseId, runGit = defaultRunGit) {
  if (!/^[0-9a-f]{40}$/u.test(releaseId)) {
    throw new Error('Release ID must be a Git commit SHA.');
  }
  if (resolve(runGit(['rev-parse', '--show-toplevel']).trim()) !== repositoryRoot) {
    throw new Error('Artifact builder must run in the authoritative repository.');
  }
  if (runGit(['rev-parse', 'HEAD']).trim() !== releaseId) {
    throw new Error('Release ID must equal HEAD.');
  }
  if (runGit(['status', '--porcelain=v1', '--untracked-files=all']) !== '') {
    throw new Error('Artifact builder requires a clean worktree.');
  }
}

export function buildArtifact(outputDirectory, releaseId) {
  assertReleaseIdentity(releaseId);
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  execFileSync(npm, ['run', 'build:shared-types'], {
    cwd: repositoryRoot,
    stdio: 'inherit'
  });
  execFileSync(
    npm,
    ['run', 'build', '--workspace', '@spotify-wallpaper/public-backend'],
    { cwd: repositoryRoot, stdio: 'inherit' }
  );
  assertReleaseIdentity(releaseId);

  const output = resolve(outputDirectory);
  const sources = entries.map((entry) => resolve(repositoryRoot, entry));
  if (
    sources.some(
      (source) =>
        output === source ||
        output.startsWith(source + sep) ||
        source.startsWith(output + sep)
    )
  ) {
    throw new Error('Artifact output must be isolated from its inputs.');
  }
  if (existsSync(output)) {
    throw new Error('Artifact output must not already exist.');
  }
  mkdirSync(output, { recursive: true, mode: 0o700 });
  for (const [index, entry] of entries.entries()) {
    const source = sources[index];
    if (!existsSync(source)) throw new Error('Required artifact input is missing.');
    rejectLinks(source);
    const destination = resolve(output, entry);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(source, destination, { recursive: true, errorOnExist: true });
  }
  writeFileSync(resolve(output, 'RELEASE_ID'), releaseId + '\n', {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx'
  });
  assertReleaseIdentity(releaseId);

  const files = listFiles(output);
  for (const file of files) {
    const path = relative(output, file).split(sep).join('/');
    if (
      path.includes('/node_modules/') ||
      path.endsWith('.map') ||
      (path.endsWith('.ts') && !path.endsWith('.d.ts')) ||
      /(^|\/)\.(env|dev\.vars)(\.|$)/u.test(path)
    ) {
      throw new Error('Forbidden artifact file detected.');
    }
  }
  const manifest = files
    .map((file) => {
      const path = relative(output, file).split(sep).join('/');
      const digest = createHash('sha256').update(readFileSync(file)).digest('hex');
      return digest + '  ' + path;
    })
    .sort()
    .join('\n');
  writeFileSync(resolve(output, 'SHA256SUMS'), manifest + '\n', {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx'
  });
  return { output, fileCount: files.length };
}

function defaultRunGit(arguments_) {
  return execFileSync('git', arguments_, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  });
}

function rejectLinks(path) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new Error('Artifact inputs must not be links.');
  if (!stat.isDirectory()) return;
  for (const child of readdirSync(path)) rejectLinks(resolve(path, child));
}

function listFiles(path) {
  const files = [];
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = resolve(path, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Artifact output must not contain links.');
    if (entry.isDirectory()) files.push(...listFiles(child));
    else if (entry.isFile()) files.push(child);
    else throw new Error('Artifact output contains an unsupported file type.');
  }
  return files;
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const output = process.argv[2];
  const releaseId = process.argv[3];
  if (
    process.argv.length !== 4 ||
    output === undefined ||
    releaseId === undefined ||
    basename(output) === ''
  ) {
    process.exitCode = 2;
  } else {
    try {
      const result = buildArtifact(output, releaseId);
      process.stdout.write(
        JSON.stringify({ ok: true, fileCount: result.fileCount }) + '\n'
      );
    } catch {
      process.stdout.write(JSON.stringify({ ok: false }) + '\n');
      process.exitCode = 1;
    }
  }
}
