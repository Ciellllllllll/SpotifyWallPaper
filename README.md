# Spotify Wallpaper

Spotify Wallpaper is a Wallpaper Engine Web Wallpaper project. It has a browser-previewable mock wallpaper plus Spotify playback polling, Wallpaper Engine property customization, an optional BYO Client ID VPS backend, visualizer, transitions, player controls, an optional Tauri configurator, and optional Rainmeter JSON export.

## Guides And Repository Notes

- `docs/` contains tracked specifications, runbooks, privacy, QA, and phase
  records. The production operator must publish the Privacy Notice and EULA
  with real operator/contact details before accepting Spotify-connected beta
  users.
- This README carries the release-candidate setup and QA notes that must remain available from GitHub.
- `examples/settings/` contains token-free sample settings JSON.

## Technical Stack

- Wallpaper app: Svelte, TypeScript, Vite, Wallpaper Engine Web Wallpaper APIs.
- Optional public backend: Node.js 22 ESM on a VPS with PostgreSQL 17, Caddy,
  OAuth2 Proxy, Authorization Code with PKCE, encrypted Spotify credentials,
  and Pairing Tokens.
- Legacy direct auth page: static Vite + TypeScript app for developer testing with GitHub Pages.
- Shared model types: TypeScript workspace package.
- Visual core: Rust compiled to WebAssembly for typed-array visual normalization and readability helpers.
- Optional configurator: Svelte frontend with Tauri/Rust backend.
- Optional Rainmeter output: configurator-side JSON writer and scheduler.

## Current Design

The runtime wallpaper is the main product. It must work as a Wallpaper Engine Web Wallpaper and in a normal browser
preview without requiring Tauri, Rainmeter, or a live Spotify connection.

Spotify authorization is intentionally split from the wallpaper runtime:

- The dormant Workshop-compatible path uses each user's own Spotify Client ID
  and the public backend's hardened OAuth flow. It does not use a shared
  Spotify application or Client Secret.
- The public backend keeps Spotify Access and Refresh Tokens out of Wallpaper Engine. It returns a `swpb1.` Pairing Token once after authorization; Wallpaper Engine stores that Pairing Token as its backend credential.
- Browser mock mode, the loopback Rust backend, and legacy direct mode remain available without the public backend.
- The static `@spotify-wallpaper/spotify-auth` GitHub Pages app and its `swpt1.` bundle remain developer-only legacy compatibility paths. They are not the managed public or default Workshop setup path.
- The optional Tauri configurator remains available as a companion path, but it is not required for the wallpaper runtime.

Wallpaper Engine properties are now the normal settings surface for common modules. `settings_json` remains available for
advanced or bulk configuration, but users should not need to paste JSON for normal module toggles.

## Requirements

- Node.js 22 or newer.
- Rust stable toolchain.
- `wasm32-unknown-unknown` Rust target for WASM verification and release packaging.
- `wasm-pack` for generating the runtime WASM bundle.
- Wallpaper Engine for real Web Wallpaper QA.

## Development

Install dependencies:

```sh
npm install
```

Run the wallpaper mock preview:

```sh
npm run dev -w @spotify-wallpaper/wallpaper
```

Open `http://127.0.0.1:5173/`. Without Spotify settings, the wallpaper stays in browser mock mode.

## Public Backend Policy Lock

The approved target production origin is
`https://ciel-spotify-wallpaper.duckdns.org`. Production runs only with
`SPOTIFY_MODE=policy_locked`; no other hostname or mode is selected
automatically. Once deployed, the origin serves `/health`, `/privacy`, and
`/terms`. Exact allowed Spotify route/method pairs, including
`GET /auth/callback`, reach Node and return a fixed `503` response with
`Cache-Control: no-store` before Node reads a body, Cookie, Authorization
header, database state, rate limiter, random source, or outbound network.
Unknown paths, wrong methods, wrong sockets, and trailing-slash variants are
rejected instead.

Consequently, production setup, Spotify authorization, reauthorization,
playback, controls, account deletion, and Pairing Token issuance are not
available. Do not register the production callback, connect a real Spotify
account, or distribute a `swpb1.` credential. The hardened OAuth and deletion
protocol is dormant and may be tested only in externally unreachable
`synthetic_test` mode with synthetic credentials.

