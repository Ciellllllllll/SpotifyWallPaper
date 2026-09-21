# Hosted backend retirement

## Phase name

Hosted backend retirement (strict-gated, non-Phase work, 2026-09-21).

## Summary

With explicit user approval, permanently deleted Cloudflare Worker
`spotify-wallpaper-api-preview` and D1 databases `spotify-wallpaper-preview`
and `spotify-wallpaper-deletion-preview`. Dashboard lists subsequently showed
six unrelated Workers and two unrelated databases, with the three targets absent.
The inspected VPS had no SpotifyWallPaper deployment; the user instructed us
to leave it running in that case. No VPS service was changed.

Removed the unused hosted Node/PostgreSQL application, deployment assets,
artifact builder, dedicated CI and database-only npm dependencies. Standard
Pages/direct operation and optional local integrations remain.

## Changed files

- Removed tracked files under `apps/public-backend/` and `deploy/public-backend/`,
  `.github/workflows/cloudflare-worker-ci.yml`, and the backend artifact builder/test.
- `package.json`, `package-lock.json`: remove hosted-backend scripts/dependencies;
  update Vitest to 4.1.11 and devalue to 5.9.4 within existing compatible ranges.
- Wallpaper backend provider, polling, property adapter and regression tests:
  reject public HTTPS transport and old public pairing input.
- Workshop preparation and tests: remove the retired origin prerequisite;
  retain credential clearing and Workshop ID validation.
- Configurator: describe backend selection as local loopback.
- Entry/domain/user/QA/privacy documents and repository-authority policy:
  retire hosted procedures and classify six old operator documents as history.

## Relevant docs read

AGENTS; docs README and entry documents 00–05; domains 10, 11, 13, 20, 21,
23–25; SubAgent matrix; user guide, QA checklist, privacy/EULA and former
backend operations; h5i guide. Ponytail baseline and audit skills; Git finish skill.

## Implemented requirements

- Cloudflare deletion was performed only after named-target final confirmation.
- No SpotifyWallPaper service was found on the registered VPS; no host shutdown.
- Backend transport permits only canonical HTTP loopback and still rejects redirects.
- Old public `swpb1.` input produces a fixed Pages reauthorization message and
  retains current credentials instead of overwriting them or selecting a public provider.
- Local Rust backend, Tauri/Rainmeter, mock rendering, Spotify direct access,
  IndexedDB persistence and all audio/visual algorithms remain.
- Existing shared secret scanning and product CI gates remain. Only tests and
  CI belonging exclusively to the removed application were retired.
- Ignored local settings/build outputs and 26 protected historical documents
  were preserved. No push, Pages publication or unrelated resource deletion.

## Known gaps

No real Spotify account, Wallpaper Engine long-running test, multi-display
storage measurement, native Tauri UI or Rainmeter host acceptance was performed.
Cloudflare dashboard absence verifies account-level deletion, not physical
purging of Cloudflare internal retention. Ignored old local artifacts were not
purged and must not be distributed. Archived EULA is not current release approval.

## Tests run

Focused RED/GREEN for public-origin rejection and old-token replay (2 tests),
dedicated legacy-pairing replay (2 additional tests), plus release preparation without backend environment (32 tests). Existing
adapter/polling regressions passed (59 tests). Normal check/build, optional
check/build and 21 configurator tests passed. Rust loopback tests passed (10).
Pages E2E passed (3); generated WASM parity passed (2). Dependency audit reports
zero vulnerabilities after compatible updates. The full npm suite passed before the final legacy-field guard; the changed
wallpaper suite then passed all 287 tests. Browser characterization and IndexedDB tests passed all 88 cases in an isolated
run. The initial run had one HMR navigation failure while a parallel optional
build rewrote shared output; no rendering or snapshot change was made.
Repository authority passed and protected historical files matched (26).
After the final listener fix, direct IndexedDB E2E passed again (2), wallpaper
unit tests passed (287), type checks/build and secret scanning passed. CodeGraph
was refreshed successfully (1,678 indexed files).

## Risks introduced

Former public Pairing Tokens no longer connect; users must authorize through
Pages. The retained loopback interface is intentionally not removed. No new
runtime dependency or rendering changes. Existing Vite WASM runtime-URL warning
remains; generated artifact parity is tested separately.

## Review outcome

Strict gates completed on the final implementation: Sol PASS, independent
Security PASS, SpecGuard PASS, Architecture PASS. The subsequent official
Ponytail full audit returned `Lean already. Ship.`. No required gate was omitted.
This report-only completion update is rechecked before commit.
Official Ponytail 4.10.0, source https://github.com/DietrichGebert/ponytail.git,
revision e3ba2aa6f1e6f0bc4d69eb09c9f0d0a93af56156, verified 2026-09-21;
marketplace refresh returned no update. Installed and snapshot manifests agree.
Mode full; hooks SessionStart, SubagentStart, UserPromptSubmit. Sanitized local
evidence lives under `.codex/reports/backend-retirement-progress.txt`.

## Fixes from review

Architecture review found the Workshop origin requirement and Configurator's
public-backend label/example; both were corrected with release preparation
RED/GREEN verification. Security review found that the hidden legacy Pairing
Token field could still clear direct credentials; it now uses the same retain
rule with two additional regression cases. Sol also found simultaneous legacy-field
replay versus explicit empty-input ambiguity; one listener regression now proves
that initial replay retains credentials and a subsequent explicit edit disconnects. Review also corrected residual
public-backend descriptions in current docs. Dependency audit found three moderate issues in the
existing Vitest/devalue tree; compatible patch updates removed them.

## Verification commands

Resource-intensive commands ran through `h5i capture run --`:

- `npm ci`, `npm test`, `npm run check`, `npm run build`
- `npm run check:optional`, `npm run test:optional`, `npm run build:optional`
- `npm run build:workshop -w @spotify-wallpaper/wallpaper`
- `npm run scan:public-backend-secrets:all`, `npm run test:wasm-parity`
- `npx playwright test tests/playwright/wallpaper-characterization.spec.ts tests/playwright/direct-credentials.spec.ts`
- `npx playwright test --config playwright.auth.config.ts`
- `cargo test --manifest-path apps/backend/Cargo.toml --all-features`
- `npm audit --audit-level=moderate`
- `npm run check:repository-authority`, `npm run check:repository-preservation`
- `git diff --cached --check`
- `powershell.exe -NoProfile -Command codegraph index`

Two full-suite runs overlapped newly added RED tests and therefore failed on
those expected regressions. They are not reported as clean baseline runs.
The subsequent final suite is the completion gate.

## Next recommended task

Perform real Wallpaper Engine restart, refresh and multi-display acceptance
with separately authorized test accounts. Publish Pages only after the user's
separate deployment action and the documented release checks.
