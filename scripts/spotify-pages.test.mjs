import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('Pages is opt-in, master-only and grants publish permissions only to deployment', () => {
  const workflow = readFileSync('.github/workflows/spotify-auth-pages.yml', 'utf8');
  assert.doesNotMatch(workflow, /pull_request:|workflow_dispatch:/);
  assert.match(workflow, /PAGES_DEPLOY_ENABLED == 'true'/);
  assert.match(workflow, /master: \$\{\{ steps\.branch\.outputs\.master \}\}/);
  assert.doesNotMatch(workflow, /outputs\.develop/);
  assert.match(workflow, /needs: \[release-branch, build\]/);
  assert.match(workflow, /playwright test --config playwright.auth.config.ts/);
  assert.match(readFileSync('playwright.auth.config.ts', 'utf8'), /testMatch: 'spotify-auth.spec.ts'/);
  assert.equal(workflow.match(/if: needs\.release-branch\.outputs\.master == 'true' && vars\.PAGES_DEPLOY_ENABLED == 'true'/g)?.length, 2);
  assert.match(readFileSync('.github/workflows/ci.yml', 'utf8'), /direct-credentials.spec.ts/);
  assert.match(workflow, /environment:\s+name: github-pages/);
  assert.doesNotMatch(workflow, /pull_request_target|\$\{\{\s*secrets\.|SPOTIFY_CLIENT_ID/);
  const [build, deploy] = workflow.split('\n  deploy:');
  assert.doesNotMatch(build, /pages: write|id-token: write/);
  assert.match(deploy, /pages: write/);
  assert.match(deploy, /id-token: write/);
  for (const name of ['configure-pages', 'upload-pages-artifact', 'deploy-pages']) assert.match(workflow, new RegExp(`actions/${name}@[a-f0-9]{40}`));
});

test('both workflows require release tag pushes and gate all verification jobs', () => {
  for (const file of ['ci.yml', 'spotify-auth-pages.yml']) {
    const workflow = readFileSync(`.github/workflows/${file}`, 'utf8');
    assert.match(workflow, /on:\s+push:\s+tags: \['release-\*'\]\s/);
    assert.doesNotMatch(workflow, /pull_request:|workflow_dispatch:|branches:|paths:/);
    assert.match(workflow, /if: github.event.deleted == false/);
    assert.match(workflow, /fetch-depth: 0/);
    const jobs = file === 'ci.yml' ? ['web', 'rust', 'tauri', 'loopback'] : ['build'];
    for (const job of jobs) assert.match(workflow, new RegExp(`  ${job}:\\s+needs: release-branch`));
  }
});

test('release branch gate accepts develop/master ancestry and rejects unrelated commits', () => {
  const scripts = ['ci.yml', 'spotify-auth-pages.yml'].map(file => {
    const workflow = readFileSync(`.github/workflows/${file}`, 'utf8');
    const match = workflow.match(/id: branch\s+shell: pwsh\s+run: \|\n((?: {10}.+\n)+)/);
    assert.ok(match, 'branch gate script exists');
    return match[1].replace(/^ {10}/gm, '');
  });
  assert.equal(scripts[0], scripts[1]);
  const dir = mkdtempSync(join(tmpdir(), 'swp-release-gate-'));
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  try {
    git('init', '--quiet');
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'base');
    const base = git('rev-parse', 'HEAD');
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'release');
    const release = git('rev-parse', 'HEAD');
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'tag', '-a', 'release-v1.0.0', '-m', 'release');
    git('checkout', '--detach', 'release-v1.0.0');
    const output = join(dir, 'output');
    for (const [branch, target, expected] of [['feature', release, 1], ['master', release, 0], ['develop', release, 0], ['develop', base, 1]]) {
      git('update-ref', `refs/remotes/origin/${branch}`, target);
      writeFileSync(output, '');
      const result = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', scripts[0]], {
        cwd: dir, encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: output }
      });
      assert.equal(result.status, expected, result.stderr);
      if (expected === 0) assert.match(readFileSync(output, 'utf8'), new RegExp(`master=${branch === 'master'}`));
      git('update-ref', '-d', `refs/remotes/origin/${branch}`);
    }
    // An older tagged commit is also eligible once contained in an allowed branch.
    git('update-ref', 'refs/remotes/origin/master', release);
    git('checkout', '--detach', base);
    assert.equal(spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', scripts[0]], {
      cwd: dir, env: { ...process.env, GITHUB_OUTPUT: output }
    }).status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('normal product build/check/test exclude optional applications without removing their gates', () => {
  const { scripts } = JSON.parse(readFileSync('package.json', 'utf8'));
  for (const name of ['build', 'check', 'test']) {
    assert.doesNotMatch(scripts[name], /public-backend|configurator|--workspaces/);
    assert.ok(scripts[`${name}:optional`]);
  }
});

test('migration evidence is classified without changing historical byte exceptions', () => {
  const policy = JSON.parse(readFileSync('config/repository-authority.json', 'utf8'));
  const path = 'docs/phase-reports/github-pages-direct-migration.md';
  const groups = policy.documentGroups.filter(group => group.paths.includes(path));
  assert.equal(groups.length, 1);
  assert.equal(groups[0].classification, 'historical-evidence');
  assert.doesNotMatch(readFileSync('.gitattributes', 'utf8'), /github-pages-direct-migration/);
  assert.match(readFileSync('docs/phase-reports/README.md', 'utf8'), /github-pages-direct-migration/);
});


test('retired hosted backend is absent while optional configurator gates remain', () => {
  const { scripts } = JSON.parse(readFileSync('package.json', 'utf8'));
  for (const name of ['build', 'check', 'test']) {
    assert.match(scripts[`${name}:optional`], /configurator/);
    assert.doesNotMatch(scripts[`${name}:optional`], /public-backend/);
  }
  for (const path of ['apps/public-backend/package.json', 'deploy/public-backend/systemd/swp-public-backend.service', '.github/workflows/cloudflare-worker-ci.yml', 'scripts/build-public-backend-artifact.mjs']) assert.equal(existsSync(path), false);
  assert.ok(existsSync('apps/backend/Cargo.toml'));
  assert.ok(existsSync('scripts/check-public-backend-secrets.mjs'));
});


test('retired backend runbooks are historical while the retirement contract stays normative', () => {
  const policy = JSON.parse(readFileSync('config/repository-authority.json', 'utf8'));
  const retired = policy.documentGroups.find(group => group.name === 'retired-backend-documents');
  assert.equal(retired.classification, 'historical-evidence');
  assert.equal(retired.paths.length, 1);
  assert.ok(retired.paths.includes('docs/eula.md'));
  assert.ok(policy.documentGroups.some(group => group.classification === 'normative' && group.paths.includes('docs/25-public-backend.md')));
});
