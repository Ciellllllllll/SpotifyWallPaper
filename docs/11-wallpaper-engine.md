# Wallpaper Engine Integration

## Responsibilities

This domain handles Wallpaper Engine Web Wallpaper compatibility, user properties, audio listener, and browser mock fallback.

## Web wallpaper rule

The display target is a Wallpaper Engine Web Wallpaper. The same app must also open in a normal browser for development preview.

## User properties

Support receiving at least:

- Spotify Client ID
- Spotify Refresh Token
- settings JSON
- selected preset
- visualizer enabled
- performance mode
- debug enabled
- Spotify playback provider
- Spotify backend URL
- Spotify backend Pairing Token

Property parsing must be isolated behind an adapter.

The release build may inject one official HTTPS backend origin. Runtime validation permits that exact origin and HTTP loopback only. Pairing Tokens must never be sent to arbitrary origins or across redirects.

## Browser fallback

When Wallpaper Engine APIs are absent, use mock settings, mock playback, and mock audio data. Do not crash.

## Audio listener

Use Wallpaper Engine audio data if available. Normalize it before visualizer use.

Fallback modes:

- mock waveform in browser preview
- idle animation when audio data is unavailable
- static low-power state if visualizer disabled

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
