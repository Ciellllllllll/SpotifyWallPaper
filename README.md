# Spotify Wallpaper

Spotify Wallpaper is a Wallpaper Engine Web Wallpaper project. It has a browser-previewable mock wallpaper plus Spotify playback polling, Wallpaper Engine property customization, static GitHub Pages PKCE authorization and direct Spotify access, visualizer, transitions, player controls, an optional Tauri configurator, and optional Rainmeter JSON export.

## Guides And Repository Notes

- `docs/` contains tracked specifications, runbooks, privacy, QA, and phase
  records. Before publication, review the direct-mode Privacy Notice and
  applicable terms with real operator/contact details. The former hosted
  backend EULA is archived.
- This README carries the release-candidate setup and QA notes that must remain available from GitHub.
- `examples/settings/` contains token-free sample settings JSON.

## Technical Stack

- Wallpaper app: Svelte, TypeScript, Vite, Wallpaper Engine Web Wallpaper APIs.
- Standard auth page: static Vite + TypeScript PKCE app hosted on GitHub Pages; each user supplies their own Client ID.
- Shared model types: TypeScript workspace package.
- Optional WASM helpers: Rust compiled to WebAssembly for visualizer sample normalization and theme readability calculation. The wallpaper runs with TypeScript fallbacks when WASM is absent.
- Optional configurator: Svelte frontend with Tauri/Rust backend.
- Optional Rainmeter output: configurator-side JSON writer and scheduler.

## Current Design

The runtime wallpaper is the main product. It must work as a Wallpaper Engine Web Wallpaper and in a normal browser
preview without requiring Tauri, Rainmeter, or a live Spotify connection.

Spotifyへの接続は、初回・再認証だけブラウザの静的Pages認証ページを使い、
通常はローカルWeb WallpaperからSpotify Web APIとtoken endpointへ直接接続します。
VPS、Worker、D1、GitHub Actionsによる定期更新、追加の常駐アプリ、Client Secretは不要です。
`DirectPlaybackProvider`と専用IndexedDBがToken更新・保存・復元を担当します。
一般設定JSONと機密保存は別で、設定exportには認証情報を含めません。
任意のTauri/Rainmeterとローカルloopback接続は維持しています。

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

## Retired hosted backend

The former Cloudflare Worker and two Spotify D1 databases were deleted on
2026-09-21. The unused Node/PostgreSQL proxy, deployment assets and dedicated CI
have been removed. The inspected VPS had no SpotifyWallPaper deployment and
was left running. See `docs/25-public-backend.md` for the retirement boundary.

## Spotify接続とGitHub Pages

