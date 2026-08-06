# System-Wide Refactor Phase 0 Repository Specification Truth

## Phase name

Phase 0 — Repository and specification truth

## Summary

Phase 0 establishes a tracked, machine-checkable authority contract for
documents, ignored artifacts, generated-source ownership, and recovered
historical evidence. The first implementation-tree reviews found seven valid
boundary defects, and subsequent adversarial review found cross-item snapshot,
attribute-isolation, resource-bound, and cleanup-hardening gaps. Every blocking
finding has been reproduced by a test and remediated in the original 46-path
scope. The latest rejected tuple exposed a terminal-pass ordering race; its new
regression now passes after reverse-order revalidation. The complete
authority/preservation suite passes 96/96, and the complete baseline gate
reproduces only the two approved known reds. Substantive quality, Security, and
SpecGuard reviews all passed on one fixed tuple. The final report-bearing
exact-tree reviews and commit must still run.

Source: this Phase 0 commit; resolve it through this report path in Git history.

## Changed files

The exact Phase 0 allowlist contains 46 regular `100644` paths (`M=8`, `A=38`):

- repository controls: `.gitattributes`, `.gitignore`, CI, `AGENTS.md`, and
  `package.json`;
- machine contracts: `config/repository-authority.json` and five authority or
  preservation scripts/tests;
- current authority: the repository entry documents, repository-authority
  specification, document/report indexes, reviewed Phase 0 plan, and this
  report;
- recovered authority: 26 byte-preserved historical documents.

No dependency, lockfile, Worker runtime, application source, crate source, or
existing application test is changed.

## Relevant docs read

- `AGENTS.md`
- `docs/README.md`
- `docs/00-codex-entrypoint.md`
- `docs/01-project-goals-and-non-goals.md`
- `docs/02-repository-structure.md`
- `docs/03-implementation-phases.md`
- `docs/04-quality-gates.md`
- `docs/05-repository-authority.md`
- `docs/22-performance.md`
- `docs/23-test-qa.md`
- `docs/24-docs-and-reporting.md`
- `docs/25-public-backend.md`
- `docs/30-subagent-matrix.md`
- `docs/how-to-use-h5i.md`
- the approved system-wide refactor design and reviewed Phase 0 plan
- the in-app browser skill used for the mock-preview smoke test

## Implemented requirements

- Classified all 63 required documents exactly once: 61 beneath `docs/` plus
  `AGENTS.md` and the root `README.md`.
- Declared all 35 positive ignore rules, three representative non-ignored
  example probes, one tracked generated source, and their ownership metadata.
- Added fixed-output authority and preservation CLIs with bounded Git and
  filesystem reads, fatal decoding, safe Git-mode checks, and non-reflective
  diagnostics.
- Rejected unsafe paths, Windows device names and ADS syntax, case-fold
  collisions, symlinks, junctions, reparse points, escaped real paths,
  submodules, unexpected modes, and staged-set drift.
- Combined bounded worktree discovery with index-only entries under the
  configured Markdown root, and rejected every discovered reparse path without
  traversing its target.
- Preserved all 26 recovered documents byte-for-byte in the worktree and index
  with exact `-text` attributes. Two historical CRLF reports have exact-path
  `whitespace=-trailing-space` attributes so Git does not misclassify their
  preserved carriage returns.
- Required the policy and fixed helper allowlists to match exactly, validated
  exact worktree/index `.gitattributes` semantics and effective attributes, and
  prohibited filter, encoding, and ident transforms.
- Isolated Git plumbing from inherited repository/index/object/config/replace
  controls and read recovered worktree bytes through a bounded identity-checked
  file handle.
- Streamed Markdown and static-local directories under fixed depth, entry, and
  UTF-8 path-byte ceilings that test seams cannot raise.
- Preserved the static local set by path, type, and size metadata only; no local
  content was read or claimed as content-identical, and unsafe numeric sizes
  are rejected before hashing.
- Revalidated the complete Markdown directory and recovered worktree sets,
  every declared path, repository roots, bounded control-file bytes, full Git
  snapshots, pinned index OIDs, and pinned `HEAD` state after dependent work.
