# User Guide

This guide covers the current `v0.0.1` milestone. The wallpaper runs as a Wallpaper Engine Web Wallpaper, and it also opens in a normal browser with mock playback for development and QA.

## Quick Start

1. Install dependencies from the repository root:

   ```sh
   npm install
   ```

2. Start the browser preview:

   ```sh
   npm run dev -w @spotify-wallpaper/wallpaper
   ```

3. Open `http://127.0.0.1:5173/`.

Without Spotify settings, the wallpaper uses mock playback, mock audio, and safe default settings.

## Spotify Developer Setup

The optional public backend beta uses BYO Client ID with Authorization Code and PKCE. Create one Spotify Developer app
for your own use. Do not create, paste, or store a Spotify Client Secret in the wallpaper or setup page.

Spotify-connected Limited beta access is not open yet. The flow below applies
only after the phase report records the policy, legal, infrastructure, smoke,
alert-delivery, Security, and SpecGuard gates.

Required scopes for passive display:

- `user-read-currently-playing`
- `user-read-playback-state`

Additional scope for playback controls:

- `user-modify-playback-state`

Spotify Development Mode currently requires the app owner to have Spotify
Premium, limits new Client ID creation to one per developer, and allows at most
five authorized users per app. Only existing resources above those limits may
be grandfathered. Check the Developer Dashboard before assuming a new BYO app
can be created. Passive display does not otherwise require Premium, but
playback controls can be restricted by account or device capabilities.

The production backend must use a fixed custom HTTPS origin. The operator publishes that origin only after the production
domain release gate is complete. Use this flow:

1. In the Spotify Developer Dashboard, register exactly the callback URI formed from the official production origin plus
   `/auth/callback`. It must have the same scheme and host as the official `/setup` page and no added trailing slash,
   query, or fragment.
2. Open the official production origin followed by `/setup`.
3. Read the linked Privacy Notice and EULA, explicitly accept both, enter your
   Spotify Client ID, and choose Authorize Spotify.
4. Log in to Spotify and approve the requested scopes.
5. Copy the `swpb1.` Pairing Token shown after success. The page displays it only once.
6. In Wallpaper Engine, paste the Pairing Token into the single Spotify Token
   field. Its `swpb1.` prefix selects the release-configured backend
   automatically.

The Pairing Token is a bearer credential and remains valid until account deletion or revocation. Never share it, send it
to maintainers, or put it in a URL, screenshot, recording, log, issue, browser storage, or committed file.

### Six-Month Reauthorization

Spotify authorization expires six months after the most recent authorization. The Worker also requires reauthorization
if Spotify returns `invalid_grant`. The wallpaper keeps its last safe display and reports `unauthorized` instead of
retrying indefinitely.

1. Return to the same official `/setup` page.
2. Accept the current Privacy Notice and EULA, then under Reauthorize Spotify
   enter the existing Pairing Token.
3. Complete Spotify authorization again.

Successful reauthorization retains the same Pairing Token and starts a new six-month authorization period. The
reauthorization success page does not issue a replacement token.

### Delete And Disconnect

1. Open the same official `/setup` page.
2. Under Delete backend account, enter the Pairing Token.
3. Confirm the page reports that the backend account was deleted.
4. In Spotify account settings, open Apps and remove the BYO app using the
   name you assigned when creating it.

The setup page calls authenticated `DELETE /api/account`. The Worker first writes a 35-day non-secret `publicId`
tombstone to a separate deletion ledger, then deletes OAuth sessions, encrypted Spotify tokens, Client ID, Pairing
digest, refresh leases, and cache from the primary database. The tombstone blocks restored primary data from becoming
active. Cloudflare D1 Time Travel can retain historical encrypted database state for up to 30 days on Workers Paid; it
is not live account data, and the 35-day tombstone covers that restore window. Backend deletion does not disconnect the
app inside Spotify, so step 4 is required.

For an incident or deletion problem, use the repository issue tracker:
`https://github.com/Ciellllllllll/SpotifyWallPaper/issues`. Include only non-sensitive symptoms and times. Never include
a Client ID, Pairing Token, Spotify token, authorization code, callback URL, or Worker secret. For a sensitive report,
open a non-sensitive issue asking maintainers for a private reporting channel.

### Legacy Direct Mode

Direct mode remains available for compatibility and developer testing. A `swpt1.` token contains a Client ID and Spotify
Refresh Token and is accepted only by direct mode; the public Worker never accepts it. The static GitHub Pages auth page
is a local developer-only legacy tool, not the Workshop default or a managed
public authorization path. The repository workflow checks/builds it manually
but no longer has GitHub Pages deployment permission.

For local browser preview, keep the settings credential-free and select the v3 mock provider:

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

Clear local test credentials after testing:

