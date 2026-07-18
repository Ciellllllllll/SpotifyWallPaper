# Spotify Wallpaper

Spotify Wallpaper is a Wallpaper Engine Web Wallpaper project. It has a browser-previewable mock wallpaper plus Spotify playback polling, Wallpaper Engine property customization, an optional BYO Client ID Cloudflare backend, visualizer, transitions, player controls, an optional Tauri configurator, and optional Rainmeter JSON export.

## Guides And Repository Notes

- `docs/` contains tracked specifications, runbooks, privacy, QA, and phase
  records. The production operator must publish the Privacy Notice and EULA
  with real operator/contact details before accepting Spotify-connected beta
  users.
- This README carries the release-candidate setup and QA notes that must remain available from GitHub.
- `examples/settings/` contains token-free sample settings JSON.

## Technical Stack

- Wallpaper app: Svelte, TypeScript, Vite, Wallpaper Engine Web Wallpaper APIs.
- Optional public backend: TypeScript Cloudflare Worker with D1, Authorization Code with PKCE, encrypted Spotify credentials, and Pairing Tokens.
- Legacy direct auth page: static Vite + TypeScript app for developer testing with GitHub Pages.
- Shared model types: TypeScript workspace package.
- Visual core: Rust compiled to WebAssembly for pure layout, readability, and visualizer helpers.
- Optional configurator: Svelte frontend with Tauri/Rust backend.
- Optional Rainmeter output: configurator-side JSON writer and scheduler.

## Current Design

The runtime wallpaper is the main product. It must work as a Wallpaper Engine Web Wallpaper and in a normal browser
preview without requiring Tauri, Rainmeter, or a live Spotify connection.

Spotify authorization is intentionally split from the wallpaper runtime:

- The optional Workshop-compatible beta path uses each user's own Spotify Client ID and the public backend's `/setup` page. It does not use a shared Spotify application or Client Secret.
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

## Public Backend Beta Setup

The optional public backend beta uses BYO Client ID: each user creates one Spotify Developer app and authorizes it with
Authorization Code and PKCE. Do not create or paste a Client Secret.

Spotify Development Mode currently requires the app owner to have Spotify
Premium, limits new Client ID creation to one per developer, and limits an app
to five authorized users. Only existing resources above those limits are
grandfathered, so a new BYO app cannot assume another Client ID is available.
Passive wallpaper display does not otherwise require Premium, but Spotify
restricts playback controls and the Development Mode app itself.

The production backend must have a fixed custom HTTPS origin before setup is published. No production URL is included in
this repository until that release gate is complete. When the operator publishes the official origin:

1. Create one app in the Spotify Developer Dashboard and copy its Client ID.
2. Register exactly the backend callback URI: the published production origin followed by `/auth/callback`. It must use
   the same scheme and host as the official `/setup` page, with no added trailing slash, query, or fragment.
3. Open the official production origin followed by `/setup`.
4. Read the served Privacy Notice and EULA, explicitly accept both, enter the
   Client ID, and complete Spotify authorization.
5. Copy the `swpb1.` Pairing Token shown on the success page. It is displayed only once.
6. In Wallpaper Engine, set Spotify Playback Provider to `Backend Proxy`, keep the release-provided backend origin, and
   paste the token into Spotify Backend Pairing Token / `spotify_pairing_token`.

The Pairing Token is a bearer credential. Never share it, send it to maintainers, place it in a URL, or include it in a
screenshot, recording, log, issue, or committed file. The token remains valid until account deletion or explicit
revocation even though the setup page displays it only once.

Spotify authorization expires six months after authorization. When the wallpaper reports `unauthorized` or requests
reauthorization, return to the same official `/setup` page, use Reauthorize Spotify, and enter the existing Pairing
Token. Successful reauthorization keeps that same Pairing Token; it does not display or require a replacement.

To delete the backend account, open the same `/setup` page, use Delete backend account, and enter the Pairing Token. The
page sends authenticated `DELETE /api/account`. The Worker first records a 35-day non-secret `publicId` tombstone, then
deletes OAuth sessions, encrypted Spotify tokens, Client ID, Pairing digest, leases, and cached data from the primary
database. The tombstone prevents a backup restore from reactivating the
deleted credential. Separately remove the BYO app from Spotify account
settings using the app name you registered; backend deletion cannot perform
that Spotify-side disconnect.

See `docs/privacy.md` for data handling and deletion retention and
`docs/eula.md` for the beta EULA.

## Legacy Direct Authorization

Direct browser-side authorization remains available for compatibility and local developer testing. Its token format is
`swpt1.<base64url-json>` and contains the Spotify Client ID and Refresh Token. A `swpt1.` token is accepted only by
legacy direct mode and is never accepted by the public Worker.

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

The public backend is implemented for private local/mock staging and
limited-beta preparation. A Spotify-connected Limited beta and general
Workshop publication are blocked until the applicable items below have
recorded evidence:

- Spotify approval or a documented policy-compatible redesign covering BYO
  authorization, sound-recording/visual synchronization, product naming, and
  Spotify Mark usage.