- Ran effective-attribute and raw/filtered hashing in a private Git context
  with the original repository configuration excluded, and revalidated the
  attribute contract before and after the proof.
- Retained every static-local file and directory identity in each of the two
  collections and revalidated each set in reverse traversal order so earlier
  records are checked after their later siblings.
- Added repository-authority verification before dependency installation in CI
  and before workspace tests in the root test script.
- Preserved browser mock mode and made no Spotify, Worker, OAuth, rendering, or
  deployment behavior change.

## Known gaps

- Final report-bearing quality, Security, and SpecGuard exact-tree reviews and
  the Phase 0 commit have not yet run.
- Root `cargo fmt --all -- --check` reproduces the pre-existing
  `config-schema` and `visual-core` formatting diff assigned to Phase 1.
- The current npm advisory database reports five high-severity findings:
  the previously recorded PostCSS advisory plus a `sharp` advisory chain
  through Miniflare, Wrangler, and the Cloudflare Workers test pool. Phase 0
  changed no dependency or lockfile. Phase 2 must assess the build-chain update;
  a resolution that reaches Wrangler remains deferred under the approved
  design until its behavior boundary is reviewed.
- Reproducible credential-content and generated-content scanning belongs to
  Phase 1 and is not claimed by this phase.
- Filesystem traversal is sequential rather than an atomic snapshot. It rejects
  observed drift but cannot prevent a same-user process from changing a path
  after that path's final observation. Repository operators, the same user, and
  administrators are non-adversarial for the complete preservation boundary
  and must not concurrently mutate protected local paths while a gate runs.
  Static-local comparison is evidence against stable agent-caused
  path/type/size drift, not concurrent-writer integrity or same-size content
  identity.
- Private attribute-repository cleanup assumes a normally protected per-user
  Windows temp directory or sticky/appropriately permissioned POSIX temp
  parent, and treats the same user and administrators as non-adversarial.
  Node's path-based recursive removal cannot atomically prevent a privileged
  process from replacing the random quarantine path after validation; custom
  world-writable non-sticky temp configuration is outside the threat model.
  Setup failure before the ownership-marker `try/finally` can leave a bounded
  temporary artifact. Both are accepted low residual risks.

## Tests run

- `node --test scripts/repository-authority.test.mjs scripts/repository-preservation.test.mjs`
  — the post-remediation authority/preservation suite passed 96/96 with zero
  skips (`h5i` object `0db7d782aceb3e9e`). The terminal-pass ordering
  regression first failed (`30a5bd21a01d96ab`) before reverse-order
  revalidation made its focused two-test run and the complete suite pass.
- Focused real-fixture tests passed for an undeclared junction, index-only
  Markdown and symlink modes, Git replacement objects, inherited alternate
  repository/index controls, policy drift, broad/duplicate/transform
  attributes, worktree/index attribute drift, file growth/truncation/ancestor
  identity changes, repository-root replacement, full-set sibling races,
  unsafe static sizes, strict `fsutil` diagnostic parsing, and
  traversal-budget boundaries.
- Post-remediation repository authority passed; recovered worktree and index
  remained `MATCH count=26`, and static-local metadata remained
  `MATCH count=71`.
- `npm run verify:repository-authority`
  — tests passed, `Repository authority: PASS`, recovered index
  `MATCH count=26` (`h5i` object `545f8593dbfb8817`).
- `npm test` — all repository-authority and workspace tests passed; wallpaper
  workspace includes 22 files and 138 tests (`885fe6015fb85d25`).
- `npm run check`, `npm run build:wasm`, and `npm run build` — passed; the
  check evidence is `fcedd51eaa0d5764` and the complete workspace build
  evidence is `a7412ab77bd231b1`.
- `node --use-system-ca <npm-cli> audit --audit-level=moderate`
  — expected controlled exit 1; five high-severity dependency findings, with
  dependency and lockfile inputs unchanged (`9cdfa7e873527ca0`).
- `cargo fmt --all -- --check` — expected controlled exit 1 in the two
  pre-existing Phase 1 formatting areas (`1e4d94e6efd51a1c`).
