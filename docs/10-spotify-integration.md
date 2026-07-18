# Spotify Integration

## Responsibilities

This domain handles Spotify OAuth, token refresh, API polling, normalized playback state, playback operations, and Spotify error handling.

## OAuth policy

Use Authorization Code with PKCE. Do not use Client Secret in the Web Wallpaper.

The wallpaper may accept Client ID and Refresh Token from Wallpaper Engine properties or settings JSON.
The configurator may help the user obtain Refresh Token.

Do not log tokens or full callback URLs.

## Provider modes

- `direct`: legacy browser-side PKCE refresh using Client ID and Refresh Token.
- `backend` with loopback HTTP: optional local Rust backend.
- `backend` with the exact official HTTPS origin: optional Cloudflare Worker.
- no usable provider: browser mock or last safe display.

An explicitly selected but invalid backend configuration must not silently fall back to direct credentials.

## Public backend OAuth

The public Worker uses each user's own Spotify Client ID with Authorization Code + PKCE. It does not use a Client Secret. OAuth state is single-use and stored only as a digest; the PKCE verifier is encrypted and expires within ten minutes.

After successful token exchange, issue `swpb1.<publicId>.<secret>`. `publicId` has at least 128 bits of entropy and `secret` at least 256 bits. D1 stores only `publicId` and a keyed HMAC digest of `secret`.

Spotify Refresh Tokens expire six months after authorization. `invalid_grant` must delete stored Spotify tokens, stop retrying, mark reauthorization required, and allow reauthorization with the existing Pairing Token.

## Required scopes

Passive display:

- `user-read-currently-playing`
- `user-read-playback-state`

Playback operations:

- `user-modify-playback-state`

Future optional library features must request library scopes only when enabled.

## Normalized playback model

Do not pass raw Spotify API responses directly to UI. Normalize into a display-safe model containing:

- item kind: track, episode, none
- item id
- item uri
- title
- artists or publisher/show names
- album or show title
- image URLs
- duration ms
- progress ms
- is playing
- device state
- shuffle state
- repeat state
- volume percent
- external URL
- fetched timestamp

## Polling

Default polling:

- playing: about 1 second
- paused/stopped: slower, about 3 seconds
- error: backoff
- rate-limited: respect retry delay if available

Public backend defaults:

- playing: about 2 seconds
- paused/stopped: about 5 seconds
- Access Token refresh: single-flight, 60 seconds before expiry
- Spotify 429: persist backoff by Client ID

Between polls, progress display may be interpolated locally while playing.

## Error handling

Classify at least:

- unauthorized
- forbidden
- rate limited
- network error
- unavailable/no active device
- unknown response shape
- item null

Errors must not crash the wallpaper.

Public API responses use `{ ok: true, value }` or `{ ok: false, error }`, preserve `retryAfterMs`, return normalized playback only, keep `source: 'spotify'`, and include `fetchedAt`.

## Playback controls

Support when allowed:

- play/pause
- next
- previous
- seek
- volume
- shuffle
- repeat

Premium or restricted-device failures must show safe disabled/error state.
