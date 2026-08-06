# System-Wide Refactor Phase 0 Repository Specification Truth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Selected execution path — read before invoking a sub-skill:** Use `superpowers:executing-plans`. Do not invoke `superpowers:subagent-driven-development` for this plan.

**Goal:** Make the tracked Git tree the complete, machine-checkable source of repository specifications, historical phase evidence, and generated-source ownership without deleting or rewriting local artifacts.

**Architecture:** Add one dependency-free repository-authority checker driven by a machine-readable policy. The checker evaluates Git tracking and ignore state rather than trusting filesystem existence, treats every Markdown file under `docs/` as tracked repository material, distinguishes normative documents from historical evidence in human-facing indexes, and records the single tracked generated-source exception. The migration removes blanket authority ignores while replacing their accidental protection with explicit root-anchored local/generated-output rules.

**Tech Stack:** Node.js ESM and `node:test`, Git plumbing commands, JSON policy, GitHub Actions, Markdown, PowerShell-safe verification commands.

## Global Constraints

- Work only in `D:\Git\SpotifyWallPaper`; do not create or use a Codex worktree.
- Preserve the approved baseline `455dcf183c62a9b9162c081a1d8fd38aae9e1dc5` and the documentation bootstrap commit.
- Do not delete, move, clean, overwrite, or stage unrelated local files.
- Do not run `git clean`, `git add -A`, `git add .`, `git reset --hard`, or `git checkout --`.
- Never stage `.codex/reports` or any file under `.codex/`.
- Treat paths and Git metadata as the repository-authority checker inputs. The only additional bounded content reader introduced in this phase is the exact 26-path preservation helper; it never returns or prints content. Never read local environment-file contents, OAuth material, credentials, callback queries, the ignored ZIP, or local evidence. The static protected-local inventory hashes path/type/size metadata only. Preservation digests remain uncaptured shell state and are never stored by h5i or any report.
- Preserve the recovered historical reports and the executed 2026-07-18 plan byte-for-byte. Classify them through index documents instead of rewriting their historical content.
- Do not change CI branch filters, toolchain versions, Rust formatting, dependency versions, audit behavior, Worker runtime code, WASM output, or release artifact provenance in this phase.
- Run resource-intensive verification through `h5i capture run`; only secret-free commands may be captured.
- Treat the `.gitignore` and path-validation changes as security-sensitive: require an independent Security review in addition to quality and SpecGuard review.
- Finish with one independently reviewed implementation commit for Phase 0.

### Execution-skill compatibility

- Use `superpowers:executing-plans` for this plan. Do not use `superpowers:subagent-driven-development`: this plan intentionally has one tightly coupled task, and that skill's implementer-first commit and per-task branch-finishing flow conflict with the repository's mandatory review-before-commit and one-commit-per-phase rules.
- Follow `gitflow-branch-finish` and do not invoke `superpowers:using-git-worktrees`. Confirm the primary checkout directly: the resolved absolute working directory must equal `D:\Git\SpotifyWallPaper`, and `git rev-parse --git-dir` must resolve to the same path as `git rev-parse --git-common-dir`. Stop before editing if either check fails. Reuse the installed dependencies; do not run setup-time `npm install` or an unscoped `cargo build`, because dependency/toolchain changes belong to Phases 1 and 2 and the exact baseline gates are specified below.
- The user's explicit instruction that all phase approvals and phase commits may proceed without further questions, together with the approved design and `AGENTS.md` one-commit-per-phase rule, is the existing authorization for the Phase 0 commit. It is not authorization to merge, push, publish, or deploy.
- Do not run `superpowers:finishing-a-development-branch` or merge after Phase 0. Phase 0 is one nested phase of the approved 37-commit refactor sequence; branch finishing applies only after Phase 33 and its final acceptance.
- Independent agents may perform bounded audits and reviews, but they do not commit or create an SDD ledger/workspace. The ignored `.codex` implementation report plus the tracked phase report and this checklist are the recovery record.

### Review-remediation amendment

The first implementation-tree reviews found seven valid Phase 0 boundary
defects. The old review tuple and its PASS results are invalid. Phase 0 must
also satisfy these requirements before the final gate:

- evaluate every reparse point found beneath a Markdown root, not only paths
  declared by policy, and never traverse its target;
- merge index-only entries beneath each Markdown root into Markdown
  classification and safe-mode evaluation;
- read recovered worktree files through a bounded file handle with
  pre/open/post identity, ancestor/reparse/realpath revalidation, POSIX
  no-follow open, and an expected-size-plus-one probe;
- require worktree and index `.gitattributes` semantics to equal the one global
  rule, 24 exact `-text` paths, and two exact
  `-text whitespace=-trailing-space` paths; require effective `text=unset`,
  `eol=lf`, and no `filter`, `working-tree-encoding`, or `ident` transform
  for recovered paths, and effective `text=auto`, `eol=lf`, and no transform
  for every classified non-recovered document;
- remove inherited Git control variables, disable replacement objects and
  prompts, redirect global configuration/attributes/excludes to the platform
  null device, and use an OS execution-variable allowlist. Git literal
  pathspec mode remains fixed for plumbing; because `check-ignore` rejects that
  mode, its validated canonical probe is supplied through NUL-delimited stdin
  under an explicit `--no-literal-pathspecs` command override;
- stream directory entries and fail closed at fixed ceilings of depth 64,
  1,024 entries per directory, 2,048 total entries, 4,096 UTF-8 bytes per
  normalized path, and 16 MiB aggregate path bytes. Test seams may only lower,
  never raise, production ceilings;
- keep independent code-side recovered/static allowlists and require the
  bounded, schema-valid policy to match both complete sets exactly. Both the
  repository-authority CLI and preservation verification CLI enforce the
  equality.

Subsequent adversarial review extended those requirements without changing
the 46-path scope:

- the two bootstrap capture modes may run before policy migration, but every
  compare and verify mode must enforce the fixed policy both before inspection
  and immediately before emitting a result;
- reject `.git/info/attributes` and every nested `.gitattributes` that is an
  ancestor of an inspected recovered or classified document. Validate
  attributes in a private temporary Git repository, and compare
  `hash-object --no-filters --stdin` with
  `hash-object --path=<path> --stdin` using the same bounded buffer and the
  same isolated Git context. The original repository's filter configuration
  must never execute;
- resolve Git to one canonical absolute executable outside the repository,
  exclude inherited Git controls, and cap each Git inspection at ten seconds;
- cap Windows generic reparse checks at 256 unique identities and 15 seconds
  per operation. Accept `fsutil` exit 1 as non-reparse only for bounded
  diagnostics whose first numeric code on the first non-empty line is
  `4390:`; every access or operational failure closes the inspection. POSIX
  uses `lstat` without consuming this Windows budget;
- treat each directory-tree and Git-state enumeration as a complete set.
  Revalidate all
  walked Markdown directories, declared worktree paths, the repository root,
  policy and Gitignore bytes, Git root, full index bytes, and
  tracked-and-ignored bytes after dependent work. Collect the static-local
  tree twice, retain and revalidate every file and directory record at the end
  of each collection in reverse traversal order, and require identical
  path/type/size maps;
- read the recovered worktree set through one bounded shared reparse inspector
  and revalidate every path record after all 26 reads. Pin index paths to one
  complete path/OID snapshot and pin `HEAD` to one commit, then require the
  corresponding state to remain unchanged. For all three sources, require the
  repository root identity, canonical path, and reparse state to remain
  unchanged at completion. Reject static-local file sizes that are not
  non-negative safe integers;
- use stable directory identity before recursive temporary-fixture cleanup.
  The private attribute repository additionally uses an ownership marker and
  a random same-parent quarantine rename, validates identity after the rename,
  and removes only the validated quarantine path.

The final temporary-repository removal is path based because Node.js does not
provide a handle-relative recursive removal API. Phase 0 therefore trusts a
normally protected per-user Windows temp directory or a sticky/appropriately
permissioned POSIX temp parent, and treats the same user and administrators as
non-adversarial. A process with those privileges could still replace the
random quarantine path after validation and before removal; custom
world-writable non-sticky temp configuration is outside this threat model.
Setup failures before the ownership-marker `try/finally` may also leave a
bounded temporary artifact. These are accepted low residual risks, not claims
of atomic cleanup.

All filesystem enumerations and revalidations are sequential observations, not
atomic filesystem snapshots. They reject drift observed between checks, and the
reverse terminal pass specifically checks every earlier record after its later
siblings, but no finite series of portable Node filesystem calls can prevent a
same-user process from changing a record after its final observation. Phase 0
therefore treats repository operators, the same user, and administrators as
non-adversarial across the complete preservation boundary, not only temporary
cleanup. They must not concurrently mutate the protected local set while a gate
runs. Static-local comparison proves stable agent-caused path/type/size
preservation under that model; it does not claim an atomic point-in-time
snapshot, concurrent-writer integrity, or same-size content identity.

All remediation remains inside the original 46-path allowlist. After the
finding tests turn green, rerun the complete Phase 0 gate and obtain new
quality, Security, and SpecGuard PASS results for one new exact
branch/parent/tree tuple.

---

## Task 1: Establish the Repository Authority Contract

**Files:**

- Create: `config/repository-authority.json`
- Create: `scripts/repository-authority.mjs`
- Create: `scripts/check-repository-authority.mjs`
- Create: `scripts/repository-authority.test.mjs`
- Create: `scripts/repository-preservation.mjs`
- Create: `scripts/repository-preservation.test.mjs`
- Modify: `.gitattributes`
- Modify: `.gitignore`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `AGENTS.md`
- Modify: `docs/README.md`
- Update and track recovered untracked authority: `docs/00-codex-entrypoint.md`
- Create: `docs/05-repository-authority.md`
- Modify: `docs/02-repository-structure.md`
- Modify: `docs/24-docs-and-reporting.md`
- Create: `docs/phase-reports/README.md`
- Create: `docs/superpowers/plans/README.md`
- Create and track: `docs/superpowers/plans/2026-07-27-system-wide-refactor-phase-0-repository-specification-truth.md`
- Create: `docs/phase-reports/system-wide-refactor-phase-0-repository-specification-truth.md`
- Track unchanged: the 26 recovered Markdown files listed in Step 1.2

### Step 1.1: Record the pre-migration safety baseline

- [ ] Confirm the branch and clean tracked state:

```powershell
git branch --show-current
git rev-parse HEAD
git status --short --branch --untracked-files=no
git rev-parse --git-dir
git rev-parse --git-common-dir
git diff --check
```

Expected:

- branch is `Fix/system-wide-refactor`;
- HEAD is the reviewed documentation bootstrap or its reviewed descendant;
- tracked worktree is clean before Phase 0 edits;
- the resolved Git directory and common directory are identical, proving this is the required primary checkout;
- only already-known ignored/local material exists.

- [ ] Freeze the following two preservation contracts now, before any recovered document is touched. Compute their baseline values only after the preservation helper and tests are green in Step 1.5, and before changing `.gitignore` or any document:

1. a SHA-256 byte fingerprint for the 26 recovered Markdown files that must remain byte-for-byte unchanged;
2. a SHA-256 metadata fingerprint over normalized relative path plus byte length, without reading file contents, for the static protected local set: `docs/phase-reports.zip`, `CLAUDE.md`, and existing files under `goal/`, `.superpowers/`, and `.claude/`.

The recovered-document algorithm is fixed as SHA-256 over the domain separator `spotify-wallpaper/recovered-documents/v1\0`, followed by each normalized UTF-8 path in ordinal byte order as an unsigned 64-bit big-endian path length, path bytes, unsigned 64-bit big-endian blob length, and 32-byte SHA-256 blob digest. It supports binary-safe `worktree`, `index`, and `HEAD` sources and rejects missing, oversized, symbolic-link, reparse, submodule, or repository-escaping input. The first set excludes `docs/00-codex-entrypoint.md` because this phase intentionally aligns its reading order.

