# QA Checklist

Use this checklist before release or when changing settings, Spotify, Wallpaper Engine adapters, visual display, or optional integrations.

## Automated Gates

- `npm run test --workspaces --if-present`
- `npm run test:wallpaper-link`
- `npm run check`
- `npm run build`
- `cargo check --workspace`
- `cargo test --workspace`
- `cargo check --manifest-path apps/configurator/src-tauri/Cargo.toml`
- `cargo test --manifest-path apps/configurator/src-tauri/Cargo.toml`
- `npm audit --audit-level=moderate`
- `git diff --check`
- `npx playwright test tests/playwright/wallpaper-characterization.spec.ts --grep "visualizer positioning|glowing object canvas|display mode animations"`

Resource-intensive commands should run through `h5i capture run`.

## Browser Mock

- Open `http://127.0.0.1:5173/`.
- Confirm mock album art or placeholder is visible.
- Confirm title, artists, progress, seekbar, and clock are visible.
- Confirm visualizer renders from mock or idle audio data.
- Confirm the full-screen glowing-object Canvas starts near the center, moves
  outward, and remains visible when the SVG visualizer is disabled.
- Confirm album-only and album-details both scale album content above the audio
  threshold while the straight seekbar stays fixed.
- Confirm malformed settings JSON falls back safely.
- Confirm no Wallpaper Engine object is required.

## Wallpaper Engine

- Build and link with `npm run wallpaper:dev-build`.
- Confirm the first run creates `projects/myprojects/spotify-wallpaper-dev` as
  a junction to `apps/wallpaper/dist`.
- Confirm a second run succeeds without replacing the junction.
- Rebuild and reload the existing Wallpaper Engine project without importing
  another copy.
- Confirm an existing file, directory, symlink, or different junction is not
  deleted or replaced.
- Confirm `project.json` is present in `apps/wallpaper/dist`.
- Confirm normal builds contain no `workshopid`.
- Confirm Workshop metadata `null` omits `workshopid`, a positive decimal
  string is injected only by the Workshop build, and invalid values fail.
- Confirm Workshop preparation never copies credential or unknown metadata
  fields into `dist/project.json`.
- Confirm `project.json` uses only Wallpaper Engine supported user property types: `color`, `slider`, `bool`, `combo`, `textinput`, `file`, or `directory`.
- Confirm user properties apply:
  - `spotify_client_id`
  - `spotify_refresh_token` (legacy `swpt1.` bundle only)
  - `settings_json`
  - `selected_preset`
  - `visualizer_enabled`
  - `glowing_objects_enabled`
  - `visualizer_position`
  - `performance_mode`
  - `debug_enabled`
- Confirm `settings_json` is editable as single-line JSON with valid JSON, an empty value, and malformed JSON; malformed JSON must not crash the wallpaper.
- Confirm `spotify_client_id` and `spotify_refresh_token` accept empty and dummy values without logging or persisting the value outside the Wallpaper Engine user property.
- In legacy direct mode, confirm `spotify_refresh_token` accepts a dummy `swpt1.` bundle and applies its bundled Client ID and Refresh Token without requiring `spotify_client_id`; raw Refresh Tokens are never entered into `settings_json`.
- Confirm `spotify_playback_provider=backend` uses only the release-configured public origin in a Workshop build.
- Confirm an explicit invalid or untrusted `spotify_backend_url` does not fall back to direct mode and never receives a Pairing Token.
- Confirm `spotify_pairing_token` accepts a dummy `swpb1.` value without exposing it in debug, warnings, or errors.
- Treat `play-in-window` or CLI `applyProperties` checks as diagnostics only; RC-2 pass/fail requires Wallpaper Engine UI editing and applying the wallpaper to an actual display.
- Confirm browser fallback still works after Wallpaper Engine changes.
- Current update-flow status: automated junction tests use isolated temporary
  folders. Record the real registry detection, first link, idempotent second
  link, and rebuild/reload results below before acceptance.
- 2026-08-25 local result: registry detection, first Junction creation,
  second-run idempotency, target path, `index.html`, and `project.json` passed.
  UI reload confirmation stopped because an older manual import exposed an
  existing credential-bearing property; revoke and reissue that credential,
  then repeat the reload check without capturing property text.
- Required real-machine result fields:
  - property application result for every property above
  - `settings_json` malformed JSON fallback result
  - audio listener source result: `wallpaper-engine`, `mock`, or `idle`
  - fallback result when audio listener is unavailable

## Spotify

- Confirm current playback displays when credentials are valid.
- Confirm real Wallpaper Engine audio reacts only after the current provider
  has successfully returned a playing track or episode.
- Confirm a transient poll failure retains the last valid playing eligibility,
  a successful paused/stopped/item-null result disables it, and a provider
  change waits for the new provider's first success.
- Confirm no-active-device, unauthorized, and forbidden results also disable
  real audio while network/rate-limit failures retain the last state.
- Confirm an optimistic Play command does not enable real audio before the next
  successful playing poll.
- Confirm volume 1, 25, 50, and 100 produce matching visuals for equivalently
  attenuated input; zero and unavailable volume remain unboosted.