```js
localStorage.removeItem('spotify-wallpaper-settings');
location.reload();
```

Never put Spotify tokens in browser settings, URLs, screenshots, logs, Rainmeter output, or committed files. Direct
credentials are supplied only through the dedicated Wallpaper Engine properties.

## Wallpaper Engine Development and Updates

1. Build the web wallpaper and create its development link:

   ```powershell
   npm run wallpaper:dev-build
   ```

2. In Wallpaper Engine, select the `spotify-wallpaper-dev` project under
   `projects\myprojects` once.
3. After later source changes, run `npm run wallpaper:dev-build` again and
   reload the existing wallpaper. Do not import another copy.
4. Configure user properties as needed.

The link command reads Wallpaper Engine's install path from the current-user
registry. To use a non-standard location, set
`WALLPAPER_ENGINE_PROJECTS_DIR` to the absolute path of the `myprojects`
folder. The command does not delete or overwrite an existing destination, and
it leaves older manual imports such as `index1` untouched.

### Workshop updates

Normal development builds never contain a Workshop ID. Workshop builds read
`apps/wallpaper/workshop-metadata.json` instead:

```powershell
$env:VITE_SPOTIFY_BACKEND_ORIGIN='https://your-approved-origin.example'
npm run build:workshop -w @spotify-wallpaper/wallpaper
```

For the first owner-only Private test, use no Spotify credentials and verify
mock behavior only. After Wallpaper Engine creates the Workshop item, copy
only its decimal ID into `workshop-metadata.json` as a quoted string. Run the
Workshop build again before future **Submit Update** operations. Steam updates
the same subscribed item, although delivery may be slightly delayed.

Private publication itself is not automated. Do not connect a real Spotify
account, invite another user, begin a Limited beta, or publish generally until
the existing Spotify distribution gates are complete and the action is
separately approved.

Visible user property keys:

- `spotify_refresh_token`
- `visualizer_enabled`
- `glowing_objects_enabled`
- `visualizer_mode`
- `visualizer_position`
- `visualizer_intensity`
- `visualizer_sensitivity`
- `visualizer_smoothing`
- `visualizer_decay`
- `clock_enabled`
- `clock_hour12`
- `clock_show_date`
- `performance_mode`
- `debug_enabled`

The `spotify_refresh_token` key is displayed as Spotify Token for saved-value
compatibility. Paste `swpb1.` for the public backend or `swpt1.` for direct
mode; the prefix selects the provider automatically. The release build rejects
arbitrary HTTPS origins before sending a credential. Clearing the field
disconnects Spotify, and malformed prefixed input does not replace the active
credential. Legacy hidden properties remain readable for existing installs,
but Settings JSON and the separate provider, backend URL, Client ID, and
Pairing Token controls are no longer shown.

If Wallpaper Engine APIs are absent, the same build still works in a browser using mock settings and mock playback.

### Visualizer tuning

When Visualizer Enabled is on, Wallpaper Engine shows four live sliders. Each
slider accepts two decimal places in 0.01 steps:

- Visualizer Intensity changes the final height or radius of the effect.
- Visualizer Sensitivity raises quiet input before it is treated as silence.
- Visualizer Smoothing trades immediate movement for steadier movement; move
  it toward 0 for the quickest response.
- Visualizer Decay Speed controls how quickly the effect falls after a sound;
  higher values produce a shorter tail.

Changes apply without reloading. Start by lowering Smoothing, then raise
Sensitivity for quiet sources, and use Intensity only for the final visual
size. Set Visualizer Position to `around-album` to keep circular geometry
centered on the album art, or to `bottom-up` to anchor the visualizer at the
bottom of the screen and grow radial bars upward. The position is independent
of the selected mode, and the visualizer does not rotate as a whole.

In direct or backend Spotify mode, Wallpaper Engine audio starts reacting only
after the current connection successfully reports a playing track or episode.
Spotify volume 1 through 100 is virtually referenced to 100 with
`100 / volume`; zero or unavailable volume is left unboosted. This affects only
the wallpaper response and never changes Spotify or PC volume. Paused, stopped,
missing-item, and not-yet-fetched states set the visualizer to zero while the
album and lights return to rest. A short network failure keeps the last valid playback state,
while no active device, no item, expired authorization, or denied access stops
audio response. Changing connection waits for the next successful result. Browser mock
audio is never boosted. Because Wallpaper Engine receives the PC-wide audio
mix, other audible applications are also amplified visually while Spotify is
eligible.

### Glowing objects