The static-local metadata algorithm uses a separate `spotify-wallpaper/static-local-metadata/v1\0` domain, ordinal normalized path order, unsigned 64-bit path and byte-length fields, and never reads file content. It does not prove same-size content preservation; it detects only path, type, and byte-length drift. It rejects reparse points and escaped real paths at every ancestor. The second set excludes mutable `.codex/`, `.codegraph/`, `artifacts/`, logs, dependency caches, and build output because report updates, CodeGraph indexing, h5i captures, tests, and builds may legitimately change them. For those mutable paths, record only the pre-existing top-level path presence and later prove that they remain ignored and were neither staged nor explicitly deleted.

Keep both initial digest values only in the active uncaptured shell state. Never write either digest to the tracked report, ignored report, reviewer prompt, h5i capture, or another file; downstream evidence is only `MATCH` plus count. If the shell state is lost before the staged comparison, stop Phase 0 instead of inventing or re-baselining the values after edits.

- [ ] Record the current tracking and ignore failures:

```powershell
$trackedIgnoredCount = @(git ls-files -ci --exclude-standard).Count
if ($LASTEXITCODE -ne 0) { throw "Unable to count tracked ignored paths." }
git check-ignore --no-index --quiet -- AGENTS.md
$agentsIgnoreExit = $LASTEXITCODE
git check-ignore --no-index --quiet -- docs/README.md
$docsIgnoreExit = $LASTEXITCODE
git check-ignore --no-index --quiet -- docs/phase-reports.zip
$archiveIgnoreExit = $LASTEXITCODE
git check-ignore --no-index --quiet -- goal/docs
$goalIgnoreExit = $LASTEXITCODE
```

Expected red baseline:

- `$trackedIgnoredCount` is 30 and the two authority probes exit 0;
- 27 recovered Markdown files plus this Phase 0 plan are ignored and untracked;
- the local phase-report ZIP and `goal/` probes exit 0 and remain protected only through the current blanket rule or other local excludes;
- no broad ignored-file listing, ignore-rule text, or arbitrary discovered filename is printed.

### Step 1.2: Freeze the exact recovered-document migration set

- [ ] Treat the following 26 files as recovered source material whose bytes may not change in Phase 0:

```text
docs/12-rust-wasm-core.md
docs/14-ui-layout.md
docs/15-background-theme.md
docs/16-visualizer.md
docs/17-lyrics.md
docs/18-transitions.md
docs/21-rainmeter.md
docs/release-notes-v0.0.1.md
docs/superpowers/plans/2026-07-18-cloudflare-worker-public-backend.md
docs/phase-reports/final-implementation-report.md
docs/phase-reports/lyrics-deferred-spec-update.md
docs/phase-reports/one-click-spotify-auth-token.md
docs/phase-reports/phase-0-scaffold-and-mock-preview.md
docs/phase-reports/phase-1-spotify-mvp.md
docs/phase-reports/phase-2-wallpaper-engine-bridge.md
docs/phase-reports/phase-3-rust-wasm-core.md
docs/phase-reports/phase-4-settings-layout-customization.md
docs/phase-reports/phase-5-background-theme.md
docs/phase-reports/phase-6-visualizer.md
docs/phase-reports/phase-7-lyrics.md
docs/phase-reports/phase-8-transitions.md
docs/phase-reports/phase-9-player-clock.md
docs/phase-reports/phase-10-tauri-configurator.md
docs/phase-reports/phase-11-rainmeter.md
docs/phase-reports/phase-12-final-qa-docs.md
docs/phase-reports/post-v0.0.1-stabilization.md
```

- [ ] Treat `docs/00-codex-entrypoint.md` as recovered normative authority whose content is intentionally updated only to align the canonical read order and the current implemented-product context.

- [ ] Treat this Phase 0 implementation plan as new current implementation authority. It is not part of the recovered byte-preservation set and must be tracked in the Phase 0 commit.

- [ ] The repository has `core.autocrlf=true`, and two recovered reports are observably changed by the current clean filter. Before staging any recovered document, add one exact `-text` entry to `.gitattributes` for each of the 26 paths above. The two CRLF reports, `docs/phase-reports/phase-7-lyrics.md` and `docs/phase-reports/phase-8-transitions.md`, also receive the exact path attribute `whitespace=-trailing-space` so the required `git diff --check` gate does not misclassify their preserved carriage returns. Do not use a wildcard: both exceptions are historical-file-specific, and all other text continues to follow `* text=auto eol=lf`.

- [ ] Do not extract, modify, replace, or stage `docs/phase-reports.zip`. It remains a redundant local archive, not repository authority.

### Step 1.3: Establish importable test seams

- [ ] Create `scripts/repository-authority.mjs` with the public function names from Step 1.5 and deliberately incomplete, side-effect-free return values. The module must import successfully, must not invoke Git at import time, and must not print anything.

- [ ] Create `scripts/check-repository-authority.mjs` as a thin entry point whose process-exit behavior is delegated to an exported `main()` function so tests can exercise it without importing a process that exits.

- [ ] Create `scripts/repository-preservation.mjs` with the public function names from Step 1.5a and deliberately incomplete, side-effect-free return values. No module may inspect the repository, environment, Git, or filesystem at import time.

This is interface scaffolding only. No policy behavior is implemented before its failing test.

### Step 1.4: Add and satisfy failing tests in small TDD slices

- [ ] Create `scripts/repository-authority.test.mjs` and `scripts/repository-preservation.test.mjs`, importing the scaffolded public functions.

- [ ] Define in-memory fixture builders for:

```js
makePolicy(overrides = {}): RepositoryAuthorityPolicy
makeSnapshot(overrides = {}): RepositorySnapshot
findingCodes(findings): string[]
```

- [ ] Add one numbered group at a time. For each group, run the named test, observe an assertion failure for that behavior, implement the smallest change, and rerun it to green before adding the next group:

1. `normalizeDiscoveredRepositoryPath()` converts Windows separators to `/` and removes leading `./`, but throws on drive-qualified, UNC, rooted, empty, ASCII-control, Unicode bidi-control, or `..` traversal input. It also rejects NTFS alternate-data-stream colons, components ending in a dot or space, and Windows device-name stems `CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `COM¹`–`COM³`, `LPT1`–`LPT9`, and `LPT¹`–`LPT³`, case-insensitively and with or without any extension. `validateCanonicalRepositoryPath()` applies the same safety rules to policy document/probe/source paths and additionally rejects backslashes. `validateGitignoreRule()` is separate: it requires a positive root-anchored `/...` rule or a negated root-anchored `!/...` rule, permits only the documented Git glob syntax, and rejects traversal, backslashes, control/bidi characters, malformed negation, every listed ADS/device component, and trailing dot/space components. Unit tests exercise all three validators with the six superscript variants, lowercase forms, and multi-extension examples such as `docs/com².txt` and `/docs/LPT³.tar.gz`. A temporary-Git integration test inserts `docs/COM¹.md` and `docs/lpt³.txt` directly into the index with plumbing commands, without requiring an unsafe worktree checkout, and proves snapshot collection rejects both on Windows and non-Windows hosts.
2. A complete safe policy and snapshot return no findings.
3. An absent required document returns only `REQUIRED_DOCUMENT_MISSING` for that path.
4. An existing but untracked required document returns `REQUIRED_DOCUMENT_UNTRACKED`.
5. A required document that is tracked and ignored returns `AUTHORITY_IS_IGNORED`.
6. A Markdown file found under a configured Markdown root but not tracked returns `MARKDOWN_UNTRACKED`.
7. A discovered Markdown file under a configured Markdown root that is absent from every `documentGroups.paths` list returns `MARKDOWN_UNCLASSIFIED`, even when it is tracked.
8. An actual positive `.gitignore` rule missing from the policy returns `IGNORE_RULE_UNDOCUMENTED`.
9. A policy ignore rule missing from `.gitignore` returns `IGNORE_RULE_MISSING`.
10. A positive generated/local probe that is not ignored returns `IGNORED_ARTIFACT_EXPOSED`.
11. A tracked exception probe that remains ignored returns `TRACKED_EXCEPTION_IGNORED`.
12. Any tracked-and-ignored path returns `TRACKED_PATH_IGNORED`.
13. Every ignored-artifact item requires a valid classification, nonblank owner and producer, a unique positive rule and probe, and valid `sourceInputs`. `dependency-cache` and `generated-output` require at least one source input; `local-secret`, `local-evidence`, `local-tool-state`, and `local-archive` may use an empty list. Every nonempty source input must be safe, existing, and tracked.
14. Every tracked-ignore exception has the exact two-property shape `{"ignorePattern":"!/...","probePath":"..."}`. Positive rules, malformed or duplicate exception rules, duplicate probes, and an ignored exception probe fail policy validation.
15. A tracked generated source without owner, producer, source inputs, or verification command returns `POLICY_METADATA_INVALID`.
16. A tracked generated source that is absent, untracked, or ignored returns respectively `TRACKED_GENERATED_MISSING`, `TRACKED_GENERATED_UNTRACKED`, or `TRACKED_GENERATED_IGNORED`.
17. Required source inputs for a tracked generated source must exist and be tracked.
18. Duplicate document paths, ignore rules, probe paths, source-input paths within an item, and generated-source paths are rejected. Case-fold collisions between any policy, discovered, or tracked repository paths are rejected deterministically even on a case-sensitive host.
19. Findings are deterministic, deduplicated, and sorted by safe `path`, then `code`.
20. `repositoryPathId()` emits `@sha256:<64 lowercase hex>` for every variable/discovered repository path. Formatted diagnostics contain only a fixed code and either that non-reversible ID or one of the fixed locations `.`, `.gitignore`, and `config/repository-authority.json`; an undocumented ignore rule always uses `.gitignore`. No raw discovered filename or ignore rule is stored in a `Finding`.
21. A required authority path or existing ancestor represented by a symlink, junction, or reparse point returns `AUTHORITY_SYMLINK`; an escaped `realpath()` returns `AUTHORITY_OUTSIDE_REPOSITORY`.
22. `parseNullSeparatedIndexEntries()` parses `git ls-files --stage -z` without newline assumptions, retains `{mode, oid, stage}` for each path, and rejects malformed, duplicate, nonzero-stage, or unsupported-object-format records without reflecting their bytes.
23. Every tracked path used as authority, Markdown, a required document, a generated-source declaration, a preservation input, or a source input must have Git mode `100644` or `100755`; mode `120000`, `160000`, or any other mode returns `TRACKED_PATH_UNSAFE_MODE` using only a path ID. A temporary-repository integration test sets `core.symlinks=false` and proves a mode-`120000` index entry is rejected even when its worktree representation is a regular file.
24. A fixed Git-runner failure produces only `REPOSITORY_INSPECTION_FAILED .`, never captured stderr.
25. `lstat`, `readdir`, `realpath`, `readGitignore`, policy-read, invalid UTF-8/JSON, and malformed-policy failures injected with an absolute secret-bearing message collapse to fixed repository/policy findings and never reflect the exception, path, JSON excerpt, or content.
26. Hostile ASCII secret filenames, callback-URL filenames, control/bidi filenames, malformed exception rules, and filesystem/Git failures never occur verbatim in a `Finding`, CLI output, or captured test output.

- [ ] The first red/green slice is:

```powershell
node --test --test-name-pattern="repository path validation" scripts/repository-authority.test.mjs
```

Expected red: an assertion failure from unsafe path handling, not `ERR_MODULE_NOT_FOUND`.

Expected green: only that slice passes after the minimal path implementation.

- [ ] Build `scripts/repository-preservation.test.mjs` one red/green slice at a time. Cover the exact 26-path allowlist; ordinal UTF-8 ordering; domain separator and unsigned 64-bit length prefixes; byte length plus SHA-256 content digest; binary-safe worktree/index/HEAD sources; equality and mismatch without digest/content disclosure; missing/oversized blobs; Git mode `120000` and `160000`; symlink, junction, reparse, escaped real path, and unsafe ancestor rejection; same-size metadata changes being intentionally undetectable; and output restricted to fixed `MATCH count=<n>` or fixed failure codes. Use fake blob readers first, then a temporary Git integration repository with `core.autocrlf=true` and `* text=auto eol=lf`: prove the two known CRLF fixtures change without an exact `-text` rule, remain raw-byte identical with it, and that all 26 policy paths report `text: unset` through NUL-delimited `git check-attr -z text`.

- [ ] Before Step 1.12, add failing/green preservation slices for `parseNullSeparatedRawDiff()`, the exact Phase 0 `{path,status,mode}` constant, `verifyRecoveredIndexBytesAndAttributes()`, and `verifyPhase0StagedIndex()`. Cover additions/modifications, deletion/rename/copy/type/mode changes, hostile names, duplicate or malformed NUL records, Git failure/overflow, raw attribute mismatch, and fixed-output behavior. These functions and their CLI modes must be green before any Phase 0 path is staged.

### Step 1.5: Complete the pure evaluator and Git snapshot collector

- [ ] Complete `scripts/repository-authority.mjs` with JSDoc types and these exports:

```js
normalizeDiscoveredRepositoryPath(input: string): string
repositoryPathId(input: string): string
validateCanonicalRepositoryPath(input: string): boolean
validateGitignoreRule(input: string, expectedNegated: boolean): boolean
parseNullSeparatedIndexEntries(input: Buffer): Map<string, {
  mode: '100644' | '100755' | string,
  oid: string,
  stage: number
}>
validateRepositoryAuthorityPolicy(policy: RepositoryAuthorityPolicy): Finding[]
evaluateRepositoryAuthority(
  policy: RepositoryAuthorityPolicy,
  snapshot: RepositorySnapshot
): Finding[]
collectRepositorySnapshot(
  repositoryRoot: string,
  policy: RepositoryAuthorityPolicy,
  dependencies?: RepositoryInspectionDependencies
): Promise<RepositorySnapshot>
loadRepositoryAuthorityPolicy(repositoryRoot: string): Promise<RepositoryAuthorityPolicy>
runRepositoryAuthorityCheck(repositoryRoot: string): Promise<Finding[]>
formatRepositoryAuthorityFindings(findings: Finding[]): string
```

- [ ] Use this injectable inspection boundary so tests can simulate Git and filesystem failures without exposing their raw messages:

```js
{
  runGit(repositoryRoot: string, args: string[]): Promise<{
    exitCode: number,
    stdout: Buffer,
    stderr: Buffer
  }>,
  lstat(path: string): Promise<Stats>,
  readdir(path: string): Promise<Dirent[]>,
  realpath(path: string): Promise<string>,
  readGitignore(path: string): Promise<Buffer>,
  readPolicy(path: string): Promise<Buffer>
}
```

Production `readGitignore` may read only the root `.gitignore`, and `readPolicy` may read only `config/repository-authority.json`. Both decode with a fatal UTF-8 decoder before parsing. Production Git calls use `execFile`/`spawn` with an argument array, `shell: false`, bounded stdout, discarded stderr, and fixed failure findings for spawn, nonzero, and overflow. Tests inject fixed stdout/exit codes, hostile stderr, and fake directory entries, including symlink and reparse entries, to prove no traversal or disclosure occurs.

- [ ] Use this stable finding shape:

```js
{
  check: 'repository' | 'policy' | 'required-document' | 'markdown' | 'ignore-policy' | 'generated-source',
  code: string,
  path: '.' | '.gitignore' | 'config/repository-authority.json' | `@sha256:${string}`
}
```

- [ ] Use this snapshot shape:

```js
{
  existingPaths: Set<string>,
  symlinkPaths: Set<string>,
  trackedEntries: Map<string, { mode: string, oid: string, stage: number }>,
  trackedIgnoredPaths: Set<string>,
  markdownPaths: Set<string>,
  gitignoreRules: string[],
  ignoredProbePaths: Set<string>,
  inspectionFindings: Finding[]
}
```

- [ ] Collect repository state only through:

- path existence checks for policy-declared paths;
- `lstat`, `realpath`, and recursive directory entry names beneath configured Markdown roots, rejecting and never following symlinks, junctions, or reparse points;
- `git rev-parse --show-toplevel`, requiring the discovered root to equal the requested repository root;
- `git ls-files --stage -z`, retaining and validating mode, object ID, stage, and raw NUL-delimited path;
- `git ls-files -ci --exclude-standard -z`;
- `git check-ignore --no-index --quiet -- <probePath>`;
- non-comment, non-empty rule lines from the root `.gitignore`.

- [ ] Resolve and validate the repository root first. For Markdown roots, required documents, tracked-generated inputs, and every existing ancestor of a declared path or probe, require separator-aware containment beneath the canonical repository real path and reject symlinks, junctions, and reparse points. A nonexistent probe may have a lexical tail, but its nearest existing ancestor must pass the same checks.

- [ ] Never read files beneath ignored artifact paths. Never include file contents, raw discovered paths/rules, command stderr, environment values, or arbitrary Git output in findings. On a Git command failure, return a fixed repository-level finding with path `.`.

- [ ] Validate policy schema before evaluating repository state. Apply canonical repository-path validation to Markdown roots, document paths, probe paths, tracked-generated paths, preservation paths, and source inputs. Apply the separate Gitignore-rule validator to `ignorePattern` and negated exception rules so their required leading `/` or `!/` is not mistaken for a filesystem absolute path. Reject unsupported `schemaVersion`, missing arrays, extra properties in fixed-shape items, unsafe paths/rules, blank metadata, invalid classification, insufficient source inputs, case-fold collisions, and duplicates. Always place `--` before path arguments to Git. Never execute `producer` or `verificationCommand` metadata.

- [ ] Add a temporary-Git-repository integration group using `mkdtemp()` as a direct child of the canonical operating-system temp directory. Before use and again in `finally`, require separator-aware real-path containment, exact direct-child parentage, and no reparse attribute; cleanup only the exact `mkdtemp()` return path. Cover:

- actual `git init`, tracked files, ignored probes, and NUL-delimited collection;
- `core.symlinks=false` with an index mode-`120000` required document that is a regular worktree file but must still fail;
- Git exit codes other than the documented `check-ignore` 0/1 meanings;
- injected stderr that must not appear in findings or formatted evaluator output.
- `lstat`, `readdir`, `realpath`, `.gitignore` read, policy read/parse, spawn, nonzero, and bounded-output failures whose hostile errors must never appear in findings or formatted CLI output.

- [ ] Run the complete unit/integration test:

```powershell
node --test scripts/repository-authority.test.mjs scripts/repository-preservation.test.mjs
```

Expected: PASS.

### Step 1.5a: Complete and run the preservation helper

- [ ] Complete `scripts/repository-preservation.mjs` with:

```js
computeRecoveredDocumentFingerprint(options: {
  repositoryRoot: string,
  paths: string[],
  source: 'worktree' | 'index' | 'HEAD'
}): Promise<{ count: number, digest: Buffer }>
computeStaticLocalMetadataFingerprint(options: {
  repositoryRoot: string,
  paths: string[]
}): Promise<{ count: number, digest: Buffer }>
comparePreservationFingerprints(expected, actual): { match: boolean, count: number }
formatPreservationComparison(result): string
parseNullSeparatedRawDiff(input: Buffer): StagedEntry[]
verifyRecoveredCleanFilterIsRaw(repositoryRoot: string): Promise<{
  match: boolean,
  count: number
}>
verifyRecoveredIndexBytesAndAttributes(repositoryRoot: string): Promise<{
  match: boolean,
  count: number
}>
verifyPhase0StagedIndex(repositoryRoot: string): Promise<{
  match: boolean,
  count: number
}>
main(argv?: string[]): Promise<number>
```

The implementation uses binary-safe buffers; exact fixed allowlists; no-follow ancestor validation; NUL-delimited `git diff --cached --raw -z` and `git check-attr -z`; `execFile` with `shell: false`, bounded stdout, fixed timeout, and discarded stderr for Git; and no path, content, digest, or raw error in formatted output. It never writes a baseline file. `verifyRecoveredCleanFilterIsRaw` requires every recovered path's `text` attribute to be `unset`, rejects additional effective attribute sources, and requires isolated `git hash-object --no-filters --stdin` to equal isolated `git hash-object --path=<path> --stdin` for the same bounded buffer before staging. `verifyRecoveredIndexBytesAndAttributes` additionally requires all 26 worktree/index fingerprints and their final snapshots to match after staging.

- [ ] Implement these exact, mutually exclusive CLI modes before staging:

```text
capture-recovered --source=worktree|index|HEAD
capture-static-local
compare-recovered --source=worktree|index|HEAD --expected-token=v1:<count>:<sha256>
compare-static-local --expected-token=v1:<count>:<sha256>
verify-recovered-index
verify-recovered-clean-filter
verify-phase0-staged-index
```

`--repository-root=<absolute-path>` is optional and defaults to the current directory. Capture modes write only the machine token to stdout so the uncaptured shell can assign it without displaying it. Compare/verify modes write only `MATCH count=<n>` on success. Exit 0 means success, exit 1 means mismatch, and exit 2 means fixed argument/inspection failure. Unknown/mixed/duplicate options, invalid token length/hex/count, Git/fs exceptions, and output overflow write only a fixed code and `.` to stderr. Tests invoke the real CLI for every exit contract.

- [ ] Run the complete tests. Then, before changing `.gitattributes`, `.gitignore`, or any document, compute the recovered worktree and static-local metadata baselines from Step 1.1 in one uncaptured active shell and retain only the two machine-token strings in shell memory. Do not echo them. Expected recovered count is 26. If the active shell or either value is lost, stop rather than re-baselining after migration edits.

```powershell
$recoveredBaselineToken = (& node scripts/repository-preservation.mjs capture-recovered --source=worktree).Trim()
if ($LASTEXITCODE -ne 0) { throw "Unable to capture recovered baseline." }
$staticLocalBaselineToken = (& node scripts/repository-preservation.mjs capture-static-local).Trim()
if ($LASTEXITCODE -ne 0) { throw "Unable to capture static-local baseline." }
```

The assignment suppresses stdout display; never print either variable or place it in a command that h5i captures.

### Step 1.6: Prove the real repository is red

- [ ] Complete `scripts/check-repository-authority.mjs` as a thin CLI exporting:

```js
main(options?: MainOptions): Promise<number>
```

`MainOptions` supplies only `repositoryRoot`, `stdout.write`, and `stderr.write`; production defaults are `process.cwd()`, `process.stdout`, and `process.stderr`. The function returns an exit code and never calls `process.exit()`.

Behavior:

- print `Repository authority: PASS` and exit 0 when no findings exist;
- print one `CODE path` line per finding and exit 1 otherwise;
- print no file contents or Git stderr.
- call `main()` only when the module is the process entry point and assign its returned code to `process.exitCode`, so importing it in tests has no process side effects.

- [ ] Extend the temporary-repository test group only now that the CLI is complete:

- invoke the CLI entry point against a valid temporary repository and assert exit 0 plus the fixed PASS line;
- introduce one contract violation and assert exit 1 plus only fixed `CODE path` diagnostics;
- import the CLI module and prove that import alone does not write output or change `process.exitCode`.

- [ ] Create an initial `config/repository-authority.json` containing the intended final document and artifact contract, then run:

```powershell
node scripts/check-repository-authority.mjs
```

Expected: FAIL on the current repository because the blanket ignores remain and the recovered documents are not yet tracked. The failure must include `AUTHORITY_IS_IGNORED`, `REQUIRED_DOCUMENT_UNTRACKED`, and/or `MARKDOWN_UNTRACKED`, and must not reveal contents.

### Step 1.7: Define the machine-readable authority policy

- [ ] Use this top-level JSON structure:

```json
{
  "schemaVersion": 1,
  "markdownRoots": ["docs"],
  "documentGroups": [],
  "ignoredArtifacts": [],
  "trackedIgnoreExceptions": [],
  "trackedGeneratedSources": [],
  "preservation": {
    "rawByteAttributesFile": ".gitattributes",
    "recoveredDocuments": [],
    "staticLocalPaths": []
  }
}
```

`preservation.rawByteAttributesFile` is exactly `.gitattributes`; `preservation.recoveredDocuments` is exactly the 26 paths in Step 1.2; and `preservation.staticLocalPaths` is exactly `docs/phase-reports.zip`, `CLAUDE.md`, `goal`, `.superpowers`, and `.claude`. The authority checker requires the attributes file and all recovered documents to be tracked regular blobs, non-ignored, safe, and cross-list-unique but never reads their contents; only `repository-preservation.mjs` performs the bounded, explicitly requested preservation reads and attribute checks.

- [ ] Every `documentGroups` item has:

```json
{
  "name": "stable-group-name",
  "classification": "normative | operational | historical-evidence | implementation-plan",
  "paths": ["repository/relative/path.md"]
}
```

- [ ] Use these exact document groups and classifications:

`repository-entry` (`normative`):

```text
AGENTS.md
```

`user-entry` (`operational`):

```text
README.md
```

`project-governance` (`normative`):

```text
docs/README.md
docs/00-codex-entrypoint.md
docs/01-project-goals-and-non-goals.md
docs/02-repository-structure.md
docs/03-implementation-phases.md
docs/04-quality-gates.md
docs/05-repository-authority.md
docs/30-subagent-matrix.md
```

`domain-specifications` (`normative`):

```text
docs/10-spotify-integration.md
docs/11-wallpaper-engine.md
docs/12-rust-wasm-core.md
docs/13-settings-schema.md
docs/14-ui-layout.md
docs/15-background-theme.md
docs/16-visualizer.md
docs/17-lyrics.md
docs/18-transitions.md
docs/19-player-clock.md
docs/20-tauri-configurator.md
docs/21-rainmeter.md
docs/22-performance.md
docs/23-test-qa.md
docs/24-docs-and-reporting.md
docs/25-public-backend.md
```

`operator-and-user-documents` (`operational`):

```text
docs/eula.md
docs/how-to-use-h5i.md
docs/operations/cloudflare-worker-deploy.md
docs/operations/cloudflare-worker-incident-response.md
docs/operations/cloudflare-worker-key-rotation.md
docs/operations/cloudflare-worker-restore.md
docs/post-v0.0.1-stabilization.md
docs/privacy.md
docs/qa-checklist.md
docs/release-notes-public-backend-beta.md
docs/release-notes-v0.0.1.md
docs/user-guide.md
```

`approved-designs` (`normative`):

```text
docs/superpowers/specs/2026-07-27-system-wide-refactoring-design.md
```

`current-plans` (`implementation-plan`):

```text
docs/superpowers/plans/README.md
docs/superpowers/plans/2026-07-27-system-wide-refactor-phase-0-repository-specification-truth.md
```

`historical-plans` (`historical-evidence`):

```text
docs/superpowers/plans/2026-07-18-cloudflare-worker-public-backend.md
```

`phase-report-index` (`operational`):

```text
docs/phase-reports/README.md
```

`phase-reports` (`historical-evidence`):

```text
docs/phase-reports/cloudflare-worker-public-backend.md
docs/phase-reports/final-implementation-report.md
docs/phase-reports/lyrics-deferred-spec-update.md
docs/phase-reports/one-click-spotify-auth-token.md
docs/phase-reports/phase-0-scaffold-and-mock-preview.md
docs/phase-reports/phase-1-spotify-mvp.md
docs/phase-reports/phase-2-wallpaper-engine-bridge.md
docs/phase-reports/phase-3-rust-wasm-core.md
docs/phase-reports/phase-4-settings-layout-customization.md
docs/phase-reports/phase-5-background-theme.md
docs/phase-reports/phase-6-visualizer.md
docs/phase-reports/phase-7-lyrics.md
docs/phase-reports/phase-8-transitions.md
docs/phase-reports/phase-9-player-clock.md
docs/phase-reports/phase-10-tauri-configurator.md
docs/phase-reports/phase-11-rainmeter.md
docs/phase-reports/phase-12-final-qa-docs.md
docs/phase-reports/post-v0.0.1-stabilization.md
docs/phase-reports/rc-2-wallpaper-engine-property-types.md
docs/phase-reports/system-wide-refactor-phase-0-repository-specification-truth.md
```

- [ ] Enforce exact classification coverage: the set of discovered `docs/**/*.md` paths must equal the set of `documentGroups.paths` entries beneath `docs/`. A newly tracked Markdown file without a group is a failure; a grouped file that is missing, untracked, ignored, duplicated, or symlinked is also a failure. `AGENTS.md` and root `README.md` are the only required document-group entries outside the configured Markdown root in schema version 1.

- [ ] Every `ignoredArtifacts` item has:

```json
{
  "ignorePattern": "/root-anchored-pattern/",
  "probePath": "representative/repository/path",
  "classification": "dependency-cache | generated-output | local-secret | local-evidence | local-tool-state | local-archive",
  "owner": "responsible subsystem or local operator",
  "producer": "command or actor that creates it",
  "sourceInputs": ["tracked/input/path"]
}
```

`sourceInputs` may be empty only for local secrets, local operator evidence, local archives, and local tool state.

Every `generated-output` item must have one owned policy entry with a root-anchored `ignorePattern`, `owner`, `producer`, non-empty `sourceInputs`, and a matching ignore-state probe. Phase 0 validates only this ownership metadata and the declared ignore state. Generated-output content inspection is deliberately deferred to Phase 1.

- [ ] Use the following exact ignored-artifact ownership entries. Each semicolon-separated source input is a separate tracked path:

| Ignore rule | Probe path | Classification | Owner | Producer | Source inputs |
|---|---|---|---|---|---|
| `/node_modules/` | `node_modules/.repository-authority-probe` | dependency-cache | root npm workspace | `npm ci` | `package.json`; `package-lock.json` |
| `/apps/*/node_modules/` | `apps/wallpaper/node_modules/.repository-authority-probe` | dependency-cache | application workspaces | `npm ci --workspaces` | `package.json`; `package-lock.json` |
| `/packages/*/node_modules/` | `packages/shared-types/node_modules/.repository-authority-probe` | dependency-cache | package workspaces | `npm ci --workspaces` | `package.json`; `package-lock.json` |
| `/target/` | `target/.repository-authority-probe` | generated-output | root Rust workspace | `cargo build`, `cargo check`, or `cargo test` | `Cargo.toml`; `Cargo.lock` |
| `/apps/configurator/src-tauri/target/` | `apps/configurator/src-tauri/target/.repository-authority-probe` | generated-output | Tauri Rust workspace | Tauri Cargo build/check/test | `apps/configurator/src-tauri/Cargo.toml`; `apps/configurator/src-tauri/Cargo.lock` |
| `/apps/configurator/src-tauri/gen/` | `apps/configurator/src-tauri/gen/.repository-authority-probe` | generated-output | Tauri configurator | `npm run tauri:build -w @spotify-wallpaper/configurator` | `apps/configurator/package.json`; `apps/configurator/src-tauri/tauri.conf.json` |
| `/apps/*/dist/` | `apps/wallpaper/dist/.repository-authority-probe` | generated-output | web application workspaces | `npm run build` | `package.json`; `package-lock.json` |
| `/apps/*/.vite/` | `apps/wallpaper/.vite/.repository-authority-probe` | generated-output | Vite application workspaces | Vite dev/build commands | `package.json`; `package-lock.json` |
| `/packages/*/dist/` | `packages/shared-types/dist/.repository-authority-probe` | generated-output | shared package workspaces | `npm run build -w @spotify-wallpaper/shared-types` | `packages/shared-types/package.json`; `package-lock.json` |
| `/apps/spotify-auth/pages/` | `apps/spotify-auth/pages/.repository-authority-probe` | generated-output | Spotify auth static export | `node apps/spotify-auth/prepare-pages.mjs` | `apps/spotify-auth/prepare-pages.mjs`; `apps/spotify-auth/package.json` |
| `/apps/wallpaper/public/wasm/` | `apps/wallpaper/public/wasm/.repository-authority-probe` | generated-output | visual-core WASM package | `npm run build:wasm` | `package.json`; `crates/visual-core/Cargo.toml`; `Cargo.lock` |
| `/apps/cloudflare-worker/.wrangler/` | `apps/cloudflare-worker/.wrangler/.repository-authority-probe` | local-tool-state | Cloudflare Worker local runtime | Wrangler dev/deploy | none |
| `/apps/cloudflare-worker/.wrangler.*.generated.json` | `apps/cloudflare-worker/.wrangler.preview.generated.json` | generated-output | Worker deployment configuration | `npm run prepare:deploy:preview -w @spotify-wallpaper/cloudflare-worker` | `apps/cloudflare-worker/prepare-deploy-config.mjs`; `apps/cloudflare-worker/wrangler.jsonc` |
| `/apps/cloudflare-worker/.wrangler.*.generated.json.*.tmp` | `apps/cloudflare-worker/.wrangler.preview.generated.json.1.probe.tmp` | generated-output | Worker deployment configuration | atomic temporary output from `prepare-deploy-config.mjs` | `apps/cloudflare-worker/prepare-deploy-config.mjs`; `apps/cloudflare-worker/wrangler.jsonc` |
| `/apps/cloudflare-worker/dist-preview/` | `apps/cloudflare-worker/dist-preview/.repository-authority-probe` | generated-output | Worker preview dry-run | preview Wrangler dry-run from the deployment runbook | `apps/cloudflare-worker/wrangler.jsonc`; `docs/operations/cloudflare-worker-deploy.md` |
| `/apps/cloudflare-worker/dist-production/` | `apps/cloudflare-worker/dist-production/.repository-authority-probe` | generated-output | Worker production dry-run | production Wrangler dry-run from the deployment runbook | `apps/cloudflare-worker/wrangler.jsonc`; `docs/operations/cloudflare-worker-deploy.md` |
| `/dist-preview/` | `dist-preview/.repository-authority-probe` | generated-output | repository-level Worker preview evidence | preview Wrangler dry-run from the deployment runbook | `apps/cloudflare-worker/wrangler.jsonc`; `docs/operations/cloudflare-worker-deploy.md` |
| `/dist-production/` | `dist-production/.repository-authority-probe` | generated-output | repository-level Worker production evidence | production Wrangler dry-run from the deployment runbook | `apps/cloudflare-worker/wrangler.jsonc`; `docs/operations/cloudflare-worker-deploy.md` |
| `/**/.env` | `apps/configurator/src-tauri/.env` | local-secret | repository operator | local environment configuration at any depth | none |
| `/**/.env.*` | `crates/visual-core/fixtures/.env.local` | local-secret | repository operator | local environment configuration at any depth | none |
| `/**/.dev.vars` | `apps/cloudflare-worker/nested/.dev.vars` | local-secret | Worker operator | Wrangler local secret configuration at any depth | none |
| `/**/.dev.vars.*` | `apps/cloudflare-worker/nested/.dev.vars.local` | local-secret | Worker operator | Wrangler local secret configuration at any depth | none |
| `/**/.envrc` | `apps/cloudflare-worker/nested/.envrc` | local-secret | repository operator | direnv configuration at any depth | none |
| `/**/.envrc.*` | `apps/cloudflare-worker/nested/.envrc.local` | local-secret | repository operator | direnv configuration at any depth | none |
| `/**/.direnv/` | `apps/configurator/src-tauri/.direnv/.repository-authority-probe` | local-secret | repository operator | direnv generated environment at any depth | none |
| `/artifacts/` | `artifacts/.repository-authority-probe` | local-evidence | QA/release operator | local verification or packaging command | none |
| `/docs/phase-reports.zip` | `docs/phase-reports.zip` | local-archive | repository operator | manually recovered report archive | none |
| `/.codex-*.log` | `.codex-repository-authority-probe.log` | local-evidence | local development process | local diagnostic command | none |
| `/.codex/` | `.codex/.repository-authority-probe` | local-tool-state | Codex | Codex task/report state | none |
| `/.codegraph/` | `.codegraph/.repository-authority-probe` | local-tool-state | CodeGraph | `codegraph index` | none |
| `/.superpowers/` | `.superpowers/.repository-authority-probe` | local-tool-state | local agent tooling | local planning/tool state | none |
| `/goal/` | `goal/.repository-authority-probe` | local-tool-state | local task tooling | local goal state | none |
| `/.agents/` | `.agents/.repository-authority-probe` | local-tool-state | local agent tooling | local agent state | none |
| `/.claude/` | `.claude/.repository-authority-probe` | local-tool-state | local agent tooling | local Claude state | none |
| `/CLAUDE.md` | `CLAUDE.md` | local-tool-state | local agent tooling | local Claude instructions | none |

- [ ] Every `trackedIgnoreExceptions` item has exactly this JSON shape, an exact negated `.gitignore` rule, and a representative probe that must remain non-ignored:

```json
{
  "ignorePattern": "!/**/.env.example",
  "probePath": "apps/wallpaper/.env.example"
}
```

Use exactly:

| Negated rule | Non-ignored probe |
|---|---|
| `!/**/.env.example` | `apps/wallpaper/.env.example` |
| `!/**/.dev.vars.example` | `apps/cloudflare-worker/.dev.vars.example` |
| `!/**/.envrc.example` | `apps/cloudflare-worker/.envrc.example` |

Unit and temporary-repository integration tests additionally probe the repository root and a path at least three directories deep for every recursive positive rule and exception, so a single representative policy probe cannot conceal incorrect recursive Gitignore semantics.

- [ ] Register exactly one `trackedGeneratedSources` item:

```json
{
  "path": "apps/cloudflare-worker/worker-configuration.d.ts",
  "owner": "Cloudflare Worker type boundary",
  "producer": "npm run types -w @spotify-wallpaper/cloudflare-worker",
  "sourceInputs": [
    "apps/cloudflare-worker/package.json",
    "apps/cloudflare-worker/normalize-generated-types.mjs",
    "apps/cloudflare-worker/wrangler.jsonc",
    "package-lock.json"
  ],
  "verificationCommand": "npm run types -w @spotify-wallpaper/cloudflare-worker, then git diff --exit-code -- apps/cloudflare-worker/worker-configuration.d.ts"
}
```

- [ ] Classify `package-lock.json`, root `Cargo.lock`, and `apps/configurator/src-tauri/Cargo.lock` as tracked reproducibility inputs in `docs/05-repository-authority.md`, not as generated output exceptions.

### Step 1.7a: Pin recovered historical files to raw Git blobs

- [ ] Keep the existing first line of `.gitattributes` unchanged:

```gitattributes
* text=auto eol=lf
```

Append a commented `Recovered historical evidence: preserve original bytes` section containing exactly the 26 Step 1.2 repository paths, one per line followed by ` -text`. Do not apply `-text` to `docs/00-codex-entrypoint.md`, current plans/reports, all Markdown, or a directory wildcard.

- [ ] Before staging, run:

```powershell
node scripts/repository-preservation.mjs verify-recovered-clean-filter
```

Expected: `MATCH count=26`. This proves the clean filter now hashes the exact worktree bytes, including the two previously mismatching CRLF reports. A test removes either known `-text` rule under `core.autocrlf=true` and must reproduce a fixed mismatch.

### Step 1.8: Replace blanket ignores with explicit owned paths

- [ ] Replace `.gitignore` with commented, root-scoped sections whose non-comment rules exactly match the policy.

The final rule set must cover:

```text
/node_modules/
/apps/*/node_modules/
/packages/*/node_modules/
/target/
/apps/configurator/src-tauri/target/
/apps/configurator/src-tauri/gen/
/apps/*/dist/
/apps/*/.vite/
/packages/*/dist/
/apps/spotify-auth/pages/
/apps/wallpaper/public/wasm/
/apps/cloudflare-worker/.wrangler/
/apps/cloudflare-worker/.wrangler.*.generated.json
/apps/cloudflare-worker/.wrangler.*.generated.json.*.tmp
/apps/cloudflare-worker/dist-preview/
/apps/cloudflare-worker/dist-production/
/dist-preview/
/dist-production/
/**/.env
/**/.env.*
!/**/.env.example
/**/.dev.vars
/**/.dev.vars.*
!/**/.dev.vars.example
/**/.envrc
/**/.envrc.*
!/**/.envrc.example
/**/.direnv/
/artifacts/
/docs/phase-reports.zip
/.codex-*.log
/.codex/
/.codegraph/
/.superpowers/
/goal/
/.agents/
/.claude/
/CLAUDE.md
```

- [ ] Remove the `AGENTS.md` and `docs/` blanket rules.

- [ ] Do not add a blanket ignore for Markdown, `config/`, `scripts/`, `.github/`, `examples/`, or `tests/`.

- [ ] Confirm authority exposure and local protection before staging with explicit PowerShell exit-code assertions. `git check-ignore` exit 1 means “not ignored,” exit 0 means “ignored,” and every other exit is an inspection failure:

```powershell
foreach ($authorityPath in @('AGENTS.md', 'README.md', 'docs/README.md', 'docs/00-codex-entrypoint.md')) {
  git check-ignore --no-index -- $authorityPath
  if ($LASTEXITCODE -ne 1) { throw "Authority path must not be ignored: $authorityPath" }
}

