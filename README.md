# Spotify Wallpaper

Spotify Wallpaper is a Wallpaper Engine Web Wallpaper project. It has a browser-previewable mock wallpaper plus Spotify playback polling, settings customization, visualizer, LRC lyrics, transitions, player controls, an optional Tauri configurator, and optional Rainmeter JSON export.

## Guides And Repository Notes

- `docs/` is intentionally local-only and ignored by Git because it contains development specs and phase reports that are not part of the public release package.
- This README carries the release-candidate setup and QA notes that must remain available from GitHub.
- `examples/settings/` contains token-free sample settings JSON.

## Technical Stack

- Wallpaper app: Svelte, TypeScript, Vite, Wallpaper Engine Web Wallpaper APIs.
- Shared model types: TypeScript workspace package.
- Visual core: Rust compiled to WebAssembly for pure layout, lyrics, readability, and visualizer helpers.
- Optional configurator: Svelte frontend with Tauri/Rust backend.
- Optional Rainmeter output: configurator-side JSON writer and scheduler.

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
| LRC parse and LRC offset application | Rust/WASM visual core | TypeScript parser | Wallpaper calls Rust through `parseLrcWithCore` when the WASM bundle is loaded. |
| Visualizer smoothing, decay, and normalized peak | Rust/WASM visual core | TypeScript normalizer | Rendering-specific bar/path generation stays in TypeScript. |
| Theme readability and contrast | Rust/WASM visual core | TypeScript contrast helper | Browser album pixel extraction stays in TypeScript because it uses Image and Canvas APIs. |
| Percent layout rectangle | Rust/WASM visual core | TypeScript CSS transform style | Non-percent units and CSS string construction stay in TypeScript. |
| Full nested settings validation | TypeScript | None | Keep TypeScript as source of truth until the Rust schema crate models the full nested app settings object. |

Lyrics use user-provided LRC text only. The wallpaper does not bundle lyrics, scrape lyrics, or call external lyrics
providers in the current phase:

```js
localStorage.setItem(
  'spotify-wallpaper-settings',
  JSON.stringify({
    layout: {
      preset: 'Lyrics Focus'
    },
    lyrics: {
      enabled: true,
      sourceText: '[00:01.00]First line\\n[00:04.50]Second line',
      mode: 'context',
      offsetMs: 0,
      showMissingState: true
    }
  })
);
location.reload();
```

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
      lyrics: true,
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
| `settings_json` | Valid JSON applies settings; malformed JSON falls back safely and reports a debug warning. |
| `spotify_client_id` | Client ID reaches Spotify polling settings without being logged. |
| `spotify_refresh_token` | Refresh Token enables Spotify polling and debug only shows configured/not configured. |
| `lyrics_enabled` | Toggles the lyrics layer without breaking layout. |
| `visualizer_enabled` | Enables/disables visualizer rendering and clears visualizer state when disabled. |
| `performance_mode` | Accepts `low-power`, `standard`, and `high-effect`; invalid values keep safe defaults. |
| `debug_enabled` | Toggles the debug panel without exposing token values. |
| Wallpaper Engine audio listener | Real data uses `wallpaper-engine`; unavailable data falls back to mock or idle visualizer state. |

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

## Optional configurator

The configurator is optional and is not required for the Wallpaper Engine wallpaper runtime.

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
- `spotify_refresh_token`
- `settings_json`
- `selected_preset`
- `visualizer_enabled`
- `lyrics_enabled`
- `performance_mode`
- `debug_enabled`

Check Rust crates:

```sh
cargo check --workspace
```

The wallpaper app must keep working in a normal browser without Wallpaper Engine, Spotify credentials, or the optional configurator.
