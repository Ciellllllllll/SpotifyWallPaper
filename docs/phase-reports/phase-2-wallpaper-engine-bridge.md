# Phase 2: Wallpaper Engine bridge

## Summary

Implemented the Wallpaper Engine bridge foundation: isolated property parsing, settings patch merge, Wallpaper Engine audio listener adapter, browser mock audio fallback, and shared visualizer input model.

## Changed files

- `README.md`
- `packages/shared-types/src/index.ts`
- `apps/wallpaper/src/App.svelte`
- `apps/wallpaper/src/wallpaperEngine/**`
- `docs/phase-reports/phase-2-wallpaper-engine-bridge.md`

## Docs read

- `AGENTS.md`
- `docs/README.md`
- `docs/00-codex-entrypoint.md`
- `docs/01-project-goals-and-non-goals.md`
- `docs/03-implementation-phases.md`
- `docs/04-quality-gates.md`
- `docs/11-wallpaper-engine.md`
- `docs/16-visualizer.md`
- `docs/22-performance.md`
- `docs/23-test-qa.md`
- `docs/24-docs-and-reporting.md`
- `docs/30-subagent-matrix.md`

## Implemented requirements

- Wallpaper Engine property access is isolated behind `apps/wallpaper/src/wallpaperEngine/properties.ts`.
- Supported basic property keys: `spotify_client_id`, `spotify_refresh_token`, `settings_json`, `selected_preset`, `visualizer_enabled`, `lyrics_enabled`, `performance_mode`, and `debug_enabled`.
- Property patches are merged into validated defaults without replacing full settings categories with partial objects.
- Token values are accepted as configuration but are not logged or displayed.
- Wallpaper Engine audio listener access is isolated behind `apps/wallpaper/src/wallpaperEngine/audio.ts`.
- Wallpaper Engine audio samples and browser mock audio produce the same `VisualizerFrame` model.
- Browser fallback creates mock audio frames when `wallpaperRegisterAudioListener` is unavailable.
- Debug overlay shows current visualizer source and audio peak without exposing tokens.
- README documents `apps/wallpaper/dist` as the Wallpaper Engine import folder after build.

## Deviations from spec

- Phase 2 normalizes audio input but does not render a visualizer yet; visualizer rendering starts in Phase 6.
- The property adapter supports basic flat property keys first. A full Wallpaper Engine `project.json` and rich property UI are not created yet.

## Tests run

- `npm test` passed: 7 files, 21 tests.
- `npm run check` passed.
- `npm run build` passed.
- `cargo check --workspace` passed.
- `cargo test --workspace` passed.
- `npm audit --audit-level=moderate` passed with 0 vulnerabilities.
- `Invoke-WebRequest -UseBasicParsing http://127.0.0.1:5173/` returned HTTP 200 from the wallpaper dev server.
- Chrome headless screenshot verification confirmed browser mock still renders album placeholder, album art, track title, artists, progress display, clock, and debug toggle.

## Known gaps

- No real Wallpaper Engine runtime test was performed in this phase.
- No `project.json` metadata is generated yet.
- No visualizer rendering consumes `VisualizerFrame` beyond debug state.

## Risks

- Wallpaper Engine property key naming may need adjustment when the final `project.json` schema is added.
- Browser mock audio runs on a timer while the wallpaper is open; this is intentionally lightweight but may be tuned by performance mode later.

## Next tasks

- Start Phase 3: Rust/WASM core pure calculation modules and tests.

## SpecGuard review

- SpecGuard reviewed Phase 2 for phase order, property adapter isolation, shared audio model, secrets handling, polling cadence, mock/browser preview, Tauri optionality, and report completeness.
- Findings: none.
- Status: passed.
