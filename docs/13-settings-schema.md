# Settings Schema

## Purpose

All customization is represented by a versioned settings object. Settings must be safe to paste into Wallpaper Engine properties and safe to edit through the configurator.

## Required top-level categories

- spotify
- layout
- theme
- background
- albumArt
- text
- player
- seekbar
- visualizer
- clock
- transitions
- performance
- rainmeter
- debug

## Versioning

Every settings object must include `schemaVersion`.

Unknown or old versions must be migrated when possible. Invalid values must be replaced with defaults instead of crashing.

## Defaults

Defaults must produce a working wallpaper in mock mode without Spotify connection.

Default profile should be visually simple and low-risk:

- background album blur or gradient
- album art center or left-center
- track info visible
- seekbar visible
- clock visible
- visualizer moderate
- performance standard

Lyrics/LRC settings are not part of the current v1 schema. Legacy `lyrics` input must be ignored or dropped during repair rather than preserved as an active setting.

## Export policy

Settings export must allow excluding legacy direct Refresh Tokens. Default export does not include secrets. A public-backend Pairing Token must never be exported, including when legacy Refresh Token export is explicitly enabled.

`spotify.refreshToken` and `spotify.pairingToken` are secrets. Export, debug, warning, error, Rainmeter, and phase-report paths always exclude `pairingToken` and exclude `refreshToken` by default. `spotify.backendUrl` may contain only HTTP loopback or the exact release-configured HTTPS origin.

The public-backend change does not require a schema-version bump because `playbackProvider`, `backendUrl`, and `pairingToken` already exist as optional fields. Legacy schema version 1 settings must remain valid.

## Validation policy

Validate ranges for:

- opacity
- scale
- rotation
- zIndex
- visualizer intensity
- smoothing
- decay
- particle count
- transition duration
- polling intervals if configurable

Malformed JSON must not prevent startup. Use defaults and show debug warning.
