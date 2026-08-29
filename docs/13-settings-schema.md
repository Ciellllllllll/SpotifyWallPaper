# Settings Schema

## Purpose

All customization is represented by a versioned settings object. Settings must be safe to paste into Wallpaper Engine properties and safe to edit through the configurator.

## Settings v2 authority

Settings v2 is the single preference authority for Wallpaper and Configurator.
Its default provider is `mock` and its default display mode is `album-only`.
It preserves existing display, performance, Rainmeter, and debug preferences,
but never serializes Client ID, Refresh Token, Pairing Token, or
`hasRefreshToken`. V1/unversioned input is a migration-only DTO; future
versions are rejected to safe defaults without downgrade or automatic write.
Credentials are process-memory/provider inputs, not settings fields.

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

V1 and unversioned inputs are migration-only DTOs and are migrated to v2 when
their preference fields are known. Future versions are rejected to safe
defaults with a fixed warning; they are never downgraded or automatically
written back. Invalid values are repaired instead of crashing.

## Defaults

Defaults must produce a working wallpaper in mock mode without Spotify connection.

The v2 default profile is visually simple and low-risk:

- background album blur or gradient
- album art center or left-center
- visualizer position `around-album`
- track text hidden in the default `album-only` mode
- seekbar visible
- clock hidden in the default `album-only` mode; visible in `album-details`
- visualizer moderate
- performance standard

Clock visibility is enabled when `displayMode` is `album-details`; the
`album-only` default hides the clock along with track text, controls, and
volume. `album-details` is the full characterization profile.

Lyrics/LRC settings are not part of the current v2 preference schema. Legacy
`lyrics` input must be ignored or dropped during repair rather than preserved as
an active setting.

## Export policy

Settings v2 export is always preference-only and secret-free. Client ID,
Refresh Token, Pairing Token, `hasRefreshToken`, and legacy credential fields
are ignored on import and absent from serialized settings, debug, warnings,
errors, Rainmeter, and phase reports. A deliberate legacy direct export, if
ever retained, is a separate user-mediated native sink and is not a settings
serializer. The v2 field is `spotify.backendOrigin`; legacy `backendUrl` is
accepted only by the migration DTO and is never emitted.

`visualizer.position` is serialized as either `around-album` or `bottom-up`.
Missing, malformed, and unsupported values are repaired to the safe default
`around-album`.

`visualizer.glowingObjectsEnabled` is a separate boolean display toggle and
defaults to `true`. It is also exposed as the Wallpaper Engine property
`glowing_objects_enabled`; non-boolean property values are ignored. The v2
schema version remains unchanged.

`visualizer.particleCount` and `visualizer.particleLife` use zero as an
automatic value, not as an off switch. Automatic particle counts are 24 in
`low-power`, 48 in `standard`, and 96 in `high-effect`; automatic life is 3.5
seconds. Disable the effect with `glowingObjectsEnabled`.

Audio-coupled album scale, capped outward offset, particle speed/brightness,
and album-art dominant color are runtime view values. They are not added to the
serialized settings object and do not change the v2 schema version. The
visualizer-only color also does not replace the persisted background or text
theme.

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
