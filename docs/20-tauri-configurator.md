# Tauri Configurator

## Role

The configurator is optional. The wallpaper must not require it at runtime.

Configurator preferences use the same Settings v2 authority and
`packages/wallpaper-view` renderer as Wallpaper.
Preview is network-free and control intents never reach Spotify. Native auth
and credential handling remain a separate Rust boundary; ordinary WebView
state exposes only presence/status or fixed error codes, never raw secrets.

## Responsibilities

- Spotify OAuth PKCE setup assistance
- optional public Worker setup-page handoff
- Refresh Token acquisition assistance
- settings editor
- layout preview
- preset management
- import/export
- Rainmeter output settings
- debug log viewer
- Wallpaper Engine settings JSON generation

## Screens

- Welcome / Setup
- Spotify Connection
- Layout Editor
- Theme Editor
- Visualizer Editor
- Transition Settings
- Clock Settings
- Rainmeter Integration
- Performance
- Export / Import
- Debug

## Token policy

Authentication uses one native command,
`authorize_spotify_and_copy_swpt1`. The verifier, OAuth state, callback URL,
authorization code, and Refresh Token remain Rust locals; after native user
confirmation, the command copies the `swpt1` value to the clipboard exactly
once. Ordinary WebView IPC returns only status/presence and fixed error codes;
it never returns raw credentials, callback material, or upstream bodies. There
is no generic settings/export path for credentials, and public-backend Pairing
Tokens are never exported.

The public Worker setup page is the supported public-backend authorization path. Tauri remains optional and must not be required to authorize or run the Wallpaper Engine wallpaper.

## First milestone

The first configurator milestone is not a full drag editor. It is enough to load defaults, edit basic settings, preview mock display, and export settings JSON.
