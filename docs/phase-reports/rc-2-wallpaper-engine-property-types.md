# RC-2 Report - Wallpaper Engine Property Types

## Summary

Aligned Wallpaper Engine user property definitions with the supported Web Wallpaper property types. Text-like inputs now
use `textinput`, and `settings_json` is documented as single-line JSON.

## Changed Files

- `apps/wallpaper/public/project.json`
- `apps/wallpaper/src/wallpaperEngine/projectJson.test.ts`
- `README.md`
- `docs/user-guide.md`
- `docs/qa-checklist.md`
- `docs/post-v0.0.1-stabilization.md`
- `docs/phase-reports/rc-2-wallpaper-engine-property-types.md`

## Relevant Docs Read

- `AGENTS.md`
- `docs/README.md`
- `docs/00-codex-entrypoint.md`
- `docs/01-project-goals-and-non-goals.md`
- `docs/02-repository-structure.md`
- `docs/03-implementation-phases.md`
- `docs/04-quality-gates.md`
- `docs/11-wallpaper-engine.md`
- `docs/13-settings-schema.md`
- `docs/23-test-qa.md`
- `docs/24-docs-and-reporting.md`
- `docs/30-subagent-matrix.md`
- `docs/how-to-use-h5i.md`

## Implemented Requirements

- Changed `spotify_client_id`, `spotify_refresh_token`, and `settings_json` to Wallpaper Engine `textinput` properties.
- Added a regression test that rejects unsupported `project.json` user property types such as `text` and `textarea`.
- Documented that `settings_json` must be entered as single-line JSON.
- Documented that public QA should use dummy Refresh Token values because the Wallpaper Engine input can be visible.
- Documented that CLI property injection is diagnostic only for RC-2; pass/fail depends on Wallpaper Engine UI editing and real display application.

## Known Gaps

- Real Wallpaper Engine UI QA cannot be executed in this Codex environment.
- RC-2 artifact import into Wallpaper Engine must be completed on a Windows machine with Wallpaper Engine installed.

## Tests Run

- `h5i capture run -- npm.cmd run test -w @spotify-wallpaper/wallpaper` - passed, 20 files and 66 tests.
- `h5i capture run -- npm.cmd run check` - passed.
- `h5i capture run -- npm.cmd run build` - passed.
- `git diff --check` - passed with CRLF normalization warnings only.
- `h5i capture run -- wasm-pack build crates/visual-core --target web --out-dir ../../apps/wallpaper/public/wasm` - passed.
- `h5i capture run -- npm.cmd run build -w @spotify-wallpaper/wallpaper` - passed for RC-2 artifact generation.

## Risks Introduced

- `settings_json` is no longer represented as multiline input in Wallpaper Engine, so users must paste compact single-line JSON.

## Next Recommended Task

Rebuild the RC-2 artifact, import it into Wallpaper Engine, and record redacted real-machine QA results.
