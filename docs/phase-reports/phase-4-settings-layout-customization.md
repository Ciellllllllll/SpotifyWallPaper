# Phase 4: Settings and layout customization

## Summary

Implemented versioned settings repair, coordinate-based layout items, anchor-based positioning, required layout presets, and preset/property-driven layout selection in the wallpaper UI.

## Changed files

- `README.md`
- `packages/shared-types/src/index.ts`
- `apps/configurator/src/App.svelte`
- `apps/wallpaper/src/App.svelte`
- `apps/wallpaper/src/layout/presets.ts`
- `apps/wallpaper/src/layout/presets.test.ts`
- `apps/wallpaper/src/layout/style.ts`
- `apps/wallpaper/src/layout/style.test.ts`
- `apps/wallpaper/src/settings/defaultSettings.ts`
- `apps/wallpaper/src/settings/loadSettings.ts`
- `apps/wallpaper/src/settings/repairSettings.ts`
- `apps/wallpaper/src/settings/repairSettings.test.ts`
- `apps/wallpaper/src/wallpaperEngine/properties.ts`
- `docs/phase-reports/phase-4-settings-layout-customization.md`

## Docs read

- `AGENTS.md`
- `docs/README.md`
- `docs/00-codex-entrypoint.md`
- `docs/01-project-goals-and-non-goals.md`
- `docs/03-implementation-phases.md`
- `docs/04-quality-gates.md`
- `docs/11-wallpaper-engine.md`
- `docs/13-settings-schema.md`
- `docs/14-ui-layout.md`
- `docs/19-player-clock.md`
- `docs/24-docs-and-reporting.md`
- `docs/30-subagent-matrix.md`

## Implemented requirements

- `WallpaperSettings.layout` now contains versioned `LayoutItem` entries.
- Layout items include enabled, x, y, unit, anchor, width, height, scale, rotation, opacity, zIndex, responsive behavior, safe area margin, locked, and transition participation fields.
- Main UI pieces are rendered from layout items: album art, track text, seekbar, clock, and debug overlay.
- Percent-based positioning is supported.
- All required anchors are supported in CSS style generation.
- Safe-area clamping is supported through `responsive: "clamp-safe-area"`.
- Required presets are defined: Minimal, Center Album, Lyrics Focus, Visualizer Heavy, Rainmeter Hybrid, Left Dock, Bottom Player, Clock Focus, Album Ring, and Ambient Background.
- Presets can be selected through settings JSON or Wallpaper Engine `selected_preset`.
- Invalid settings and layout fields are repaired or defaulted without blocking startup.
- README documents preset/custom layout JSON and states that invalid settings are repaired safely.

## Deviations from spec

- Pixel, `vw`, and `vh` units are typed and emitted by the style helper, but presets currently use percent coordinates as the recommended default.
- Interactive drag/edit UI is not implemented in the wallpaper; configurator editing is scheduled for a later phase.
- Rust layout helpers from Phase 3 are not yet wired into the TypeScript runtime; Phase 4 uses TypeScript-side layout style generation.

## Tests run

- `npm test` passed: 10 files, 28 tests.
- `npm run check` passed.
- `npm run build` passed.
- `cargo check --workspace` passed.
- `cargo test --workspace` passed.
- `npm audit --audit-level=moderate` passed with 0 vulnerabilities.
- `Invoke-WebRequest -UseBasicParsing http://127.0.0.1:5173/` returned HTTP 200 from the wallpaper dev server.
- Chrome headless screenshot verification confirmed browser mock still renders album placeholder, album art, track title, artists, progress display, clock, and debug toggle with layout-item positioning.

## Known gaps

- No drag-and-drop layout editor yet.
- No full settings reference document yet beyond README examples.
- No live Wallpaper Engine runtime test was performed.
- TypeScript and Rust layout implementations are still separate.

## Risks

- Preset coordinates may need visual tuning across unusual aspect ratios.
- Future configurator work must avoid exporting refresh tokens by default when editing settings JSON.

## Next tasks

- Start Phase 5: album-based background modes, theme extraction/fallback, and readability correction.

## SpecGuard review

- Initial SpecGuard finding: settings JSON preset selection did not apply preset coordinates when `layout.items` was omitted.
- Fix: `loadSettings()` now clones the selected preset items when settings JSON supplies only `layout.preset`, with a regression test for `Bottom Player`.
- Re-review findings: none.
- Status: passed.
