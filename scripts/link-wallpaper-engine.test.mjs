import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const productionScript = resolve(repositoryRoot, 'scripts/link-wallpaper-engine.ps1');

test('creates the development junction and accepts the same junction again', { skip: process.platform !== 'win32' }, () => {
  withSyntheticRepository(({ destination, dist, run }) => {
    const first = run();
    assert.equal(first.status, 0, first.stderr);
    assert.equal(lstatSync(destination).isSymbolicLink(), true);
    assert.equal(realpathSync.native(destination), realpathSync.native(dist));

    const second = run();
    assert.equal(second.status, 0, second.stderr);
  });
});

const hasShortNameAlias = (shortPath, longPath, required) => {
  assert.ok(shortPath, 'Windows short-name capability probe returned no path');
  if (shortPath !== longPath) return true;
  assert.equal(required, false, 'This CI run requires a real 8.3 alias; the temporary volume does not provide one');
  return false;
};

test('separates missing 8.3 capability from required CI coverage', () => {
  assert.equal(hasShortNameAlias('same-path', 'same-path', false), false);
  assert.throws(() => hasShortNameAlias('same-path', 'same-path', true), /requires a real 8.3 alias/);
  assert.equal(hasShortNameAlias('short-path', 'long-path', true), true);
  assert.throws(() => hasShortNameAlias('', 'long-path', false), /returned no path/);
});

test('accepts an existing junction whose target uses an actual Windows short name', { skip: process.platform !== 'win32' }, (t) => {
  withSyntheticRepository(({ destination, dist, run }) => {
    const short = spawnSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      '(New-Object -ComObject Scripting.FileSystemObject).GetFolder($env:LINK_TEST_DIST).ShortPath'
    ], { encoding: 'utf8', env: { ...process.env, LINK_TEST_DIST: dist } });
    assert.equal(short.status, 0, short.stderr);
    const shortDist = short.stdout.trim();
    const required = process.env.GITHUB_ACTIONS === 'true' || process.env.SPOTIFY_REQUIRE_83_ALIAS === 'true';
    if (!hasShortNameAlias(shortDist, realpathSync.native(dist), required)) {
      t.skip('No 8.3 alias on this temporary volume; ordinary junction checks still run');
      return;
    }
    t.diagnostic('Actual Windows 8.3 alias available and exercised');
    symlinkSync(shortDist, destination, 'junction');
    assert.equal(realpathSync.native(destination), realpathSync.native(shortDist));
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = run();
      assert.equal(result.status, 0, result.stderr);
    }
    // Run through the short repository spelling as well as the long spelling.
    const result = run(resolve(shortDist, '../../../scripts/link-wallpaper-engine.ps1'));
    assert.equal(result.status, 0, result.stderr);
  });
});

test('does not replace a junction to a different directory', { skip: process.platform !== 'win32' }, () => {
  withSyntheticRepository(({ destination, dist, run }) => {
    const other = resolve(dist, '../other');
    mkdirSync(other);
    const marker = resolve(other, 'keep.txt');
    writeFileSync(marker, 'keep', 'utf8');
    symlinkSync(other, destination, 'junction');
    const result = run();
    assert.equal(result.status, 1);
    assert.equal(lstatSync(destination).isSymbolicLink(), true);
    assert.equal(realpathSync.native(destination), realpathSync.native(other));
    assert.equal(readFileSync(marker, 'utf8'), 'keep');
  });
});

test('does not overwrite an existing development directory', { skip: process.platform !== 'win32' }, () => {
  withSyntheticRepository(({ destination, run }) => {
    mkdirSync(destination);
    const marker = resolve(destination, 'keep.txt');
    writeFileSync(marker, 'keep', 'utf8');

    const result = run();

    assert.equal(result.status, 1);
    assert.equal(readFileSync(marker, 'utf8'), 'keep');
    assert.equal(lstatSync(destination).isDirectory(), true);
  });
});

test('does not create a junction when required build output is missing', { skip: process.platform !== 'win32' }, () => {
  withSyntheticRepository(({ destination, projectPath, run }) => {
    rmSync(projectPath);

    const result = run();

    assert.equal(result.status, 1);
    assert.equal(existsSync(destination), false);
  });
});

const withSyntheticRepository = (runTest) => {
  const root = mkdtempSync(resolve(tmpdir(), 'spotify-wallpaper-link-'));
  const scriptPath = resolve(root, 'scripts/link-wallpaper-engine.ps1');
  const dist = resolve(root, 'apps/wallpaper/dist');
  const projects = resolve(root, 'wallpaper-engine/projects/myprojects');
  const destination = resolve(projects, 'spotify-wallpaper-dev');
  const projectPath = resolve(dist, 'project.json');

  try {
    mkdirSync(dirname(scriptPath), { recursive: true });
    mkdirSync(dist, { recursive: true });
    mkdirSync(projects, { recursive: true });
    copyFileSync(productionScript, scriptPath);
    writeFileSync(resolve(dist, 'index.html'), '<!doctype html>', 'utf8');
    writeFileSync(projectPath, '{}', 'utf8');

    runTest({
      destination,
      dist,
      projectPath,
      run: (entry = scriptPath) => spawnSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', entry],
        {
          cwd: root,
          encoding: 'utf8',
          env: { ...process.env, WALLPAPER_ENGINE_PROJECTS_DIR: projects }
        }
      )
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};