- `cargo clippy --workspace --all-targets --all-features -- -D warnings`
  — passed.
- `cargo test --workspace --all-features` — 16 passed
  (`ebecbc0c4f8228b3`).
- `cargo check -p spotify-wallpaper-visual-core --target wasm32-unknown-unknown`
  — passed.
- Backend fmt/clippy/test — passed; five tests passed.
- Tauri configurator fmt/clippy/test — passed; six tests passed.
- Worker type regeneration — passed and the tracked declaration remained
  byte-identical (`932d24f9e1dda46d`).
- CodeGraph re-indexed 126 files and identified the two authority test files as
  affected tests; the final report-bearing refresh is `96c41f0642e45150`.
- Mock preview at loopback rendered `Afterglow Atlas`, `Nami Kuroda`,
  `The Static Lights`, changing playback progress, and a visible clock after
  opening track details. The final slider advanced from 39 to 40, the clock was
  visible at `22:49`, browser console errors were zero, and no credentials or
  Wallpaper Engine APIs were required.
- Exact staging, protected-input, ignore-depth, whitespace, and worktree checks
  passed: `MATCH count=46`, tracked-and-ignored count zero, recovered worktree
  and index `MATCH count=26`, static-local metadata `MATCH count=71`.

## Risks introduced

- The authority migration changes `.gitignore` and is security-sensitive.
  Exact root/deep probes, bounded non-reflective inspection, staged allowlisting,
  and independent review mitigate accidental exposure or authority loss.
- Windows generic reparse detection depends on the verified
  `SystemRoot\System32\fsutil.exe`; PATH lookup is disabled, execution is
  non-shell, diagnostics are bounded and never emitted, only a first-line
  `4390:` error is accepted as non-reparse, and fixed count/time ceilings fail
  closed.
- Temporary private-Git cleanup uses an ownership marker, stable directory
  identity, a random same-parent quarantine rename, and `force: false`.
  The path-based removal race and early-setup leak described under Known gaps
  remain low accepted residual risks under the stated secure-temp threat model.
- The two whitespace exceptions are exact historical paths only. They preserve
  immutable CRLF evidence and do not weaken whitespace checks for current code
  or documents.
- The dependency advisories are pre-existing inputs, not introduced by this
  phase, but remain valid unresolved repository risks for later phases.

## Review outcome

The initial implementation plan at SHA-256
`8CE35CA8F86DA8C2E2EFEB785512DD64C80AB466A6ECC189C67AB1CE274760EC`
received quality, Security, and SpecGuard PASS with zero unresolved findings.
Those plan reviews remain historical evidence only.

The first implementation-tree quality and Security reviews found seven unique
valid defects; overlapping findings were classified as duplicates. The
contemporary SpecGuard classification agreed that all seven were Phase 0
blocking and that none could be deferred. Later exact-tree reviewers rejected
tuple `f8bb24d91329a0de002d09be9135aae015583456` because the second
static-local collection did not revalidate earlier siblings after later work.
The finding was classified valid and Phase 0 blocking by all three reviewers.
Its failing test now passes by retaining and revalidating the complete record
set at the end of both static collections.

All three reviewers then rejected tuple
`9235943d5121fbb98fc797d992db88e4cf089975`: the terminal pass still used
forward insertion order, so a later sibling could change an already checked
earlier record. The finding is valid and Phase 0 blocking. The regression first
failed as expected, then passed after terminal records were revalidated in
reverse traversal order. Both tuples remain invalid; the complete gate and all
three same-tuple reviews must run again.

Quality, Security, and SpecGuard then independently reviewed
`branch=refs/heads/Fix/system-wide-refactor`,
`parent=d13ff252e25f433ea735634a1dc040205b486a24`, and
`tree=5846d8de24a838cfac540ef13af3ba409f03c5a2`. All three returned
substantive PASS with zero new or unresolved valid findings. They agreed that
reverse terminal traversal closes the documented later-sibling ordering race,
that its temporary array remains within the fixed 2,048-entry bound, and that
the non-atomic same-user concurrency limitation is stated without an integrity
overclaim. This tuple is substantive evidence only: recording these outcomes
changes the report-bearing tree, which must receive a complete gate and new
exact-tree reviews before commit.

