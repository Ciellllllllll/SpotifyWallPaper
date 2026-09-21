import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('Pages is opt-in, develop-only and grants publish permissions only to deployment', () => {
  const workflow = readFileSync('.github/workflows/spotify-auth-pages.yml', 'utf8');
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /PAGES_DEPLOY_ENABLED == 'true'/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/develop'/);
  assert.match(workflow, /github\.event_name != 'pull_request'/);
  assert.match(workflow, /needs: build/);
  assert.match(workflow, /playwright test --config playwright.auth.config.ts/);
  assert.match(workflow, /tests\/playwright\/spotify-auth.spec.ts/);
  assert.match(readFileSync('.github/workflows/ci.yml', 'utf8'), /direct-credentials.spec.ts/);
  assert.match(workflow, /environment:\s+name: github-pages/);
  assert.doesNotMatch(workflow, /pull_request_target|\$\{\{\s*secrets\.|SPOTIFY_CLIENT_ID/);
  const [build, deploy] = workflow.split('\n  deploy:');
  assert.doesNotMatch(build, /pages: write|id-token: write/);
  assert.match(deploy, /pages: write/);
  assert.match(deploy, /id-token: write/);
  for (const name of ['configure-pages', 'upload-pages-artifact', 'deploy-pages']) assert.match(workflow, new RegExp(`actions/${name}@[a-f0-9]{40}`));
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
