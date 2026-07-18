# Tauri Configurator

## Role

The configurator is optional. The wallpaper must not require it at runtime.

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

Do not show tokens by default. Do not include tokens in exported settings by default. Legacy direct Refresh Token export, if retained, must be explicit. Public-backend Pairing Token export is never allowed.

The public Worker setup page is the supported public-backend authorization path. Tauri remains optional and must not be required to authorize or run the Wallpaper Engine wallpaper.

## First milestone

The first configurator milestone is not a full drag editor. It is enough to load defaults, edit basic settings, preview mock display, and export settings JSON.
