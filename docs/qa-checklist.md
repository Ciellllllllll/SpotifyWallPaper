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
- Confirm malformed settings JSON falls back safely.
- Confirm no Wallpaper Engine object is required.

## Wallpaper Engine

- Build with `npm run build`.
- Import `apps/wallpaper/dist` as a Web Wallpaper.
- Confirm `project.json` is present in `apps/wallpaper/dist`.
- Confirm `project.json` uses only Wallpaper Engine supported user property types: `color`, `slider`, `bool`, `combo`, `textinput`, `file`, or `directory`.
- Confirm user properties apply:
  - `spotify_client_id`
  - `spotify_refresh_token`
  - `settings_json`
  - `selected_preset`
  - `visualizer_enabled`
  - `performance_mode`
  - `debug_enabled`
- Confirm `settings_json` is editable as single-line JSON with valid JSON, an empty value, and malformed JSON; malformed JSON must not crash the wallpaper.
- Confirm `spotify_client_id` and `spotify_refresh_token` accept empty and dummy values. Use dummy values for public QA because the token field can be visible.
- In legacy direct mode, confirm `spotify_refresh_token` accepts a dummy `swpt1.` bundle and applies its bundled Client ID and Refresh Token without requiring `spotify_client_id`.
- Confirm `spotify_playback_provider=backend` uses only the release-configured public origin in a Workshop build.
- Confirm an explicit invalid or untrusted `spotify_backend_url` does not fall back to direct mode and never receives a Pairing Token.
- Confirm `spotify_pairing_token` accepts a dummy `swpb1.` value without exposing it in debug, warnings, or errors.
- Treat `play-in-window` or CLI `applyProperties` checks as diagnostics only; RC-2 pass/fail requires Wallpaper Engine UI editing and applying the wallpaper to an actual display.
- Confirm browser fallback still works after Wallpaper Engine changes.
- Post-v0.0.1 Codex status: not executed in this environment because Wallpaper Engine is not available. Must be completed on a Windows machine with Wallpaper Engine installed.
- Required real-machine result fields:
  - property application result for every property above
  - `settings_json` malformed JSON fallback result
  - audio listener source result: `wallpaper-engine`, `mock`, or `idle`
  - fallback result when audio listener is unavailable

## Spotify

- Confirm current playback displays when credentials are valid.
- Confirm paused playback slows polling and does not crash.
- Confirm stopped or item-null playback does not crash.
- Confirm 401, 403, 429, network failure, and unknown responses show safe status.
- Confirm Refresh Token, Access Token, authorization code, and full callback URL do not appear in logs or screenshots.
- Post-v0.0.1 Codex status: not executed in this environment because no real account credentials or Spotify Premium/restricted-device matrix are available. Must be completed locally with token values redacted from notes.
- Premium checks when available: play, pause, next, previous, seek, volume, shuffle, and repeat.
- Non-Premium or restricted-device checks: controls remain disabled or show non-fatal status text without breaking passive display.

## Public Backend Beta

- Confirm the Spotify app registers the exact production custom-domain callback ending in `/auth/callback`.
- Confirm Development Mode owner Premium, one-Client-ID-per-new-developer, and five-user allowlist restrictions are communicated before authorization.
- Confirm `/setup` initial authorization displays a `swpb1.` Pairing Token once with `Cache-Control: no-store`.
- Confirm the Pairing Token appears in no URL, cookie, Web Storage, IndexedDB, log, metric, screenshot, or persisted backend row.
- Confirm playback and every control use `Authorization: Bearer` and normalized Spotify responses.
- Confirm 50 concurrent expired-token requests perform one Spotify refresh.
- Confirm Spotify 429, network errors, D1 errors, and Worker rate limits return fixed safe states.
- Confirm `invalid_grant` stops refresh retries, removes encrypted Spotify tokens, and requests reauthorization.
- Confirm reauthorization from `/setup` retains the existing Pairing Token.
- Confirm `DELETE /api/account` immediately invalidates the Pairing Token and removes live credentials.
- Confirm the separate non-secret deletion tombstone remains for 35 days and is replayed after a D1 restore.
- Confirm the user is told to disconnect the app separately in Spotify account settings.
- Confirm mock, legacy direct, loopback Rust, and public Worker modes all remain usable independently.

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
- Confirm PKCE auth start opens a Spotify authorization URL without a Client Secret.
- Confirm pasted callback URL exchanges for a Refresh Token and saves it into the local configurator draft.
- Confirm exported settings still exclude the Refresh Token by default after OAuth.
- Confirm imported malformed JSON leaves defaults active.
- Confirm the Tauri shell can validate settings JSON.
- Confirm the wallpaper still runs without the configurator.

## Rainmeter

- Confirm Rainmeter output can be enabled/disabled in the configurator.
- Confirm Tauri write succeeds for display-safe JSON and a writable path.
- Confirm Tauri scheduler writes about once per second while playback is marked playing.
- Confirm Tauri scheduler uses `stoppedUpdateIntervalMs` while playback is marked stopped.
- Confirm Tauri write rejects token, client secret, authorization code, and callback URL field names.
- Confirm Rainmeter write failure does not affect the wallpaper.
- Confirm the sample skin or documented measure can read the generated JSON.

## Release Notes

- Update release notes with implemented features, known gaps, and verification commands.
- Update the phase report with docs read, tests run, risks, and next task.

## General Workshop Publication Gate

Confirm the legacy auth workflow has no Pages write/deploy capability and any
historical Pages deployment is disabled.

Do not publish generally until the phase report contains evidence for every
item:

- Spotify approval or a documented policy-compatible redesign covering BYO
  authorization, sound-recording/visual synchronization, product naming, and
  Spotify Mark usage.
- Original, unmodified Spotify artwork with no crop, blur, animation,
  distortion, or overlay, plus required Spotify logo attribution and link.
- Published privacy notice with real operator and private incident contacts.
- Fixed production custom domain and exact Spotify callback registration.
- Completed limited beta.
- Completed 72-hour Wallpaper Engine soak.
- Verified cost, abuse, deletion-reconciliation, and incident alerts.