予定の認証ページは [Spotify認証ページ](https://ciellllllllll.github.io/SpotifyWallPaper/spotify-auth/) です。
この作業では公開していません。登録するRedirect URIは
`https://ciellllllllll.github.io/SpotifyWallPaper/spotify-auth/callback/` です。
大文字小文字と末尾スラッシュを含めて一致させてください。

各利用者が自分のClient IDで認証し、生成された`swpt2.`データをWallpaper Engineの
「Spotify Token」欄へ貼り付けます。これはRefresh Tokenを含む機密データで、
Base64urlは暗号化ではありません。既存`swpt1.`も読めます。
旧`swpb1.`は直接接続へ変換できないため、Pagesで一度再認証します。

詳しい接続・解除・復元・公開設定・実機制約は[ユーザーガイド](docs/user-guide.md)を参照してください。
通常の`npm run build`、`npm run check`、`npm test`は主製品を検証します。
任意機能には`build:optional`、`check:optional`、`test:optional`を使います。
ローカルbackend・TauriのCIと、配布物の機密情報検査は維持しています。

```sh
npm run build -w @spotify-wallpaper/spotify-auth
node apps/spotify-auth/prepare-pages.mjs
npx playwright test --config playwright.auth.config.ts
```

Spotifyの認証情報を設定せずにビルドできます。`VITE_SPOTIFY_CLIENT_ID`は編集可能な初期値に限ります。
本番パスは`apps/spotify-auth/pages-config.json`が定義し、任意のURL/queryで変更できません。
ローカル開発は`npm run dev -w @spotify-wallpaper/spotify-auth`（127.0.0.1:1430）です。

## Publication Status

実装・ローカル検証と外部公開は別です。Pagesの実公開、Spotify実アカウント接続、
Wallpaper Engineの72時間連続稼働・再起動・複数画面は未検証です。
公開前には運営者・連絡先を含むPrivacy/EULAの確認、Spotifyの画像・音声同期・表示・商標の
公開条件、GitHub Pagesの商用・機密取引に関する制限を確認してください。
既存の演出を維持したことは公開規約への適合確認を意味しません。
旧公開バックエンドは廃止済みです。

一次資料: [Spotify Policy](https://developer.spotify.com/policy)、
[Design Guidelines](https://developer.spotify.com/documentation/design)、
[GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)。

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

Clear browser mock preferences with (this does not delete the dedicated credential store):

```js
localStorage.removeItem('spotify-wallpaper-settings');
location.reload();
```

Never place Spotify tokens in browser settings, a URL, screenshot, log, or committed file. Direct credentials are supplied
through the dedicated Wallpaper Engine properties and persisted only in the dedicated credential store; the Web Wallpaper must not use a Spotify Client Secret.

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

CI and Spotify Auth Pages run only when a `release-*` Git tag is pushed
(for example, `release-v1.0.0`). A preliminary job requires the tagged commit
to be contained in `develop` or `master`; ordinary branch pushes and PRs do
not trigger either workflow. Push the branch before pushing its release tag.
Pages publishing additionally requires master ancestry, `PAGES_DEPLOY_ENABLED=true`,
and an environment rule permitting `release-*` tags; develop-only commits only validate.
See the [publication steps](docs/user-guide.md#github-pagesの公開手順利用者が実行).

CI runs independent web, visual-core Rust, Tauri and loopback jobs. The web
job generates WASM and shared types before tests/builds, runs browser
characterization and audits dependencies. Pages publishing remains opt-in.

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
| `spotify_playback_provider` | Standard Spotify mode is `Direct`; `Mock` previews without credentials. Backend is optional and restricted to local HTTP loopback. |
| `spotify_backend_url` | Only canonical HTTP loopback origins are accepted. All public HTTPS origins are rejected before a credential is sent. |
| `spotify_pairing_token` | Legacy field for local loopback credentials; public `swpb1.` setup is retired. Debug only shows configured/not configured. Never expose a real value in screenshots or logs. |
| `spotify_client_id` | Optional legacy raw-token input. `swpt2.`/`swpt1.` bundles already include the Client ID. |
| `spotify_refresh_token` | Standard connection input: paste the Pages `swpt2.` bundle (`swpt1.` remains compatible). Empty input explicitly disconnects. Never expose a real value in screenshots or logs. |
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
wallpaper runtime. The hosted backend is retired. The configurator remains useful for local
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
- `spotify_refresh_token` (`swpt2.` or compatible `swpt1.` direct bundle; never put a raw token in settings JSON)
- `spotify_playback_provider`
- `spotify_backend_url`
- `spotify_pairing_token` (optional local loopback credential)
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
Wallpaper Engine `textinput` properties. `spotify_pairing_token` is a hidden
legacy input for the optional local loopback backend.
`spotify_refresh_token` is the standard direct authorization input; `spotify_client_id` is a hidden legacy field. Paste `settings_json` as single-line JSON
because Wallpaper Engine Web Wallpaper user properties do not provide a textarea type.

Check Rust crates:

```sh
cargo check --workspace
```

The wallpaper app must keep working in a normal browser without Wallpaper Engine, Spotify credentials, or the optional configurator.
