# Post-v0.0.1 Stabilization Report

## Summary

Implemented the post-`v0.0.1` stabilization pass without treating `v0.0.1` as final release complete. The work connects the wallpaper to a Rust/WASM visual core when generated assets are present, adds Spotify OAuth PKCE assistance to the optional Tauri configurator, adds a Tauri-side Rainmeter scheduler, adds Wallpaper Engine metadata, adds CI, and updates QA/release docs with real-machine QA status.

## Changed Files

- `.github/workflows/ci.yml`
- `.gitignore`
- `Cargo.lock`
- `README.md`
- `package.json`
- `apps/wallpaper/public/project.json`
- `apps/wallpaper/src/App.svelte`
- `apps/wallpaper/src/layout/style.ts`
- `apps/wallpaper/src/lyrics/lrc.ts`
- `apps/wallpaper/src/theme/colors.ts`
- `apps/wallpaper/src/visualizer/model.ts`
- `apps/wallpaper/src/wasm/visualCore.ts`
- `apps/configurator/src/App.svelte`
- `apps/configurator/src/tauriCommands.ts`
- `apps/configurator/src-tauri/Cargo.lock`
- `apps/configurator/src-tauri/Cargo.toml`
- `apps/configurator/src-tauri/src/main.rs`
- `crates/visual-core/Cargo.toml`
- `crates/visual-core/src/lib.rs`
- `crates/visual-core/src/wasm.rs`
- `docs/post-v0.0.1-stabilization.md`
- `docs/qa-checklist.md`
- `docs/user-guide.md`
- `examples/rainmeter/SpotifyWallPaper/SpotifyWallPaper.ini`

## Relevant Docs Read

- `AGENTS.md`
- `docs/README.md`
- `docs/00-codex-entrypoint.md`
- `docs/01-project-goals-and-non-goals.md`
- `docs/02-repository-structure.md`
- `docs/03-implementation-phases.md`
- `docs/04-quality-gates.md`
- `docs/10-spotify-integration.md`
- `docs/11-wallpaper-engine.md`
- `docs/12-rust-wasm-core.md`
- `docs/13-settings-schema.md`
- `docs/14-ui-layout.md`
- `docs/15-background-theme.md`
- `docs/16-visualizer.md`
- `docs/17-lyrics.md`
- `docs/19-player-clock.md`
- `docs/20-tauri-configurator.md`
- `docs/21-rainmeter.md`
- `docs/22-performance.md`
- `docs/23-test-qa.md`
- `docs/24-docs-and-reporting.md`
- `docs/30-subagent-matrix.md`
- `docs/how-to-use-h5i.md`

## Implemented Requirements

- Added wasm-bindgen JSON bindings for LRC parsing, visualizer normalization, readability calculation, and percent layout rectangle calculation.
- Added wallpaper runtime adapter that loads `/wasm/spotify_wallpaper_visual_core.js` and falls back safely to TypeScript when unavailable.
- Routed LRC parsing, visualizer smoothing/decay normalization, theme readability, and percent layout calculation through the Rust/WASM adapter when available.
- Documented Rust-vs-TypeScript source-of-truth boundaries and remaining TypeScript fallback reasons.
- Added `apps/wallpaper/public/project.json` with required Wallpaper Engine property keys.
- Added Tauri OAuth PKCE commands for authorization URL generation and callback exchange without Client Secret usage.
- Added configurator UI for Client ID, redirect URI, auth start, callback paste, and Refresh Token save; token export remains disabled by default.
- Added Tauri-side Rainmeter scheduler with playing/stopped interval behavior and isolated write failures.
- Added a minimal Rainmeter sample skin.
- Added CI workflow for npm tests/check/build, cargo check/test, Tauri check/test, and npm audit.
- Removed `docs/` from `.gitignore` so project docs are no longer excluded.

## Unimplemented Items

- Real Wallpaper Engine runtime QA was not executed in this environment.
- Real Spotify account QA was not executed in this environment.
- `wasm32-unknown-unknown` target is not installed in this environment, so wasm-target cargo check could not run.
- Full nested settings validation is still TypeScript-owned in the wallpaper; Rust owns the numeric validation core and documented pure visual logic.
- Album image pixel extraction remains browser/TypeScript-owned because it requires DOM Canvas APIs.

## Real-Device QA Results

- Wallpaper Engine Web Wallpaper import: not executed; Wallpaper Engine is unavailable in this Codex environment.
- Wallpaper Engine properties `settings_json`, `spotify_client_id`, `spotify_refresh_token`, `lyrics_enabled`, `visualizer_enabled`, `performance_mode`, and `debug_enabled`: adapter coverage exists; real runtime confirmation still required.
- Wallpaper Engine audio listener: adapter/fallback paths remain implemented; real audio listener data could not be verified here.
- Spotify current playback: not executed; no real account Refresh Token provided.
- Spotify Premium controls: not executed; no Premium/restricted-device test matrix available.
- Credential safety during local work: no token, Client Secret, authorization code, or full callback URL was added to docs, samples, logs, or screenshots.

## Tests Run

- `h5i capture run -- npm.cmd test --workspaces --if-present` - passed, 77 TypeScript tests.
- `h5i capture run -- npm.cmd run check` - passed.
- `h5i capture run -- npm.cmd run build` - passed.
- `h5i capture run -- cargo check --workspace` - passed.
- `h5i capture run -- cargo test --workspace` - passed, 14 Rust workspace tests.
- `h5i capture run -- cargo check --manifest-path apps/configurator/src-tauri/Cargo.toml` - passed.
- `h5i capture run -- cargo test --manifest-path apps/configurator/src-tauri/Cargo.toml` - passed, 4 Tauri backend tests.
- `h5i capture run -- npm.cmd audit --audit-level=moderate` - passed with 0 vulnerabilities.
- `git diff --check` - passed; Git reported only CRLF normalization warnings.
- `h5i capture run -- cargo check -p spotify-wallpaper-visual-core --target wasm32-unknown-unknown` - failed because the wasm32 target is not installed.

## Specification Differences

- The Rust/WASM runtime integration is present but optional at startup to preserve browser mock and Wallpaper Engine fallback safety.
- Full settings schema repair is not yet moved to Rust because the existing Rust schema crate does not model the full nested TypeScript settings object.
- Real-machine QA is documented as required but cannot be completed by this environment.

## Risks Introduced

- The generated WASM file path must match `/wasm/spotify_wallpaper_visual_core.js`; packaging docs now include the `wasm-pack` command.
- Tauri OAuth exchanges depend on Spotify accepting the configured redirect URI and on the user pasting the callback URL locally.
- Rainmeter scheduler runs in a background thread; write errors are intentionally ignored inside the loop to avoid impacting the app.

## SpecGuard

- Scope: no advanced visual effects or native wallpaper renderer were added.
- Secrets: no Client Secret usage; token export remains opt-in; callback/token errors are sanitized.
- Performance: Spotify API polling remains interval-based; Rainmeter writes are scheduled; album extraction remains album-change-only.
- Settings safety: WASM load failure and malformed settings continue to use safe fallback paths.
- Mock mode: wallpaper browser mock remains functional without Spotify, Wallpaper Engine, Tauri, Rainmeter, or generated WASM.

## Next Recommended Task

Run the documented real-machine QA on Windows with Wallpaper Engine and a Spotify account, then record the redacted results in `docs/qa-checklist.md` before tagging a release.
