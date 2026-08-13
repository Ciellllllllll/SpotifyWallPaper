import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import {
  access as accessFile,
  lstat as lstatFile,
  open as openFile,
  opendir as openDirectory,
  realpath as resolveRealPath,
} from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

/**
 * @typedef {object} GitIndexEntry
 * @property {string} mode
 * @property {string} oid
 * @property {number} stage
 */

/**
 * @typedef {object} Finding
 * @property {'repository'|'policy'|'required-document'|'markdown'|'ignore-policy'|'generated-source'} check
 * @property {string} code
 * @property {string} path
 */

/**
 * @typedef {object} DocumentGroup
 * @property {string} name
 * @property {'normative'|'operational'|'historical-evidence'|'implementation-plan'} classification
 * @property {string[]} paths
 */

/**
 * @typedef {object} IgnoredArtifact
 * @property {string} ignorePattern
 * @property {string} probePath
 * @property {'dependency-cache'|'generated-output'|'local-secret'|'local-evidence'|'local-tool-state'|'local-archive'} classification
 * @property {string} owner
 * @property {string} producer
 * @property {string[]} sourceInputs
 */

/**
 * @typedef {object} TrackedIgnoreException
 * @property {string} ignorePattern
 * @property {string} probePath
 */

/**
 * @typedef {object} TrackedGeneratedSource
 * @property {string} path
 * @property {string} owner
 * @property {string} producer
 * @property {string[]} sourceInputs
 * @property {string} verificationCommand
 */

/**
 * @typedef {object} PreservationPolicy
 * @property {string} rawByteAttributesFile
 * @property {string[]} recoveredDocuments
 * @property {string[]} staticLocalPaths
 */

/**
 * @typedef {object} RepositoryAuthorityPolicy
 * @property {number} schemaVersion
 * @property {string[]} markdownRoots
 * @property {DocumentGroup[]} documentGroups
 * @property {IgnoredArtifact[]} ignoredArtifacts
 * @property {TrackedIgnoreException[]} trackedIgnoreExceptions
 * @property {TrackedGeneratedSource[]} trackedGeneratedSources
 * @property {PreservationPolicy} preservation
 */

/**
 * @typedef {object} RepositorySnapshot
 * @property {Set<string>} existingPaths
 * @property {Set<string>} symlinkPaths
 * @property {Map<string, GitIndexEntry>} trackedEntries
 * @property {Set<string>} trackedIgnoredPaths
 * @property {Set<string>} markdownPaths
 * @property {string[]} gitignoreRules
 * @property {Set<string>} ignoredProbePaths
 * @property {Finding[]} inspectionFindings
 */

/**
 * @typedef {object} GitInspectionResult
 * @property {number} exitCode
 * @property {Buffer} stdout
 * @property {Buffer} stderr
 */

/**
 * @typedef {object} RepositoryInspectionDependencies
 * @property {(repositoryRoot: string, args: string[], stdin?: Buffer|null) => Promise<GitInspectionResult>} runGit
 * @property {(absolutePath: string) => Promise<import('node:fs').Stats>} lstat
 * @property {(absolutePath: string) => Promise<import('node:fs').Dirent[]>} readdir
 * @property {(absolutePath: string) => Promise<string>} realpath
 * @property {(absolutePath: string, stats: import('node:fs').Stats) => Promise<boolean>} isReparsePoint
 * @property {(absolutePath: string, expectedStats: import('node:fs').Stats) => Promise<Buffer>} readGitignore
 * @property {(absolutePath: string, expectedStats: import('node:fs').Stats) => Promise<Buffer>} readPolicy
 * @property {Partial<typeof REPOSITORY_TRAVERSAL_LIMITS>} [traversalLimits]
 */

/**
 * @typedef {object} ReparseQueryDependencies
 * @property {() => Promise<string>} resolveExecutable
 * @property {typeof spawn} spawnProcess
 * @property {number} timeoutMs
 */

