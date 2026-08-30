# Wallpaper Engine Integration

## Responsibilities

This domain handles Wallpaper Engine Web Wallpaper compatibility, user properties, audio listener, and browser mock fallback.

## Web wallpaper rule

The display target is a Wallpaper Engine Web Wallpaper. The same app must also open in a normal browser for development preview.

## User properties

The native property panel exposes only:

- one Spotify Token field
- visualizer enabled, glowing objects enabled, mode, and position
- visualizer intensity, sensitivity, smoothing, and decay speed
- clock enabled, 12-hour display, and date display
- performance mode
- debug enabled

The Spotify Token field auto-detects `swpt1.` as direct mode and an exact
`swpb1.` Pairing Token as public-backend mode. A release-configured official
HTTPS backend origin is used automatically for `swpb1.`. A build without that
origin reports a fixed non-secret configuration warning. Empty input clears
the active credential, while malformed prefixed input is ignored instead of
overwriting a valid process-memory credential.

Legacy Client ID, provider, backend URL, Pairing Token, settings JSON, preset,
and display property keys remain accepted by the adapter for existing
installations, but they are not shown in the current native property panel.

Property parsing must be isolated behind an adapter.

The release build may inject one official HTTPS backend origin. Runtime validation permits that exact origin and HTTP loopback only. Pairing Tokens must never be sent to arbitrary origins or across redirects.

## Browser fallback

When Wallpaper Engine APIs are absent, use mock settings, mock playback, and mock audio data. Do not crash.

## Audio listener

Use Wallpaper Engine audio data if available. Its fixed 128-value spectrum is
two 64-bin channels: left values first, then right values. Average matching
left/right bins into one 64-bin spectrum before visualizer normalization.
Forward every listener callback without timer throttling. Rust/WASM, or its
TypeScript fallback, remains the sole authority for clamping, noise gating,
smoothing, and decay.

The native Wallpaper Engine property panel exposes 0.01-step fractional sliders for
intensity (0–6, default 2.16), sensitivity (0–3), smoothing (0–0.95), and decay speed
(0–1). They are shown only while the visualizer is enabled and apply without
reloading the wallpaper. Invalid or non-finite property values are ignored and
the shared settings repair boundary remains authoritative.

The visualizer position is selected independently from its mode. `around-album`
centers the visualizer on the album art and uses the circular album geometry;
`bottom-up` anchors it to the lower edge of the viewport and grows radial bars
upward. Invalid position notifications from Wallpaper Engine are ignored so the
existing position is retained. Missing or invalid values while restoring shared
settings are repaired to `around-album`.

The runtime also derives one audio-coupled motion state from the shaped
visualizer frame. Its weighted impact is `peak * 0.45 + bass * 0.30 + mid *
0.15 + treble * 0.10`. The resulting impact is applied continuously: album
content scales from `1.0` to `1.54`, glowing-object speed scales from `1.0` to
`2.0`, and brightness scales from `1.0` to `1.6`. Low-frequency impact also
gives the album a deterministic outward offset capped at 8px. This state is
calculated even when the SVG visualizer is disabled, so the album and
glowing-object layers remain independent consumers. Silence, stopped playback,
and stale callbacks release it toward neutral over about 450ms through the
existing zero-frame path. Real Wallpaper Engine audio is eligible only after
the current direct/backend provider has returned a successful Spotify result,
the normalized source is `spotify`, playback is active, and the item is a track
or episode. A provider change clears that success state until the new provider
succeeds; a transient network, rate-limit, or unsupported-response failure
retains the previous successful state. Item-null, no-active-device,
unauthorized, and forbidden results clear eligibility.
An optimistic Play control result also clears eligibility until the next
successful playing poll confirms the state.
Eligible Spotify volume from 1 through 100 applies a fixed `100 / volume` input
gain before sensitivity, noise gating, clamping, smoothing, and decay. Zero,
missing, and invalid volume uses gain 1. There is no gain cap. The gain changes
visual response only and never calls a Spotify or PC volume API. A volume change
takes effect on the next audio callback; the runtime does not keep or replay an
unprocessed audio frame.

Fallback modes:

- mock waveform in browser preview
- mock audio uses gain 1 regardless of the mock playback volume
- paused, stopped, missing-item, source-mismatched, and not-yet-fetched Spotify
  states keep the idle visualizer but do not drive album or glowing-object motion
- idle animation while no Wallpaper Engine listener is available or a browser
  mock callback is waiting/stale
- after the Wallpaper Engine source is established, noise-gated silence and a
  stale callback produce a zero frame instead of restarting idle animation
- hidden/static SVG visualizer when it is disabled; album and glowing-object
  motion consumers remain independent when enabled

Wallpaper Engine audio is the PC-wide mixed output rather than a Spotify-only
stream. While Spotify playback is eligible, the fixed virtual gain therefore
also affects other applications present in that mix.

## Output

The wallpaper build must produce files suitable for Wallpaper Engine. On
Windows, development uses one safe directory junction from
`projects/myprojects/spotify-wallpaper-dev` to `apps/wallpaper/dist`. The link
command may create a missing junction or accept the same junction again, but
must never delete, replace, or redirect an existing file, directory, symlink,
or different junction. After the first selection in Wallpaper Engine,
developers build and reload instead of importing another copy.

Normal development output must not contain a Workshop ID. Workshop identity
belongs to `apps/wallpaper/workshop-metadata.json` and is injected only by the
Workshop preparation step. The tracked value is either `null` or a positive
decimal string without leading zeroes. Invalid metadata must fail the Workshop
build before writing a prepared project.

The first Workshop publication is owner-only Private, credential-free, and
mock-only. Later **Submit Update** operations use the same ID so Steam can
distribute updates to subscribers. Spotify-connected testing, third-party
access, Limited beta, and general publication remain blocked by the release
gates and require separate approval.
