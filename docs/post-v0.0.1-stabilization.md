# Post-v0.0.1 Stabilization

## Rust/WASM Runtime Integration

Rust is the source of truth for these pure calculations when the generated WASM bundle is present:

- Visualizer smoothing, decay, clamping, and peak normalization: `crates/visual-core/src/visualizer.rs`
- Theme readability and contrast selection: `crates/visual-core/src/theme.rs`

Phase 8 retired the Rust layout ABI. Layout and safe-area semantics remain
TypeScript-owned, while the WASM adapter exposes only typed-array visual
normalization and readability calculations.

The wallpaper loads `/wasm/spotify_wallpaper_visual_core.js` at runtime through `apps/wallpaper/src/wasm/visualCore.ts`. If the generated WASM bundle is missing or fails to initialize, the wallpaper keeps running with TypeScript fallback logic. This fallback exists so browser preview and Wallpaper Engine startup never depend on Tauri, Rust tooling, or a generated asset.

## Known Remaining TypeScript Fallbacks

- Album color extraction remains TypeScript/browser-owned because it requires image loading and canvas pixel reads. Rust may receive sampled colors later, but it must not own DOM or Canvas.
- Full settings object repair remains TypeScript-owned in the wallpaper. The
  retired Rust `config-schema` crate is no longer a runtime or workspace
  authority; shared TypeScript settings contracts own migration and repair.
- Layout CSS generation remains TypeScript-owned for all units and CSS
  transform string construction.
- Visualizer bar layout, waveform SVG path generation, and color selection remain TypeScript-owned because they are rendering-adjacent. Rust owns sample normalization.

## Build WASM For Wallpaper Runtime

Install `wasm-pack`, then generate the browser bundle into the wallpaper public folder:

```sh
wasm-pack build crates/visual-core --target web --out-dir ../../apps/wallpaper/public/wasm
```

Then build the wallpaper:

```sh
npm run build -w @spotify-wallpaper/wallpaper
```

The generated `apps/wallpaper/dist` folder will include `project.json`, the WASM loader, and the `.wasm` binary.

## Wallpaper Engine QA Status

This Codex environment cannot launch Wallpaper Engine or attach to its live audio listener. The project now includes `apps/wallpaper/public/project.json`, and the adapter supports these runtime properties:

- `settings_json`
- `spotify_client_id`
- `spotify_refresh_token`
- `visualizer_enabled`
- `performance_mode`
- `debug_enabled`

The remaining required real-machine checks are documented in `docs/qa-checklist.md`.

RC-2 updates `apps/wallpaper/public/project.json` to use Wallpaper Engine supported `textinput` properties for
`spotify_client_id`, `spotify_refresh_token`, and `settings_json`. `settings_json` must be pasted as single-line JSON
because Web Wallpaper user properties do not provide a textarea type. CLI property injection is diagnostic only for
RC-2; acceptance is based on Wallpaper Engine UI editing and actual display application.

## Spotify Real Account QA Status

This Codex environment has no user Spotify account session, no Refresh Token, and no Premium/restricted-device matrix. OAuth PKCE assistance is implemented in the optional Tauri configurator without Client Secret usage. Real-account current playback and playback-control QA still require a local user account and must not record tokens, authorization codes, callback URLs, or screenshots containing credentials.

## SpecGuard Review

- Scope: stabilization targets stay within post-v0.0.1 gaps.
- Secrets: no Client Secret added; OAuth callback and token values are not logged; token export remains opt-in.
- Performance: Spotify polling remains interval-based; album image extraction remains album-change-only; Rainmeter writes run on a scheduler.
- Settings safety: startup fallback remains active when WASM or settings JSON fails.
- Mock support: browser mock mode remains available without Spotify, Wallpaper Engine, Tauri, Rainmeter, or WASM.