foreach ($localPath in @(
  'docs/phase-reports.zip',
  'goal/docs',
  '.codex/reports',
  'apps/configurator/src-tauri/.env',
  'crates/visual-core/fixtures/.env.local',
  'apps/cloudflare-worker/nested/.dev.vars',
  'apps/cloudflare-worker/nested/.envrc',
  'apps/configurator/src-tauri/.direnv/.repository-authority-probe'
)) {
  git check-ignore --no-index -- $localPath
  if ($LASTEXITCODE -ne 0) { throw "Local path must remain ignored: $localPath" }
}

foreach ($examplePath in @(
  '.env.example',
  'apps/wallpaper/.env.example',
  'packages/shared-types/deep/.env.example',
  'apps/cloudflare-worker/.dev.vars.example',
  'apps/cloudflare-worker/.envrc.example'
)) {
  git check-ignore --no-index -- $examplePath
  if ($LASTEXITCODE -ne 1) { throw "Tracked example path must not be ignored." }
}
```

Expected:

- authority and example probes are non-ignored;
- all exact local probes are ignored at root and nested depths;
- no arbitrary ignored path or ignore-rule text is printed.

### Step 1.9: Align repository documentation without rewriting history

- [ ] Update `AGENTS.md` to:

- point to `docs/05-repository-authority.md`;
- state that the approved system-wide refactor design owns the current refactor sequence while `docs/03-implementation-phases.md` preserves product-construction order;
- include all report fields required by the approved design;
- preserve every existing secrets, performance, mock-mode, optional-integration, command, and CodeGraph rule.

- [ ] Update `docs/00-codex-entrypoint.md` to match the `AGENTS.md` read order and describe work on an implemented product rather than instructing agents to create a new project.

- [ ] Update `docs/README.md` to index:

- entry and domain documents, including `docs/05-repository-authority.md`;
- release/QA/user documents;
- operations runbooks;
- normative specs and implementation plans;
- historical phase reports;
- the distinction between `docs/post-v0.0.1-stabilization.md` and its phase-report namesake.

- [ ] Update `docs/02-repository-structure.md` to match the real tree, adding at least:

- `apps/spotify-auth/`;
- `config/`;
- `scripts/`;
- `.github/workflows/`;
- `examples/`;
- the real purpose of `tests/`;
- tracked authority versus ignored output ownership.

- [ ] Update `docs/24-docs-and-reporting.md` so new reports require exactly:

```text
Phase name
Summary
Changed files
Relevant docs read
Implemented requirements
Known gaps
Tests run
Risks introduced
Review outcome
Fixes from review
Verification commands
Next recommended task
```

- [ ] Create `docs/05-repository-authority.md` documenting:

- authority classifications and precedence;
- Git-tracked state as the clean-clone truth;
- all `docs/**/*.md` as tracked material;
- historical reports and executed plans as non-normative evidence;
- the exact 26-path `.gitattributes -text` exception as the raw-byte preservation boundary;
- ignored artifact ownership and producer categories;
- the Worker type declaration as the sole tracked generated-source exception;
- lockfiles as tracked reproducibility inputs;
- checker behavior and fixed-location/non-reversible-path-ID diagnostics;
- explicit migration/staging safeguards;
- ownership changes requiring policy, tests, docs, and review in the same commit.

- [ ] Create `docs/phase-reports/README.md` as a catalog that:

- lists all historical reports;
- states that report prose is historical narrative, not current normative behavior or necessarily an exact commit diff;
- identifies the old lyrics/phase-number sequence as superseded by current specs;
- points current behavior to `AGENTS.md`, `docs/01`–`docs/25`, and the approved refactor design;
- records that recovered reports began tracked history in Phase 0 without altering their bytes.

- [ ] Create `docs/superpowers/plans/README.md` that:

- marks the 2026-07-18 Worker plan as executed historical intent for baseline `455dcf1`;
- explains that its unchecked boxes are not current execution status;
- identifies the approved refactor design and this Phase 0 plan as current authority for the ongoing work.

### Step 1.10: Integrate package and CI entry points

- [ ] Add these scripts to the root `package.json`:

```json
"test:repository-authority": "node --test scripts/repository-authority.test.mjs scripts/repository-preservation.test.mjs",
"check:repository-authority": "node scripts/check-repository-authority.mjs",
"check:repository-preservation": "node scripts/repository-preservation.mjs verify-recovered-index",
"verify:repository-authority": "npm run test:repository-authority && npm run check:repository-authority && npm run check:repository-preservation"
```

- [ ] Change the root `test` script to run the repository-authority suite before workspace tests:

```json
"test": "npm run test:repository-authority && npm run test --workspaces --if-present"
```

- [ ] Add exactly one step to `.github/workflows/ci.yml` after `Setup Node` and before Rust setup/dependency installation:

```yaml
- name: Verify repository authority
  run: npm run verify:repository-authority
