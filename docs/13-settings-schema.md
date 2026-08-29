# Settings Schema

## Purpose

All customization is represented by a versioned settings object. Settings must
be safe to paste into Wallpaper Engine properties and safe to edit through the
configurator.

## Settings v3 authority

Settings v3 is the single preference authority for Wallpaper and Configurator.
Its default provider is `mock` and its default display mode is `album-only`.
It preserves existing display, performance, Rainmeter, and debug preferences,
but never serializes Client ID, Refresh Token, Pairing Token, or
`hasRefreshToken`. Credentials are process-memory/provider inputs, not settings
fields.

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

## Versioning and migration

Every settings object must include `schemaVersion` when it is exported.

Unversioned, v1, and v2 inputs are migration-only DTOs and are migrated to v3.
Their visualizer `intensity` is first checked against the old `0–2` range,
then multiplied once by three and capped at `6`. A missing or invalid legacy
value uses the old default `0.72`, which becomes `2.16`. A v3 value is checked
against the current `0–6` range and is never multiplied again.

The legacy seekbar style `album-ring` is repaired to `line`. The
`album-ring` value remains a visualizer mode, not a seekbar style.

Future versions are rejected to safe defaults without downgrade or automatic
write. Invalid values are repaired instead of crashing.

## Defaults

Defaults must produce a working wallpaper in mock mode without Spotify
connection.

The v3 default profile is visually simple and low-risk:

- background album blur or gradient
- album art center or left-center
- visualizer position `around-album`
- track text hidden in the default `album-only` mode
- straight-line seekbar visible
- clock hidden in the default `album-only` mode; visible in `album-details`
- visualizer intensity `2.16`, within the current `0–6` range
- performance standard

Clock visibility is enabled when `displayMode` is `album-details`; the
`album-only` default hides the clock along with track text, controls, and
volume. `album-details` is the full characterization profile.

Lyrics/LRC settings are not part of the current v3 preference schema. Legacy
`lyrics` input must be ignored or dropped during repair rather than preserved as
an active setting.

## Export policy

Settings v3 export is always preference-only and secret-free. Client ID,
Refresh Token, Pairing Token, `hasRefreshToken`, and legacy credential fields
are ignored on import and absent from serialized settings, debug, warnings,
errors, Rainmeter, and phase reports. A deliberate legacy direct export, if
ever retained, is a separate user-mediated native sink and is not a settings
serializer. The v3 field is `spotify.backendOrigin`; legacy `backendUrl` is
accepted only by the migration DTO and is never emitted.

`visualizer.position` is serialized as either `around-album` or `bottom-up`.
Missing, malformed, and unsupported values are repaired to the safe default
`around-album`.

`seekbar.style` is always serialized as `line`. The removed progress-ring
markup and configuration option must not be produced by the configurator.

`visualizer.glowingObjectsEnabled` is a separate boolean display toggle and
defaults to `true`. It is also exposed as the Wallpaper Engine property
`glowing_objects_enabled`; non-boolean property values are ignored.

`visualizer.particleCount` and `visualizer.particleLife` use zero as an
automatic value, not as an off switch. Automatic particle counts are 24 in
`low-power`, 48 in `standard`, and 96 in `high-effect`; automatic life is 3.5
seconds. Disable the effect with `glowingObjectsEnabled`.

Audio-coupled album scale, capped outward offset, particle speed/brightness,
album-art dominant color, and live volume adaptation are runtime view values.
They are not added to the serialized settings object. The runtime keeps a
per-track high-water level, decays it over about 12 seconds while playing, and
limits automatic plus Spotify-volume compensation to 4×. The visual target is
about 98% after the response curve at the default `2.16` intensity. Configured
intensity remains the final display multiplier. Volume-only refreshes reuse the
corrected high-water without recording the previous audio frame as a new peak;
the normalized frame remains unchanged.

## Validation policy

Validate ranges for:

- opacity
- scale
- rotation
- zIndex
- visualizer intensity (`0–6`)
- smoothing
- decay
- particle count
- transition duration
- polling intervals if configurable

Malformed JSON must not prevent startup. Use defaults and show debug warning.
