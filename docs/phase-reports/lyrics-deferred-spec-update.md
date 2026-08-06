# Lyrics Deferred Spec Update

## Summary

Updated the current v1 specification to treat Lyrics/LRC as deferred scope rather than an implemented requirement. The runtime no longer exposes lyrics settings, layout items, Wallpaper Engine properties, or LRC parsing, and legacy `lyrics` settings are repaired by dropping the inactive object.

## Changed files

- `AGENTS.md`
- `docs/01-project-goals-and-non-goals.md`
- `docs/02-repository-structure.md`
- `docs/03-implementation-phases.md`
- `docs/11-wallpaper-engine.md`
- `docs/12-rust-wasm-core.md`
- `docs/13-settings-schema.md`
- `docs/14-ui-layout.md`
- `docs/17-lyrics.md`
- `docs/18-transitions.md`
- `docs/20-tauri-configurator.md`
- `docs/23-test-qa.md`
- `docs/24-docs-and-reporting.md`
- `docs/30-subagent-matrix.md`
- `docs/user-guide.md`
- `docs/qa-checklist.md`
- `docs/release-notes-v0.0.1.md`
- `docs/post-v0.0.1-stabilization.md`
- `apps/wallpaper/src/settings/repairSettings.ts`
- `apps/wallpaper/src/settings/loadSettings.test.ts`

## Docs read

- `AGENTS.md`
- `docs/README.md`
- `docs/00-codex-entrypoint.md`
- `docs/01-project-goals-and-non-goals.md`
- `docs/02-repository-structure.md`
- `docs/03-implementation-phases.md`
- `docs/04-quality-gates.md`
- `docs/11-wallpaper-engine.md`
- `docs/12-rust-wasm-core.md`
- `docs/13-settings-schema.md`
- `docs/14-ui-layout.md`
- `docs/17-lyrics.md`
- `docs/18-transitions.md`
- `docs/20-tauri-configurator.md`
- `docs/23-test-qa.md`
- `docs/24-docs-and-reporting.md`
- `docs/30-subagent-matrix.md`
- `docs/user-guide.md`
- `docs/qa-checklist.md`
- `docs/release-notes-v0.0.1.md`

## Implemented requirements

- Removed Lyrics/LRC from current v1 product, settings, layout, Rust/WASM, Wallpaper Engine, QA, and user-guide requirements.
- Rewrote `docs/17-lyrics.md` as a deferred-scope document with explicit reintroduction requirements.
- Added a regression test that legacy top-level `lyrics` settings are dropped during settings repair.

## Deviations from prior spec

The previous docs treated user-provided LRC lyrics as an implemented milestone feature. The current v1 spec now defers Lyrics/LRC until a future dedicated phase.

## Tests run

- `h5i capture run -- npm run test -w @spotify-wallpaper/wallpaper -- src/settings/loadSettings.test.ts src/wallpaperEngine/projectJson.test.ts` passed.
- `h5i capture run -- npm run test -w @spotify-wallpaper/wallpaper` passed.
- `h5i capture run -- npm run check -w @spotify-wallpaper/wallpaper` passed.
- `h5i capture run -- cargo test` passed.

## Known gaps

Historical phase reports still describe the previous Lyrics/LRC implementation because they are retained as history.

## Risks

Users with old settings JSON containing `lyrics` fields will see those fields ignored. This is intentional for the current v1 scope and should not break startup.

## Next tasks

Run wallpaper settings tests, full wallpaper checks, and update this report if verification reveals a gap.
