import { pathToFileURL } from 'node:url';

import {
  collectRepositorySnapshot,
  evaluateRepositoryAuthority,
  formatRepositoryAuthorityFindings,
  loadRepositoryAuthorityPolicy,
  validateRepositoryAuthorityPolicy,
} from './repository-authority.mjs';
import { preservationPolicyMatchesFixedPaths } from './repository-preservation.mjs';

/**
 * @typedef {object} WritableOutput
 * @property {(value: string) => unknown} write
 */

/**
 * @typedef {object} MainOptions
 * @property {string} repositoryRoot
 * @property {WritableOutput} stdout
 * @property {WritableOutput} stderr
 */

/**
 * @param {Partial<MainOptions>} [options]
 * @returns {Promise<number>}
 */
export async function main(
  options = {
    repositoryRoot: process.cwd(),
    stdout: process.stdout,
    stderr: process.stderr,
  },
) {
  const repositoryRoot = options?.repositoryRoot ?? process.cwd();
  const stdout = options?.stdout ?? process.stdout;
  const stderr = options?.stderr ?? process.stderr;
  if (
    typeof repositoryRoot !== 'string' ||
    typeof stdout?.write !== 'function' ||
    typeof stderr?.write !== 'function'
  ) {
    const diagnosticOutput =
      typeof stderr?.write === 'function' ? stderr : process.stderr;
    diagnosticOutput.write('REPOSITORY_CHECK_ARGUMENT_INVALID .\n');
    return 2;
  }

  let findings;
  try {
    const policy = await loadRepositoryAuthorityPolicy(repositoryRoot);
    findings = validateRepositoryAuthorityPolicy(policy);
    if (
      findings.length === 0 &&
      !preservationPolicyMatchesFixedPaths(policy)
    ) {
      findings = [
        {
          check: 'policy',
          code: 'POLICY_METADATA_INVALID',
          path: 'config/repository-authority.json',
        },
      ];
    }
    if (findings.length === 0) {
      const snapshot = await collectRepositorySnapshot(
        repositoryRoot,
        policy,
      );
      findings = evaluateRepositoryAuthority(policy, snapshot);
    }
  } catch {
    findings = [
      {
        check: 'policy',
        code: 'POLICY_READ_FAILED',
        path: 'config/repository-authority.json',
      },
    ];
  }
  if (findings.length === 0) {
    stdout.write('Repository authority: PASS\n');
    return 0;
  }
  stdout.write(`${formatRepositoryAuthorityFindings(findings)}\n`);
  return 1;
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = await main();
}
