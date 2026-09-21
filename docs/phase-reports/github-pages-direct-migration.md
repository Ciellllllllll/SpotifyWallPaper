# GitHub Pages / Direct Spotify migration

## Phase name

Strict-gated migration, 2026-09-21. One checkout: `D:\Git\SpotifyWallPaper`,
branch `develop`, starting HEAD `5b34c4c38f4c3293e72ad4ecf296aff26bc1c0cf`.
The resulting local commit contains this report; no push or deployment is authorized.

## Summary

The standard connection uses static Pages PKCE authorization followed by direct
Spotify requests from the wallpaper. Normal build/check/test no longer require
the optional backend or configurator. This does not establish actual Wallpaper
Engine compatibility: host storage and Spotify CORS still need device testing.

## Changed files

- `apps/spotify-auth/`: static Japanese authorization UI, transaction validation,
  exact Pages paths, callback output, artifact allowlist, unit tests.
- `apps/wallpaper/src/spotify/`: dedicated credential store, refresh session,
  bounded requests, token validation, errors, compatible import format, tests.
- `apps/wallpaper/src/{runtime,settings,wallpaperEngine}/` and `App.svelte`:
  host integration, stale-input protection, restoration and status.
- `packages/shared-types/`: internal diagnostics separated from provider-v1 wire types.
- Workflows, package scripts, security checks, Playwright tests/configuration.
- Current entry/domain/user/privacy/QA documents, report catalog and authority policy.

## Relevant docs read

AGENTS; docs README and 00–05; 10, 11, 13, 20, 21, 23–25, 30;
how-to-use-h5i; user guide and QA checklist. The supplied migration requirements
were read from the user's attached file. Historical reports were not treated as
current normative behavior. Spotify PKCE/refresh/quota/policy/design and GitHub
Pages workflow/limits/HTTPS official references are linked in current user docs.

## Implemented requirements

- The production authorization path is `/SpotifyWallPaper/spotify-auth/`; the
  registered redirect ends in `/spotify-auth/callback/`. One config supplies Vite
  and artifact paths. Builds need no Spotify credentials.
- PKCE/state/client/redirect/time are bound to a one-use transaction. Callback
  query data is removed before exchange. Old callbacks cannot erase new sessions.
  The success bundle is shown in memory, manually copied and explicitly clearable.
- `swpt2` adds an authorization identifier and original authorization time;
  `swpt1` remains readable. Base64url is encoding, not encryption.
- IndexedDB `spotify-wallpaper-direct-credentials` / `credentials` / `current`
  owns raw credentials separately from settings. It is plaintext browser storage,
  not an OS vault. Settings export and runtime snapshots exclude raw secrets.
- Atomic short transactions claim a 60-second lease. Network waits happen outside
  transactions. Identity/revision/lease checks reject stale account results;
  successful rotation survives provider disposal and unclaimed lease expiry.
- The initial import digest never overwrites a rotated token. Retired identifiers
  prevent stale host input after disconnect or invalid_grant. At the 4096-entry
  safety limit, deletion still succeeds and further imports fail closed until
  storage is deliberately reset; clearing storage also removes stale-input protection.
- Concurrent refreshes share a promise and, within a shared database, a lease.
  Transient failure cooldown/backoff/jitter is persisted. Late API 401 retries once
  against the current token. Only current invalid_grant retires authorization.
- Expiry follows `expires_in`; no 24-hour local expiry exists. Rotation does not
  reset original authorization time or extend Spotify's six-month authorization.
- Existing rendering, beat/motion algorithms, visualizers, particle drawing,
  background/theme/layout/clock/transitions and Mock remain in their existing modules.
- Optional Tauri/Rainmeter/loopback/policy-locked public backend remain available.
  No secrets were extracted from those systems and no resources were stopped.
- Pages PR runs validate only. Deployment requires trusted `develop`, successful
  build/tests, and `PAGES_DEPLOY_ENABLED == 'true'`; permissions belong to deploy.

## Known gaps

