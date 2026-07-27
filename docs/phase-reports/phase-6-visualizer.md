# Phase 6: Visualizer

## Summary

Implemented the Phase 6 visualizer MVP with album ring, radial bars, waveform line, settings-driven tuning, browser mock audio rendering, and performance-mode scaling.

## Changed files

- `README.md`
- `packages/shared-types/src/index.ts`
- `apps/configurator/src/App.svelte`
- `apps/wallpaper/src/App.svelte`
- `apps/wallpaper/src/settings/defaultSettings.ts`
- `apps/wallpaper/src/settings/loadSettings.ts`
- `apps/wallpaper/src/settings/loadSettings.test.ts`
- `apps/wallpaper/src/settings/repairSettings.ts`
- `apps/wallpaper/src/visualizer/VisualizerLayer.svelte`
- `apps/wallpaper/src/visualizer/model.ts`
- `apps/wallpaper/src/visualizer/model.test.ts`
- `apps/wallpaper/src/wallpaperEngine/properties.test.ts`
- `docs/phase-reports/phase-6-visualizer.md`

## Docs read

- `AGENTS.md`
- `docs/README.md`
- `docs/00-codex-entrypoint.md`
- `docs/01-project-goals-and-non-goals.md`
- `docs/02-repository-structure.md`
- `docs/03-implementation-phases.md`
- `docs/04-quality-gates.md`
- `docs/11-wallpaper-engine.md`
- `docs/16-visualizer.md`
- `docs/22-performance.md`
- `docs/23-test-qa.md`
- `docs/24-docs-and-reporting.md`
- `docs/30-subagent-matrix.md`

## Implemented requirements

- Visualizer renders in browser mock mode using the existing Wallpaper Engine audio bridge fallback.
- Added `album-ring`, `radial-bars`, and `waveform-line` modes.
- Added visualizer tuning settings for intensity, sensitivity, smoothing, decay, band weights, bar count, line width, radius, gap, rotation speed, glow, color mode, mirror mode, clamp max, noise gate, and idle animation.
- Audio frames are shaped with intensity, sensitivity, smoothing, decay, noise gate, clamp max, and bass/mid/treble weights before rendering.
- Low-power mode reduces bar count, sample usage, glow, and idle rotation speed.
- If no audio frame is available, the visualizer can render an idle frame instead of crashing.
- Stale or missing Wallpaper Engine audio now falls back to a low-frequency idle frame path for every MVP mode.
- Disabled visualizers skip frame shaping and clear cached visualizer state.
- Wallpaper Engine `settings_json` preserves visualizer tuning settings.
- Debug overlay reports visualizer mode/source and active performance mode.
- README documents the Phase 6 visualizer settings.

## Deviations from spec

- Particle-related settings are validated and preserved as schema fields, but particle rendering is not implemented because particles are listed as planned, not MVP.
- Visualizer rendering is implemented with lightweight SVG/Svelte instead of Canvas/WebGL.
- Simple settings UI controls are not implemented yet; settings are currently configured through JSON or Wallpaper Engine property import.

## Tests run

- `npm --workspace @spotify-wallpaper/wallpaper test -- src/visualizer/model.test.ts src/settings/loadSettings.test.ts src/wallpaperEngine/properties.test.ts` passed: 3 files, 15 tests.
- Post-SpecGuard fix rerun: `npm --workspace @spotify-wallpaper/wallpaper test -- src/visualizer/model.test.ts src/settings/loadSettings.test.ts src/wallpaperEngine/properties.test.ts` passed.
- Post-SpecGuard fix rerun: `npm run check` passed.
- `npm test` passed: 14 files, 46 tests.
- `npm run check` passed.
- `npm run build` passed.
- `cargo check --workspace` passed.
- `cargo test --workspace` passed.
- `npm audit --audit-level=moderate` passed with 0 vulnerabilities.
- `Invoke-WebRequest -UseBasicParsing http://127.0.0.1:5173/` returned HTTP 200 from the wallpaper dev server.
- Chrome headless screenshot verification confirmed browser mock still renders with the default album-ring visualizer: `artifacts/phase-6-visualizer-final-check.png`.
- Post-SpecGuard fix full rerun: `npm test`, `npm run build`, `cargo check --workspace`, `cargo test --workspace`, `npm audit --audit-level=moderate`, HTTP 200, and Chrome headless screenshot all passed.
- Post-SpecGuard fix screenshot: `artifacts/phase-6-after-specguard-fix.png`.

## Known gaps

- No live Wallpaper Engine runtime visual QA yet.
- No configurator UI for visualizer controls yet.
- No pixel-level browser automation for switching all visualizer modes; mode generation is covered by unit tests.

## Risks

- The SVG visualizer is intentionally lightweight; later high-effect modes may need Canvas/WebGL if richer effects are required.
- Album-ring placement follows the album art layout item and can overlap nearby text on very dense custom layouts.

## Next tasks

- Start Phase 7: LRC lyrics import/parsing UI, lyrics ON/OFF display, current-line and previous/current/next modes, offset handling, and missing-lyrics state.

## SpecGuard review

- Initial review found two P2 issues: visualizer frames were still shaped while disabled, and Wallpaper Engine audio registration had no stale/no-frame idle fallback.
- Fixed by gating frame shaping when `settings.visualizer.enabled` is false and adding a low-frequency idle ticker that activates only when audio frames are missing or stale.
- Follow-up review passed with no remaining blocker findings.