```

- [ ] Do not edit workflow triggers, action versions, toolchain selection, or any other CI step in Phase 0.

### Step 1.11: Create the in-progress Phase 0 report

- [ ] Create `docs/phase-reports/system-wide-refactor-phase-0-repository-specification-truth.md` before the first green repository check because the policy requires that report to exist and be tracked.

- [ ] Include every field required by `docs/24-docs-and-reporting.md`. Before gates and review, use explicit factual state such as “not run; Phase 0 remains incomplete” rather than fabricated results or ambiguous placeholders.

- [ ] Record the source as “this Phase 0 commit; resolve via this report path in Git history.” Do not invent a commit SHA before committing.

- [ ] After verification, replace the in-progress test entries with exact command outcomes. After substantive review, record:

- quality, Security, and SpecGuard outcomes;
- every finding and its `valid`, `invalid`, `duplicate`, or `deferred` classification;
- every fix and rerun;
- exact verification commands and known pre-existing red gates;
- Phase 1 as the next task.

### Step 1.12: Stage only the exact Phase 0 allowlist and turn the repository check green

- [ ] Stage infrastructure, current authority, indexes, the current plan, and the in-progress report with this exact command:

```powershell
git add -- .gitattributes .gitignore .github/workflows/ci.yml AGENTS.md package.json config/repository-authority.json scripts/repository-authority.mjs scripts/check-repository-authority.mjs scripts/repository-authority.test.mjs scripts/repository-preservation.mjs scripts/repository-preservation.test.mjs docs/README.md docs/00-codex-entrypoint.md docs/02-repository-structure.md docs/05-repository-authority.md docs/24-docs-and-reporting.md docs/phase-reports/README.md docs/superpowers/plans/README.md docs/superpowers/plans/2026-07-27-system-wide-refactor-phase-0-repository-specification-truth.md docs/phase-reports/system-wide-refactor-phase-0-repository-specification-truth.md
```

- [ ] Stage the recovered domain/release material and historical Worker plan with this exact command:

```powershell
git add -- docs/12-rust-wasm-core.md docs/14-ui-layout.md docs/15-background-theme.md docs/16-visualizer.md docs/17-lyrics.md docs/18-transitions.md docs/21-rainmeter.md docs/release-notes-v0.0.1.md docs/superpowers/plans/2026-07-18-cloudflare-worker-public-backend.md
```

- [ ] Stage the recovered historical reports with this exact command:

```powershell
git add -- docs/phase-reports/final-implementation-report.md docs/phase-reports/lyrics-deferred-spec-update.md docs/phase-reports/one-click-spotify-auth-token.md docs/phase-reports/phase-0-scaffold-and-mock-preview.md docs/phase-reports/phase-1-spotify-mvp.md docs/phase-reports/phase-2-wallpaper-engine-bridge.md docs/phase-reports/phase-3-rust-wasm-core.md docs/phase-reports/phase-4-settings-layout-customization.md docs/phase-reports/phase-5-background-theme.md docs/phase-reports/phase-6-visualizer.md docs/phase-reports/phase-7-lyrics.md docs/phase-reports/phase-8-transitions.md docs/phase-reports/phase-9-player-clock.md docs/phase-reports/phase-10-tauri-configurator.md docs/phase-reports/phase-11-rainmeter.md docs/phase-reports/phase-12-final-qa-docs.md docs/phase-reports/post-v0.0.1-stabilization.md
```

- [ ] Never use a broad add command. `repository-preservation.mjs` contains the exact Phase 0 `{path,status,mode}` allowlist corresponding to the three commands above and exposes `verifyPhase0StagedIndex(repositoryRoot)`. It obtains `git diff --cached --raw -z` with `execFile`, parses paths without newline assumptions, and compares the complete set before any human-readable diff command. A mismatch emits only `PHASE0_STAGED_ALLOWLIST_MISMATCH .` plus counts, never the unexpected path. Unit tests cover added/modified/deleted/renamed entries, mode drift, duplicates, hostile filenames, malformed records, Git failure, stderr non-reflection, and output overflow.

The expected set has 46 regular `100644` entries: status `M` for exactly `.gitattributes`, `.gitignore`, `.github/workflows/ci.yml`, `AGENTS.md`, `package.json`, `docs/README.md`, `docs/02-repository-structure.md`, and `docs/24-docs-and-reporting.md`; status `A` for the other 38 paths, including the recovered-but-untracked `docs/00-codex-entrypoint.md`. No deletion, rename, copy, type change, executable-bit change, submodule, or additional path is allowed.

- [ ] Immediately run the machine comparison, then inspect only the now-proven trusted allowlist:

```powershell
git diff --exit-code --quiet
if ($LASTEXITCODE -ne 0) { throw "Unstaged tracked changes exist." }
node scripts/repository-preservation.mjs verify-phase0-staged-index
if ($LASTEXITCODE -ne 0) { throw "Phase 0 staged allowlist mismatch." }
git diff --cached --name-status
git diff --cached --stat
git diff --cached --check *> $null
if ($LASTEXITCODE -ne 0) { throw "Staged whitespace check failed." }
```

Expected:

- `.codex/`, `goal/`, `.codegraph/`, generated output, local logs, `CLAUDE.md`, and the ZIP are absent from the index;
- all policy-required Markdown, including this plan, is in the index;
- recovered historical files are additions, not deletions or renames.

- [ ] Run:

```powershell
npm run verify:repository-authority
$trackedIgnoredCount = @(git ls-files -ci --exclude-standard).Count
if ($LASTEXITCODE -ne 0 -or $trackedIgnoredCount -ne 0) { throw "Tracked ignored paths remain." }
git diff --cached --check *> $null
if ($LASTEXITCODE -ne 0) { throw "Staged whitespace check failed." }
```

Expected:

- every command exits 0;
- `git ls-files -ci --exclude-standard` prints nothing;
- checker output is `Repository authority: PASS`.

### Step 1.13: Verify preservation, full baseline gates, mock mode, and scope

- [ ] In the same uncaptured shell that retains the Step 1.5a baseline tokens, recompute and compare:

```text
initial recovered worktree = current recovered worktree = current index blobs
initial static-local metadata = current static-local metadata
```

Invoke the preservation helper's fixed-output compare modes without h5i:

```powershell
node scripts/repository-preservation.mjs compare-recovered --source=worktree "--expected-token=$recoveredBaselineToken"
if ($LASTEXITCODE -ne 0) { throw "Recovered worktree preservation failed." }
node scripts/repository-preservation.mjs compare-recovered --source=index "--expected-token=$recoveredBaselineToken"
if ($LASTEXITCODE -ne 0) { throw "Recovered index preservation failed." }
node scripts/repository-preservation.mjs verify-recovered-index
if ($LASTEXITCODE -ne 0) { throw "Recovered index/attribute verification failed." }
node scripts/repository-preservation.mjs compare-static-local "--expected-token=$staticLocalBaselineToken"
if ($LASTEXITCODE -ne 0) { throw "Static-local preservation failed." }
```

Do not print or persist the tokens. Record only `MATCH count=26` for recovered worktree/index and `MATCH count=<n>` for static-local metadata.

Expected:

- all 26 recovered worktree files, their exact index blobs after Git clean-filter/EOL processing, and the initial baseline have identical aggregate byte fingerprints;
- the ZIP and static protected local files have the exact original metadata-only aggregate and count; this proves path/type/size stability, not same-size content stability;
- mutable local/tool/build paths still exist where they existed before, remain ignored, have no staged deletion, and are allowed to gain or change generated files.

- [ ] Prove the local-secret ignore contract at both repository root and nested depth without opening any candidate. Every prohibited probe must be ignored; the three exact `.example` forms must remain non-ignored. Also require zero tracked-and-ignored paths:

```powershell
$mustBeIgnored = @(
  '.env',
  'apps/wallpaper/a/b/.env.local',
  '.dev.vars',
  'apps/wallpaper/a/b/.dev.vars.local',
  '.envrc',
  'apps/wallpaper/a/b/.envrc.local',
  '.direnv/probe',
  'apps/wallpaper/a/b/.direnv/probe'
)
foreach ($probe in $mustBeIgnored) {
  git check-ignore --quiet --no-index -- $probe
  if ($LASTEXITCODE -ne 0) { throw "Required local-secret ignore probe failed." }
}

