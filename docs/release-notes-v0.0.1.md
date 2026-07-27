# Release Notes - v0.0.1

## Status

`v0.0.1` is the first complete milestone for the browser-previewable Wallpaper Engine Web Wallpaper foundation. It includes Spotify polling foundations, settings safety, visual customization basics, optional configurator support, and optional Rainmeter JSON export.

## Highlights

- Browser mock wallpaper works without Spotify, Wallpaper Engine, Tauri, or Rainmeter.
- Spotify playback normalization, token refresh, polling, and error classification are implemented.
- Wallpaper Engine property and audio adapters are isolated behind browser-safe fallbacks.
- Rust crates provide pure logic for config schema validation, layout, theme readability, visualizer normalization, and animation helpers.
- Settings schema includes layout, theme, background, player, seekbar, visualizer, clock, transitions, performance, Rainmeter, and debug categories.
- Album-based background/theme fallback and readability handling are implemented.
- Visualizer modes include album ring, radial bars, waveform line, idle behavior, and performance-mode tuning.
- Track transitions retain previous/current display state and support reduce-motion.
- Player display, safe controls, seekbar, and optimized clock behavior are implemented.
- Optional Tauri configurator can preview, import, and export settings JSON.
- Optional Rainmeter JSON output can be written from the Tauri configurator with credential-field rejection.

## Security Notes

- Spotify Client Secret is not used by the Web Wallpaper.
- Refresh Token export is disabled by default in the configurator.
- The static auth page can issue a single `swpt1.` Wallpaper Engine Token that bundles the public Client ID and Refresh Token for one-paste setup.
- Token values, OAuth authorization codes, and full callback URLs must not be logged or committed.
- Rainmeter output is display-only and rejects token-like, client-secret, authorization-code, and callback URL field names.

## Known Gaps

- The configurator does not yet implement full OAuth PKCE acquisition UI.
- The configurator is not a full drag-and-drop layout editor.
- Rainmeter has JSON output only; no bundled Rainmeter skin template or INI output.
- Album-art local cache writing is not implemented.
- Lyrics/LRC support is deferred from v0.0.1 and legacy `lyrics` settings are not active.
- Advanced planned visual modes such as particles and custom backgrounds are not implemented.

## Verification

Run before publishing:

```sh
npm run test --workspaces --if-present
npm run check
npm run build
cargo check --workspace
cargo test --workspace
cargo check --manifest-path apps/configurator/src-tauri/Cargo.toml
cargo test --manifest-path apps/configurator/src-tauri/Cargo.toml
npm audit --audit-level=moderate
git diff --check
```

See `docs/qa-checklist.md` for manual QA.