- Confirm virtual gain changes neither Spotify volume nor PC volume and sends
  no volume command. Note that other applications in Wallpaper Engine's
  PC-wide audio mix receive the same visual gain while Spotify is eligible.
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
- Confirm `/setup` links `/privacy` and `/terms`, requires explicit acceptance
  for initial authorization and reauthorization, and rejects missing consent
  without creating an OAuth session.
- Confirm `swpb_oauth` is documented as a strictly necessary ten-minute
  first-party cookie and no tracking cookie is created.
- Confirm `/setup` initial authorization displays a `swpb1.` Pairing Token once with `Cache-Control: no-store`.
- Confirm the Pairing Token appears in no URL, cookie, Web Storage, IndexedDB, log, metric, screenshot, or persisted backend row.
- Confirm playback and every control use `Authorization: Bearer` and normalized Spotify responses.
- Confirm 50 concurrent expired-token requests perform one Spotify refresh.
- Confirm Spotify 429, network errors, D1 errors, and Worker rate limits return fixed safe states.
- Confirm `invalid_grant` stops refresh retries, removes encrypted Spotify tokens, and requests reauthorization.
- Confirm reauthorization from `/setup` retains the existing Pairing Token.
- Confirm `DELETE /api/account` immediately invalidates the Pairing Token and removes live credentials.
- Confirm the separate non-secret deletion tombstone remains for 35 days and is replayed after a D1 restore.
- Confirm one failed tombstone does not block later rows and that retry,
  pending, oldest-pending, and failed counts reach aggregate metrics.
- Confirm consumed OAuth sessions are deleted and abandoned expired sessions
  are purged by scheduled maintenance.
- Confirm the user is told to disconnect the app separately in Spotify account settings.
- Confirm mock, legacy direct, loopback Rust, and public Worker modes all remain usable independently.

## Visual And Settings Regression

- Confirm all layout presets render without overlap at desktop and narrow widths.
- Confirm long title and many-artist fixtures do not break text layout.
- Confirm very bright and very dark theme cases keep text readable.
- Confirm low-power mode reduces visualizer work and blur.
- Confirm paused, stopped, missing-item, source-mismatched, and initial-fetch
  states show a zero visualizer frame without album or glowing-object input;
  motion returns to neutral in about 450ms.
- Confirm browser mock audio remains reactive with no volume boost.
- Confirm automatic glowing-object density is 24/48/96 for low-power/standard/high-effect,
  and that high-effect glow is stronger than standard while low-power disables
  particle shadow blur.
- Confirm the Canvas uses the lower logical backing resolution in low-power on
  a HiDPI display, and that disabling the property after particles appear
  clears particles and stops the animation loop.
- Confirm `around-album` centers circular visualizer geometry on the album art.
- Confirm `bottom-up` is anchored to the lower edge and radial bars grow upward.
- Confirm `album-only`/`album-details` changes enable track-panel `text-enter`
  and album-frame transitions.
- Confirm reduced motion stops those display-mode animations and transitions.
- Confirm track transitions retain previous/current display state during animation.
- Confirm reduce-motion resolves aggressive transition presets to safe motion.

## Optional Configurator

- Open `http://127.0.0.1:1420/`.
- Confirm generated settings JSON is `schemaVersion: 3` and excludes all credential fields and values.
- Confirm v1, v2, and unversioned settings migrate intensity once from the old 0–2 range to 0–6, while v3 settings are not multiplied again.
- Confirm legacy `seekbar.style: "album-ring"` is repaired to the straight `line` seekbar and no progress-ring element is rendered.
- Confirm the single native auth command starts PKCE without a Client Secret and returns only status/fixed error codes to the WebView.
- Confirm verifier, state, callback URL, authorization code, and Refresh Token never enter the WebView draft, logs, settings JSON, or export.
- Confirm native confirmation copies an approved `swpt1.` bundle to the clipboard once and does not expose it in app state.
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

## Spotify Distribution Gates

An initial owner-only Private Workshop item may be used only for
credential-free mock verification. Real Spotify authorization, third-party
access, Limited beta, and general publication remain prohibited until the
applicable gates below are complete and the action is separately approved.

Confirm the legacy auth workflow has no Pages write/deploy capability and any
historical Pages deployment is disabled.

Do not begin a Spotify-connected Limited beta until policy or a
policy-compatible build, operator-reviewed Privacy/EULA, infrastructure,
smoke, alert-delivery, Security, and SpecGuard evidence are recorded.

Do not publish generally until the phase report also contains evidence for
every item:

- Spotify approval or a documented policy-compatible redesign covering BYO
  authorization, sound-recording/visual synchronization, product naming, and
  Spotify Mark usage.
- Original, unmodified Spotify artwork with no crop, blur, animation,
  distortion, or overlay, plus required Spotify logo attribution and link.
- Published privacy notice with real operator and private incident contacts.
- Published operator-reviewed EULA and pre-authorization consent.
- Fixed production custom domain and exact Spotify callback registration.
- Verified non-budget operational alert configuration and delivery.
- Completed Spotify-connected limited beta.
- Completed 72-hour Wallpaper Engine soak.
- Verified cost, abuse, deletion-reconciliation, and incident alerts.
