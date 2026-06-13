# Phase 9: Player and Clock

## Summary

Implemented Spotify playback controls, controllable seek and volume inputs, shuffle/repeat toggles, album-ring seekbar display, player metadata controls, and optimized clock display settings.

## Changed files

- `README.md`
- `packages/shared-types/src/index.ts`
- `apps/configurator/src/App.svelte`
- `apps/wallpaper/src/App.svelte`
- `apps/wallpaper/src/settings/defaultSettings.ts`
- `apps/wallpaper/src/settings/loadSettings.ts`
- `apps/wallpaper/src/settings/loadSettings.test.ts`
- `apps/wallpaper/src/settings/repairSettings.ts`
- `apps/wallpaper/src/spotify/client.ts`
- `apps/wallpaper/src/spotify/client.test.ts`
- `apps/wallpaper/src/spotify/polling.ts`
- `apps/wallpaper/src/spotify/types.ts`
- `apps/wallpaper/src/wallpaperEngine/properties.ts`
- `apps/wallpaper/src/wallpaperEngine/properties.test.ts`
- `docs/phase-reports/phase-9-player-clock.md`

## Docs read

- `AGENTS.md`
- `docs/README.md`
- `docs/00-codex-entrypoint.md`
- `docs/01-project-goals-and-non-goals.md`
- `docs/02-repository-structure.md`
- `docs/03-implementation-phases.md`
- `docs/04-quality-gates.md`
- `docs/10-spotify-integration.md`
- `docs/11-wallpaper-engine.md`
- `docs/13-settings-schema.md`
- `docs/19-player-clock.md`
- `docs/22-performance.md`
- `docs/23-test-qa.md`
- `docs/24-docs-and-reporting.md`
- `docs/30-subagent-matrix.md`

## Implemented requirements

- Added Spotify playback operations for play, pause, next, previous, seek, volume, shuffle, and repeat.
- Playback operations reuse the existing token refresh session and never log token values.
- Control failures are classified through the existing Spotify error model and shown as safe UI status text.
- Controls are disabled in browser mock mode, without credentials, while busy, and on restricted devices.
- Passive display still works without Spotify Premium or any Spotify credentials.
- Seekbar remains available as a straight line and can send seek operations when controls are available.
- Added album-ring seekbar display around album art when configured.
- Added player settings for control visibility, device display, volume display, and shuffle/repeat display.
- Added clock settings for 24h/12h, seconds, date, weekday, font size, font weight, letter spacing, opacity, and auto/fixed color.
- Clock updates at the next minute boundary when seconds are disabled instead of updating every second.
- Broken player, seekbar, and clock settings are repaired to safe defaults and ranges.
- README documents the new player, seekbar, and clock settings.

## Deviations from spec

- No live Spotify Premium/device QA was performed; operation behavior is covered by fetch-level unit tests.
- Album-ring seekbar is display-only in this phase; interactive seeking remains on the straight line seekbar.
- Repeat UI toggles between context and off; track-repeat cycling can be added later.

## Tests run

- `npm test` passed: 17 files, 60 tests.
- `npm run check` passed with 0 warnings.
- `npm run build` passed.
- `cargo check --workspace` passed.
- `cargo test --workspace` passed.
- `npm audit --audit-level=moderate` passed with 0 vulnerabilities.
- `Invoke-WebRequest -UseBasicParsing http://127.0.0.1:5173/` returned HTTP 200 from the D drive wallpaper dev server.
- Browser plugin visual QA was attempted, but the Node REPL browser bridge failed before startup because the local kernel is treated as ESM and calls CommonJS `require`.

## Known gaps

- No Wallpaper Engine runtime QA for controls yet.
- No live Spotify playback control QA against a real account/device yet.
- No configurator UI editor for the new player, seekbar, and clock fields yet.

## Risks

- Spotify control availability varies by account, device, and Premium status; failures should be expected and are surfaced as non-fatal status text.
- Dense custom layouts can still overlap control rows because controls are rendered inside the existing track text layout item.

## Next tasks

- Start Phase 10: optional Tauri configurator setup and settings editor.

## SpecGuard review

- Initial review blocked completion because Wallpaper Engine `settings_json` did not propagate Phase 9 `player`, `seekbar`, and `clock` settings.
- Fixed `patchFromSettings` and added a Wallpaper Engine adapter regression test for those settings.
- SpecGuard also noted this phase report is ignored by `.gitignore`; it must be force-added before commit, matching prior phase-report handling.
- Follow-up review passed with no remaining blocking findings.