## Fixes from review

- Collapsed inspection failures to one fixed diagnostic and prevented exception,
  stderr, path, or content reflection.
- Completed Unicode bidi, NTFS ADS, trailing-dot/space, glob, and all
  superscript COM/LPT device-name rejection.
- Required safe modes and regular types for authority controls and documents,
  and made `.gitignore` and policy reads no-follow and identity-checked.
- Made raw staged inspection expose submodules and full object IDs while
  rejecting delete, rename, copy, type, mode, and extra-path drift.
- Added generic Windows reparse detection with a verified absolute `fsutil`
  path, timeout, no PATH search, and per-inspection caching.
- Bounded every file, Git, and check-ignore output and exercised real CLI exit
  contracts.
- Restricted temporary test cleanup to the exact validated `mkdtemp` return
  path.
- Restored tracked-ignore exceptions to representative non-ignored probes that
  need not exist or be tracked.
- Enforced Markdown classification in both directions by rejecting non-Markdown
  document-group paths.
- Preserved the two CRLF historical reports while keeping the staged whitespace
  gate green through exact-path attributes and an integration test.
- Rejected undeclared reparse points discovered beneath the Markdown root and
  merged index-only Markdown and unsafe-mode entries into authority evaluation.
- Replaced path re-open reads with bounded file-handle reads that compare
  pre/open/post identity, revalidate ancestors and reparse/real paths, detect
  one-byte growth and truncation, and always close the handle.
- Replaced effective-`text`-only checks with an exact semantic contract for
  worktree and index `.gitattributes`; rejected broad, duplicate, missing,
  extra, whitespace, filter, encoding, and ident drift before any clean filter
  can run.
- Removed inherited Git control variables, disabled replacement objects and
  prompts, null-routed global config/attributes/excludes, and used validated
  NUL-delimited stdin for the one `check-ignore` compatibility exception.
- Replaced unbounded production directory arrays with streaming handles and
  fixed depth, per-directory, total-entry, single-path, and aggregate-path-byte
  ceilings.
- Required the bounded, schema-valid policy preservation arrays to equal the
  independent fixed recovered/static helper sets in both authority and
  preservation verification CLIs.
- Revalidated every complete Git/filesystem snapshot at the end of dependent
  work, including recovered repository-root identity for worktree, index, and
  `HEAD`, and rejected unsafe static metadata sizes.
- Tightened Windows error-4390 recognition to the first numeric code on the
  first non-empty diagnostic line so an echoed path component cannot be
  mistaken for the result code.
- Reproduced the second-static-pass earlier-sibling race, then retained and
  revalidated every file and directory record after each complete static
  collection.
- Reproduced the terminal-pass ordering race, revalidated terminal records in
  reverse traversal order, and documented that portable sequential filesystem
  inspection is not an atomic concurrent-writer snapshot.

## Verification commands

- `node --check` for all five Phase 0 scripts/tests
- `node --test scripts/repository-authority.test.mjs scripts/repository-preservation.test.mjs`
- `npm run verify:repository-authority`
- `npm test`
- `npm run check`
- `npm run build:wasm`
- `npm run build`
- `node --use-system-ca <npm-cli> audit --audit-level=moderate`
- root Cargo fmt, clippy, test, and WASM target check commands
- backend Cargo fmt, clippy, and test commands
- configurator Cargo fmt, clippy, and test commands
- `npm run types -w @spotify-wallpaper/cloudflare-worker`
- fixed root/deep ignore and example probes
- recovered worktree/index, static-local metadata, and exact staged allowlist
  comparisons
- protected working-tree/cached input checks and `git diff --cached --check`
- in-app browser mock-preview smoke check on loopback

Every resource-intensive command above was preceded by the name-only capture
preflight and run through `h5i capture run`.

## Next recommended task

Restage the exact 46-path allowlist, rerun the complete gate against this
report-bearing tree, obtain final quality, Security, and SpecGuard PASS for one
read-only branch/parent/tree tuple, commit that exact tree, and begin Phase 1.
