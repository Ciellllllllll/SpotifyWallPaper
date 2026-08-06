# Phase 3: Rust/WASM core

## Summary

Implemented Rust pure logic foundations for settings validation/migration, layout anchor calculation, LRC parsing and lookup, readability calculation, visualizer normalization, and animation interpolation.

## Changed files

- `crates/config-schema/src/lib.rs`
- `crates/visual-core/src/lib.rs`
- `crates/visual-core/src/animation.rs`
- `crates/visual-core/src/layout.rs`
- `crates/visual-core/src/lrc.rs`
- `crates/visual-core/src/theme.rs`
- `crates/visual-core/src/visualizer.rs`
- `docs/phase-reports/phase-3-rust-wasm-core.md`

## Docs read

- `AGENTS.md`
- `docs/README.md`
- `docs/00-codex-entrypoint.md`
- `docs/01-project-goals-and-non-goals.md`
- `docs/03-implementation-phases.md`
- `docs/04-quality-gates.md`
- `docs/12-rust-wasm-core.md`
- `docs/13-settings-schema.md`
- `docs/14-ui-layout.md`
- `docs/15-background-theme.md`
- `docs/17-lyrics.md`
- `docs/23-test-qa.md`
- `docs/24-docs-and-reporting.md`
- `docs/30-subagent-matrix.md`

## Implemented requirements

- Rust code remains pure logic only.
- No Spotify HTTP, token refresh, DOM mutation, Canvas/WebGL drawing, Wallpaper Engine API registration, or file writes were added to Rust crates.
- Settings validation repairs invalid opacity, scale, rotation, z-index, visualizer intensity, smoothing, decay, particle count, transition duration, and polling intervals.
- Old or unknown schema versions migrate to `CURRENT_SCHEMA_VERSION`.
- Layout calculation supports all required anchors and safe-area clamping.
- LRC parser supports metadata, offset, duplicate timestamps, empty lines, and lookup by playback progress.
- Readability calculation chooses text color and overlay/shadow recommendations for bright and dark backgrounds.
- Visualizer normalization clamps, gates, smooths, decays, and reports peak level.
- Animation helpers clamp interpolation boundaries and provide cubic easing.

## Deviations from spec

- WASM package generation/bindings are not created yet; this phase establishes crate-side pure functions and tests first.
- Theme generation from actual album image pixels is not implemented yet; only contrast/readability helpers are included.

## Tests run

- `cargo test --workspace` passed: config-schema 4 tests, visual-core 9 tests.
- `cargo check --workspace` passed.
- `npm test` passed: 7 files, 21 tests.
- `npm run check` passed.
- `npm run build` passed.
- `npm audit --audit-level=moderate` passed with 0 vulnerabilities.
- `Invoke-WebRequest -UseBasicParsing http://127.0.0.1:5173/` returned HTTP 200 from the wallpaper dev server.

## Known gaps

- No wasm-bindgen or TypeScript WASM loading yet.
- No full settings object schema shared between Rust and TypeScript yet.
- No album image color extraction yet.
- No visualizer rendering yet.

## Risks

- Rust and TypeScript settings models can drift until a shared generation/binding approach is added.
- The first readability/theme helpers are intentionally minimal and may need expansion in Phase 5.

## Next tasks

- Start Phase 4: versioned settings and layout customization, including coordinate-based positioning and presets.

## SpecGuard review

- SpecGuard reviewed Phase 3 for phase order, Rust responsibility boundaries, forbidden responsibilities, required Rust test coverage, mock/browser preview, and report completeness.
- Findings: none.
- Status: passed.
