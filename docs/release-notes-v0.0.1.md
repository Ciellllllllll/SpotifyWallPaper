# Release Notes - v0.0.1

## Status

`v0.0.1` is the first complete milestone for the browser-previewable Wallpaper Engine Web Wallpaper foundation. The current structure-first refactor keeps the browser mock path independent while making settings, provider, runtime, renderer, Tauri, and WASM boundaries explicit.

## Highlights

- Browser mock wallpaper works without Spotify, Wallpaper Engine, Tauri, or Rainmeter.
- Spotify playback normalization, token refresh, polling, and error classification are implemented.
- Wallpaper Engine property and audio adapters are isolated behind browser-safe fallbacks.
- Rust/WASM provides typed-array visual normalization and readability only; settings migration, repair, layout, and serialization are TypeScript-owned.
- Settings v2 is the single preference authority and includes layout, theme, background, player, seekbar, visualizer, clock, transitions, performance, Rainmeter, and debug categories.
- Album-based background/theme fallback and readability handling are implemented.
- Visualizer modes include album ring, radial bars, waveform line, idle behavior, and performance-mode tuning.
- Track transitions retain previous/current display state and support reduce-motion.
- Player display, safe controls, seekbar, and optimized clock behavior are implemented.
- Optional Tauri configurator uses the shared renderer, previews mock data, and imports/exports secret-free settings JSON.
- Optional Rainmeter JSON output can be written from the Tauri configurator with credential-field rejection.

## Security Notes

- Spotify Client Secret is not used by the Web Wallpaper.
- Client IDs are excluded from settings export. The user-provided public Client ID may remain in Configurator WebView state and is passed to the single native authorization command; Refresh Tokens, Pairing Tokens, and sensitive OAuth material never enter WebView state.
- Tauri authorization keeps OAuth material in Rust locals and copies an approved `swpt1.` bundle once after native confirmation.
- The static auth page can issue a single `swpt1.` Wallpaper Engine Token that bundles the public Client ID and Refresh Token for one-paste setup.
- Token values, OAuth authorization codes, and full callback URLs must not be logged or committed.
- Rainmeter output is display-only and rejects token-like, client-secret, authorization-code, and callback URL field names.

## Known Gaps

- The configurator does not expose callback-URL paste or a token draft; authorization is delegated to the native command.
- The configurator is not a full drag-and-drop layout editor.
- Rainmeter has JSON output only; no bundled Rainmeter skin template or INI output.
- Album-art local cache writing is not implemented.
- Lyrics/LRC support is deferred from v0.0.1 and legacy `lyrics` settings are not active.
- Advanced planned visual modes such as particles and custom backgrounds are not implemented.

## Verification

Run before publishing:

```sh
npm run build:wasm
npm run build:shared-types
npm test
npm run check
npm run build
cargo fmt --all -- --check
cargo test --manifest-path crates/visual-core/Cargo.toml --all-features
cargo check --manifest-path apps/configurator/src-tauri/Cargo.toml
cargo test --manifest-path apps/configurator/src-tauri/Cargo.toml
npm audit --audit-level=moderate
git diff --check
```

See `docs/qa-checklist.md` for manual QA.
