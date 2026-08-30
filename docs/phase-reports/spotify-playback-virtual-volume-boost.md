# Spotify playback-linked virtual volume boost

## Phase name

Phase 6 follow-up — Spotify playback-linked virtual volume boost

## Summary

Replaced per-track automatic visualizer adaptation with one fixed virtual
Spotify-volume gain and made real Wallpaper Engine audio react only to the
current connection's last successfully fetched playing track or episode.

## Changed files

- `README.md`
- `apps/wallpaper/src/runtime/wallpaperRuntime.test.ts`
- `apps/wallpaper/src/runtime/wallpaperRuntime.ts`
- `apps/wallpaper/src/visualizer/adaptation.test.ts` (removed)
- `apps/wallpaper/src/visualizer/adaptation.ts` (removed)
- `apps/wallpaper/src/visualizer/model.test.ts`
- `apps/wallpaper/src/visualizer/model.ts`
- `apps/wallpaper/src/wallpaperEngine/audio.test.ts`
- `apps/wallpaper/src/wallpaperEngine/audio.ts`
- `config/repository-authority.json`
- `docs/11-wallpaper-engine.md`
- `docs/13-settings-schema.md`
- `docs/16-visualizer.md`
- `docs/18-transitions.md`
- `docs/23-test-qa.md`
- `docs/phase-reports/README.md`
- `docs/phase-reports/spotify-playback-virtual-volume-boost.md`
- `docs/qa-checklist.md`
- `docs/user-guide.md`
- `packages/shared-types/src/visualizer.test.ts`
- `packages/shared-types/src/visualizer.ts`
- `tests/playwright/__snapshots__/wallpaper-characterization.spec.ts-snapshots/*.png`
- `tests/playwright/wallpaper-characterization.spec.ts`

## Relevant docs read

- `AGENTS.md`
- `docs/README.md`
- `docs/00-codex-entrypoint.md`
- `docs/01-project-goals-and-non-goals.md`
- `docs/02-repository-structure.md`
- `docs/03-implementation-phases.md`
- `docs/04-quality-gates.md`
- `docs/05-repository-authority.md`
- `docs/10-spotify-integration.md`
- `docs/11-wallpaper-engine.md`
- `docs/13-settings-schema.md`
- `docs/16-visualizer.md`
- `docs/22-performance.md`
- `docs/23-test-qa.md`
- `docs/24-docs-and-reporting.md`
- `docs/30-subagent-matrix.md`
- `docs/how-to-use-h5i.md`
- `docs/qa-checklist.md`
- `docs/user-guide.md`
- Relevant local reports listed in the implementation memory.

## Implemented requirements

- Added `virtualVolumeBoostGain`: volume 1 through 100 returns
  `100 / volume`; zero, missing, non-finite, negative, and above-100 values
  return 1, with no multiplier cap.
- Applied the input gain before sensitivity, band weighting, the noise gate,
  clamping, smoothing, and decay in both shaping and silence detection.
- Kept intensity as the final display-only multiplier and mock/idle gain at 1.
- Added one internal successful-poll flag. Provider reconfiguration clears it,
  a successful result sets it, and a transient network, rate-limit, or
  unsupported-response failure retains it. Item-null, no-active-device,
  unauthorized, and forbidden results clear it.
- Accepted real audio only for a source-matched, successfully fetched, playing
  Spotify track or episode.
- Replaced ineligible real audio with the existing idle visualizer frame while
  releasing album and glowing-object motion to neutral over about 450ms.
- Delayed volume-change response until the next audio callback and added no
  raw-frame replay storage or Spotify/PC volume command.
- Cleared poll eligibility after an optimistic Play command until a later
  successful playing poll confirms it.
- Removed per-track high-water tracking, 12-second decay, gain smoothing,
  response inversion, and the combined 4× cap.
- Preserved browser mock mode, settings schema, Spotify/provider contracts,
  WASM ABI, and dependencies.
- Kept Wallpaper Engine frames ineligible during mock playback. Browser
  characterization now injects deterministic frames through the existing mock
  bridge instead of disguising them as Wallpaper Engine audio.

## Known gaps

- Wallpaper Engine exposes the PC-wide mixed audio stream, so another audible
  application receives the same virtual visual gain while Spotify is eligible.
- Live Wallpaper Engine and real Spotify account QA remains manual and must not
  capture credential-bearing UI.

## Tests run

- Visualizer model RED: 15 expected failures; GREEN: 26/26 passed.
- Runtime RED: 10 expected failures; GREEN: 40/40 passed. A browser-mock
  regression test then failed as expected and passed after matching the
  connection to playback origin rather than the test callback's frame label;
  that runtime suite passed 41/41. SpecGuard RED coverage then added four
  terminal playback/auth errors and Sol RED coverage added one optimistic-Play
  case. All five failed before their fixes and the current runtime suite passes
  46/46.
