# Wallpaper Engine Update Flow

## Phase name

Wallpaper Engine development reload and Workshop update flow

## Summary

Added a safe Windows development link so later builds can be loaded by
reloading one Wallpaper Engine project. Separated Workshop identity from
ordinary development output so only a prepared Workshop build can update the
same subscribed item.

## Changed files

- Root npm scripts and Windows junction script/test
- Wallpaper Workshop metadata, preparation logic, and project tests
- Root dependency override and lockfile patch for `nanoid@3.3.18`
- Wallpaper Engine developer, user, and QA documentation
- Phase report catalog and repository-authority classification

## Relevant docs read

- `AGENTS.md`
- `docs/README.md`
- `docs/00-codex-entrypoint.md`
- `docs/01-project-goals-and-non-goals.md`
- `docs/02-repository-structure.md`
- `docs/03-implementation-phases.md`
- `docs/04-quality-gates.md`
- `docs/05-repository-authority.md`
- `docs/11-wallpaper-engine.md`
- `docs/24-docs-and-reporting.md`
- `docs/30-subagent-matrix.md`
- `docs/how-to-use-h5i.md`
- `docs/user-guide.md`
- `docs/qa-checklist.md`

## Implemented requirements

- One idempotent development junction with no deletion or replacement path
- Build-and-reload npm entry point without changing the existing full build
- Workshop ID stored separately and injected only into Workshop output
- Invalid ID rejection and credential/unknown-field non-copying
- Owner-only Private mock boundary and existing Spotify distribution gates

## Known gaps

- Private Workshop publication and Steam delivery were not executed because
  publishing is a separate user-approved action.
- Spotify-connected Limited beta and general Workshop publication remain
  blocked by the existing distribution gates.
- Wallpaper Engine registry detection, Junction creation, and idempotency were
  verified locally. UI reload confirmation stopped when an older manual import
  exposed an existing credential-bearing property. Its value is not recorded;
  revoke and reissue it before repeating UI QA.
- After explicit approval permitted exact-file staging, the repository-authority
  suite accepted the newly classified report with all 99 tests passing.
- The exact final same-state review results are retained in the local
  implementation report so this tracked report does not need a post-review
  edit that would invalidate the reviewed diff.

## Tests run

- `node --test scripts/link-wallpaper-engine.test.mjs`: 3 passed
- `npm run test:repository-authority`: 99 passed
- `npm run test:wallpaper-link`: 3 passed
- `npm run test -w @spotify-wallpaper/wallpaper -- src/wallpaperEngine/projectJson.test.ts`: 30 passed
- `npm run test --workspaces --if-present`: 351 passed
- `npm run check`: passed with zero Svelte errors and warnings
- `npm run build`: passed
- `npx playwright test tests/playwright/wallpaper-characterization.spec.ts`: 7 passed
- `cargo test --workspace`: 12 passed
- `npm audit --audit-level=moderate`: zero vulnerabilities after pinning the
  patched transitive `nanoid@3.3.18`
- Development and Workshop builds plus artifact secret scan: passed
- CodeGraph: refreshed, 149 files indexed

## Risks introduced

- A local developer can still select the wrong Wallpaper Engine project
  manually; the script prevents automatic deletion or replacement but cannot
  control editor selection.
- Workshop updates can be delayed by Steam.
- The existing local Spotify credential surfaced by UI inspection must be
  revoked and reissued. No credential value was copied into repository files.

## Review outcome

Ponytail baseline frozen 2026-08-25 02:04 JST: official source
`https://github.com/DietrichGebert/ponytail.git`, snapshot revision
`2ed6c52c9d7e5e56942508591085fd45dea277d3`, exact version `4.9.0`, installed
and enabled, standard trusted `SessionStart`, `SubagentStart`, and
`UserPromptSubmit` hooks, full mode. Marketplace refresh reported no update.
Independent Sol review found zero valid Code, Architecture, SpecGuard,
Security, testability, documentation, or YAGNI findings and returned
`SOL PASS`. The same-state Ponytail 4.9.0 full whole-repository audit returned
`Lean already. Ship.`. This completed report is part of the final frozen diff;
phase acceptance additionally requires a subsequent same-state Sol-to-Ponytail
recheck recorded in the local implementation report before approval.

## Fixes from review

No implementation fix was required by the frozen-diff Sol or Ponytail review.
Earlier implementation verification fixed PowerShell 5.1 UTF-8 parsing,
Junction target resolution, JSDoc narrowing, and the existing transitive
`nanoid` advisory before the frozen review.

## Verification commands

- Resource-intensive test, check, build, audit, Rust, Playwright, Workshop, and
  CodeGraph commands listed under Tests run were captured through h5i.
- `npm test` passed after exact-file staging, including 99 repository-authority
  tests, 3 Junction tests, and 351 workspace tests.
- Independent Sol/SpecGuard/Security review and Ponytail full audit passed;
  the mandatory final same-state recheck and its exact result are retained in
  the local implementation report.

## Next recommended task

Revoke and reissue the exposed existing local Spotify credential, repeat the
Wallpaper Engine UI reload check without property-text capture, then provide
explicit commit approval if the reviewed implementation is accepted.