No real Spotify account, Pages deployment, Wallpaper Engine CORS/Origin test,
real restart/sleep/offline recovery, multi-display storage-sharing measurement,
or physical 24/72-hour soak was performed. Browser IndexedDB tests prove only
same-origin contexts sharing one browser database. Separate processes/profiles/PCs
may need separate authorization; no shared storage or IPC is assumed.
The historical cause of a reported 24-hour failure was not established.
Operator contact details and Spotify/GitHub public-use compliance remain release
checks. Static Pages cannot promise arbitrary HTTP response headers or that its
hosting service never receives the initial callback request.

## Tests run

Before implementation, focused existing wallpaper tests passed (200 tests) and
auth tests passed (11). New regression cases first reproduced failures in token
validation, persistence, import, state/client binding, concurrency and workflow.
Normal `npm test` passed 461 tests; normal check/build passed. Optional
tests/check/build passed (180 tests; the existing opt-in clean-release artifact
integration test was not enabled and remains one skip). Actual WASM parity
passed 2 tests. Browser characterization plus real IndexedDB passed 88 tests;
mocked Pages authorization passed 3. Auth cleanup was followed by 19 passing
auth tests, typecheck/build, and the 3 browser tests again. Repository authority,
26 recovered byte matches, source/artifact secret scans and diff checks passed.
The production diff scanner flagged a removed `VITE_AUTH_BASE_PATH` name only;
added production lines passed and dummy test fixtures were reviewed separately.
Final command results and exact reviewed tree are recorded in local
`.codex/reports` evidence. Native Tauri/Rainmeter UI was not exercised.
Fake clocks cover 1, 24 and 72 hours; these are not real-time soak tests.

## Risks introduced

Browser storage access can be denied, lost or read by local software. The UI
reports persistence failure; it does not advertise memory-only fallback as durable.
A rotation whose response or durable write is lost may require reauthorization.
Read failures before refresh can recover; a failed refresh save fails closed.
Clearing an authorization input disconnects and retires it; an old bundle is not
a reconnect mechanism. Use a new Pages authorization after disconnect.

## Review outcome

Work class: strict (authentication, credentials, architecture, settings, CI).
Sol, Security (including independent auth review), Architecture and SpecGuard
returned PASS. Ponytail's first full audit found an unused error-redaction
helper; it was removed and its safety test moved to the actual callback boundary.
Following renewed role PASS results, Ponytail returned `Lean already. Ship.`.
Early failing reviews were not treated as PASS. This evidence-only report update
is also subject to final review before committing; exact tree and clean-HEAD
verification results are stored under `.codex/reports` and summarized in the
task's completion report.
Ponytail frozen baseline: official `https://github.com/DietrichGebert/ponytail.git`,
revision `e3ba2aa6f1e6f0bc4d69eb09c9f0d0a93af56156`, stable 4.10.0,
verified 2026-09-21; hooks SessionStart activate, SubagentStart subagent,
UserPromptSubmit tracker; minimal-solution mode plus strict full audit.
External real-account and device gates are intentionally left unverified.

## Fixes from review

Separated provider deactivation from disconnect; protected queued new imports
from old notifications; retained rotations after sleep/disposal; corrected forced
401 single-flight; persisted failure cooldown; separated wire diagnostics;
preserved deletion at the retired-ID limit; wired browser tests into CI; separated
PowerShell validation steps; handled unavailable storage and old OAuth callbacks;
retained long Retry-After without overflowing browser timers.

## Verification commands

Resource-intensive commands use `h5i capture run --`:
`npm test`, `npm run check`, `npm run build`, `npm run test:optional`,
`npm run check:optional`, `npm run build:optional`, `npm run test:wasm-parity`,
`node apps/spotify-auth/prepare-pages.mjs`,
`npx playwright test --config playwright.auth.config.ts`,
`npx playwright test tests/playwright/direct-credentials.spec.ts tests/playwright/wallpaper-characterization.spec.ts`,
`npm run verify:repository-authority`, artifact secret scanning, `git diff --check`.

## Next recommended task

Follow README's manual Pages configuration and register the exact Spotify
redirect. Before enabling publication, finish operator/policy checks. Then test
the produced wallpaper in Wallpaper Engine with real CORS, persistence, restart,
sleep, offline recovery and multiple displays; record a separate 72-hour soak.
Only after those checks should the user independently retire an old backend.