Glowing Objects Enabled controls a full-screen field of small lights that begin
near the center and move outward. The effect is independent of album-art and
SVG visualizer visibility. Normalized audio continuously grows the album
content up to 54%, moves it outward by at most 8px, and raises particle speed
up to twice normal with a brightness increase; after the sound stops, these
values ease back in about 450ms. In theme color mode, the album's quantized
dominant color is applied to the SVG visualizer and lights only, with white as
the fallback and a short color transition. Reduce Motion does not disable
this effect. A particle count or lifetime of 0 selects the performance-aware
automatic value; use the toggle when the effect should be off.

### Display mode animation

The default `album-only` mode hides track details. Switching to
`album-details` reveals the track panel with its text-entry animation while the
album frame transitions to its details layout. Switching back reverses the
album and seekbar position changes; the detail text is removed. Enable Reduce
Motion when these display-mode animations and transitions should be stopped.

## Rust/WASM Visual Core

The wallpaper can use the Rust visual core at runtime for typed-array visualizer normalization and readability calculation.
Layout and settings remain TypeScript-owned. Generate the WASM bundle before packaging when Rust runtime integration is required:

```sh
wasm-pack build crates/visual-core --target web --out-dir ../../apps/wallpaper/public/wasm
npm run build -w @spotify-wallpaper/wallpaper
```

If the WASM bundle is not present, the wallpaper falls back to TypeScript logic and still starts in browser preview and Wallpaper Engine.

## Optional Configurator

Run the browser configurator:

```sh
npm run dev -w @spotify-wallpaper/configurator
```

Run the Tauri shell:

```sh
npm run tauri:dev -w @spotify-wallpaper/configurator
```

The configurator edits the complete v3 preferences object, previews the shared mock renderer, imports/exports secret-free
settings JSON, and writes optional Rainmeter JSON. Spotify authorization uses the single native
`authorize_spotify_and_copy_swpt1` command. Verifier, state, callback URL, authorization code, and Refresh Token stay in
Rust locals; after native confirmation, the approved `swpt1.` bundle is copied to the clipboard once. The WebView receives
only status or fixed error codes and never stores or exports credentials. There is no callback-URL paste or token draft.

The configurator is optional. The wallpaper runtime must keep working without it.

## Settings Reference

Every preferences object uses `schemaVersion: 3` and these top-level categories:

- `spotify`
- `layout`
- `theme`
- `background`
- `albumArt`
- `text`
- `player`
- `seekbar`
- `visualizer`
- `clock`
- `transitions`
- `performance`
- `rainmeter`
- `debug`

Malformed settings are repaired or replaced with safe defaults at startup. Examples are available in `examples/settings/`.

Use `layout.preset` for the first level of customization. Available presets:

- `Minimal`
- `Center Album`
- `Visualizer Heavy`
- `Rainmeter Hybrid`
- `Left Dock`
- `Bottom Player`
- `Clock Focus`
- `Album Ring`
- `Ambient Background`

## Rainmeter Integration

Rainmeter export is optional and belongs to the configurator/Tauri side. The Web Wallpaper does not require Rainmeter and does not write local files.

The current output mode is JSON. The payload contains:

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

The Tauri command rejects payloads with Spotify token, client secret, OAuth authorization code, or callback URL field names before writing files.

The Tauri scheduler can write Rainmeter JSON repeatedly. It writes at about 1 second while playback is marked playing and uses `rainmeter.stoppedUpdateIntervalMs` while stopped. Scheduler failures are isolated from the wallpaper runtime.

A minimal Rainmeter reader sample is available at `examples/rainmeter/SpotifyWallPaper/SpotifyWallPaper.ini`. Copy it into a Rainmeter skin folder and set `JsonPath` to the configurator output file if you do not use the default `@Resources/NowPlaying.json` location.

## Troubleshooting

- Browser opens but no Spotify data appears: this is expected without Spotify settings; mock playback should still render.
- Wallpaper Engine properties do not apply: reload the existing development wallpaper after rebuilding and confirm the visible property key names.
- Spotify controls fail: passive display works without Premium, but some playback operations can be denied by Spotify or by restricted devices.
- Public backend reports `unauthorized`: reauthorize from the same official `/setup` page with the existing Pairing Token. If the backend account was deleted, complete a new setup instead.
- Public backend setup fails: confirm the Spotify app has the exact production callback URI and that its owner meets Spotify Development Mode Premium and user-limit requirements.
- Lyrics/LRC settings are not available in this milestone. Remove legacy `lyrics` fields from pasted settings JSON if they appear in old samples.
- Visualizer is idle: Wallpaper Engine audio data may be unavailable; browser preview uses mock or idle audio paths. In Wallpaper Engine, confirm Visualizer Enabled, lower Smoothing, and raise Sensitivity gradually.
- Rainmeter write fails: confirm the configurator is running in the Tauri shell, not only the browser preview, and verify the output path is writable.
- Settings break the layout: clear `spotify-wallpaper-settings` from local storage or import a known-good sample from `examples/settings/`.
