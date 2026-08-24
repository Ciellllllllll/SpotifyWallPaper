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
    assert.equal(realpathSync(destination), realpathSync(dist));

    const second = run();
    assert.equal(second.status, 0, second.stderr);
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
      run: () => spawnSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
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