The implementation target runs as Node.js 22 ESM behind Caddy and OAuth2 Proxy. Node listens
only on two permission-separated AF_UNIX sockets with exact public/admin
route allowlists and uses PostgreSQL 17 databases named `spotify_wallpaper`
and `spotify_wallpaper_deletion_ledger`. A future Spotify unlock requires a
separately reviewed application-mode change, systemd unit/network change,
policy approval, and complete release-gate evidence.

See `docs/privacy.md`, `docs/eula.md`, and `docs/25-public-backend.md` for the
current locked data-handling and architecture contract.

## Legacy Direct Authorization

Direct browser-side authorization remains available for compatibility and local developer testing. Its token format is
`swpt1.<base64url-json>` and contains the Spotify Client ID and Refresh Token. A `swpt1.` token is accepted only by
legacy direct mode and is never accepted by the public backend.

The static GitHub Pages auth app is not the public backend and must not be presented as the Workshop default. Its
deployment workflow is manual-only for developer testing:

```sh
npm run dev -w @spotify-wallpaper/spotify-auth
```

Build `apps/spotify-auth/dist` under `/spotify-auth/` only when testing the legacy page:

```sh
npm run build -w @spotify-wallpaper/spotify-auth
```

To prefill a developer-owned public Client ID for that legacy test build:

```sh
$env:VITE_SPOTIFY_CLIENT_ID='your-public-client-id'
npm run build -w @spotify-wallpaper/spotify-auth
```

The legacy workflow is `.github/workflows/spotify-auth-pages.yml`. It runs only
through `workflow_dispatch`, checks/builds the legacy app, and has no Pages
write permission or deploy job. Disable any historical GitHub Pages deployment
before public-backend beta distribution. Because the Client ID is part of
Spotify's authorization URL, it is treated as a public identifier. Do not
configure or commit a Spotify Client Secret.

If the repository name changes, build with the matching base path:

```sh
$env:VITE_AUTH_BASE_PATH='/<repo>/spotify-auth/'
npm run build -w @spotify-wallpaper/spotify-auth
```

The auth build creates `index.html`, `callback/index.html`, and `404.html` so a developer-selected GitHub Pages site can
handle its registered legacy callback path without a backend. Register the exact callback shown for that deployment in
the developer-owned Spotify app; do not reuse the public backend callback.

## Publication Status

The Node/VPS backend is an approved target architecture under implementation;
it is not yet a deployed or operator-verified service. Private local/mock
staging may continue. A Spotify-connected Limited beta and general
Workshop publication are blocked until the applicable items below have
recorded evidence:

- Spotify approval or a documented policy-compatible redesign covering BYO
  authorization, sound-recording/visual synchronization, product naming, and
  Spotify Mark usage.
- Original, unmodified artwork with no crop, blur, animation, distortion, or
  overlay, plus the required Spotify logo attribution and Spotify link.
- Published privacy notice with real operator and private incident contacts.
- Published EULA and verified pre-authorization consent flow.
- Fixed production origin and verified `policy_locked` response behavior.
- Separately reviewed application and systemd/network changes before any
  future Spotify unlock or callback registration.
- Verified non-budget operational alert configuration and delivery.
- Completed Spotify-connected limited beta.
- Completed 72-hour Wallpaper Engine soak.
- Verified cost, abuse, deletion-reconciliation, and incident alerts.

