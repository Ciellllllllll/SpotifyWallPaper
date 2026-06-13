# Phase 7: Lyrics

## Summary

Implemented user-provided LRC lyrics support with parsing, synced display state, current-line and previous/current/next display modes, offset handling, missing-state behavior, layout placement, and provider boundary metadata.

## Changed files

- `README.md`
- `packages/shared-types/src/index.ts`
- `apps/configurator/src/App.svelte`
- `apps/wallpaper/src/App.svelte`
- `apps/wallpaper/src/layout/presets.ts`
- `apps/wallpaper/src/layout/presets.test.ts`
- `apps/wallpaper/src/lyrics/LyricsLayer.svelte`
- `apps/wallpaper/src/lyrics/lrc.ts`
- `apps/wallpaper/src/lyrics/lrc.test.ts`
- `crates/visual-core/src/lrc.rs`
- `apps/wallpaper/src/settings/defaultSettings.ts`
- `apps/wallpaper/src/settings/loadSettings.ts`
- `apps/wallpaper/src/settings/loadSettings.test.ts`
- `apps/wallpaper/src/settings/repairSettings.ts`
- `apps/wallpaper/src/wallpaperEngine/properties.test.ts`
- `docs/phase-reports/phase-7-lyrics.md`

## Docs read

- `AGENTS.md`
- `docs/README.md`
- `docs/00-codex-entrypoint.md`
- `docs/01-project-goals-and-non-goals.md`
- `docs/02-repository-structure.md`
- `docs/03-implementation-phases.md`
- `docs/04-quality-gates.md`
- `docs/12-rust-wasm-core.md`
- `docs/14-ui-layout.md`
- `docs/17-lyrics.md`
- `docs/23-test-qa.md`
- `docs/24-docs-and-reporting.md`
- `docs/30-subagent-matrix.md`

## Implemented requirements

- Lyrics are disabled by default and never bundled.
- Initial lyrics source is user-provided LRC text in settings.
- LRC parser supports timestamped lines, metadata tags, offset tags, duplicate timestamps, empty lyric lines, and long text.
- LRC offset metadata applies to all parsed timestamped lines regardless of where the offset tag appears.
- Synced lyric display state supports disabled, missing, before-first-line, and active states.
- Current-line-only mode does not display a timed lyric before its timestamp.
- Added current-line-only and previous/current/next display modes.
- Added settings offset support with safe range repair.
- Added configurable missing-state display.
- Added `lyrics` layout item across presets, including a larger `Lyrics Focus` placement.
- Added future provider boundary metadata for user LRC source, search input shape, synced/plain support flags, cache policy, and failure reason.
- Wallpaper Engine `settings_json` preserves lyrics settings.
- README documents user-provided LRC usage and explicitly states that lyrics are not bundled or externally fetched in this phase.

## Deviations from spec

- Web runtime uses a TypeScript LRC parser that mirrors the Rust parser behavior; no WASM binding is wired yet.
- External lyrics providers are not implemented, only the provider boundary metadata.
- No configurator UI editor for LRC input yet; settings are configured through JSON or Wallpaper Engine property import.

## Tests run

- `npm --workspace @spotify-wallpaper/wallpaper test -- src/lyrics/lrc.test.ts src/layout/presets.test.ts src/settings/loadSettings.test.ts src/wallpaperEngine/properties.test.ts` passed in this worktree: 4 files, 18 tests.
- `npm run check` passed in this worktree with 0 warnings.
- `npm test` passed in this worktree: 15 files, 52 tests.
- `npm run build` passed in this worktree.
- `cargo check --workspace` passed in this worktree.
- `cargo test --workspace` passed in this worktree.
- Post-Rust-offset fix rerun: `npm --workspace @spotify-wallpaper/wallpaper test -- src/lyrics/lrc.test.ts src/layout/presets.test.ts src/settings/loadSettings.test.ts src/wallpaperEngine/properties.test.ts` passed.
- Post-Rust-offset fix rerun: `cargo test --workspace` passed with 10 visual-core tests.
- Post-Rust-offset fix rerun: `npm run check` passed with 0 warnings.
- Post-Rust-offset fix rerun: `cargo check --workspace`, `npm run build`, and `npm audit --audit-level=moderate` passed.
- `npm audit --audit-level=moderate` passed in this worktree with 0 vulnerabilities.
- `Invoke-WebRequest -UseBasicParsing http://127.0.0.1:5175/` returned HTTP 200 from the current worktree wallpaper dev server.
- Chrome headless screenshot verification confirmed browser mock still renders with lyrics disabled by default: `artifacts/phase-7-after-fixes-default-mock.png`.
- `npm install` restored dependencies in this worktree with 0 vulnerabilities.

## Known gaps

- No live Wallpaper Engine runtime QA for lyrics settings yet.
- No browser screenshot for enabled lyrics mode due lack of installed browser automation in this repo.
- No WASM-bound LRC parser in the web runtime yet.
- No LRC editor/import workflow in the optional configurator yet.

## Risks

- User-provided very long LRC strings are parsed in the web runtime and may need memoization or size limits during final QA.
- Dense custom layouts can overlap lyrics with other elements; the lyrics layer follows the same coordinate system and repair rules as other layout items.

## Next tasks

- Start Phase 8: track-change detection, previous/current state retention animations, rapid-change safety, and reduce-motion behavior.

## SpecGuard review

- Initial current-worktree review found three issues: before-first-line rendering could show the first timed lyric when missing state was disabled, `[offset]` handling was order-dependent, and the phase report was missing from this worktree.
- Fixed before-first-line rendering, made LRC offset order-independent, added a regression test, and wrote this report.
- Follow-up review passed for the active web path and identified one non-blocking Rust/WASM consistency issue.
- Fixed the Rust LRC parser to apply offset metadata order-independently and added a Rust regression test.
- Final follow-up review passed with no remaining Phase 7 blockers or consistency findings.
