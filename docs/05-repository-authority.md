# Repository Authority

## Authority order

Current normative behavior is determined in this order:

1. `AGENTS.md` and the mandatory entry documents.
2. Current domain specifications under `docs/`.
3. Approved designs for active cross-cutting work.
4. Current implementation plans for execution detail.
5. Tracked code, tests, and machine-readable contracts.

Historical phase reports and executed plans are evidence of prior work. They
do not override current specifications and need not describe the exact diff of
the commit that first tracked them.

The policy classifications have distinct authority:

- `normative` defines current required behavior and constraints.
- `operational` defines current procedures, runbooks, and agent workflows.
- `implementation-plan` defines reviewed execution detail for active work but
  does not override a higher-precedence specification.
- `historical-evidence` records prior intent, implementation, or verification
  and never overrides current requirements.

## Clean-clone truth

Git-tracked state is the source of truth available to a clean clone. Every
Markdown file beneath `docs/` must be tracked and classified exactly once in
`config/repository-authority.json`. A file merely existing in a local checkout
does not make it repository authority.

The authority checker validates tracking, ignore state, Git object mode,
case-fold collisions, Windows path safety, symlink/reparse containment, and
required ownership metadata. Variable paths are reported only as
non-reversible SHA-256 identifiers; arbitrary paths, file contents, Git
stderr, and local exception text are not emitted.

Markdown discovery is the union of the bounded worktree walk and all index
entries beneath each configured Markdown root. An index-only Markdown file
therefore cannot bypass classification, and an index-only symlink, submodule,
or other unsafe mode beneath a Markdown root cannot bypass mode validation.
Every reparse point discovered by the Markdown walk is rejected even when its
path was not declared in advance; its target is never traversed.

## Historical raw-byte boundary

Exactly 26 recovered historical documents are listed in the policy and have
exact `-text` entries in `.gitattributes`. Those entries preserve their
original worktree bytes through Git clean filters. The exception is
file-specific: it does not apply to `docs/00-codex-entrypoint.md`, current
plans/reports, all Markdown, or a directory wildcard.

Two recovered reports retain historical CRLF bytes. Their exact path entries
also disable Git's trailing-space diagnostic so `git diff --check` does not
misclassify the preserved carriage returns; this exception is not a wildcard
and does not permit rewriting either report.

The preservation helper compares the recovered worktree, index, reviewed tree,
and committed `HEAD` without printing content or digests. The local report ZIP
is a redundant ignored archive and is never repository authority.

The helper independently fixes the 26 recovered paths, the five static-local
paths, and the two historical whitespace exceptions in code. The policy must
match those sets exactly, without duplicates and independent of ordering.
Worktree and index `.gitattributes` rules must contain only the global text
rule and the exact path-specific exceptions. The recovered paths must have
effective `text=unset` and `eol=lf`; every classified non-recovered document
must have effective `text=auto` and `eol=lf`. Both groups must exclude
`filter`, `working-tree-encoding`, `ident`, and unexpected `whitespace`
transforms. A nested `.gitattributes` on any inspected document's ancestor and
repository-local `.git/info/attributes` are rejected.

Recovered worktree bytes are read only through a bounded file handle. The
reader checks ancestor containment and reparse state before and after the
read, compares path and handle identity, uses no-follow open semantics where
the platform provides them, and probes one byte beyond the expected size to
reject growth or truncation during inspection. After every recovered path has
been read, the complete path set is revalidated so a file inspected earlier
cannot change while a later file is processed.

The clean-filter proof first validates the attribute boundary, then sends the
same bounded in-memory bytes to `git hash-object --no-filters --stdin` and
`git hash-object --path=<path> --stdin`. Both hashes run in the same private
temporary Git repository with system, global, and original repository-local
configuration excluded. The private worktree contains only the already
validated root attributes, so an original repository filter command cannot be
executed. The original attribute boundary is validated again after hashing.

Index fingerprints pin all 26 path-to-object mappings in one NUL-delimited
snapshot and require the same raw snapshot at the end. `HEAD` fingerprints pin
one commit object ID and require `HEAD` to remain there. Static-local metadata
is collected twice as a complete path/type/size enumeration and the two sampled
maps must match. Each collection retains every inspected file and directory
record and revalidates the records in reverse traversal order, so an earlier
record is checked after all of its later siblings. Every metadata file size
must be a non-negative safe integer.
Recovered fingerprints for worktree, index, and `HEAD` also require the
repository root identity, canonical real path, and reparse state to remain
unchanged through the end of inspection.

