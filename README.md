# Spotify Wallpaper

Spotify Wallpaper is a Wallpaper Engine Web Wallpaper project. It has a browser-previewable mock wallpaper plus Spotify playback polling, settings customization, visualizer, LRC lyrics, transitions, player controls, an optional Tauri configurator, and optional Rainmeter JSON export.

## Guides

- `docs/user-guide.md` covers setup, Spotify Developer configuration, Wallpaper Engine import, settings, lyrics, Rainmeter, and troubleshooting.
- `docs/qa-checklist.md` covers manual and automated release QA.
- `docs/release-notes-v0.0.1.md` lists the current milestone scope and known gaps.
- `examples/settings/` contains token-free sample settings JSON.

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
wasm-pack build crates/visual-core --target web --out-dir ../../apps/wallpaper/public/wasm
npm run build -w @spotify-wallpaper/wallpaper
```

If the generated WASM files are absent, the wallpaper keeps running with TypeScript fallback logic.

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
cargo check --manifest-path apps/configurator/src-tauri/Cargo.toml
cargo test --manifest-path apps/configurator/src-tauri/Cargo.toml
npm audit --audit-level=moderate
```

For Wallpaper Engine import, build the project and select `apps/wallpaper/dist` as the Web Wallpaper folder. The build
copies `apps/wallpaper/public/project.json` into the distribution folder.

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