const CONTROL_OR_BIDI_PATTERN =
  /[\u0000-\u001f\u007f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;
const WINDOWS_RESERVED_CHARACTER_PATTERN = /[<>:"|?*]/u;
const WINDOWS_DEVICE_STEM_PATTERN =
  /^(?:CON|PRN|AUX|NUL|COM(?:[1-9¹²³])|LPT(?:[1-9¹²³]))$/iu;

function isUnsafeWindowsComponent(component) {
  if (
    component.length === 0 ||
    component === '.' ||
    component === '..' ||
    component.endsWith('.') ||
    component.endsWith(' ') ||
    CONTROL_OR_BIDI_PATTERN.test(component) ||
    WINDOWS_RESERVED_CHARACTER_PATTERN.test(component)
  ) {
    return true;
  }

  const stem = component.split('.', 1)[0];
  return WINDOWS_DEVICE_STEM_PATTERN.test(stem);
}

/**
 * @param {string} input
 * @returns {string}
 */
export function normalizeDiscoveredRepositoryPath(input) {
  if (
    typeof input !== 'string' ||
    input.length === 0 ||
    input.startsWith('/') ||
    input.startsWith('\\') ||
    /^[A-Za-z]:/u.test(input)
  ) {
    throw new TypeError('Unsafe repository path.');
  }

  let normalized = input.replaceAll('\\', '/');
  while (normalized.startsWith('./')) {
    normalized = normalized.slice(2);
  }

  const components = normalized.split('/');
  if (
    normalized.length === 0 ||
    components.some((component) => isUnsafeWindowsComponent(component))
  ) {
    throw new TypeError('Unsafe repository path.');
  }

  return normalized;
}

/**
 * @param {string} input
 * @returns {string}
 */
export function repositoryPathId(input) {
  if (typeof input !== 'string') {
    throw new TypeError('Repository path must be a string.');
  }
  return `@sha256:${createHash('sha256').update(Buffer.from(input, 'utf8')).digest('hex')}`;
}

/**
 * @param {string} input
 * @returns {boolean}
 */
export function validateCanonicalRepositoryPath(input) {
  if (typeof input !== 'string' || input.includes('\\')) {
    return false;
  }

  try {
    return normalizeDiscoveredRepositoryPath(input) === input;
  } catch {
    return false;
  }
}

/**
 * @param {string} input
 * @param {boolean} expectedNegated
 * @returns {boolean}
 */
export function validateGitignoreRule(input, expectedNegated) {
  if (
    typeof input !== 'string' ||
    typeof expectedNegated !== 'boolean' ||
    CONTROL_OR_BIDI_PATTERN.test(input) ||
    input.includes('\\')
  ) {
    return false;
  }

  const prefix = expectedNegated ? '!/' : '/';
  if (!input.startsWith(prefix) || (!expectedNegated && input.startsWith('!/'))) {
    return false;
  }

  const body = input.slice(prefix.length);
  if (body.length === 0 || body.includes('!') || body.includes(':')) {
    return false;
  }

  const components = body.endsWith('/')
    ? body.slice(0, -1).split('/')
    : body.split('/');
  if (components.some((component) => component.length === 0)) {
    return false;
  }

  for (const component of components) {
    if (
      component === '.' ||
      component === '..' ||
      component.endsWith('.') ||
      component.endsWith(' ')
    ) {
      return false;
    }
    if (!/^[\p{L}\p{N}._*{}-]+$/u.test(component)) {
      return false;
    }
    const literalStem = component
      .split('.', 1)[0]
      .replace(/[*{}]/gu, '');
    if (
      literalStem.length > 0 &&
      WINDOWS_DEVICE_STEM_PATTERN.test(literalStem)
    ) {
      return false;
    }
    if (!component.includes('*') && isUnsafeWindowsComponent(component)) {
      return false;
    }
  }

  return true;
}

/**
 * @param {Buffer} input
 * @returns {Map<string, GitIndexEntry>}
 */
export function parseNullSeparatedIndexEntries(input) {
  const fail = () => {
    throw new TypeError('Invalid Git index output.');
  };
  if (!Buffer.isBuffer(input)) {
    fail();
  }
  if (input.length === 0) {
    return new Map();
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

  const entries = new Map();
  let objectIdLength;
  for (const record of decoded.slice(0, -1).split('\0')) {
    const match =
      /^(?<mode>[0-9]{6}) (?<oid>[0-9a-f]+) (?<stage>[0-3])\t(?<path>.+)$/u.exec(
        record,
      );
    if (match?.groups === undefined || match.groups.stage !== '0') {
      fail();
    }

    const { mode, oid } = match.groups;
    if (
      (oid.length !== 40 && oid.length !== 64) ||
      (objectIdLength !== undefined && objectIdLength !== oid.length)
    ) {
      fail();
    }
    objectIdLength = oid.length;

    let repositoryPath;
    try {
      repositoryPath = normalizeDiscoveredRepositoryPath(match.groups.path);
    } catch {
      fail();
    }
    if (entries.has(repositoryPath)) {
      fail();
    }
    entries.set(repositoryPath, { mode, oid, stage: 0 });
  }

  return entries;
}

const DOCUMENT_CLASSIFICATIONS = new Set([
  'normative',
  'operational',
  'historical-evidence',
  'implementation-plan',
]);
const ARTIFACT_CLASSIFICATIONS = new Set([
  'dependency-cache',
  'generated-output',
  'local-secret',
  'local-evidence',
  'local-tool-state',
  'local-archive',
]);
const LOCAL_ARTIFACT_CLASSIFICATIONS = new Set([
  'local-secret',
  'local-evidence',
  'local-tool-state',
  'local-archive',
]);
const REPOSITORY_CONTROL_PATHS = Object.freeze([
  '.gitattributes',
  '.gitignore',
  'config/repository-authority.json',
]);

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function hasExactKeys(value, expectedKeys) {
  if (!isPlainObject(value)) {
    return false;
  }
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function isNonblankString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isUniqueArray(values, normalize = (value) => value) {
  if (!Array.isArray(values)) {
    return false;
  }
  const normalized = values.map(normalize);
  return new Set(normalized).size === normalized.length;
}

function policyInvalidFinding() {
  return {
    check: 'policy',
    code: 'POLICY_METADATA_INVALID',
    path: 'config/repository-authority.json',
  };
}

/**
 * @param {RepositoryAuthorityPolicy} policy
 * @returns {Finding[]}
 */
export function validateRepositoryAuthorityPolicy(policy) {
  const invalid = () => [policyInvalidFinding()];
  if (
    !hasExactKeys(policy, [
      'schemaVersion',
      'markdownRoots',
      'documentGroups',
      'ignoredArtifacts',
      'trackedIgnoreExceptions',
      'trackedGeneratedSources',
      'preservation',
    ]) ||
    policy.schemaVersion !== 1 ||
    !Array.isArray(policy.markdownRoots) ||
    policy.markdownRoots.length !== 1 ||
    policy.markdownRoots[0] !== 'docs' ||
    !isUniqueArray(policy.markdownRoots) ||
    policy.markdownRoots.some(
      (repositoryPath) => !validateCanonicalRepositoryPath(repositoryPath),
    ) ||
    !Array.isArray(policy.documentGroups) ||
    !Array.isArray(policy.ignoredArtifacts) ||
    !Array.isArray(policy.trackedIgnoreExceptions) ||
    !Array.isArray(policy.trackedGeneratedSources) ||
    !hasExactKeys(policy.preservation, [
      'rawByteAttributesFile',
      'recoveredDocuments',
      'staticLocalPaths',
    ])
  ) {
    return invalid();
  }

  const documentPaths = [];
  const documentGroupNames = [];
  for (const group of policy.documentGroups) {
    if (
      !hasExactKeys(group, ['name', 'classification', 'paths']) ||
      !isNonblankString(group.name) ||
      !DOCUMENT_CLASSIFICATIONS.has(group.classification) ||
      !Array.isArray(group.paths) ||
      group.paths.length === 0 ||
      !isUniqueArray(group.paths) ||
      group.paths.some(
        (repositoryPath) =>
          !validateCanonicalRepositoryPath(repositoryPath) ||
          !repositoryPath.toLocaleLowerCase('en-US').endsWith('.md'),
      )
    ) {
      return invalid();
    }
    documentGroupNames.push(group.name);
    documentPaths.push(...group.paths);
  }
  if (
    !isUniqueArray(documentGroupNames) ||
    !isUniqueArray(documentPaths) ||
    !(
      documentPaths.filter(
        (repositoryPath) => !repositoryPath.startsWith('docs/'),
      ).length === 2 &&
      documentPaths.includes('AGENTS.md') &&
      documentPaths.includes('README.md')
    )
  ) {
    return invalid();
  }

  const ignoreRules = [];
  const probePaths = [];
  const policyPaths = [
    ...policy.markdownRoots,
    ...documentPaths,
  ];
  for (const artifact of policy.ignoredArtifacts) {
    if (
      !hasExactKeys(artifact, [
        'ignorePattern',
        'probePath',
        'classification',
        'owner',
        'producer',
        'sourceInputs',
      ]) ||
      !validateGitignoreRule(artifact.ignorePattern, false) ||
      !validateCanonicalRepositoryPath(artifact.probePath) ||
      !ARTIFACT_CLASSIFICATIONS.has(artifact.classification) ||
      !isNonblankString(artifact.owner) ||
      !isNonblankString(artifact.producer) ||
      !Array.isArray(artifact.sourceInputs) ||
      !isUniqueArray(artifact.sourceInputs) ||
      artifact.sourceInputs.some(
        (repositoryPath) => !validateCanonicalRepositoryPath(repositoryPath),
      ) ||
      (!LOCAL_ARTIFACT_CLASSIFICATIONS.has(artifact.classification) &&
        artifact.sourceInputs.length === 0)
    ) {
      return invalid();
    }
    ignoreRules.push(artifact.ignorePattern);
    probePaths.push(artifact.probePath);
    policyPaths.push(artifact.probePath, ...artifact.sourceInputs);
  }

  for (const exception of policy.trackedIgnoreExceptions) {
    if (
      !hasExactKeys(exception, ['ignorePattern', 'probePath']) ||
      !validateGitignoreRule(exception.ignorePattern, true) ||
      !validateCanonicalRepositoryPath(exception.probePath)
    ) {
      return invalid();
    }
    ignoreRules.push(exception.ignorePattern);
    probePaths.push(exception.probePath);
    policyPaths.push(exception.probePath);
  }

  const generatedPaths = [];
  for (const generated of policy.trackedGeneratedSources) {
    if (
      !hasExactKeys(generated, [
        'path',
        'owner',
        'producer',
        'sourceInputs',
        'verificationCommand',
      ]) ||
      !validateCanonicalRepositoryPath(generated.path) ||
      !isNonblankString(generated.owner) ||
      !isNonblankString(generated.producer) ||
      !isNonblankString(generated.verificationCommand) ||
      !Array.isArray(generated.sourceInputs) ||
      generated.sourceInputs.length === 0 ||
      !isUniqueArray(generated.sourceInputs) ||
      generated.sourceInputs.some(
        (repositoryPath) => !validateCanonicalRepositoryPath(repositoryPath),
      )
    ) {
      return invalid();
    }
    generatedPaths.push(generated.path);
    policyPaths.push(generated.path, ...generated.sourceInputs);
  }

  const { preservation } = policy;
  if (
    preservation.rawByteAttributesFile !== '.gitattributes' ||
    !Array.isArray(preservation.recoveredDocuments) ||
    !Array.isArray(preservation.staticLocalPaths) ||
    preservation.recoveredDocuments.length === 0 ||
    preservation.staticLocalPaths.length === 0 ||
    !isUniqueArray(preservation.recoveredDocuments) ||
    !isUniqueArray(preservation.staticLocalPaths) ||
    preservation.recoveredDocuments.some(
      (repositoryPath) => !validateCanonicalRepositoryPath(repositoryPath),
    ) ||
    preservation.staticLocalPaths.some(
      (repositoryPath) => !validateCanonicalRepositoryPath(repositoryPath),
    ) ||
    preservation.recoveredDocuments.some(
      (repositoryPath) => !documentPaths.includes(repositoryPath),
    ) ||
    preservation.staticLocalPaths.some((repositoryPath) =>
      preservation.recoveredDocuments.includes(repositoryPath),
    ) ||
    !isUniqueArray(ignoreRules) ||
    !isUniqueArray(probePaths) ||
    !isUniqueArray(generatedPaths)
  ) {
    return invalid();
  }
  policyPaths.push(
    preservation.rawByteAttributesFile,
    ...preservation.recoveredDocuments,
    ...preservation.staticLocalPaths,
  );

  const caseFoldedPaths = new Map();
  for (const repositoryPath of policyPaths) {
    const folded = repositoryPath.toLocaleLowerCase('en-US');
    const prior = caseFoldedPaths.get(folded);
    if (prior !== undefined && prior !== repositoryPath) {
      return invalid();
    }
    caseFoldedPaths.set(folded, repositoryPath);
  }

  return [];
}

function sortAndDedupeFindings(findings) {
  const unique = new Map();
  for (const finding of findings) {
    unique.set(
      `${finding.check}\0${finding.code}\0${finding.path}`,
      finding,
    );
  }
  return [...unique.values()].sort(
    (left, right) =>
      left.path.localeCompare(right.path, 'en') ||
      left.code.localeCompare(right.code, 'en') ||
      left.check.localeCompare(right.check, 'en'),
  );
}

function pathFinding(check, code, repositoryPath) {
  return {
    check,
    code,
    path: repositoryPathId(repositoryPath),
  };
}

/**
 * @param {RepositoryAuthorityPolicy} policy
 * @param {RepositorySnapshot} snapshot
 * @returns {Finding[]}
 */
export function evaluateRepositoryAuthority(policy, snapshot) {
  const inspectionFindings = [...(snapshot?.inspectionFindings ?? [])];
  if (inspectionFindings.length > 0) {
    return sortAndDedupeFindings(inspectionFindings);
  }
  const findings = [];
  const documentPaths = (policy?.documentGroups ?? []).flatMap(
    (group) => group.paths ?? [],
  );
  const classifiedDocuments = new Set(documentPaths);
  const markdownRoots = policy?.markdownRoots ?? [];
  const trackedMarkdownRootPaths = [...(snapshot.trackedEntries?.keys() ?? [])].filter(
    (repositoryPath) => {
      const foldedPath = repositoryPath.toLocaleLowerCase('en-US');
      return markdownRoots.some((markdownRoot) => {
        const foldedRoot = markdownRoot.toLocaleLowerCase('en-US');
        return (
          foldedPath === foldedRoot ||
          foldedPath.startsWith(`${foldedRoot}/`)
        );
      });
    },
  );
  const discoveredMarkdownPaths = new Set([
    ...(snapshot.markdownPaths ?? []),
    ...trackedMarkdownRootPaths.filter((repositoryPath) =>
      repositoryPath.toLocaleLowerCase('en-US').endsWith('.md'),
    ),
  ]);

  for (const controlPath of REPOSITORY_CONTROL_PATHS) {
    if (!snapshot.existingPaths.has(controlPath)) {
      findings.push(
        pathFinding('repository', 'AUTHORITY_INPUT_MISSING', controlPath),
      );
    } else if (!snapshot.trackedEntries.has(controlPath)) {
      findings.push(
        pathFinding('repository', 'AUTHORITY_INPUT_UNTRACKED', controlPath),
      );
    }
    if (snapshot.trackedIgnoredPaths.has(controlPath)) {
      findings.push(
        pathFinding('repository', 'AUTHORITY_INPUT_IGNORED', controlPath),
      );
    }
  }

  for (const documentPath of documentPaths) {
    if (!snapshot.existingPaths.has(documentPath)) {
      findings.push(
        pathFinding(
          'required-document',
          'REQUIRED_DOCUMENT_MISSING',
          documentPath,
        ),
      );
      continue;
    }
    if (!snapshot.trackedEntries.has(documentPath)) {
      findings.push(
        pathFinding(
          'required-document',
          'REQUIRED_DOCUMENT_UNTRACKED',
          documentPath,
        ),
      );
    }
    if (snapshot.trackedIgnoredPaths.has(documentPath)) {
      findings.push(
        pathFinding(
          'required-document',
          'AUTHORITY_IS_IGNORED',
          documentPath,
        ),
      );
    }
  }

  for (const markdownPath of discoveredMarkdownPaths) {
    if (!snapshot.trackedEntries.has(markdownPath)) {
      findings.push(
        pathFinding('markdown', 'MARKDOWN_UNTRACKED', markdownPath),
      );
    }
    if (!classifiedDocuments.has(markdownPath)) {
      findings.push(
        pathFinding('markdown', 'MARKDOWN_UNCLASSIFIED', markdownPath),
      );
    }
  }

  const policyIgnoreRules = new Set([
    ...(policy.ignoredArtifacts ?? []).map((item) => item.ignorePattern),
    ...(policy.trackedIgnoreExceptions ?? []).map(
      (item) => item.ignorePattern,
    ),
  ]);
  const repositoryIgnoreRules = new Set(snapshot.gitignoreRules ?? []);
  for (const rule of repositoryIgnoreRules) {
    if (!policyIgnoreRules.has(rule)) {
      findings.push({
        check: 'ignore-policy',
        code: 'IGNORE_RULE_UNDOCUMENTED',
        path: '.gitignore',
      });
    }
  }
  for (const rule of policyIgnoreRules) {
    if (!repositoryIgnoreRules.has(rule)) {
      findings.push({
        check: 'ignore-policy',
        code: 'IGNORE_RULE_MISSING',
        path: '.gitignore',
      });
    }
  }

  for (const artifact of policy.ignoredArtifacts ?? []) {
    if (!snapshot.ignoredProbePaths.has(artifact.probePath)) {
      findings.push(
        pathFinding(
          'ignore-policy',
          'IGNORED_ARTIFACT_EXPOSED',
          artifact.probePath,
        ),
      );
    }
  }
  for (const exception of policy.trackedIgnoreExceptions ?? []) {
    if (snapshot.ignoredProbePaths.has(exception.probePath)) {
      findings.push(
        pathFinding(
          'ignore-policy',
          'TRACKED_EXCEPTION_IGNORED',
          exception.probePath,
        ),
      );
    }
  }

  for (const generated of policy.trackedGeneratedSources ?? []) {
    if (!snapshot.existingPaths.has(generated.path)) {
      findings.push(
        pathFinding(
          'generated-source',
          'TRACKED_GENERATED_MISSING',
          generated.path,
        ),
      );
    } else if (!snapshot.trackedEntries.has(generated.path)) {
      findings.push(
        pathFinding(
          'generated-source',
          'TRACKED_GENERATED_UNTRACKED',
          generated.path,
        ),
      );
    }
    if (snapshot.trackedIgnoredPaths.has(generated.path)) {
      findings.push(
        pathFinding(
          'generated-source',
          'TRACKED_GENERATED_IGNORED',
          generated.path,
        ),
      );
    }
  }

  const sourceInputPaths = new Set([
    ...(policy.ignoredArtifacts ?? []).flatMap(
      (artifact) => artifact.sourceInputs ?? [],
    ),
    ...(policy.trackedGeneratedSources ?? []).flatMap(
      (generated) => generated.sourceInputs ?? [],
    ),
  ]);
  for (const sourceInput of sourceInputPaths) {
    if (!snapshot.existingPaths.has(sourceInput)) {
      findings.push(
        pathFinding(
          'repository',
          'TRACKED_SOURCE_INPUT_MISSING',
          sourceInput,
        ),
      );
    } else if (!snapshot.trackedEntries.has(sourceInput)) {
      findings.push(
        pathFinding(
          'repository',
          'TRACKED_SOURCE_INPUT_UNTRACKED',
          sourceInput,
        ),
      );
    }
  }

  const authorityPaths = new Set([
    ...REPOSITORY_CONTROL_PATHS,
    ...documentPaths,
    ...discoveredMarkdownPaths,
    ...trackedMarkdownRootPaths,
    policy.preservation?.rawByteAttributesFile,
    ...(policy.preservation?.recoveredDocuments ?? []),
    ...sourceInputPaths,
    ...(policy.trackedGeneratedSources ?? []).map(
      (generated) => generated.path,
    ),
  ]);
  authorityPaths.delete(undefined);

  for (const safetyPath of snapshot.symlinkPaths ?? []) {
    findings.push(
      pathFinding('repository', 'AUTHORITY_SYMLINK', safetyPath),
    );
  }
  for (const authorityPath of authorityPaths) {
    const tracked = snapshot.trackedEntries.get(authorityPath);
    if (
      tracked !== undefined &&
      tracked.mode !== '100644' &&
      tracked.mode !== '100755'
    ) {
      findings.push(
        pathFinding('repository', 'TRACKED_PATH_UNSAFE_MODE', authorityPath),
      );
    }
  }

  for (const trackedIgnoredPath of snapshot.trackedIgnoredPaths ?? []) {
    findings.push(
      pathFinding('repository', 'TRACKED_PATH_IGNORED', trackedIgnoredPath),
    );
  }

  return sortAndDedupeFindings(findings);
}

const MAX_GIT_OUTPUT_BYTES = 16 * 1024 * 1024;
const MAX_GIT_INSPECTION_MS = 10_000;
const MAX_POLICY_BYTES = 4 * 1024 * 1024;
const REPOSITORY_TRAVERSAL_LIMITS = Object.freeze({
  maxDepth: 64,
  maxEntriesPerDirectory: 1_024,
  maxEntries: 2_048,
  maxPathBytes: 4_096,
  maxAggregatePathBytes: 16 * 1024 * 1024,
});
const MAX_REPARSE_QUERIES = 256;
const MAX_REPARSE_ELAPSED_MS = 15_000;

function boundedTraversalLimits(overrides) {
  if (overrides === undefined) {
    return REPOSITORY_TRAVERSAL_LIMITS;
  }
  if (
    overrides === null ||
    typeof overrides !== 'object' ||
    Array.isArray(overrides)
  ) {
    throw new TypeError('Invalid traversal limits.');
  }
  const limits = {};
  for (const [name, maximum] of Object.entries(
    REPOSITORY_TRAVERSAL_LIMITS,
  )) {
    const candidate = overrides[name] ?? maximum;
    if (!Number.isSafeInteger(candidate) || candidate < 0) {
      throw new TypeError('Invalid traversal limits.');
    }
    limits[name] = Math.min(candidate, maximum);
  }
  return limits;
}

function fixedInspectionFinding(code = 'REPOSITORY_INSPECTION_FAILED') {
  return { check: 'repository', code, path: '.' };
}

export function createBoundedReparseInspector(
  queryReparsePoint,
  options = {},
) {
  if (typeof queryReparsePoint !== 'function') {
    throw new TypeError('Invalid reparse query.');
  }
  const now = options.now ?? (() => performance.now());
  const maxQueries = Math.min(
    options.maxQueries ?? MAX_REPARSE_QUERIES,
    MAX_REPARSE_QUERIES,
  );
  const maxElapsedMs = Math.min(
    options.maxElapsedMs ?? MAX_REPARSE_ELAPSED_MS,
    MAX_REPARSE_ELAPSED_MS,
  );
  if (
    typeof now !== 'function' ||
    !Number.isSafeInteger(maxQueries) ||
    maxQueries < 0 ||
    !Number.isSafeInteger(maxElapsedMs) ||
    maxElapsedMs < 0
  ) {
    throw new TypeError('Invalid reparse query budget.');
  }
  const startedAt = now();
  if (!Number.isFinite(startedAt) || startedAt < 0) {
    throw new TypeError('Invalid reparse query clock.');
  }
  let queryCount = 0;
  const cache = new Map();
  return async (absolutePath, stats) => {
    const identity = [
      stats.dev,
      stats.ino,
      stats.mode,
      stats.size,
      stats.mtimeMs,
      stats.ctimeMs,
    ].join(':');
    const cached = cache.get(absolutePath);
    if (cached?.identity === identity) {
      return cached.result;
    }
    const beforeQueryTime = now();
    if (
      !Number.isFinite(beforeQueryTime) ||
      beforeQueryTime < startedAt ||
      queryCount >= maxQueries ||
      beforeQueryTime - startedAt >= maxElapsedMs
    ) {
      throw new TypeError('Reparse query budget exceeded.');
    }
    queryCount += 1;
    const result = Promise.resolve(
      queryReparsePoint(absolutePath, stats),
    ).then((value) => {
      const afterQueryTime = now();
      if (
        !Number.isFinite(afterQueryTime) ||
        afterQueryTime < beforeQueryTime ||
        afterQueryTime - startedAt >= maxElapsedMs
      ) {
        throw new TypeError('Reparse query time exceeded.');
      }
      return value;
    });
    cache.set(absolutePath, { identity, result });
    return result;
  };
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

function isStatReportedReparseEntry(stats) {
  return (
    stats.isSymbolicLink() ||
    (typeof stats.reparseTag === 'number' && stats.reparseTag !== 0)
  );
}

let trustedFsutilPathPromise;

function normalizeTrustedWindowsSystemRoot(candidate) {
  if (
    typeof candidate !== 'string' ||
    candidate.startsWith('\\\\') ||
    !path.win32.isAbsolute(candidate)
  ) {
    throw new TypeError('Reparse-point inspection failed.');
  }
  const normalized = path.win32.normalize(candidate);
  const parsed = path.win32.parse(normalized);
  if (
    !/^[A-Za-z]:\\$/u.test(parsed.root) ||
    path.win32.dirname(normalized).toLocaleLowerCase('en-US') !==
      parsed.root.toLocaleLowerCase('en-US') ||
    path.win32.basename(normalized).toLocaleLowerCase('en-US') !== 'windows'
  ) {
    throw new TypeError('Reparse-point inspection failed.');
  }
  return normalized;
}

function isTrustedFsutilExecutablePath(candidate) {
  try {
    const normalized = path.win32.normalize(candidate);
    const parsed = path.win32.parse(normalized);
    const relative = path.win32.relative(parsed.root, normalized);
    return (
      /^[A-Za-z]:\\$/u.test(parsed.root) &&
      relative.toLocaleLowerCase('en-US') ===
        'windows\\system32\\fsutil.exe'
    );
  } catch {
    return false;
  }
}

async function resolveTrustedFsutilPath() {
  const systemRoot = normalizeTrustedWindowsSystemRoot(
    process.env.SystemRoot,
  );
  const physicalSystemRoot = await resolveRealPath(systemRoot);
  const systemRootStats = await lstatFile(physicalSystemRoot);
  if (
    !pathsEqual(systemRoot, physicalSystemRoot) ||
    !systemRootStats.isDirectory() ||
    isStatReportedReparseEntry(systemRootStats)
  ) {
    throw new TypeError('Reparse-point inspection failed.');
  }
  const expectedPath = path.win32.join(
    systemRoot,
    'System32',
    'fsutil.exe',
  );
  const physicalPath = await resolveRealPath(expectedPath);
  const stats = await lstatFile(physicalPath);
  if (
    !pathsEqual(expectedPath, physicalPath) ||
    !stats.isFile() ||
    isStatReportedReparseEntry(stats)
  ) {
    throw new TypeError('Reparse-point inspection failed.');
  }
  return expectedPath;
}

/**
 * @param {string} absolutePath
 * @param {Partial<ReparseQueryDependencies>} [dependencies]
 * @returns {Promise<boolean>}
 */
export async function queryWindowsReparsePoint(
  absolutePath,
  dependencies = {},
) {
  if (typeof absolutePath !== 'string' || !path.isAbsolute(absolutePath)) {
    throw new TypeError('Invalid reparse-point path.');
  }
  if (process.platform !== 'win32') {
    return false;
  }
  const resolveExecutable =
    dependencies.resolveExecutable ??
    (() => {
      trustedFsutilPathPromise ??= resolveTrustedFsutilPath();
      return trustedFsutilPathPromise;
    });
  const spawnProcess = dependencies.spawnProcess ?? spawn;
  const timeoutMs = dependencies.timeoutMs ?? 5_000;
  if (
    typeof resolveExecutable !== 'function' ||
    typeof spawnProcess !== 'function' ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 5_000
  ) {
    throw new TypeError('Reparse-point inspection failed.');
  }
  let trustedFsutilPath;
  try {
    trustedFsutilPath = await resolveExecutable();
    if (!isTrustedFsutilExecutablePath(trustedFsutilPath)) {
      throw new TypeError('Unexpected reparse executable.');
    }
  } catch {
    throw new TypeError('Reparse-point inspection failed.');
  }
  return new Promise((resolve, reject) => {
    const child = spawnProcess(
      trustedFsutilPath,
      ['reparsepoint', 'query', absolutePath],
      {
        cwd: path.win32.dirname(trustedFsutilPath),
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    let settled = false;
    let timeout;
    const settle = (complete, killChild = false) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      if (killChild) {
        try {
          child.kill();
        } catch {
          // The fixed inspection error remains authoritative.
        }
      }
      complete();
    };
    const rejectInspection = () =>
      reject(new TypeError('Reparse-point inspection failed.'));
    const diagnosticChunks = [];
    let diagnosticBytes = 0;
    const captureDiagnostic = (chunk) => {
      if (settled) {
        return;
      }
      const buffer = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(String(chunk), 'utf8');
      diagnosticBytes += buffer.length;
      if (diagnosticBytes > 4_096) {
        settle(rejectInspection, true);
        return;
      }
      diagnosticChunks.push(buffer);
    };
    child.stdout?.on('data', captureDiagnostic);
    child.stderr?.on('data', captureDiagnostic);
    timeout = setTimeout(() => {
      settle(rejectInspection, true);
    }, timeoutMs);
    child.once('error', () => {
      settle(rejectInspection);
    });
    child.once('close', (exitCode, signal) => {
      if (settled) {
        return;
      }
      if (signal !== null || (exitCode !== 0 && exitCode !== 1)) {
        settle(rejectInspection);
        return;
      }
      if (exitCode === 0) {
        settle(() => resolve(true));
        return;
      }
      const diagnostic = Buffer.concat(diagnosticChunks).toString(
        'latin1',
      );
      const firstDiagnosticLine =
        diagnostic
          .split(/\r?\n/u)
          .find((line) => line.trim().length > 0) ?? '';
      if (!/^[^\d\r\n]*4390:/u.test(firstDiagnosticLine)) {
        settle(rejectInspection);
        return;
      }
      settle(() => resolve(false));
    });
  });
}

async function isReparseEntry(absolutePath, stats, inspection) {
  return (
    isStatReportedReparseEntry(stats) ||
    (await inspection.isReparsePoint(absolutePath, stats))
  );
}

export function fileIdentityMatches(before, after) {
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

async function readBoundedRegularFile(
  absolutePath,
  maximumBytes,
  expectedStats,
) {
  const handle = await openFile(absolutePath, 'r');
  try {
    const before = await handle.stat();
    if (
      !expectedStats?.isFile() ||
      !before.isFile() ||
      before.size < 0 ||
      before.size > maximumBytes ||
      !fileIdentityMatches(expectedStats, before)
    ) {
      throw new TypeError('Bounded file inspection failed.');
    }
    const buffer = Buffer.alloc(maximumBytes + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const result = await handle.read(
        buffer,
        bytesRead,
        buffer.length - bytesRead,
        bytesRead,
      );
      if (result.bytesRead === 0) {
        break;
      }
      bytesRead += result.bytesRead;
    }
    const after = await handle.stat();
    const finalPathStats = await lstatFile(absolutePath);
    if (
      bytesRead > maximumBytes ||
      bytesRead !== before.size ||
      !fileIdentityMatches(expectedStats, before) ||
      !fileIdentityMatches(before, after) ||
      !fileIdentityMatches(after, finalPathStats)
    ) {
      throw new TypeError('Bounded file inspection failed.');
    }
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function inspectRepositoryPathAncestors(
  canonicalRoot,
  repositoryPath,
  inspection,
) {
  if (!validateCanonicalRepositoryPath(repositoryPath)) {
    throw new TypeError('Unsafe repository path.');
  }
  let current = canonicalRoot;
  let stats;
  for (const component of repositoryPath.split('/')) {
    current = path.join(current, component);
    try {
      stats = await inspection.lstat(current);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return { exists: false, unsafe: null, stats: null };
      }
      throw error;
    }
    if (await isReparseEntry(current, stats, inspection)) {
      return { exists: true, unsafe: 'reparse', stats };
    }
    const physicalPath = await inspection.realpath(current);
    if (!isContainedPath(canonicalRoot, physicalPath)) {
      return { exists: true, unsafe: 'outside', stats };
    }
  }
  return { exists: true, unsafe: null, stats };
}

/**
 * @param {NodeJS.ProcessEnv|Record<string, string|undefined>} baseEnvironment
 * @param {NodeJS.Platform} [platform]
 * @returns {Record<string, string>}
 */
export function createSafeGitEnvironment(
  baseEnvironment,
  platform = process.platform,
) {
  const source =
    platform === 'win32'
      ? new Map(
          Object.entries(baseEnvironment ?? {}).map(([name, value]) => [
            name.toLocaleUpperCase('en-US'),
            value,
          ]),
        )
      : new Map(Object.entries(baseEnvironment ?? {}));
  const allowedNames =
    platform === 'win32'
      ? [
          'PATH',
          'PATHEXT',
          'SYSTEMROOT',
          'WINDIR',
          'COMSPEC',
          'TEMP',
          'TMP',
        ]
      : ['PATH', 'TMPDIR'];
  const environment = {};
  for (const name of allowedNames) {
    const value = source.get(name);
    if (typeof value === 'string' && value.length > 0) {
      environment[name] = value;
    }
  }
  Object.assign(environment, {
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_ATTR_NOSYSTEM: '1',
    GIT_LITERAL_PATHSPECS: '1',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'Never',
    GIT_CONFIG_GLOBAL: platform === 'win32' ? 'NUL' : '/dev/null',
    LC_ALL: 'C',
    LANG: 'C',
  });
  return environment;
}

export function createSafeGitArguments(args, platform = process.platform) {
  const nullDevice = platform === 'win32' ? 'NUL' : '/dev/null';
  return [
    '-c',
    `core.attributesFile=${nullDevice}`,
    '-c',
    `core.excludesFile=${nullDevice}`,
    ...args,
  ];
}

let trustedGitExecutablePromise;

async function discoverTrustedGitExecutable(repositoryRoot) {
  const environment = createSafeGitEnvironment(process.env);
  const pathValue = environment.PATH;
  if (typeof pathValue !== 'string' || pathValue.length === 0) {
    throw new TypeError('Trusted Git executable was not found.');
  }
  const executableName =
    process.platform === 'win32' ? 'git.exe' : 'git';
  for (const rawDirectory of pathValue.split(path.delimiter)) {
    const directory = rawDirectory.replace(/^"(.*)"$/u, '$1');
    if (directory.length === 0 || !path.isAbsolute(directory)) {
      continue;
    }
    const candidate = path.join(directory, executableName);
    try {
      const canonicalCandidate = await resolveRealPath(candidate);
      const stats = await lstatFile(canonicalCandidate);
      if (
        !stats.isFile() ||
        isContainedPath(repositoryRoot, canonicalCandidate)
      ) {
        continue;
      }
      if (process.platform !== 'win32') {
        await accessFile(canonicalCandidate, fsConstants.X_OK);
      }
      return canonicalCandidate;
    } catch {
      // Continue through the trusted PATH without reflecting candidate errors.
    }
  }
  throw new TypeError('Trusted Git executable was not found.');
}

export async function resolveTrustedGitExecutable(repositoryRoot) {
  trustedGitExecutablePromise ??=
    discoverTrustedGitExecutable(repositoryRoot);
  const executable = await trustedGitExecutablePromise;
  if (isContainedPath(repositoryRoot, executable)) {
    throw new TypeError('Unsafe Git executable location.');
  }
  return executable;
}

async function runGit(repositoryRoot, args, stdin = null) {
  const gitExecutable = await resolveTrustedGitExecutable(repositoryRoot);
  return new Promise((resolve) => {
    const child = execFile(
      gitExecutable,
      createSafeGitArguments(args),
      {
        cwd: repositoryRoot,
        encoding: 'buffer',
        env: createSafeGitEnvironment(process.env),
        maxBuffer: MAX_GIT_OUTPUT_BYTES,
        shell: false,
        timeout: MAX_GIT_INSPECTION_MS,
        windowsHide: true,
      },
      (error, stdout) => {
        const output = Buffer.isBuffer(stdout)
          ? stdout
          : Buffer.from(stdout ?? '');
        const exitCode =
          error === null
            ? 0
            : Number.isInteger(error?.code)
              ? error.code
              : 2;
        resolve({
          exitCode,
          stdout:
            output.length <= MAX_GIT_OUTPUT_BYTES
              ? output
              : Buffer.alloc(0),
          stderr: Buffer.alloc(0),
        });
      },
    );
    child.stdin?.on('error', () => {});
    child.stdin?.end(stdin ?? undefined);
  });
}

async function readBoundedDirectory(absolutePath) {
  const directory = await openDirectory(absolutePath);
  const entries = [];
  try {
    for (;;) {
      const entry = await directory.read();
      if (entry === null) {
        break;
      }
      if (
        entries.length >=
        REPOSITORY_TRAVERSAL_LIMITS.maxEntriesPerDirectory
      ) {
        throw new TypeError('Directory entry limit exceeded.');
      }
      entries.push(entry);
    }
    return entries;
  } finally {
    await directory.close();
  }
}

function productionInspectionDependencies() {
  const isReparsePoint =
    process.platform === 'win32'
      ? createBoundedReparseInspector(queryWindowsReparsePoint)
      : async () => false;
  return {
    runGit,
    lstat: (absolutePath) => lstatFile(absolutePath),
    readdir: readBoundedDirectory,
    realpath: (absolutePath) => resolveRealPath(absolutePath),
    isReparsePoint,
    readGitignore: (absolutePath, expectedStats) =>
      readBoundedRegularFile(
        absolutePath,
        MAX_POLICY_BYTES,
        expectedStats,
      ),
    readPolicy: (absolutePath, expectedStats) =>
      readBoundedRegularFile(
        absolutePath,
        MAX_POLICY_BYTES,
        expectedStats,
      ),
  };
}

function decodeFatalUtf8(input) {
  if (!Buffer.isBuffer(input)) {
    throw new TypeError('Invalid bounded input.');
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(input);
}

function parseNullSeparatedPaths(input) {
  if (!Buffer.isBuffer(input)) {
    throw new TypeError('Invalid Git path output.');
  }
  if (input.length === 0) {
    return [];
  }
  if (input.at(-1) !== 0) {
    throw new TypeError('Invalid Git path output.');
  }
  const decoded = decodeFatalUtf8(input);
  return decoded.slice(0, -1).split('\0').map((repositoryPath) => {
    if (repositoryPath.length === 0) {
      throw new TypeError('Invalid Git path output.');
    }
    return normalizeDiscoveredRepositoryPath(repositoryPath);
  });
}

function declaredRepositoryPaths(policy) {
  return new Set([
    ...REPOSITORY_CONTROL_PATHS,
    ...(policy.markdownRoots ?? []),
    ...(policy.documentGroups ?? []).flatMap((group) => group.paths ?? []),
    ...(policy.ignoredArtifacts ?? []).flatMap((artifact) => [
      artifact.probePath,
      ...(artifact.sourceInputs ?? []),
    ]),
    ...(policy.trackedIgnoreExceptions ?? []).map(
      (exception) => exception.probePath,
    ),
    ...(policy.trackedGeneratedSources ?? []).flatMap((generated) => [
      generated.path,
      ...(generated.sourceInputs ?? []),
    ]),
    policy.preservation?.rawByteAttributesFile,
    ...(policy.preservation?.recoveredDocuments ?? []),
    ...(policy.preservation?.staticLocalPaths ?? []),
  ]);
}

function requiredRegularRepositoryPaths(policy) {
  return new Set([
    ...REPOSITORY_CONTROL_PATHS,
    ...(policy.documentGroups ?? []).flatMap((group) => group.paths ?? []),
    ...(policy.ignoredArtifacts ?? []).flatMap(
      (artifact) => artifact.sourceInputs ?? [],
    ),
    ...(policy.trackedGeneratedSources ?? []).flatMap((generated) => [
      generated.path,
      ...(generated.sourceInputs ?? []),
    ]),
    ...(policy.preservation?.recoveredDocuments ?? []),
  ]);
}

/**
 * @param {string} repositoryRoot
 * @param {RepositoryAuthorityPolicy} policy
 * @param {Partial<RepositoryInspectionDependencies>} [dependencies]
 * @returns {Promise<RepositorySnapshot>}
 */
export async function collectRepositorySnapshot(
  repositoryRoot,
  policy,
  dependencies = {},
) {
  const snapshot = {
    existingPaths: new Set(),
    symlinkPaths: new Set(),
    trackedEntries: new Map(),
    trackedIgnoredPaths: new Set(),
    markdownPaths: new Set(),
    gitignoreRules: [],
    ignoredProbePaths: new Set(),
    inspectionFindings: [],
  };
  const inspection = {
    ...productionInspectionDependencies(),
    ...dependencies,
  };
  const addInspectionFinding = (finding = fixedInspectionFinding()) => {
    snapshot.inspectionFindings = sortAndDedupeFindings([
      ...snapshot.inspectionFindings,
      finding,
    ]);
  };
  let traversalLimits;
  try {
    traversalLimits = boundedTraversalLimits(dependencies.traversalLimits);
  } catch {
    addInspectionFinding();
    return snapshot;
  }
  const traversalBudget = {
    entries: 0,
    pathBytes: 0,
    failed: false,
  };

  try {
    const requestedRoot = path.resolve(repositoryRoot);
    const canonicalRoot = await inspection.realpath(requestedRoot);
    const rootStats = await inspection.lstat(canonicalRoot);
    if (
      !pathsEqual(requestedRoot, canonicalRoot) ||
      !rootStats.isDirectory() ||
      await isReparseEntry(canonicalRoot, rootStats, inspection)
    ) {
      addInspectionFinding();
      return snapshot;
    }

    const rootResult = await inspection.runGit(canonicalRoot, [
      'rev-parse',
      '--show-toplevel',
    ]);
    if (
      rootResult.exitCode !== 0 ||
      rootResult.stdout.length > MAX_GIT_OUTPUT_BYTES
    ) {
      addInspectionFinding();
      return snapshot;
    }
    const gitRoot = decodeFatalUtf8(rootResult.stdout).trim();
    if (!pathsEqual(gitRoot, canonicalRoot)) {
      addInspectionFinding();
      return snapshot;
    }

    const indexResult = await inspection.runGit(canonicalRoot, [
      'ls-files',
      '--stage',
      '-z',
    ]);
    if (
      indexResult.exitCode !== 0 ||
      indexResult.stdout.length > MAX_GIT_OUTPUT_BYTES
    ) {
      addInspectionFinding();
      return snapshot;
    }
    snapshot.trackedEntries = parseNullSeparatedIndexEntries(
      indexResult.stdout,
    );

    const validateAncestors = async (repositoryPath) => {
      try {
        const result = await inspectRepositoryPathAncestors(
          canonicalRoot,
          repositoryPath,
          inspection,
        );
        if (result.unsafe === 'reparse') {
          snapshot.symlinkPaths.add(repositoryPath);
          return { exists: true, unsafe: true, stats: result.stats };
        }
        if (result.unsafe === 'outside') {
          addInspectionFinding(
            pathFinding(
              'repository',
              'AUTHORITY_OUTSIDE_REPOSITORY',
              repositoryPath,
            ),
          );
          return { exists: true, unsafe: true, stats: result.stats };
        }
        return {
          exists: result.exists,
          unsafe: false,
          stats: result.stats,
        };
      } catch {
        addInspectionFinding();
        return { exists: false, unsafe: true, stats: null };
      }
    };

    const requiredRegularPaths = requiredRegularRepositoryPaths(policy);
    const requiredDirectoryPaths = new Set(policy.markdownRoots ?? []);
    const declaredStatuses = new Map();
    for (const repositoryPath of declaredRepositoryPaths(policy)) {
      if (typeof repositoryPath !== 'string') {
        addInspectionFinding();
        return snapshot;
      }
      const status = await validateAncestors(repositoryPath);
      declaredStatuses.set(repositoryPath, status);
      if (status.exists && !status.unsafe) {
        if (
          (requiredRegularPaths.has(repositoryPath) &&
            !status.stats?.isFile()) ||
          (requiredDirectoryPaths.has(repositoryPath) &&
            !status.stats?.isDirectory())
        ) {
          addInspectionFinding(
            pathFinding(
              'repository',
              'AUTHORITY_UNSAFE_TYPE',
              repositoryPath,
            ),
          );
          continue;
        }
        snapshot.existingPaths.add(repositoryPath);
      }
    }

    const policyRepositoryPath = 'config/repository-authority.json';
    const initialPolicyStatus = await inspectRepositoryPathAncestors(
      canonicalRoot,
      policyRepositoryPath,
      inspection,
    );
    if (
      !initialPolicyStatus.exists ||
      initialPolicyStatus.unsafe !== null ||
      !initialPolicyStatus.stats?.isFile()
    ) {
      addInspectionFinding();
      return snapshot;
    }
    const initialPolicyBuffer = await inspection.readPolicy(
      path.join(canonicalRoot, policyRepositoryPath),
      initialPolicyStatus.stats,
    );
    if (
      !Buffer.isBuffer(initialPolicyBuffer) ||
      initialPolicyBuffer.length > MAX_POLICY_BYTES ||
      JSON.stringify(JSON.parse(decodeFatalUtf8(initialPolicyBuffer))) !==
        JSON.stringify(policy)
    ) {
      addInspectionFinding();
      return snapshot;
    }

    if (!snapshot.existingPaths.has('.gitignore')) {
      return snapshot;
    }
    const gitignoreStatus = await inspectRepositoryPathAncestors(
      canonicalRoot,
      '.gitignore',
      inspection,
    );
    if (
      !gitignoreStatus.exists ||
      gitignoreStatus.unsafe !== null ||
      !gitignoreStatus.stats?.isFile()
    ) {
      addInspectionFinding();
      return snapshot;
    }
    const gitignoreBuffer = await inspection.readGitignore(
      path.join(canonicalRoot, '.gitignore'),
      gitignoreStatus.stats,
    );
    if (
      !Buffer.isBuffer(gitignoreBuffer) ||
      gitignoreBuffer.length > MAX_POLICY_BYTES
    ) {
      addInspectionFinding();
      return snapshot;
    }
    snapshot.gitignoreRules = decodeFatalUtf8(gitignoreBuffer)
      .split(/\r?\n/u)
      .filter((line) => line.length > 0 && !line.startsWith('#'));

    const trackedIgnoredResult = await inspection.runGit(canonicalRoot, [
      'ls-files',
      '-ci',
      '--exclude-standard',
      '-z',
    ]);
    if (
      trackedIgnoredResult.exitCode !== 0 ||
      trackedIgnoredResult.stdout.length > MAX_GIT_OUTPUT_BYTES
    ) {
      addInspectionFinding();
      return snapshot;
    }
    snapshot.trackedIgnoredPaths = new Set(
      parseNullSeparatedPaths(trackedIgnoredResult.stdout),
    );

    const failTraversal = () => {
      traversalBudget.failed = true;
      addInspectionFinding();
    };
    const sortDirectoryEntries = (entries) =>
      [...entries].sort((left, right) =>
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
    const walkedDirectories = [];
    const walkMarkdownDirectory = async (repositoryPath, depth = 0) => {
      if (
        traversalBudget.failed ||
        depth > traversalLimits.maxDepth
      ) {
        failTraversal();
        return;
      }
      const absolutePath = path.join(canonicalRoot, repositoryPath);
      let beforeStats;
      let beforePhysicalPath;
      let entries;
      try {
        beforeStats = await inspection.lstat(absolutePath);
        if (
          !beforeStats.isDirectory() ||
          await isReparseEntry(absolutePath, beforeStats, inspection)
        ) {
          snapshot.symlinkPaths.add(repositoryPath);
          failTraversal();
          return;
        }
        beforePhysicalPath = await inspection.realpath(absolutePath);
        if (!isContainedPath(canonicalRoot, beforePhysicalPath)) {
          failTraversal();
          return;
        }
        entries = sortDirectoryEntries(
          await inspection.readdir(absolutePath),
        );
      } catch {
        addInspectionFinding();
        return;
      }
      if (entries.length > traversalLimits.maxEntriesPerDirectory) {
        failTraversal();
        return;
      }

      for (const entry of entries) {
        if (traversalBudget.failed) {
          return;
        }
        let childPath;
        try {
          childPath = normalizeDiscoveredRepositoryPath(
            `${repositoryPath}/${entry.name}`,
          );
        } catch {
          addInspectionFinding();
          continue;
        }
        const childPathBytes = Buffer.byteLength(childPath, 'utf8');
        traversalBudget.entries += 1;
        traversalBudget.pathBytes += childPathBytes;
        if (
          childPathBytes > traversalLimits.maxPathBytes ||
          traversalBudget.entries > traversalLimits.maxEntries ||
          traversalBudget.pathBytes >
            traversalLimits.maxAggregatePathBytes
        ) {
          failTraversal();
          return;
        }
        const childAbsolutePath = path.join(canonicalRoot, childPath);
        let stats;
        try {
          stats = await inspection.lstat(childAbsolutePath);
        } catch {
          addInspectionFinding();
          continue;
        }
        snapshot.existingPaths.add(childPath);
        if (
          (await isReparseEntry(childAbsolutePath, stats, inspection)) ||
          entry.isSymbolicLink?.()
        ) {
          snapshot.symlinkPaths.add(childPath);
          if (childPath.toLocaleLowerCase('en-US').endsWith('.md')) {
            snapshot.markdownPaths.add(childPath);
          }
          continue;
        }
        let physicalPath;
        try {
          physicalPath = await inspection.realpath(childAbsolutePath);
        } catch {
          addInspectionFinding();
          continue;
        }
        if (!isContainedPath(canonicalRoot, physicalPath)) {
          addInspectionFinding(
            pathFinding(
              'repository',
              'AUTHORITY_OUTSIDE_REPOSITORY',
              childPath,
            ),
          );
          continue;
        }
        if (stats.isDirectory()) {
          await walkMarkdownDirectory(childPath, depth + 1);
        } else if (
          stats.isFile() &&
          childPath.toLocaleLowerCase('en-US').endsWith('.md')
        ) {
          snapshot.markdownPaths.add(childPath);
        }
      }

      try {
        const verificationEntries = sortDirectoryEntries(
          await inspection.readdir(absolutePath),
        );
        const afterStats = await inspection.lstat(absolutePath);
        const afterPhysicalPath = await inspection.realpath(absolutePath);
        if (
          !afterStats.isDirectory() ||
          await isReparseEntry(absolutePath, afterStats, inspection) ||
          !fileIdentityMatches(beforeStats, afterStats) ||
          !pathsEqual(beforePhysicalPath, afterPhysicalPath) ||
          !directoryEntriesEqual(entries, verificationEntries)
        ) {
          failTraversal();
          return;
        }
        walkedDirectories.push({
          absolutePath,
          stats: afterStats,
          physicalPath: afterPhysicalPath,
          entries: verificationEntries,
        });
      } catch {
        addInspectionFinding();
      }
    };

    for (const markdownRoot of policy.markdownRoots ?? []) {
      if (
        !traversalBudget.failed &&
        snapshot.existingPaths.has(markdownRoot)
      ) {
        await walkMarkdownDirectory(markdownRoot);
      }
    }
    for (const directory of walkedDirectories) {
      const finalEntries = sortDirectoryEntries(
        await inspection.readdir(directory.absolutePath),
      );
      const finalStats = await inspection.lstat(directory.absolutePath);
      const finalPhysicalPath = await inspection.realpath(
        directory.absolutePath,
      );
      if (
        !finalStats.isDirectory() ||
        await isReparseEntry(
          directory.absolutePath,
          finalStats,
          inspection,
        ) ||
        !fileIdentityMatches(directory.stats, finalStats) ||
        !pathsEqual(directory.physicalPath, finalPhysicalPath) ||
        !directoryEntriesEqual(directory.entries, finalEntries)
      ) {
        failTraversal();
        return snapshot;
      }
    }

    const probes = [
      ...(policy.ignoredArtifacts ?? []).map(
        (artifact) => artifact.probePath,
      ),
      ...(policy.trackedIgnoreExceptions ?? []).map(
        (exception) => exception.probePath,
      ),
    ];
    for (const probePath of probes) {
      const result = await inspection.runGit(
        canonicalRoot,
        [
          '--no-literal-pathspecs',
          'check-ignore',
          '--no-index',
          '--quiet',
          '--stdin',
          '-z',
        ],
        Buffer.from(`${probePath}\0`, 'utf8'),
      );
      if (!Buffer.isBuffer(result.stdout) || result.stdout.length !== 0) {
        addInspectionFinding();
        return snapshot;
      }
      if (result.exitCode === 0) {
        snapshot.ignoredProbePaths.add(probePath);
      } else if (result.exitCode !== 1) {
        addInspectionFinding();
      }
    }

    const finalGitignoreStatus = await inspectRepositoryPathAncestors(
      canonicalRoot,
      '.gitignore',
      inspection,
    );
    if (
      !finalGitignoreStatus.exists ||
      finalGitignoreStatus.unsafe !== null ||
      !finalGitignoreStatus.stats?.isFile()
    ) {
      addInspectionFinding();
      return snapshot;
    }
    const finalGitignoreBuffer = await inspection.readGitignore(
      path.join(canonicalRoot, '.gitignore'),
      finalGitignoreStatus.stats,
    );
    if (
      !Buffer.isBuffer(finalGitignoreBuffer) ||
      !fileIdentityMatches(
        gitignoreStatus.stats,
        finalGitignoreStatus.stats,
      ) ||
      !gitignoreBuffer.equals(finalGitignoreBuffer)
    ) {
      addInspectionFinding();
      return snapshot;
    }

    const finalPolicyStatus = await inspectRepositoryPathAncestors(
      canonicalRoot,
      policyRepositoryPath,
      inspection,
    );
    if (
      !finalPolicyStatus.exists ||
      finalPolicyStatus.unsafe !== null ||
      !finalPolicyStatus.stats?.isFile()
    ) {
      addInspectionFinding();
      return snapshot;
    }
    const finalPolicyBuffer = await inspection.readPolicy(
      path.join(canonicalRoot, policyRepositoryPath),
      finalPolicyStatus.stats,
    );
    if (
      !Buffer.isBuffer(finalPolicyBuffer) ||
      !fileIdentityMatches(
        initialPolicyStatus.stats,
        finalPolicyStatus.stats,
      ) ||
      !initialPolicyBuffer.equals(finalPolicyBuffer)
    ) {
      addInspectionFinding();
      return snapshot;
    }

    for (const [repositoryPath, initialStatus] of declaredStatuses) {
      const finalStatus = await inspectRepositoryPathAncestors(
        canonicalRoot,
        repositoryPath,
        inspection,
      );
      const initialUnsafe = initialStatus.unsafe === true;
      const finalUnsafe = finalStatus.unsafe !== null;
      const initialRequiredTypeIsValid =
        !initialStatus.exists ||
        initialUnsafe ||
        ((!requiredRegularPaths.has(repositoryPath) ||
          initialStatus.stats?.isFile()) &&
          (!requiredDirectoryPaths.has(repositoryPath) ||
            initialStatus.stats?.isDirectory()));
      const finalRequiredTypeIsValid =
        !finalStatus.exists ||
        finalUnsafe ||
        ((!requiredRegularPaths.has(repositoryPath) ||
          finalStatus.stats?.isFile()) &&
          (!requiredDirectoryPaths.has(repositoryPath) ||
            finalStatus.stats?.isDirectory()));
      if (
        finalUnsafe !== initialUnsafe ||
        finalStatus.exists !== initialStatus.exists ||
        initialRequiredTypeIsValid !== finalRequiredTypeIsValid
      ) {
        addInspectionFinding();
        return snapshot;
      }
    }
    const finalRootStats = await inspection.lstat(canonicalRoot);
    const finalCanonicalRoot = await inspection.realpath(canonicalRoot);
    if (
      !pathsEqual(canonicalRoot, finalCanonicalRoot) ||
      !fileIdentityMatches(rootStats, finalRootStats) ||
      await isReparseEntry(
        canonicalRoot,
        finalRootStats,
        inspection,
      )
    ) {
      addInspectionFinding();
      return snapshot;
    }

    const finalRootResult = await inspection.runGit(canonicalRoot, [
      'rev-parse',
      '--show-toplevel',
    ]);
    const finalIndexResult = await inspection.runGit(canonicalRoot, [
      'ls-files',
      '--stage',
      '-z',
    ]);
    const finalTrackedIgnoredResult = await inspection.runGit(
      canonicalRoot,
      ['ls-files', '-ci', '--exclude-standard', '-z'],
    );
    if (
      finalRootResult.exitCode !== 0 ||
      finalIndexResult.exitCode !== 0 ||
      finalTrackedIgnoredResult.exitCode !== 0 ||
      !rootResult.stdout.equals(finalRootResult.stdout) ||
      !indexResult.stdout.equals(finalIndexResult.stdout) ||
      !trackedIgnoredResult.stdout.equals(
        finalTrackedIgnoredResult.stdout,
      )
    ) {
      addInspectionFinding();
      return snapshot;
    }

    const collisionPaths = new Set([
      ...snapshot.trackedEntries.keys(),
      ...snapshot.markdownPaths,
      ...declaredRepositoryPaths(policy),
    ]);
    const foldedPaths = new Map();
    for (const repositoryPath of collisionPaths) {
      const folded = repositoryPath.toLocaleLowerCase('en-US');
      const prior = foldedPaths.get(folded);
      if (prior !== undefined && prior !== repositoryPath) {
        addInspectionFinding(
          fixedInspectionFinding('REPOSITORY_PATH_COLLISION'),
        );
      }
      foldedPaths.set(folded, repositoryPath);
    }
  } catch {
    addInspectionFinding();
  }

  return snapshot;
}

/**
 * @param {string} repositoryRoot
 * @param {Partial<RepositoryInspectionDependencies>} [dependencies]
 * @returns {Promise<RepositoryAuthorityPolicy>}
 */
export async function loadRepositoryAuthorityPolicy(
  repositoryRoot,
  dependencies = {},
) {
  try {
    const inspection = {
      ...productionInspectionDependencies(),
      ...dependencies,
    };
    const requestedRoot = path.resolve(repositoryRoot);
    const canonicalRoot = await inspection.realpath(requestedRoot);
    const rootStats = await inspection.lstat(canonicalRoot);
    if (
      !pathsEqual(requestedRoot, canonicalRoot) ||
      !rootStats.isDirectory() ||
      await isReparseEntry(canonicalRoot, rootStats, inspection)
    ) {
      throw new TypeError('Unsafe repository root.');
    }
    const policyStatus = await inspectRepositoryPathAncestors(
      canonicalRoot,
      'config/repository-authority.json',
      inspection,
    );
    if (
      !policyStatus.exists ||
      policyStatus.unsafe !== null ||
      !policyStatus.stats?.isFile()
    ) {
      throw new TypeError('Unsafe repository authority policy.');
    }
    const policyBuffer = await inspection.readPolicy(
      path.join(canonicalRoot, 'config', 'repository-authority.json'),
      policyStatus.stats,
    );
    if (
      !Buffer.isBuffer(policyBuffer) ||
      policyBuffer.length === 0 ||
      policyBuffer.length > MAX_POLICY_BYTES
    ) {
      throw new TypeError('Invalid repository authority policy.');
    }
    return JSON.parse(decodeFatalUtf8(policyBuffer));
  } catch {
    throw new TypeError('Repository authority policy could not be read.');
  }
}

/**
 * @param {string} repositoryRoot
 * @returns {Promise<Finding[]>}
 */
export async function runRepositoryAuthorityCheck(repositoryRoot) {
  let policy;
  try {
    policy = await loadRepositoryAuthorityPolicy(repositoryRoot);
  } catch {
    return [
      {
        check: 'policy',
        code: 'POLICY_READ_FAILED',
        path: 'config/repository-authority.json',
      },
    ];
  }
  const policyFindings = validateRepositoryAuthorityPolicy(policy);
  if (policyFindings.length > 0) {
    return policyFindings;
  }
  const snapshot = await collectRepositorySnapshot(repositoryRoot, policy);
  return evaluateRepositoryAuthority(policy, snapshot);
}

/**
 * @param {Finding[]} findings
 * @returns {string}
 */
export function formatRepositoryAuthorityFindings(findings) {
  if (!Array.isArray(findings)) {
    return 'REPOSITORY_INSPECTION_FAILED .';
  }

  const fixedPaths = new Set([
    '.',
    '.gitignore',
    'config/repository-authority.json',
  ]);
  const safePathPattern = /^@sha256:[0-9a-f]{64}$/u;
  const safeCodePattern = /^[A-Z][A-Z0-9_]*$/u;

  return findings
    .map((finding) => {
      const code = safeCodePattern.test(finding?.code ?? '')
        ? finding.code
        : 'REPOSITORY_INSPECTION_FAILED';
      const path =
        fixedPaths.has(finding?.path) || safePathPattern.test(finding?.path ?? '')
          ? finding.path
          : '.';
      return `${code} ${path}`;
    })
    .join('\n');
}