Filesystem traversal and revalidation are sequential observations, not an
atomic filesystem snapshot. They fail closed on drift observed between checks,
but cannot prevent a same-user process from changing a path after that path's
final observation. Repository operators, the same user, and administrators are
non-adversarial for this preservation boundary and must not concurrently mutate
the protected local set while a gate runs. The comparison is evidence against
stable agent-caused path/type/size drift; it is not a transaction, a
concurrent-writer integrity proof, or a same-size content proof.

The two capture commands are bootstrap-only exceptions because they establish
an uncaptured comparison token before policy migration. Every compare and
verify command validates the fixed preservation policy both before inspection
and before emitting its result.

## Bounded and isolated inspection

Production Git subprocesses inherit only the operating-system variables
needed to locate and execute Git. Repository, index, object, replace-ref,
global-config, credential, and tracing controls are not inherited. Replace
objects are disabled, global configuration/attributes/excludes are redirected
to the platform null device, prompts are disabled, and all diagnostics remain
fixed and non-reflective. Git is resolved once to a canonical absolute
executable outside the inspected repository, and every Git inspection has a
fixed ten-second timeout.

Git literal pathspec mode is enabled for plumbing commands. `check-ignore`
does not support that Git mode, so it receives one previously validated
canonical path through NUL-delimited standard input under an explicit
`--no-literal-pathspecs` command override.

Markdown and static-local directory traversal use streaming directory handles
with fixed, non-policy-configurable ceilings:

- maximum depth: 64;
- maximum entries per directory: 1,024;
- maximum entries per traversal: 2,048;
- maximum normalized path length: 4,096 UTF-8 bytes;
- maximum aggregate normalized path bytes: 16 MiB.

Limit failures close the directory handle, expose no discovered path, and
collapse to the existing fixed inspection diagnostic.

Directory name/type sets, identities, real paths, policy bytes, Gitignore
bytes, Git root, full index output, and tracked-and-ignored output are checked
again after their dependent work. On Windows, generic reparse inspection uses
at most 256 unique path identities and 15 seconds per operation. A trusted
`fsutil` exit 1 means “not a reparse point” only when its bounded diagnostic
has error code `4390:` as the first numeric code on its first non-empty line;
access and operational failures close the inspection. The diagnostic is
bounded and never emitted. POSIX uses `lstat` symlink state directly and does
not consume the Windows subprocess budget.

## Ignored artifact ownership

Every positive `.gitignore` rule is declared in the policy with:

- a representative probe;
- a classification;
- an owner;
- a producer;
- tracked source inputs for dependency caches and generated output.

Local secrets, local evidence, local archives, and local tool state may have no
tracked source input because they are operator-owned. Exact example-environment
name patterns are explicit non-ignored exceptions. Their representative probes
verify ignore semantics only and need not exist or be tracked. Content
inspection of ignored output is not part of Phase 0; Phase 1 owns the
reproducible credential-scan boundary.

## Tracked generated source

`apps/cloudflare-worker/worker-configuration.d.ts` is the sole tracked
generated-source exception. Its owner, producer, source inputs, and
verification command are declared in the policy. Regeneration must leave the
tracked declaration byte-identical unless a reviewed phase intentionally
changes its source contract.

`package-lock.json`, `Cargo.lock`, and
`apps/configurator/src-tauri/Cargo.lock` are tracked reproducibility inputs,
not generated-output exceptions.

## Migration and staging safeguards

Authority migrations must:

- preserve ignored local data and never use broad cleanup;
- stage an explicit path allowlist;
- reject deletion, rename, copy, type, mode, or extra-path drift;
- compare protected recovered bytes and static local path/type/size metadata;
- run repository authority, baseline gates, mock preview, and independent
  quality/Security/SpecGuard reviews;
- commit only the exact reviewed branch/parent/tree tuple.

Do not use broad `git add`, delete ignored artifacts to make a check pass, or
weaken an ignore/ownership rule after a failure.

## Changing ownership

Any new document, ignore rule, tracked generated source, preservation input,
or ownership classification must update the policy, executable tests,
human-facing documentation, and phase review evidence in the same commit.
