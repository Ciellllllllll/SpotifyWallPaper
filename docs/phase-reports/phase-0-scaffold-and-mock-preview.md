# Phase 0: Scaffold and mock preview

## Summary

Created the initial monorepo skeleton, browser-previewable wallpaper mock, optional configurator skeleton, shared TypeScript types, Rust workspace stubs, and mock playback fixtures.

## Changed files

- `README.md`
- `.gitignore`
- `package.json`
- `package-lock.json`
- `tsconfig.base.json`
- `Cargo.toml`
- `Cargo.lock`
- `apps/wallpaper/**`
- `apps/configurator/**`
- `packages/shared-types/**`
- `crates/config-schema/**`
- `crates/visual-core/**`
- `tests/fixtures/playback/**`
- `docs/phase-reports/phase-0-scaffold-and-mock-preview.md`

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
- `docs/19-player-clock.md`
- `docs/20-tauri-configurator.md`
- `docs/22-performance.md`
- `docs/23-test-qa.md`
- `docs/24-docs-and-reporting.md`
- `docs/30-subagent-matrix.md`

## Implemented requirements

- Browser mock wallpaper app renders without Spotify or Wallpaper Engine.
- Mock album background placeholder is visible.
- Mock album jacket is visible.
- Track title, artist names, album name, progress display, and clock are visible.
- Debug overlay toggle placeholder exists.
- Optional configurator is present as a separate app and is not required by the wallpaper runtime.
- Rust crates are pure logic stubs and do not own HTTP, DOM, drawing, or Wallpaper Engine APIs.
- Shared types establish the normalized playback and settings boundary.

## Deviations from spec

- Phase 0 only includes a minimal configurator skeleton, not a full Tauri app.
- Layout is static mock layout for MVP preview; full coordinate-based layout starts in later phases.

## Tests run

- `npm run build` passed.
- `npm run check` passed.
- `cargo check --workspace` passed.
- `cargo test --workspace` passed.
- `npm audit` passed with 0 vulnerabilities after updating the Vite/Svelte plugin toolchain.
- `Invoke-WebRequest -UseBasicParsing http://127.0.0.1:5173/` returned HTTP 200 from the wallpaper dev server.
- Chrome headless screenshot verification confirmed the mock wallpaper renders the album placeholder, album art, track title, artists, progress display, clock, and debug toggle.
- In-app Browser verification was attempted, but the local Node REPL browser runtime failed before connecting. Chrome headless was used as the fallback browser verification path.

## Known gaps

- No live Spotify polling yet.
- No Wallpaper Engine property or audio bridge yet.
- No WASM build output yet.
- No full settings validation or migration yet.
- Mock fixtures cover only the first playback states.

## Risks

- The placeholder visual design may need adjustment after browser screenshot QA.
- `docs/` is currently ignored by `.gitignore`, so this report exists in the workspace but is not shown by normal `git status`.

## Next tasks

- Start Phase 1: Spotify MVP with token refresh, polling, normalization, null item handling, and rate-limit/error classification.

## SpecGuard review

SpecGuard reviewed Phase 0 for scope, secrets handling, performance, settings safety, mock/browser preview, optional configurator boundary, Spotify API usage, and Rust/WASM boundaries. The only required fix was replacing pending report text with actual verification results; this report has been updated accordingly.