- Connection-state mutation check: both focused tests failed under deliberate
  wrong flag behavior, then passed after restoration.
- Shared visualizer tests: 27/27 passed across the shared-types workspace.
- Full workspace `npm test`: passed.
- Full workspace `npm run check`: passed; every Svelte workspace reported
  0 errors and 0 warnings.
- Full production `npm run build`: passed, including Rust/WASM and Worker dry
  run. Only the existing optional Cargo metadata and runtime WASM URL notices
  were emitted.
- Playwright wallpaper characterization: 86/86 passed. Geometry fixtures and
  four mock screenshots were updated to remove their dependency on the deleted
  automatic adaptation.
- The full workspace test, type-check, production build, and all 86 Playwright
  cases were rerun after the review fixes on 2026-08-31 and passed.
- Repository authority policy, checker, and preservation comparison: passed
  after bounded staging. The user-owned `AGENTS.md` difference was excluded.
- Browser mock visual QA: album-only and details layouts rendered, mock track
  metadata and disabled mock controls were correct, the details toggle worked,
  and the browser console had no warning or error entries.

## Risks introduced

- Very low non-zero Spotify volume intentionally produces a large uncapped
  visual input multiplier. Existing normalization, clamping, finite checks,
  and settings repair remain the safety boundary.
- Eligibility uses the last successful playback through transient communication
  failures by design. Terminal playback/auth errors, another successful result,
  or a provider change can clear it.

## Review outcome

- Work class: strict-gated, cross-cutting Phase 6 follow-up with explicitly
  requested full QA.
- Security Reviewer: omitted because authentication, credentials, secrets,
  logging, redirects, Worker, Tauri, and external provider contracts are
  unchanged.
- Initial Architecture review: FAIL because the first browser-test repair also
  allowed real Wallpaper Engine frames during mock playback. The product gate
  was restored and the test harness was moved to true mock frames. Architecture
  re-review: PASS. Initial SpecGuard review: FAIL because the real `item_null`
  error path retained eligibility. SpecGuard re-review: PASS. Initial Sol
  review: FAIL because an optimistic Play command could react before a later
  playing poll. Sol re-review: PASS with no unresolved finding. The following
  Ponytail full whole-repository read-only audit returned exactly
  `Lean already. Ship.`. Because this report completion changes the frozen diff,
  the commit gate repeats Sol and Ponytail in that order without further tracked
  edits.
- Frozen Ponytail baseline: official Git source
  `https://github.com/DietrichGebert/ponytail.git`, snapshot revision
  `2ed6c52c9d7e5e56942508591085fd45dea277d3`, snapshot and installed version
  `4.9.0`, verified 2026-08-30 23:25 JST, enabled with trusted standard
  `SessionStart`, `SubagentStart`, and `UserPromptSubmit` hooks, full mode,
  unrestricted implementation permissions. Marketplace refresh reported no
  update or error. Audit result recorded at 2026-08-31 00:53 JST:
  `Lean already. Ship.`.

## Fixes from review

- Restored frame-source eligibility: mock playback accepts only `mock` frames;
  Wallpaper Engine frames require the current successful Spotify connection.
- Added a deterministic browser-preview sample seam to the mock bridge and
  converted Playwright fixtures away from the Wallpaper Engine listener.
- Added RED/GREEN coverage for both the rejected mock-provider/real-frame case
  and the deterministic mock bridge path.
- Cleared real-audio eligibility for item-null, no-active-device, unauthorized,
  and forbidden errors, with four RED/GREEN regression cases.
- Cleared eligibility after an optimistic Play result, with RED/GREEN coverage
  proving the next playing poll remains authoritative.

## Verification commands

- `h5i capture run -- npm run test -w @spotify-wallpaper/wallpaper -- src/visualizer/model.test.ts src/runtime/wallpaperRuntime.test.ts`
- `h5i capture run -- npm run test -w @spotify-wallpaper/shared-types -- src/visualizer.test.ts`
- `h5i capture run -- npm run check -w @spotify-wallpaper/wallpaper`
- `h5i capture run -- npx playwright test tests/playwright/wallpaper-characterization.spec.ts`
- `h5i capture run -- npm test`
- `h5i capture run -- npm run check`
- `h5i capture run -- npm run build`
- `h5i capture run -- npm run verify:repository-authority`
- `h5i capture run -- powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File C:\Users\cielg\AppData\Roaming\npm\codegraph.ps1 sync .`

## Next recommended task

Complete required same-diff reviews, bounded staging, preservation verification,
commit, and committed-HEAD verification.