$mustRemainVisible = @(
  '.env.example',
  'apps/wallpaper/a/b/.env.example',
  '.dev.vars.example',
  'apps/wallpaper/a/b/.dev.vars.example',
  '.envrc.example',
  'apps/wallpaper/a/b/.envrc.example'
)
foreach ($probe in $mustRemainVisible) {
  git check-ignore --quiet --no-index -- $probe
  if ($LASTEXITCODE -eq 0) { throw "Required example exception is ignored." }
  if ($LASTEXITCODE -ne 1) { throw "Ignore probe inspection failed." }
}

$trackedIgnoredCount = @(git ls-files -ci --exclude-standard).Count
if ($LASTEXITCODE -ne 0 -or $trackedIgnoredCount -ne 0) {
  throw "Tracked ignored paths remain."
}
```

- [ ] Before any h5i capture, prove there is no unstaged tracked drift and no protected generated-input drift:

```powershell
git diff --exit-code --quiet
if ($LASTEXITCODE -ne 0) { throw "Unstaged tracked changes exist." }
git diff --exit-code --quiet -- package-lock.json Cargo.lock apps/configurator/src-tauri/Cargo.lock apps/cloudflare-worker/worker-configuration.d.ts
if ($LASTEXITCODE -ne 0) { throw "Protected working-tree input changed." }
git diff --cached --exit-code --quiet -- package-lock.json Cargo.lock apps/configurator/src-tauri/Cargo.lock apps/cloudflare-worker/worker-configuration.d.ts
if ($LASTEXITCODE -ne 0) { throw "Protected input was staged." }
node scripts/repository-preservation.mjs verify-phase0-staged-index
if ($LASTEXITCODE -ne 0) { throw "Phase 0 staged allowlist mismatch." }
```

- [ ] Define `Assert-Phase0CaptureSafe` only in the active PowerShell process; do not add it to the repository. It is a name-only guard, not a credential parser or Phase 0 security gate. It inspects only `Object.keys(process.env)`, never environment values, and obtains path names with three `shell:false` Git calls: tracked, untracked/non-ignored, and ignored. The combined NUL-delimited output has a fixed 16 MiB bound and fatal UTF-8/NUL parsing. It recognizes case-insensitive `.env`, `.env.*`, `.dev.vars`, `.dev.vars.*`, `.envrc`, `.envrc.*`, and any `.direnv` component, allowing only the three exact `.example` basenames. It also recognizes exact/category-suffix names for Spotify, Worker, Cloudflare, npm, client secrets, access/refresh/pairing/bearer/auth/session tokens, authorization/OAuth state/code/verifier, cookies, and private/encryption/HMAC keys. It emits only a fixed PASS, a fixed finding count, or a fixed inspection failure:

```powershell
$phase0PreflightSource = @'
import { spawnSync } from "node:child_process";

const limit = 16 * 1024 * 1024;
const gitArgumentSets = [
  ["ls-files", "-z"],
  ["ls-files", "--others", "-z", "--exclude-standard"],
  ["ls-files", "--others", "--ignored", "-z", "--exclude-standard"],
];
const pathRecords = [];
let totalBytes = 0;

function inspectionFailure() {
  process.stdout.write("PHASE0_CAPTURE_PREFLIGHT_INSPECTION_FAILED .\n");
  process.exit(2);
}

