# QA Checklist

Use this checklist before release or when changing settings, Spotify, Wallpaper Engine adapters, visual display, or optional integrations.

## Automated Gates

- `npm run test --workspaces --if-present`
- `npm run check`
- `npm run build`
- `cargo check --workspace`
- `cargo test --workspace`
- `cargo check --manifest-path apps/configurator/src-tauri/Cargo.toml`
- `cargo test --manifest-path apps/configurator/src-tauri/Cargo.toml`
- `npm audit --audit-level=moderate`
- `git diff --check`

Resource-intensive commands should run through `h5i capture run`.

## Browser Mock

- Open `http://127.0.0.1:5173/`.
- Confirm mock album art or placeholder is visible.
- Confirm title, artists, progress, seekbar, and clock are visible.
- Confirm visualizer renders from mock or idle audio data.
- Confirm lyrics can be enabled with user LRC text.
- Confirm malformed settings JSON falls back safely.
- Confirm no Wallpaper Engine object is required.

## Wallpaper Engine

- Build with `npm run build`.
- Import `apps/wallpaper/dist` as a Web Wallpaper.
- Confirm user properties apply:
  - `spotify_client_id`
  - `spotify_refresh_token`
  - `settings_json`
  - `selected_preset`
  - `visualizer_enabled`
  - `lyrics_enabled`
  - `performance_mode`
  - `debug_enabled`
- Confirm browser fallback still works after Wallpaper Engine changes.

## Spotify

- Confirm current playback displays when credentials are valid.
- Confirm paused playback slows polling and does not crash.
- Confirm stopped or item-null playback does not crash.
- Confirm 401, 403, 429, network failure, and unknown responses show safe status.
- Confirm Refresh Token, Access Token, authorization code, and full callback URL do not appear in logs or screenshots.

## Visual And Settings Regression

- Confirm all layout presets render without overlap at desktop and narrow widths.
- Confirm long title and many-artist fixtures do not break text layout.
- Confirm very bright and very dark theme cases keep text readable.
- Confirm low-power mode reduces visualizer work and blur.
- Confirm track transitions retain previous/current display state during animation.
- Confirm reduce-motion resolves aggressive transition presets to safe motion.

## Optional Configurator

- Open `http://127.0.0.1:1420/`.
- Confirm generated settings JSON excludes Refresh Token by default.
- Confirm imported malformed JSON leaves defaults active.
- Confirm the Tauri shell can validate settings JSON.
- Confirm the wallpaper still runs without the configurator.

## Rainmeter

- Confirm Rainmeter output can be enabled/disabled in the configurator.
- Confirm Tauri write succeeds for display-safe JSON and a writable path.
- Confirm Tauri write rejects token, client secret, authorization code, and callback URL field names.
- Confirm Rainmeter write failure does not affect the wallpaper.

## Release Notes

- Update release notes with implemented features, known gaps, and verification commands.
- Update the phase report with docs read, tests run, risks, and next task.
