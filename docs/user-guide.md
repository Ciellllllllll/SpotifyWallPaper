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

Create a Spotify Developer app and use Authorization Code with PKCE. The Web Wallpaper accepts a public Client ID and a Refresh Token. Do not use or store a Spotify Client Secret in the wallpaper.

Required scopes for passive display:

- `user-read-currently-playing`
- `user-read-playback-state`

Additional scope for playback controls:

- `user-modify-playback-state`

For local testing, paste settings into browser local storage and reload:

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

Clear local test credentials after testing:

```js
localStorage.removeItem('spotify-wallpaper-settings');
location.reload();
```

Never put Spotify tokens in URLs, screenshots, logs, Rainmeter output, or committed files.

## Wallpaper Engine Import

1. Build the web wallpaper:

   ```sh
   npm run build
   ```

2. In Wallpaper Engine, create or update a Web Wallpaper.
3. Select `apps/wallpaper/dist` as the output folder.
4. Configure user properties as needed.

Supported user property keys:

- `spotify_client_id`
- `spotify_refresh_token`
- `settings_json`
- `selected_preset`
- `visualizer_enabled`
- `lyrics_enabled`
- `performance_mode`
- `debug_enabled`

If Wallpaper Engine APIs are absent, the same build still works in a browser using mock settings and mock playback.

## Optional Configurator

Run the browser configurator:

```sh
npm run dev -w @spotify-wallpaper/configurator
```

Run the Tauri shell:

```sh
npm run tauri:dev -w @spotify-wallpaper/configurator
```

The configurator can edit milestone settings, preview a mock layout, import/export settings JSON, and write optional Rainmeter JSON from the Tauri shell. Refresh Token export is off by default and must be explicitly enabled before a token appears in generated settings JSON.

The configurator is optional. The wallpaper runtime must keep working without it.

## Settings Reference

Every settings object uses `schemaVersion: 1` and these top-level categories:

- `spotify`
- `layout`
- `theme`
- `background`
- `albumArt`
- `text`
- `player`
- `seekbar`
- `lyrics`
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
- `Lyrics Focus`
- `Visualizer Heavy`
- `Rainmeter Hybrid`
- `Left Dock`
- `Bottom Player`
- `Clock Focus`
- `Album Ring`
- `Ambient Background`

## Lyrics LRC Guide

Lyrics are user-provided LRC text only. The wallpaper does not bundle lyrics, scrape lyrics, or call external lyrics providers in this milestone.

Example:

```json
{
  "lyrics": {
    "enabled": true,
    "sourceText": "[00:01.00]First line\n[00:04.50]Second line",
    "mode": "context",
    "offsetMs": 0,
    "showMissingState": true
  }
}
```

Supported LRC behavior includes timestamped lines, metadata lines, offsets, empty lines, duplicate timestamps, long lines, and no active line before the first timestamp.

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

## Troubleshooting

- Browser opens but no Spotify data appears: this is expected without Spotify settings; mock playback should still render.
- Wallpaper Engine properties do not apply: confirm the property key names and verify `settings_json` is valid JSON.
- Spotify controls fail: passive display works without Premium, but some playback operations can be denied by Spotify or by restricted devices.
- Lyrics do not show: confirm `lyrics.enabled` is true and `sourceText` contains valid LRC timestamps.
- Visualizer is idle: Wallpaper Engine audio data may be unavailable; browser preview uses mock or idle audio paths.
- Rainmeter write fails: confirm the configurator is running in the Tauri shell, not only the browser preview, and verify the output path is writable.
- Settings break the layout: clear `spotify-wallpaper-settings` from local storage or import a known-good sample from `examples/settings/`.