for (const args of gitArgumentSets) {
  const result = spawnSync("git", args, {
    cwd: "D:\\Git\\SpotifyWallPaper",
    shell: false,
    windowsHide: true,
    encoding: "buffer",
    maxBuffer: limit + 1,
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.error || result.signal || result.status !== 0 ||
      !Buffer.isBuffer(result.stdout)) inspectionFailure();
  totalBytes += result.stdout.length;
  if (totalBytes > limit) inspectionFailure();
  if (result.stdout.length === 0) continue;
  if (result.stdout[result.stdout.length - 1] !== 0) inspectionFailure();
  let decoded;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(result.stdout);
  } catch {
    inspectionFailure();
  }
  const records = decoded.slice(0, -1).split("\0");
  if (records.some((record) => record.length === 0)) inspectionFailure();
  pathRecords.push(...records);
}

function isSensitivePath(repositoryPath) {
  const components = repositoryPath.split(/[\\/]+/u);
  return components.some((component) => {
    const name = component.toLowerCase();
    if (name === ".direnv") return true;
    if (name === ".env" || name === ".dev.vars" || name === ".envrc") return true;
    if (name.startsWith(".env.")) return name !== ".env.example";
    if (name.startsWith(".dev.vars.")) return name !== ".dev.vars.example";
    if (name.startsWith(".envrc.")) return name !== ".envrc.example";
    return false;
  });
}

const sensitiveEnvironmentName =
  /(?:^|_)(?:CLIENT_SECRET|ACCESS_TOKEN|REFRESH_TOKEN|PAIRING_TOKEN|BEARER_TOKEN|AUTH_TOKEN|SESSION_TOKEN|ID_TOKEN|CSRF_TOKEN|AUTHORIZATION_CODE|OAUTH_STATE|CODE_VERIFIER|PKCE_VERIFIER|AUTHORIZATION|AUTHORIZATION_HEADER|COOKIE|COOKIE_SECRET|SESSION_SECRET|API_TOKEN|API_KEY|PRIVATE_KEY|PRIVATE_KEY_PEM|ENCRYPTION_KEY|ENCRYPTION_KEYRING|HMAC_KEY|HMAC_KEYRING)$/iu;
const exactEnvironmentNames = new Set([
  "NODE_AUTH_TOKEN",
  "NPM_TOKEN",
  "TOKEN_ENCRYPTION_KEYRING",
  "PAIRING_HMAC_KEYRING",
  "OAUTH_STATE_HMAC_KEY",
]);
const findingCount =
  pathRecords.filter(isSensitivePath).length +
  Object.keys(process.env).filter((name) => {
    const upper = name.toUpperCase();
    return exactEnvironmentNames.has(upper) ||
      sensitiveEnvironmentName.test(upper);
  }).length;

if (findingCount !== 0) {
  process.stdout.write(
    `PHASE0_CAPTURE_PREFLIGHT_FAILED . count=${findingCount}\n`,
  );
  process.exit(1);
}
process.stdout.write("PHASE0_CAPTURE_PREFLIGHT: PASS\n");
'@

function Assert-Phase0CaptureSafe {
  $phase0PreflightSource | node --input-type=module -
  if ($LASTEXITCODE -ne 0) { throw "Phase 0 capture preflight failed." }
}
```

Run this function immediately before every `h5i capture run` and `h5i capture commit`; do not place any command between the guard and h5i. If it is not PASS, do not invoke h5i and do not read, move, or delete a discovered file. If the shell or function is lost, recreate and rerun it. Do not use `h5i codex sync` or `h5i codex finish`.

- [ ] Refresh CodeGraph after the major edits. Resolve the shim first, then invoke the guard immediately before h5i:

```powershell
$codegraphShim = (Get-Command codegraph -CommandType ExternalScript -ErrorAction Stop).Path
if ([System.IO.Path]::GetExtension($codegraphShim) -ne '.ps1') { throw "Unexpected CodeGraph shim." }
Assert-Phase0CaptureSafe
h5i capture run -- powershell.exe -NoProfile -File $codegraphShim index
codegraph affected scripts/repository-authority.mjs scripts/check-repository-authority.mjs scripts/repository-authority.test.mjs scripts/repository-preservation.mjs scripts/repository-preservation.test.mjs
```

- [ ] Run the complete approved baseline gate. Prepare the fixed npm CLI path before its guard. Invoke `Assert-Phase0CaptureSafe` immediately before every captured line below. Every resource-intensive command is captured separately so an expected red does not suppress later evidence:

```powershell
npm run verify:repository-authority
$npmCli = Join-Path (Split-Path -Parent (Get-Command node -ErrorAction Stop).Path) 'node_modules\npm\bin\npm-cli.js'
if (-not (Test-Path -LiteralPath $npmCli -PathType Leaf)) { throw "npm CLI not found." }
Assert-Phase0CaptureSafe
h5i capture run -- npm test
Assert-Phase0CaptureSafe
h5i capture run -- npm run check
Assert-Phase0CaptureSafe
h5i capture run -- npm run build:wasm
Assert-Phase0CaptureSafe
h5i capture run -- npm run build
Assert-Phase0CaptureSafe
h5i capture run -- node --use-system-ca $npmCli audit --audit-level=moderate
Assert-Phase0CaptureSafe
h5i capture run -- cargo fmt --all -- --check
Assert-Phase0CaptureSafe
h5i capture run -- cargo clippy --workspace --all-targets --all-features -- -D warnings
Assert-Phase0CaptureSafe
h5i capture run -- cargo test --workspace --all-features
Assert-Phase0CaptureSafe
h5i capture run -- cargo check -p spotify-wallpaper-visual-core --target wasm32-unknown-unknown
Assert-Phase0CaptureSafe
h5i capture run -- cargo fmt --manifest-path apps/backend/Cargo.toml -- --check
Assert-Phase0CaptureSafe
h5i capture run -- cargo clippy --manifest-path apps/backend/Cargo.toml --all-targets --all-features -- -D warnings
Assert-Phase0CaptureSafe
h5i capture run -- cargo test --manifest-path apps/backend/Cargo.toml --all-features
Assert-Phase0CaptureSafe
h5i capture run -- cargo fmt --manifest-path apps/configurator/src-tauri/Cargo.toml -- --check
Assert-Phase0CaptureSafe
h5i capture run -- cargo clippy --manifest-path apps/configurator/src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
Assert-Phase0CaptureSafe
h5i capture run -- cargo test --manifest-path apps/configurator/src-tauri/Cargo.toml --all-features
git diff --cached --check *> $null
if ($LASTEXITCODE -ne 0) { throw "Staged whitespace check failed." }
```

- [ ] Rerun the tracked-generated-source verification through h5i, then require both fixed-output checks:

```powershell
Assert-Phase0CaptureSafe
h5i capture run -- npm run types -w @spotify-wallpaper/cloudflare-worker
git diff --exit-code --quiet -- apps/cloudflare-worker/worker-configuration.d.ts
if ($LASTEXITCODE -ne 0) { throw "Worker generated declaration changed." }
git diff --cached --exit-code --quiet -- apps/cloudflare-worker/worker-configuration.d.ts
if ($LASTEXITCODE -ne 0) { throw "Worker generated declaration was staged." }
```

Expected:

- repository authority, TypeScript tests/checks, real WASM build, workspace build, Rust tests/checks/clippy, backend gates, Tauri gates, and diff check pass;
- root Rust formatting reproduces only the already-recorded `config-schema`/`visual-core` formatting failure assigned to Phase 1;
- dependency audit reproduces the already-recorded PostCSS advisory assigned to Phase 2; because advisory data is external and time-varying, any newly surfaced dependency finding is acceptable in Phase 0 only when all protected dependency and lockfile inputs remain byte-identical, the finding is recorded in the phase report, and Security plus SpecGuard approve its design-aligned deferral;
- any non-audit additional failure, or any audit finding attributable to a Phase 0 input change, is a Phase 0 regression and must be resolved before review;
- root check/build may regenerate Worker types and dry-run output, but the tracked Worker declaration remains byte-identical and generated output remains ignored.

- [ ] Read `browser:control-in-app-browser` before the smoke check because it causes browser control. Start the already-built wallpaper preview in a cancellable terminal session:

```powershell
npm run preview -w @spotify-wallpaper/wallpaper -- --host 127.0.0.1 --port 41731 --strictPort
```

Open `http://127.0.0.1:41731/` in the in-app browser, perform the checks below, then stop only that terminal session. If the strict port is occupied, report the collision and choose another unused loopback port; never terminate an unrelated process.

Verify without Spotify credentials or Wallpaper Engine APIs:

- root landmark `aria-label="Spotify wallpaper mock preview"`;
- title `Afterglow Atlas`;
- artists `Nami Kuroda` and `The Static Lights`;
- visible playback progress;
- visible clock;
- no crash or credential prompt.

- [ ] Run the scope check:

```powershell
git diff --exit-code --quiet
if ($LASTEXITCODE -ne 0) { throw "Unstaged tracked drift exists after gates." }
git diff --exit-code --quiet -- package-lock.json Cargo.lock apps/configurator/src-tauri/Cargo.lock apps/cloudflare-worker/worker-configuration.d.ts
if ($LASTEXITCODE -ne 0) { throw "Protected working-tree input changed." }
git diff --cached --exit-code --quiet -- package-lock.json Cargo.lock apps/configurator/src-tauri/Cargo.lock apps/cloudflare-worker/worker-configuration.d.ts
if ($LASTEXITCODE -ne 0) { throw "Protected input was staged." }
node scripts/repository-preservation.mjs verify-phase0-staged-index
if ($LASTEXITCODE -ne 0) { throw "Phase 0 staged allowlist mismatch." }
git diff --cached --name-only
```

Expected:

- no dependency, lockfile, runtime, generated type, or existing application/crate source or test change; `.gitattributes` changes only the exact recovered historical paths;
- no local/tool/generated path is staged, and no tracked worktree file differs from the index;
- the report accurately distinguishes green gates from the two measured, pre-existing deferred failures.

- [ ] Update the in-progress report with the exact verification and smoke evidence, then rerun the three explicit staging commands from Step 1.12, the 46-path staged allowlist check, `npm run verify:repository-authority`, the fixed ignore probes, and all working-tree/cached diff checks above. Recompute recovered worktree/index and static-local preservation comparisons after staging; share only `MATCH` plus counts. Do not claim that repository credential content or generated output has been scanned in Phase 0.

### Step 1.14: Complete substantive and exact-tree review loops

- [ ] Dispatch independent code-quality, Security, and SpecGuard reviewers with:

- Phase 0 objective;
- `AGENTS.md`, `docs/05-repository-authority.md`, and the approved design;
- complete staged diff;
- exact green and known-red evidence;
- recovered/static-local `MATCH` counts only, never aggregate digests;
- mock smoke evidence;
- no suggested verdict.

- [ ] The Security reviewer specifically checks authority-path traversal, ancestor `realpath`, Windows ADS/device/collision handling, filesystem and Git-mode symlink/reparse/submodule rejection, fixed non-reflective diagnostics, complete ignore-policy ownership, fixed local-secret name probes, raw-byte preservation, the exact 46-path allowlist, the nonpersistent name-only h5i guard, absence of credential material in the staged diff, mock-mode preservation, and the absence of runtime or Worker behavior changes.

- [ ] Classify every finding as `valid`, `invalid`, `duplicate`, or `deferred` with evidence. Fix every valid finding, rerun affected tests and the complete Phase 0 gate, update the report, restage exact paths, and redispatch the relevant reviewer.

- [ ] After the latest substantive quality, Security, and SpecGuard reviews all PASS, update the report once to record those outcomes and fixes, restage the exact paths, and rerun the full gate against that report-bearing tree. Then restage only if the report needs exact measured-result corrections and rerun at minimum repository authority, fixed ignore probes, both preservation comparisons, the exact staged allowlist check, `git diff --exit-code --quiet`, protected working-tree/cached diff checks, and the non-reflective staged whitespace check.