- Original, unmodified artwork with no crop, blur, animation, distortion, or
  overlay, plus the required Spotify logo attribution and Spotify link.
- Published privacy notice with real operator and private incident contacts.
- Published EULA and verified pre-authorization consent flow.
- Fixed production custom domain and exact callback registration.
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

For local Spotify MVP testing, explicitly provide settings JSON in the browser console and reload:

```js
localStorage.setItem(
  'spotify-wallpaper-settings',
  JSON.stringify({
    spotify: {
      clientId: 'your-public-client-id',
      refreshToken: 'your-refresh-token'
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

Never place Spotify tokens in a URL, screenshot, log, or committed file. The Web Wallpaper must not use a Spotify Client Secret.

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
| Percent layout rectangle | Rust/WASM visual core | TypeScript CSS transform style | Non-percent units and CSS string construction stay in TypeScript. |
| Full nested settings validation | TypeScript | None | Keep TypeScript as source of truth until the Rust schema crate models the full nested app settings object. |

Visualizer settings support the Phase 6 MVP modes: `album-ring`, `radial-bars`, and `waveform-line`. Intensity and
sensitivity directly affect the normalized audio output. Low-power performance mode reduces visualizer bar count, sample
usage, glow, and idle rotation speed.

```js
localStorage.setItem(
  'spotify-wallpaper-settings',
  JSON.stringify({
    visualizer: {
      enabled: true,
      mode: 'radial-bars',
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

Track-change transitions retain the previous track display until the configured duration finishes. Reduce motion resolves
aggressive presets to a fade:

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
npm run test --workspaces --if-present
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

CI runs the same npm and cargo gates, including the wasm32 visual-core target check. It does not run `wasm-pack build`
because the generated WASM files are release artifacts that are intentionally not committed; run the release packaging
commands locally before importing into Wallpaper Engine.

For Wallpaper Engine import, build the project and select `apps/wallpaper/dist` as the Web Wallpaper folder. The build
copies `apps/wallpaper/public/project.json` into the distribution folder.

Wallpaper Engine manual QA before release candidate:

| Check | Expected result |
| --- | --- |
| Import `apps/wallpaper/dist` as a Web Wallpaper | Wallpaper starts without Tauri, Spotify, or Rainmeter. |
| `settings_json` | Entered as single-line JSON; valid JSON applies settings; empty or malformed JSON falls back safely and reports a debug warning. |
| `spotify_playback_provider` | Select `Backend Proxy` for the public beta, or `Direct` only for legacy compatibility and developer testing. |
| `spotify_backend_url` | For a Workshop build, retain the exact release-configured production origin. Arbitrary HTTPS origins are rejected before a Pairing Token is sent. |
| `spotify_pairing_token` | Accepts the one-time-displayed `swpb1.` Pairing Token for backend mode. Debug only shows configured/not configured. Never expose a real value in screenshots or logs. |
| `spotify_client_id` | Legacy direct mode only. Optional for `swpt1.` tokens. Empty and dummy values can be entered without logging the value. |
| `spotify_refresh_token` | Legacy direct mode only. Accepts a `swpt1.` bundle or raw Refresh Token for manual testing. Never expose a real value in screenshots or logs. |
| `visualizer_enabled` | Enables/disables visualizer rendering and clears visualizer state when disabled. |
| `performance_mode` | Accepts `low-power`, `standard`, and `high-effect`; invalid values keep safe defaults. |
| `debug_enabled` | Toggles the debug panel without exposing token values. |
| Wallpaper Engine audio listener | Real data uses `wallpaper-engine`; unavailable data falls back to mock or idle visualizer state. |

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

The configurator is optional and is not required for the Wallpaper Engine wallpaper runtime. The public backend beta
setup uses the official `/setup` page and the Wallpaper Engine `spotify_pairing_token` property. The configurator remains
useful for local development, Rainmeter output, and alternate PKCE testing; its direct token flow is not the managed
Workshop path.

Run the browser version:

```sh
npm run dev -w @spotify-wallpaper/configurator
```

Run the Tauri shell:

```sh
npm run tauri:dev -w @spotify-wallpaper/configurator
```

The configurator can edit the first milestone settings, preview the mock layout, import existing settings JSON, export
Wallpaper Engine settings JSON, and assist Spotify OAuth PKCE in the Tauri shell. Refresh Token export is disabled by
default and must be explicitly enabled in the configurator before the token appears in generated JSON.

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
- `spotify_refresh_token` (`swpt1.` legacy direct token or raw Refresh Token)
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
- `visualizer_mode`
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
Wallpaper Engine `textinput` properties. `spotify_pairing_token` is the public-backend beta credential.
`spotify_refresh_token` and `spotify_client_id` remain legacy direct fields. Paste `settings_json` as single-line JSON
because Wallpaper Engine Web Wallpaper user properties do not provide a textarea type.

Check Rust crates:

```sh
cargo check --workspace
```

The wallpaper app must keep working in a normal browser without Wallpaper Engine, Spotify credentials, or the optional configurator.