Spotify's current Development Mode limits and Premium owner requirement are
documented in [Quota modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes).
The one-Client-ID/five-user changes are documented in Spotify's
[February 2026 migration guide](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide).
Artwork, link, and attribution requirements are documented in Spotify's
[Developer Policy](https://developer.spotify.com/policy) and
[Design Guidelines](https://developer.spotify.com/documentation/design).

For local browser testing, keep the browser path credential-free and use the v3 mock provider:

```js
localStorage.setItem(
  'spotify-wallpaper-settings',
  JSON.stringify({
    schemaVersion: 3,
    spotify: {
      provider: 'mock'
    }
  })
);
location.reload();
```

Clear local test credentials with:

```js
localStorage.removeItem('spotify-wallpaper-settings');
location.reload();
```

Never place Spotify tokens in browser settings, a URL, screenshot, log, or committed file. Direct credentials are supplied
only through the dedicated Wallpaper Engine properties; the Web Wallpaper must not use a Spotify Client Secret.

Layout can be selected by preset or customized with coordinate-based layout items:

```js
localStorage.setItem(
  'spotify-wallpaper-settings',
  JSON.stringify({
    layout: {
      preset: 'Bottom Player',
      items: {
        trackText: {
          enabled: true,
          x: 50,
          y: 78,
          unit: 'percent',
          anchor: 'center',
          width: 720,
          height: 160,
          scale: 1,
          rotation: 0,
          opacity: 1,
          zIndex: 3,
          responsive: 'clamp-safe-area',
          safeAreaMargin: 20,
          locked: false,
          participatesInTransition: true
        }
      }
    }
  })
);
location.reload();
```

Invalid settings are repaired back to safe defaults or preset values instead of preventing startup.

Background and theme settings support album blur, album gradient, and solid color modes:

```js
localStorage.setItem(
  'spotify-wallpaper-settings',
  JSON.stringify({
    background: {
      mode: 'album-gradient',
      opacity: 0.72,
      blurPx: 26,
      solidColor: '#111318'
    },
    theme: {
      mode: 'album',
      textColor: '#f6f7fb',
      autoReadability: true
    }
  })
);
location.reload();
```

If album color extraction fails, the wallpaper uses a deterministic fallback theme from the current item identity.

Rust/WASM runtime integration is preferred for release builds. Generate the visual core bundle before building the
Wallpaper Engine artifact:

```sh
rustup target add wasm32-unknown-unknown
cargo check -p spotify-wallpaper-visual-core --target wasm32-unknown-unknown
cargo install wasm-pack
wasm-pack build crates/visual-core --target web --out-dir ../../apps/wallpaper/public/wasm
npm run build -w @spotify-wallpaper/wallpaper
```

If the generated WASM files are absent, the wallpaper keeps running with TypeScript fallback logic.
The generated `apps/wallpaper/public/wasm/` files are build artifacts and are ignored by Git. Regenerate them with the
commands above before producing a Wallpaper Engine release build.

Rust/TypeScript runtime boundary:

| Concern | Source of truth | Runtime fallback | Notes |
| --- | --- | --- | --- |
| Visualizer smoothing, decay, and normalized peak | Rust/WASM visual core | TypeScript normalizer | Rendering-specific bar/path generation stays in TypeScript. |
| Theme readability and contrast | Rust/WASM visual core | TypeScript contrast helper | Browser album pixel extraction stays in TypeScript because it uses Image and Canvas APIs. |
| Layout and safe-area semantics | TypeScript settings/view contracts | TypeScript repair/defaults | The retired Rust layout ABI and config-schema crate are not runtime authorities. |
| Full nested settings validation | TypeScript shared-types | Safe v3 repair/defaults | Settings migration, repair, presets, and secret-free serialization remain TypeScript-owned. |

Visualizer settings support the Phase 6 MVP modes: `album-ring`, `radial-bars`, and `waveform-line`. The `position` can
be `around-album` for a circular visualizer centered on the album art or `bottom-up` for a bottom-anchored visualizer
whose bars grow upward. In `around-album`, the album image and visualizer share the same moving and resizing frame. The
normalized 100×100 SVG uses radius 50 for the album edge in all three modes. Radial bars are four-point rectangles with
a 2×2-unit square base; their inner edge touches the album edge, they add audio-derived length outward, values below 0.03
are checked before intensity, keep their slot but are hidden, and `gap` is ignored in favor of equal placement by sample count. `visualizer.radius`
changes only the outward extension of radial bars and waveform; it does not move the album edge, and the album ring stays at radius 50. The same
radius rule applies to bottom-up bars and waveform height without moving the bottom anchor. If album art is hidden or its layout item is disabled,
the `around-album` visualizer is hidden as well. Sensitivity affects normalization, while intensity scales the final rendered output.
Audio-derived radial extension, bottom bars, and waveform amplitude use the 3× tuning in all three modes and both positions.
For Wallpaper Engine audio, Spotify volume from 1 through 100 is mapped to a fixed 100-percent reference with
`100 / volume`; zero, missing, and invalid values use gain 1. The gain is applied before sensitivity, the noise gate, and
normalization, with no maximum multiplier. It changes only visual response, never Spotify or PC volume. Real audio reacts
only after the current direct/backend connection has returned a successful Spotify result whose source matches the
connection and whose item is a playing track or episode. A transient poll failure keeps the last successful playback
state, while item-null, no-active-device, unauthorized, and forbidden results disable it; a connection change waits for
the new provider's first success. Paused, stopped, missing-item, mismatched,
and not-yet-fetched states publish a zero visualizer frame instead of idle bars; album and glowing-object motion ease to neutral
over about 450ms. Browser mock audio stays unboosted. Wallpaper Engine supplies the PC-wide audio mix, so other audible
applications are also multiplied while Spotify is eligible. The configured intensity remains the final display multiplier.
The album motion
scale ranges from `1.0` to `1.54`; particle speed and brightness retain
their existing `2.0` and `1.6` caps. The view uses `min(1.35, pow(clamp(sample, 0, 1), 0.72) * responseGain)` with gains
`0.90`, `1.15`, and `1.35` for low-power, standard, and high-effect. Standard and high-effect add SVG glow layers;
low-power omits them. Around-album SVG geometry may extend outside the album frame and is clipped only at the wallpaper
viewport; bottom-up geometry remains clipped to its panel. The seekbar is always a straight line; the `album-ring`
visualizer mode remains available. The visualizer does not rotate as a whole.

```js
localStorage.setItem(
  'spotify-wallpaper-settings',
  JSON.stringify({
    schemaVersion: 3,
    visualizer: {
      enabled: true,
      mode: 'radial-bars',
      position: 'around-album',
      intensity: 0.9,
      sensitivity: 1.2,
      smoothing: 0.35,
      decay: 0.22,
      bassWeight: 1.2,
      midWeight: 1,
      trebleWeight: 0.82,
      barCount: 64,
      lineWidth: 3,
      radius: 1.18,
      gap: 10,
      rotationSpeed: 0.16,
      glowStrength: 0.62,
      colorMode: 'theme',
      mirrorMode: 'mirror',
      clampMax: 1,
      noiseGate: 0.03,
      idleAnimation: true
    },
    performance: {
      mode: 'standard'
    }
  })
);
location.reload();
```

Track-change transitions retain the previous track display until the configured duration finishes. Display-mode changes
animate the album frame and track panel independently. Reduce motion resolves aggressive presets to a fade and stops
the display-mode animations:

```js
localStorage.setItem(
  'spotify-wallpaper-settings',
  JSON.stringify({
    transitions: {
      enabled: true,
      preset: 'slide-left',
      durationMs: 700,
      easing: 'ease-out',
      background: true,
      albumArt: true,
      text: true,
      visualizer: false,
      reduceMotion: false
    }
  })
);
location.reload();
```

Player controls are passive-safe: the display works without Premium or credentials, while Spotify playback operations are
disabled unless Spotify credentials and a controllable device are available. Control failures such as Premium or
restricted-device errors are shown as safe status text.

```js
localStorage.setItem(
  'spotify-wallpaper-settings',
  JSON.stringify({
    player: {
      visible: true,
      controlsEnabled: true,
      showDevice: true,
      showVolume: true,
      showShuffleRepeat: true
    },
    seekbar: {
      visible: true,
      style: 'line'
    },
    clock: {
      enabled: true,
      hour12: false,
      showSeconds: false,
      showDate: true,
      showWeekday: true,
      fontSizePx: 34,
      fontWeight: 700,
      letterSpacingPx: 0,
      opacity: 0.9,
      colorMode: 'auto',
      fixedColor: '#f6f7fb'
    }
  })
);
location.reload();
```

When clock seconds are disabled, the wallpaper updates the clock at the next minute boundary instead of every second.

Build all JavaScript workspaces:

```sh
npm run build
```

Run the main automated QA gates:

```sh
npm run build:wasm
npm run build:shared-types
npm test
npm run check
npm run build
cargo check --workspace
cargo test --workspace
rustup target add wasm32-unknown-unknown
cargo check -p spotify-wallpaper-visual-core --target wasm32-unknown-unknown
cargo check --manifest-path apps/configurator/src-tauri/Cargo.toml
cargo test --manifest-path apps/configurator/src-tauri/Cargo.toml
npm audit --audit-level=moderate
```

CI runs independent web, visual-core Rust, Tauri, loopback, and public-backend
jobs. The web job generates WASM and shared-types before consumer tests/builds,
runs the browser characterization suite, and audits the complete dependency
tree. The public-backend job targets Node.js 22 ESM and PostgreSQL behavior;
runtime packaging must not include source maps, tests, fixtures, or operator
secrets.

For Wallpaper Engine development, run `npm run wallpaper:dev-build`. The first
run creates `projects/myprojects/spotify-wallpaper-dev` as a Windows junction
to `apps/wallpaper/dist`; later runs reuse the same junction. Select that
project once in Wallpaper Engine, then use build plus reload instead of
importing another copy. The command never deletes or replaces an existing
project folder, including older manual imports such as `index1`.

Workshop releases remain separate from development builds. The normal build
never contains `workshopid`. `npm run build:workshop -w
@spotify-wallpaper/wallpaper` reads `apps/wallpaper/workshop-metadata.json` and
injects its non-null ID only into the Workshop artifact. After an owner-only,
credential-free Private mock publication, copy only the generated decimal ID
into that metadata file as a quoted string. Future **Submit Update** operations
on the same project update the existing Workshop item; Steam distributes the
update to subscribers, sometimes with a short delay.

Do not invite third parties, connect real Spotify accounts, start a Limited
beta, or publish generally until the Spotify distribution gates below are
complete and the action is separately approved. This repository does not use
a remote latest-version loader, custom updater, SteamCMD auto-publishing, or a
mandatory Tauri updater.

Wallpaper Engine manual QA before release candidate:

| Check | Expected result |
| --- | --- |
| Run `npm run wallpaper:dev-build`, select `spotify-wallpaper-dev` once, then reload after another build | The same project shows the new build without another import and starts without Tauri, Spotify, or Rainmeter. |
| `settings_json` | Entered as single-line JSON; valid JSON applies settings; empty or malformed JSON falls back safely and reports a debug warning. |
| `spotify_playback_provider` | Production backend requests are policy-locked. Use `Direct` only for legacy compatibility/developer testing, or keep mock mode. |
| `spotify_backend_url` | For a Workshop build, retain the exact release-configured production origin. Arbitrary HTTPS origins are rejected before a Pairing Token is sent. |
| `spotify_pairing_token` | The field retains `swpb1.` compatibility, but production cannot issue or use one while policy-locked. Debug only shows configured/not configured. Never expose a real value in screenshots or logs. |
| `spotify_client_id` | Legacy direct mode only. Optional for `swpt1.` tokens. Empty and dummy values can be entered without logging the value. |
| `spotify_refresh_token` | Legacy direct mode only. Accepts a `swpt1.` bundle or raw Refresh Token for manual testing. Never expose a real value in screenshots or logs. |
| `visualizer_enabled` | Enables/disables visualizer rendering and clears visualizer state when disabled. |
| `glowing_objects_enabled` | Enables/disables the full-screen glowing-object Canvas; disabling it clears active particles and stops its animation loop. |
| `visualizer_position` | Selects `around-album` or `bottom-up`; invalid Wallpaper Engine notifications keep the previous value, while invalid restored shared settings use `around-album`. |
| `performance_mode` | Accepts `low-power`, `standard`, and `high-effect`; invalid values keep safe defaults. |
| `debug_enabled` | Toggles the debug panel without exposing token values. |
| Wallpaper Engine audio listener | Real data uses `wallpaper-engine`; after that source is established, noise-gated or stale input becomes zero and never restarts idle animation. Browser preview keeps mock/idle fallback behavior. |

RC-2 Wallpaper Engine acceptance should be based on UI property editing and applying the wallpaper to an actual display.
`play-in-window` or other CLI property injection checks are useful diagnostics only and are not required for RC-2 pass/fail.

Spotify real-account QA before release candidate:

| Condition | Expected behavior |
| --- | --- |
| Valid account with current playback | Current item, progress, device, shuffle/repeat, and volume display. |
| Spotify Premium and unrestricted device | play/pause/next/previous/seek/volume/shuffle/repeat commands work or show a non-fatal Spotify status. |
| Non-Premium account | Passive display still works; restricted playback operations fail gracefully. |
| Restricted device | Controls are disabled or report a safe non-fatal status. |
| 401 unauthorized | Shows authorization missing/expired status and keeps mock-safe UI alive. |
| 403 forbidden | Shows account/device denied status and keeps passive display stable. |
| 429 rate limit | Respects retry delay when available and does not poll per frame. |
| Network error | Shows request failure status and uses backoff/fallback behavior. |

Do not capture screenshots, logs, or sample files containing Access Tokens, Refresh Tokens, authorization codes, full OAuth callback URLs, or Client Secrets.

## Optional Configurator

The configurator is optional and is not required for the Wallpaper Engine
wallpaper runtime. Production public-backend setup is unavailable while
`SPOTIFY_MODE=policy_locked`. The configurator remains useful for local
development, Rainmeter output, and alternate PKCE testing; its direct token
flow is not a managed Workshop path.

Run the browser version:

```sh
npm run dev -w @spotify-wallpaper/configurator
```

Run the Tauri shell:

```sh
npm run tauri:dev -w @spotify-wallpaper/configurator
```

The configurator edits the complete v3 preferences object, previews the shared mock renderer, and imports/exports
secret-free Wallpaper Engine settings JSON. Spotify authorization is a single native Tauri command: verifier, state,
callback URL, authorization code, and Refresh Token stay in Rust locals; after native confirmation, the approved `swpt1.`
bundle is copied to the clipboard once. The WebView receives only status or fixed error codes and never stores or exports
credentials.

### Optional Rainmeter JSON

Rainmeter export is optional and belongs to the configurator/companion side, not the Web Wallpaper runtime. The wallpaper
continues to run if Rainmeter output is disabled or if file output fails.

The Rainmeter payload is JSON only in this phase and contains display-safe playback/theme fields:

- `title`
- `artists`
- `albumName`
- `albumArtLocalPath`
- `progressMs`
- `durationMs`
- `progressRatio`
- `isPlaying`
- `primaryColor`
- `secondaryColor`
- `accentColor`
- `readableTextColor`
- `timestamp`
- `playbackSource`

Spotify Access Token, Refresh Token, authorization codes, client secrets, and OAuth callback URLs must not be written to
Rainmeter output. The Tauri command rejects payloads that contain sensitive credential field names before writing files.
Use the scheduler controls in the configurator for repeated writes: about 1 second while playing, and
`rainmeter.stoppedUpdateIntervalMs` while stopped.

The sample Rainmeter skin is `examples/rainmeter/SpotifyWallPaper/SpotifyWallPaper.ini`. It reads a JSON file through
`JsonPath`; set that variable to the configurator output path or place `NowPlaying.json` in the skin resources folder.

The Phase 2 Wallpaper Engine bridge accepts these user property keys:

- `spotify_client_id`
- `spotify_refresh_token` (`swpt1.` legacy direct bundle only; never put a raw token in settings JSON)
- `spotify_playback_provider`
- `spotify_backend_url`
- `spotify_pairing_token` (`swpb1.` public-backend Pairing Token)
- `settings_json`
- `selected_preset`
- `background_mode`
- `theme_mode`
- `album_art_visible`
- `track_text_visible`
- `player_visible`
- `player_controls_enabled`
- `player_show_device`
- `player_show_volume`
- `player_show_shuffle_repeat`
- `seekbar_visible`
- `seekbar_style`
- `visualizer_enabled`
- `glowing_objects_enabled`
- `visualizer_mode`
- `visualizer_position`
- `transitions_enabled`
- `transition_preset`
- `clock_enabled`
- `clock_hour12`
- `clock_show_seconds`
- `clock_show_date`
- `clock_show_weekday`
- `performance_mode`
- `debug_enabled`

`spotify_client_id`, `spotify_refresh_token`, `spotify_backend_url`, `spotify_pairing_token`, and `settings_json` are
Wallpaper Engine `textinput` properties. `spotify_pairing_token` is a dormant
public-backend compatibility credential; production cannot issue or use it
while policy-locked.
`spotify_refresh_token` and `spotify_client_id` remain legacy direct fields. Paste `settings_json` as single-line JSON
because Wallpaper Engine Web Wallpaper user properties do not provide a textarea type.

Check Rust crates:

```sh
cargo check --workspace
```

The wallpaper app must keep working in a normal browser without Wallpaper Engine, Spotify credentials, or the optional configurator.
