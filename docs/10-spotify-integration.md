# Spotify Integration

## Responsibilities

This domain handles Spotify OAuth, token refresh, API polling, normalized playback state, playback operations, and Spotify error handling.

These concerns cross a provider boundary. Mock, direct, and backend are
explicit `PlaybackProvider` kinds with
one polling/control contract. Provider selection distinguishes `mock`,
`ready`, and `invalid`; configuration errors are not network errors. The
runtime owns lifecycle and scheduling, while providers own their transport and
credential state. No provider is required for deterministic browser mock mode.

## OAuth policy

Use Authorization Code with PKCE. Do not use Client Secret in the Web Wallpaper.

The wallpaper accepts Client ID and Refresh Token through its dedicated
Wallpaper Engine property or explicit process-memory session input. Standard
Wallpaper Engine direct mode persists credentials in its dedicated IndexedDB
store as the limited exception described below.
Settings JSON is preference-only: embedded credentials are ignored and are
never migrated or exported. The configurator may help the user obtain a
Refresh Token, but raw credentials stay in the native/provider boundary.

Do not log tokens or full callback URLs.

## Provider modes

- `direct`: standard Wallpaper Engine access to Spotify using each user's Client ID and Refresh Token.
- `backend` with loopback HTTP: optional local Rust backend.
- `backend` with exact origin
  `https://ciel-spotify-wallpaper.duckdns.org`: optional Node.js/PostgreSQL
  VPS backend. Production is policy-locked and cannot currently provide
  Spotify data.
- no usable provider: browser mock or last safe display.

An explicitly selected but invalid backend configuration must not silently fall back to direct credentials.

## Static authorization and direct credential persistence

Initial authorization and reauthorization use the static Pages helper at
`https://ciellllllllll.github.io/SpotifyWallPaper/spotify-auth/` with exact
Redirect URI `https://ciellllllllll.github.io/SpotifyWallPaper/spotify-auth/callback/`.
These are deployment targets, not a claim that this migration published them.
Each user enters an editable Client ID; no build-time Spotify credential is
required. PKCE S256 state, verifier, Client ID, Redirect URI, and creation time
belong to one single-use, ten-minute sessionStorage transaction. Callback
parameters are removed from the browser URL before network completion.

The helper hands off `swpt2.` data containing the minimum credentials and
authorization identity/time. Compatible `swpt1.` input remains accepted with
unknown original authorization time. Base64url is encoding, not encryption;
both formats contain a secret Refresh Token, unlike a backend `swpb1.` token.
The helper keeps successful credentials only in page memory for explicit copy.
GitHub receives the initial callback request containing its short-lived code;
this is not an entirely server-free OAuth exchange.

Wallpaper Engine uses IndexedDB `spotify-wallpaper-direct-credentials`, store
`credentials`, separately from settings. It contains plaintext Client ID,
latest Refresh/Access Tokens, expiry, authorization identity, revision, and a
bounded refresh lease. The host controls its physical profile location.
This is not an OS secret vault and does not protect against same-user malware,
DevTools, or modified wallpaper code. Browser mock startup does not restore it.

Repeated initial property data must retain the latest saved token. New valid
authorization replaces the old one only after persistence succeeds. Empty
explicit input disconnects; absent properties retain state. Disconnect and a
current-revision `invalid_grant` delete active secrets and retain non-secret
retirement digests so stale properties cannot resurrect an authorization.
Deleting the whole storage area removes that protection; clear the host input
and revoke Spotify access when appropriate before clearing storage.

Short atomic transactions, lease identity, authorization identity, and revision
protect shared-storage refresh. No transaction spans a network request.
Provider disposal must not discard a completed token rotation, but an older
authorization cannot overwrite a replacement. A late 401 retries once with the
current token; only current `invalid_grant` retires credentials. Persistence
failure is distinct from revoked authorization and is not a restart guarantee.

Spotify's Refresh Token lifetime is six months from original authorization,
not extended by Access Token refresh. Do not impose a 24-hour lifetime or
convert six months into an automatic 180-day deletion rule. See the
[Spotify refresh documentation](https://developer.spotify.com/documentation/web-api/tutorials/refreshing-tokens).
Wallpaper Engine CORS, storage persistence/sharing, sleep/resume, and real
72-hour operation remain separate real-machine acceptance checks. Separate
storage contexts cannot be promised shared locking or safe token reuse;
authorize each separately and validate real-account behavior.

## Public backend OAuth

The dormant public-backend protocol uses each user's own Spotify Client ID
with Authorization Code + PKCE. It does not use a Client Secret. OAuth state
is single-use and stored only as a digest; the PKCE verifier is encrypted and
expires within ten minutes. This protocol is testable only in externally
unreachable `synthetic_test` mode.

After a synthetic successful token exchange, issue
`swpb1.<publicId>.<secret>`. `publicId` has at least 128 bits of entropy and
`secret` at least 256 bits. PostgreSQL stores only `publicId` and a keyed HMAC
digest of `secret`.

Production runs only as `SPOTIFY_MODE=policy_locked`. Every exact allowed
Spotify route/method, including `GET /auth/callback`, returns the fixed
no-store 503 before Node reads body, Cookie, Authorization, database,
rate-limit, random, or outbound-network state. Unknown paths, wrong methods,
and unknown modes fail closed.

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

The dependency-free `normalizeSpotifyPlaybackPayload(raw, fetchedAt)` in
`packages/shared-types` is the single TypeScript authority. It requires a valid
`fetchedAt`, non-empty trimmed track/episode `id` and `uri`, finite bounded
integers for numeric fields, `progressMs <= durationMs`, at most 32 artists and
8 image URLs, and the `none` invariant (`id/uri=null`, zero duration/progress,
not playing). Direct mode wraps its result to retain the `item_null` warning;
the public backend uses the result directly. Rust normalization is intentionally kept
at the language boundary and is aligned through provider-v1 fixtures.

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