- [ ] Capture the final report-bearing review tuple using read-only Git operations only. Do not create or mutate temporary refs:

```powershell
$phaseBranchRef = 'refs/heads/Fix/system-wide-refactor'
$reviewedBranch = (git symbolic-ref --quiet --no-recurse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $reviewedBranch -ne $phaseBranchRef) {
  throw "Unexpected symbolic branch."
}
$objectFormat = (git rev-parse --show-object-format).Trim()
$oidPattern = switch ($objectFormat) {
  'sha1' { '^[0-9a-f]{40}$' }
  'sha256' { '^[0-9a-f]{64}$' }
  default { throw "Unsupported Git object format." }
}
$parentBefore = (git rev-parse --verify $phaseBranchRef).Trim()
$reviewedTree = (git write-tree).Trim()
$parentAfter = (git rev-parse --verify $phaseBranchRef).Trim()
if ($parentBefore -cnotmatch $oidPattern -or
    $reviewedTree -cnotmatch $oidPattern -or
    $parentAfter -ne $parentBefore) {
  throw "Branch or parent moved while capturing the review tuple."
}
$reviewedParent = $parentBefore
git diff --exit-code --quiet
if ($LASTEXITCODE -ne 0) { throw "Unstaged tracked drift exists." }
node scripts/repository-preservation.mjs verify-phase0-staged-index
if ($LASTEXITCODE -ne 0) { throw "Phase 0 staged allowlist mismatch." }
```

- [ ] Review the exact `{branch, parent, tree}` tuple above with independent quality, Security, and SpecGuard reviewers. Pass the same three values and the complete `$reviewedParent` → `$reviewedTree` diff to each reviewer. Each reviewer independently resolves and verifies the supplied objects before inspecting the diff.

- [ ] If a final reviewer finds a valid issue, use this exact order:

1. fix the issue and affected tests;
2. provisionally update the report and restage the exact allowlist;
3. rerun the complete Phase 0 gate;
4. update the report with the exact new results and restage;
5. rerun repository authority, fixed ignore probes, recovered worktree/index and static-local comparisons, staged allowlist, non-reflective whitespace, and all working-tree/cached diff checks;
6. capture a new read-only `{branch, parent, tree}` tuple;
7. redispatch all three reviewers against the new parent-to-tree diff.

If the branch or parent changes, or if the shell loses any tuple value, discard the tuple and repeat the complete final gate and all three exact-tree reviews. Never infer a lost value from prose or create a ref to retain it.

Exit review only with zero unresolved valid findings and explicit quality, Security, and SpecGuard PASS for the same fixed branch/parent/tree tuple. Do not modify any tracked file after all three final reviewers PASS.

### Step 1.15: Commit the exact reviewed tree

- [ ] Compare the current branch, parent, index, and worktree to the exact tuple retained in the active shell. Immediately before committing, rerun repository authority, fixed ignore probes, recovered baseline versus current worktree/index, static-local baseline comparison, exact staged allowlist, protected working-tree/cached diff checks, and the non-reflective staged whitespace check. The staged tree must remain equal to the three-reviewer tree:

```powershell
$phaseBranchRef = 'refs/heads/Fix/system-wide-refactor'
$currentBranch = (git symbolic-ref --quiet --no-recurse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $currentBranch -ne $reviewedBranch) {
  throw "Branch changed after final review."
}
$currentParent = (git rev-parse --verify $phaseBranchRef).Trim()
if ($LASTEXITCODE -ne 0 -or $currentParent -ne $reviewedParent) {
  throw "Parent changed after final review."
}
$currentIndexTree = (git write-tree).Trim()
if ($currentIndexTree -ne $reviewedTree) { throw "Index changed after final review." }

git diff --exit-code --quiet
if ($LASTEXITCODE -ne 0) { throw "Worktree changed after final review." }
node scripts/repository-preservation.mjs verify-phase0-staged-index
if ($LASTEXITCODE -ne 0) { throw "Phase 0 staged allowlist mismatch." }
git diff --cached --check *> $null
if ($LASTEXITCODE -ne 0) { throw "Staged diff check failed." }
npm run verify:repository-authority
if ($LASTEXITCODE -ne 0) { throw "Repository authority verification failed." }
```

- [ ] Record HEAD before invoking h5i. A nonzero result is never retried blindly: if HEAD changed, stop for provenance investigation; if HEAD did not change, treat it as a safe failed commit and fix the cause before a new reviewed attempt.

```powershell
$branchBeforeCommit = (git symbolic-ref --quiet --no-recurse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $branchBeforeCommit -ne $reviewedBranch) {
  throw "Branch changed before commit."
}
$headBeforeCommit = (git rev-parse --verify $phaseBranchRef).Trim()
if ($LASTEXITCODE -ne 0 -or $headBeforeCommit -ne $reviewedParent) {
  throw "Parent changed before commit."
}
Assert-Phase0CaptureSafe
h5i capture commit -m "Establish repository specification authority" --agent codex --prompt "Establish repository authority checks and tracked documentation" --audit
$commitExit = $LASTEXITCODE
$branchAfterCommit = (git symbolic-ref --quiet --no-recurse HEAD).Trim()
$headAfterCommit = (git rev-parse --verify $phaseBranchRef).Trim()
$resolvedHeadAfterCommit = (git rev-parse --verify HEAD).Trim()
if ($branchAfterCommit -ne $reviewedBranch -or
    $resolvedHeadAfterCommit -ne $headAfterCommit) {
  throw "HEAD and phase branch diverged during commit."
}
if ($commitExit -ne 0) {
  if ($headAfterCommit -ne $headBeforeCommit) {
    throw "Commit command changed HEAD but returned failure; do not retry."
  }
  throw "Commit command failed without changing HEAD."
}
if ($headAfterCommit -eq $headBeforeCommit) { throw "Commit command succeeded without creating the Phase 0 commit." }

$committedTree = (git rev-parse --verify 'HEAD^{tree}').Trim()
if ($committedTree -ne $reviewedTree) { throw "Committed tree differs from reviewed tree." }
$commitParentText = (git show -s --format=%P HEAD).Trim()
$commitParents = @($commitParentText -split ' ' | Where-Object { $_ })
if ($commitParents.Count -ne 1) { throw "Phase 0 commit must have exactly one parent." }
$committedParent = $commitParents[0]
if ($committedParent -cnotmatch $oidPattern) { throw "Invalid committed parent ID." }
if ($committedParent -ne $reviewedParent) { throw "Committed parent differs from reviewed parent." }

npm run verify:repository-authority
if ($LASTEXITCODE -ne 0) { throw "Committed authority verification failed." }
node scripts/repository-preservation.mjs compare-recovered --source=HEAD "--expected-token=$recoveredBaselineToken"
if ($LASTEXITCODE -ne 0) { throw "Committed recovered-document preservation failed." }
node scripts/repository-preservation.mjs compare-recovered --source=worktree "--expected-token=$recoveredBaselineToken"
if ($LASTEXITCODE -ne 0) { throw "Final recovered worktree preservation failed." }
node scripts/repository-preservation.mjs compare-static-local "--expected-token=$staticLocalBaselineToken"
if ($LASTEXITCODE -ne 0) { throw "Final static-local preservation failed." }
git diff --exit-code --quiet
if ($LASTEXITCODE -ne 0) { throw "Post-commit worktree drift exists." }
```

- [ ] Record only the fixed `MATCH count=26` results for committed `HEAD` and final worktree plus `MATCH count=<n>` for static-local metadata from the checks above. This proves worktree, index/reviewed tree, and committed tree agree byte-for-byte for all 26 recovered files; no digest enters the report or h5i.

- [ ] Verify the committed state:

```powershell
npm run verify:repository-authority
git status --short --branch --untracked-files=no
git show --name-status --oneline --decorate HEAD
```

Expected:

- the committed parent and tree equal the exact branch/parent/tree tuple approved by all final reviewers;
- the Phase 0 commit contains only the authority migration;
- tracked worktree is clean;
- ignored/local material remains present and uncommitted;
- Phase 1 can begin without publication, push, or deployment.

## Out of Scope for Phase 0

- CI branch-trigger alignment and toolchain pinning: Phase 1.
- Root/workspace/Tauri/real-WASM/Worker/audit gate consolidation: Phase 1.
- Existing Rust formatting corrections: Phase 1.
- Standalone index/`HEAD` raw-byte credential scanning and its tests: Phase 1.
- Canonical staged-blob scanner materialization/runner and its tests: Phase 1.
- Worker complete-token canary fragmentation and the corresponding two test-file edits: Phase 1.
- Policy-driven generated-output content scanning, fixed-size manifesting, concurrent-change checks, and generated-tree traversal: Phase 1.
- Persistent Junction-aware local-secret preflight and its tests: Phase 1.
- Repository credential-scan package/CI integration: Phase 1.
- If Phase 1 introduces more than one security state machine, split it into Phase 1A/1B with separate review and commit boundaries.
- PostCSS/Vite dependency remediation, assessment of newly surfaced transitive build-chain advisories, and any lockfile updates: Phase 2. A resolution that reaches Wrangler remains deferred under the approved design until its behavior boundary is reviewed.
- Provider behavior and credential-sink characterization: Phase 3.
- Worker migrations, protocol changes, OAuth behavior, or deployment: Phases 4A–4D and later.
- Artifact hashes, clean-build provenance, and byte-for-byte reproducibility manifests: Phase 32.
- Push, deployment, Limited beta, Workshop publication, and Spotify-connected soak.

## Phase 0 Exit Evidence

Phase 0 is complete only when all of the following are true on the exact committed diff:

- every policy-required document exists, is tracked, and is not ignored;
- every authority/Markdown/required/generated/preservation/source-input Git entry is a regular `100644`/`100755` blob even when `core.symlinks=false`;
- every Markdown file under `docs/` is tracked and belongs to exactly one declared authority classification;
- no tracked path is ignored;
- every positive ignore rule and tracked exception is documented by the policy;
- every ignored artifact probe has a valid classification, owner, producer, classification-appropriate tracked source inputs, and remains ignored at representative root and nested depths;
- the Worker declaration is the sole tracked generated-source exception and has complete ownership metadata;
- historical reports and the old Worker plan are clearly non-normative without content rewrites;
- all 26 recovered documents have exact `-text` attributes, and the original worktree baseline, clean-filter result, staged/index blobs, reviewed tree, committed `HEAD` blobs, and final worktree match byte-for-byte;
- static protected local metadata passes its path/type/size-only preservation check without claiming same-size content integrity, while mutable tool/build output remains ignored and unstaged;
- repository-authority and preservation unit/integration tests pass;
- fixed root/deep ignore probes prove all local-secret names remain ignored, all exact example exceptions remain visible, and no tracked path is ignored;
- the nonpersistent name-only guard passes immediately before every h5i invocation using only environment names and the three bounded Git path-name sets; Phase 0 makes no repository credential-content or generated-content scan claim;
- all measured gates show no code or input regression beyond the exact pre-existing formatting failure assigned to Phase 1 and the dependency-audit findings assigned to Phase 2; any advisory-database drift has unchanged protected inputs, exact report evidence, and explicit Security plus SpecGuard deferral approval;
- browser mock preview renders the expected title, artists, progress, and clock without credentials;
- the phase report contains the required evidence;
- the 46-path staged allowlist contains exactly eight modified and 38 added regular `100644` blobs and no existing application/test source;
- the committed branch, single parent, and tree equal the read-only tuple reviewed by all three reviewers, and h5i nonzero handling cannot create a blind second commit;
- independent quality, Security, and SpecGuard reviews have zero unresolved valid findings.
